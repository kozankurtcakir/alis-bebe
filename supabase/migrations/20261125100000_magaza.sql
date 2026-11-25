-- Aşama 6: mağaza. Ziyaretçi hiçbir tabloyu okuyamaz; yalnızca aşağıdaki shop_* fonksiyonlarının
-- seçtiği alanları görür. Maliyet, barkod, SKU, kesin stok ve yayında olmayan ürün dışarı çıkmaz.

-- ---------------------------------------------------------------------------
-- Türkçe arama
-- ---------------------------------------------------------------------------

-- Büyük/küçük harf, İ/I/ı/i ve aksan farkını kaldırır: 'IŞIK', 'ışık' ve 'isik' aynı olur.
create function private.fold_tr(p_text text)
returns text
language sql immutable parallel safe
as $$
  select lower(regexp_replace(
    normalize(translate(p_text, 'Iı', 'ii'), NFKD), U&'[\0300-\036F]', '', 'g'))
$$;

-- Yalnızca harf ve rakamdan oluşan sözcükler.
create function private.search_words(p_text text)
returns text
language sql immutable parallel safe
as $$
  select btrim(regexp_replace(private.fold_tr(p_text), '[^[:alnum:]]+', ' ', 'g'))
$$;

-- Panel araması. Çağıranın yetkisiyle çalışır; RLS geçerlidir.
create function public.search_products(p_query text)
returns setof public.products
language sql stable security invoker set search_path = ''
as $$
  select p.* from public.products p
  where strpos(private.fold_tr(p.name), private.fold_tr(btrim(p_query))) > 0
    or exists (
      select 1 from public.product_variants v
      where v.product_id = p.id
        and (starts_with(v.sku, upper(btrim(p_query))) or v.barcode = btrim(p_query)))
$$;

create or replace function public.list_stock(p_query text, p_state text, p_page integer)
returns table (
  variant_id uuid, product_name text, color text, size text, sku text,
  on_hand integer, reserved integer, available integer, critical_level integer,
  is_sellable boolean
)
language sql stable security invoker set search_path = ''
as $$
  with q as (select btrim(coalesce(p_query, '')) as text)
  select i.variant_id, p.name, c.name, s.name, v.sku,
    i.on_hand, i.reserved, i.on_hand - i.reserved, i.critical_level,
    v.is_active and p.status <> 'archived'
  from q
  cross join public.inventory i
  join public.product_variants v on v.id = i.variant_id
  join public.products p on p.id = v.product_id
  left join public.colors c on c.id = v.color_id
  left join public.sizes s on s.id = v.size_id
  where (q.text = '' or strpos(private.fold_tr(p.name), private.fold_tr(q.text)) > 0
      or starts_with(v.sku, upper(q.text)) or v.barcode = q.text)
    and case p_state
      when 'out' then v.is_active and p.status <> 'archived' and i.on_hand = i.reserved
      when 'critical' then v.is_active and p.status <> 'archived'
        and i.on_hand > i.reserved and i.on_hand - i.reserved <= i.critical_level
      else true
    end
  order by p.name, p.id, c.name, s.sort_order, v.sku
  limit 51
  offset (least(greatest(coalesce(p_page, 1), 1), 10000) - 1) * 50;
$$;

-- ---------------------------------------------------------------------------
-- İlk yayın tarihi: "yeni gelenler" sırası taslağın değil yayının tarihine bakar.
-- ---------------------------------------------------------------------------

alter table public.products add published_at timestamptz;

create function private.stamp_published()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;
create trigger products_published_at before insert or update of status on public.products
for each row execute function private.stamp_published();

update public.products set published_at = updated_at where status = 'published';
create index products_shop_order on public.products (published_at desc, id)
where status = 'published';

-- ---------------------------------------------------------------------------
-- Mağazanın ortak kuralları (yalnızca bu dosyadaki fonksiyonlar çağırır)
-- ---------------------------------------------------------------------------

-- Kendisi ve bütün üstleri aktif olan kategoriler.
create function private.shop_category_tree()
returns table (id uuid, parent_id uuid, name text, slug text, sort_order integer, path uuid[])
language sql stable security definer set search_path = ''
as $$
  with recursive tree as (
    select c.id, c.parent_id, c.name, c.slug, c.sort_order, array[c.id] as path
    from public.categories c
    where c.parent_id is null and c.is_active
    union all
    select c.id, c.parent_id, c.name, c.slug, c.sort_order, t.path || c.id
    from public.categories c join tree t on c.parent_id = t.id
    where c.is_active
  )
  select * from tree
$$;

-- Kategoriye ve aramaya uyan yayındaki ürünler. p_category alt kategorileri de kapsar.
create function private.shop_matches(p_category text, p_query text)
returns table (product_id uuid, name_match boolean)
language sql stable security definer set search_path = ''
as $$
  with q as (
    select (string_to_array(private.search_words(left(p_query, 100)), ' '))[1:8] as words
  ), cats as (
    select t.id from private.shop_category_tree() t
    where (select c.id from public.categories c where c.slug = p_category) = any (t.path)
  )
  select p.id, not exists (
    select 1 from unnest(q.words) w
    where strpos(' ' || private.search_words(p.name), ' ' || w) = 0)
  from q cross join public.products p
  where p.status = 'published'
    and (p_category is null or exists (
      select 1 from public.product_categories pc
      where pc.product_id = p.id and pc.category_id in (select cats.id from cats)))
    and (coalesce(cardinality(q.words), 0) = 0 or not exists (
      select 1
      from (
        select ' ' || private.search_words(concat_ws(' ', p.name, p.material,
          (select b.name from public.brands b where b.id = p.brand_id),
          case p.audience when 'baby' then 'bebek' when 'child' then 'çocuk' else 'yetişkin' end,
          case p.gender when 'female' then 'kız kadın' when 'male' then 'erkek' else 'unisex' end,
          (select string_agg(c.name, ' ') from public.product_categories pc
           join public.categories c on c.id = pc.category_id where pc.product_id = p.id),
          (select string_agg(distinct c.name, ' ') from public.product_variants v
           join public.colors c on c.id = v.color_id
           where v.product_id = p.id and v.is_active))) as text
        -- Alt sorgu bir kez hesaplansın diye; her sözcükte yinelenmez.
        offset 0
      ) t, unnest(q.words) w
      where strpos(t.text, ' ' || w) = 0))
$$;

-- ---------------------------------------------------------------------------
-- Ziyaretçiye açık okuma
-- ---------------------------------------------------------------------------

create function public.shop_categories()
returns table (name text, slug text, parent_slug text)
language sql stable security definer set search_path = ''
as $$
  select t.name, t.slug, p.slug
  from private.shop_category_tree() t
  left join public.categories p on p.id = t.parent_id
  order by cardinality(t.path), t.sort_order, t.name collate "tr-x-icu"
$$;

-- Süzgeçlerin hepsine tek bir varyant uymalıdır. total: bütün sayfalardaki ürün sayısı.
create function public.shop_products(
  p_category text default null, p_query text default null,
  p_sizes text[] default '{}', p_colors text[] default '{}', p_brands text[] default '{}',
  p_genders text[] default '{}', p_min bigint default null, p_max bigint default null,
  p_in_stock boolean default false, p_sort text default 'new', p_page integer default 1,
  p_limit integer default 24
)
returns table (
  name text, slug text, price bigint, compare_at_price bigint, has_more_prices boolean,
  color_count integer, sold_out boolean, image_path text, image_alt text,
  total bigint
)
language sql stable security definer set search_path = ''
as $$
  with found as (
    select m.product_id, m.name_match,
      min(v.price) as price, max(v.price) > min(v.price) as has_more_prices,
      (array_agg(v.compare_at_price order by v.price, v.compare_at_price desc nulls last))[1]
        as compare_at_price,
      count(distinct v.color_id)::integer as color_count,
      bool_and(i.on_hand = i.reserved) as sold_out
    from private.shop_matches(p_category, p_query) m
    join public.products p on p.id = m.product_id
    join public.product_variants v on v.product_id = m.product_id and v.is_active
    join public.inventory i on i.variant_id = v.id
    left join public.sizes s on s.id = v.size_id
    left join public.colors c on c.id = v.color_id
    left join public.brands b on b.id = p.brand_id
    where (coalesce(cardinality(p_sizes), 0) = 0 or s.code = any (p_sizes))
      and (coalesce(cardinality(p_colors), 0) = 0 or c.slug = any (p_colors))
      and (coalesce(cardinality(p_brands), 0) = 0 or b.slug = any (p_brands))
      and (coalesce(cardinality(p_genders), 0) = 0 or p.gender = any (p_genders))
      and (p_min is null or v.price >= p_min)
      and (p_max is null or v.price <= p_max)
      and (p_in_stock is not true or i.on_hand > i.reserved)
    group by m.product_id, m.name_match
  ), page as (
    select f.*, p.name, p.slug, count(*) over () as total,
      -- Tükenen ürün her sıralamada sondadır.
      row_number() over (
        order by f.sold_out,
          case when p_sort = 'new' and btrim(coalesce(p_query, '')) <> '' then not f.name_match end,
          case when p_sort = 'price_asc' then f.price end,
          case when p_sort = 'price_desc' then f.price end desc,
          p.published_at desc, p.id) as place
    from found f join public.products p on p.id = f.product_id
    order by place
    limit least(greatest(coalesce(p_limit, 24), 1), 48)
    offset (least(greatest(coalesce(p_page, 1), 1), 1000) - 1)
      * least(greatest(coalesce(p_limit, 24), 1), 48)
  )
  select f.name, f.slug, f.price, f.compare_at_price, f.has_more_prices, f.color_count,
    f.sold_out, g.path, g.alt, f.total
  from page f
  left join lateral (
    select i.path, i.alt
    from public.product_images i
    left join public.colors c on c.id = i.color_id
    where i.product_id = f.product_id
    -- Renk süzülmüşse o rengin görseli öne geçer.
    order by coalesce(c.slug = any (p_colors), false) desc, i.sort_order, i.created_at, i.id
    limit 1
  ) g on true
  order by f.place
$$;

-- Kategorideki veya aramadaki ürünlerde bulunan süzgeç seçenekleri.
create function public.shop_facets(p_category text default null, p_query text default null)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with rows as (
    select p.gender, p.brand_id, v.color_id, v.size_id
    from private.shop_matches(p_category, p_query) m
    join public.products p on p.id = m.product_id
    join public.product_variants v on v.product_id = p.id and v.is_active
  )
  select jsonb_build_object(
    'sizes', (select coalesce(jsonb_agg(
        jsonb_build_object('value', s.code, 'label', s.name) order by s.sort_order, s.name), '[]')
      from public.sizes s where s.id in (select size_id from rows)),
    'colors', (select coalesce(jsonb_agg(
        jsonb_build_object('value', c.slug, 'label', c.name, 'hex', c.hex)
        order by c.name collate "tr-x-icu"), '[]')
      from public.colors c where c.id in (select color_id from rows)),
    'brands', (select coalesce(jsonb_agg(
        jsonb_build_object('value', b.slug, 'label', b.name)
        order by b.name collate "tr-x-icu"), '[]')
      from public.brands b where b.id in (select brand_id from rows)),
    'genders', (select coalesce(jsonb_agg(distinct gender), '[]') from rows),
    'has_products', exists (select 1 from rows))
$$;

-- Tek ürün. Kesin stok yerine yalnızca durum verilir: in, low, out.
create function public.shop_product(p_slug text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'name', p.name, 'description', p.description,
    'material', p.material, 'care', p.care,
    'brand', (select b.name from public.brands b where b.id = p.brand_id),
    'categories', (
      select coalesce(jsonb_agg(
        jsonb_build_object('name', c.name, 'slug', c.slug) order by u.ord), '[]')
      from public.product_categories pc
      join private.shop_category_tree() t on t.id = pc.category_id
      cross join unnest(t.path) with ordinality u (id, ord)
      join public.categories c on c.id = u.id
      where pc.product_id = p.id and pc.is_primary),
    'images', (
      select coalesce(jsonb_agg(
        jsonb_build_object('path', i.path, 'alt', i.alt, 'color', c.slug) order by i.sort_order, i.created_at, i.id), '[]')
      from public.product_images i left join public.colors c on c.id = i.color_id
      where i.product_id = p.id),
    'variants', (
      select coalesce(jsonb_agg(
        jsonb_build_object('id', v.id, 'price', v.price, 'compare_at_price', v.compare_at_price,
          'color', case when c.id is not null then
            jsonb_build_object('slug', c.slug, 'name', c.name, 'hex', c.hex) end,
          'size', case when s.id is not null then
            jsonb_build_object('code', s.code, 'name', s.name) end,
          'stock', case
            when i.on_hand = i.reserved then 'out'
            when i.on_hand - i.reserved <= i.critical_level then 'low'
            else 'in' end)
        order by c.name collate "tr-x-icu", s.sort_order, s.name), '[]')
      from public.product_variants v
      join public.inventory i on i.variant_id = v.id
      left join public.colors c on c.id = v.color_id
      left join public.sizes s on s.id = v.size_id
      where v.product_id = p.id and v.is_active),
    -- Ürünün kategorilerine veya onların üstlerine bağlı tablolar.
    'size_charts', (
      select coalesce(jsonb_agg(
        jsonb_build_object('name', sc.name, 'rows', sc.rows) order by sc.name), '[]')
      from public.size_charts sc
      where sc.category_id in (
        select unnest(t.path) from public.product_categories pc
        join private.shop_category_tree() t on t.id = pc.category_id
        where pc.product_id = p.id)))
  from public.products p
  where p.slug = p_slug and p.status = 'published'
$$;

-- ---------------------------------------------------------------------------
-- Erişim izinleri
-- ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated, service_role;
-- fold_tr yalnızca metin dönüştürür; panel aramaları çağıranın yetkisiyle kullanır.
grant execute on function private.is_active_session(), private.has_permission(text),
  private.fold_tr(text) to authenticated;

revoke all on function
  public.search_products(text),
  public.shop_categories(),
  public.shop_products(text, text, text[], text[], text[], text[], bigint, bigint, boolean, text, integer, integer),
  public.shop_facets(text, text),
  public.shop_product(text)
from public, anon, authenticated, service_role;
grant execute on function public.search_products(text) to authenticated;
grant execute on function
  public.shop_categories(),
  public.shop_products(text, text, text[], text[], text[], text[], bigint, bigint, boolean, text, integer, integer),
  public.shop_facets(text, text),
  public.shop_product(text)
to anon, authenticated;
