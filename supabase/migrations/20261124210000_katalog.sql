-- Aşama 3: katalog. Kurallar: docs/veritabani.md. Okuma yalnızca personele açıktır;
-- mağazanın herkese açık okuması Aşama 6'da eklenir.

-- ---------------------------------------------------------------------------
-- Seçim listeleri
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.categories (parent_id);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.colors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 40),
  hex text not null check (hex ~ '^#[0-9a-f]{6}$'),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- SKU önerisinde kullanılır, ör. HAR.
  code text not null unique check (code ~ '^[A-Z0-9]{1,6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sizes (
  id uuid primary key default gen_random_uuid(),
  size_group text not null check (size_group in ('baby', 'child', 'adult', 'volume', 'one_size')),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  code text not null unique check (code ~ '^[A-Z0-9-]{1,8}$'),
  age_min_months integer check (age_min_months >= 0),
  age_max_months integer check (age_max_months >= age_min_months),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (size_group, name)
);

create table public.size_charts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 80),
  category_id uuid references public.categories (id) on delete restrict,
  rows jsonb not null default '[]' check (jsonb_typeof(rows) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.size_charts (category_id);

-- ---------------------------------------------------------------------------
-- Ürün
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  -- SKU önerisinde kullanılır, ör. AB-0001.
  product_no bigint generated always as identity unique,
  name text not null check (char_length(btrim(name)) between 2 and 150),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 160),
  description text not null default '' check (char_length(description) <= 10000),
  product_type text not null default 'clothing' check (product_type in ('clothing', 'personal_care')),
  audience text not null check (audience in ('baby', 'child', 'adult')),
  gender text not null check (gender in ('female', 'male', 'unisex')),
  brand_id uuid references public.brands (id) on delete restrict,
  material text not null default '' check (char_length(material) <= 500),
  care text check (char_length(care) <= 1000),
  -- Baz puan: %10 = 1000. Varsayılan yok; oran bilinçli seçilir.
  vat_bps integer not null check (vat_bps between 0 and 10000),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'archived') = (archived_at is not null))
);
create index on public.products (brand_id);
create index on public.products (status);

create table public.product_categories (
  product_id uuid not null references public.products (id) on delete restrict,
  category_id uuid not null references public.categories (id) on delete restrict,
  is_primary boolean not null default false,
  primary key (product_id, category_id)
);
create index on public.product_categories (category_id);
create unique index product_categories_one_primary on public.product_categories (product_id)
where is_primary;

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  color_id uuid references public.colors (id) on delete restrict,
  size_id uuid references public.sizes (id) on delete restrict,
  sku text not null unique check (sku ~ '^[A-Z0-9][A-Z0-9-]{1,38}[A-Z0-9]$'),
  -- Metindir: baştaki sıfır korunur.
  barcode text unique check (barcode ~ '^[0-9A-Za-z-]{4,32}$'),
  price bigint not null check (price between 1 and 100000000),
  compare_at_price bigint check (compare_at_price > price and compare_at_price <= 100000000),
  desi numeric(6, 2) check (desi > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (product_id, color_id, size_id)
);
create index on public.product_variants (color_id);
create index on public.product_variants (size_id);

create table public.variant_costs (
  variant_id uuid primary key references public.product_variants (id) on delete restrict,
  cost bigint not null check (cost between 0 and 100000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants (id) on delete restrict,
  old_price bigint,
  new_price bigint not null,
  changed_by uuid references public.profiles (id) on delete restrict,
  changed_at timestamptz not null default now()
);
create index on public.price_history (variant_id, changed_at desc);
create index on public.price_history (changed_by);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  color_id uuid references public.colors (id) on delete restrict,
  path text not null unique
    check (path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$'),
  width integer not null check (width between 1 and 1600),
  height integer not null check (height between 1 and 10000),
  alt text not null check (char_length(btrim(alt)) between 1 and 200),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.product_images (product_id);
create index on public.product_images (color_id);

-- ---------------------------------------------------------------------------
-- Başlangıç seçenekleri (panelden değiştirilebilir)
-- ---------------------------------------------------------------------------

insert into public.sizes (size_group, name, code, age_min_months, age_max_months, sort_order) values
  ('baby', 'Yenidoğan', 'YD', 0, 1, 10),
  ('baby', '0-3 Ay', '0-3A', 0, 3, 20),
  ('baby', '3-6 Ay', '3-6A', 3, 6, 30),
  ('baby', '6-9 Ay', '6-9A', 6, 9, 40),
  ('baby', '9-12 Ay', '9-12A', 9, 12, 50),
  ('baby', '12-18 Ay', '12-18A', 12, 18, 60),
  ('baby', '18-24 Ay', '18-24A', 18, 24, 70);
insert into public.sizes (size_group, name, code, age_min_months, age_max_months, sort_order)
select 'child', y || ' Yaş', y || 'Y', y * 12, y * 12 + 11, 100 + y * 10
from generate_series(2, 14) y;
insert into public.sizes (size_group, name, code, sort_order)
select 'adult', s, s, 300 + o::integer * 10
from unnest(array['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']) with ordinality x (s, o);
insert into public.sizes (size_group, name, code, sort_order)
select 'adult', n::text, n::text, 400 + n
from generate_series(36, 46, 2) n;
insert into public.sizes (size_group, name, code, sort_order)
values ('one_size', 'Standart', 'STD', 500);

insert into public.colors (name, hex, slug, code) values
  ('Beyaz', '#ffffff', 'beyaz', 'BEY'), ('Ekru', '#f2ead8', 'ekru', 'EKR'),
  ('Siyah', '#1c1c1c', 'siyah', 'SIY'), ('Gri', '#8c9294', 'gri', 'GRI'),
  ('Lacivert', '#1f2a4d', 'lacivert', 'LAC'), ('Mavi', '#4f86c6', 'mavi', 'MAV'),
  ('Yeşil', '#4c8c5b', 'yesil', 'YES'), ('Hardal', '#f4b942', 'hardal', 'HAR'),
  ('Kırmızı', '#c8323c', 'kirmizi', 'KIR'), ('Pembe', '#eba9bd', 'pembe', 'PEM'),
  ('Lila', '#b9a3d0', 'lila', 'LIL'), ('Kahverengi', '#7a5239', 'kahverengi', 'KAH');

-- ---------------------------------------------------------------------------
-- Tetikleyiciler
-- ---------------------------------------------------------------------------

-- Kategori kendi alt kategorisinin altına giremez. Kilit, eşzamanlı iki taşımayı sıraya koyar.
create function private.check_category_cycle()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.parent_id is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('category_tree'));
  if exists (
    with recursive up as (
      select new.parent_id as id
      union
      select c.parent_id from public.categories c join up on c.id = up.id
      where c.parent_id is not null
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'Kategori kendi altına taşınamaz.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger categories_cycle before insert or update of parent_id on public.categories
for each row execute function private.check_category_cycle();

-- Fiyat ve diğer varyant alanları ayrı izinlere bağlıdır. auth.uid() yoksa işlem
-- migration veya bakım işlemidir.
create function private.check_variant_permission()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT'
     or (new.price, new.compare_at_price) is distinct from (old.price, old.compare_at_price) then
    perform private.require_permission('prices.write');
  end if;
  if tg_op = 'INSERT'
     or (new.sku, new.barcode, new.desi, new.is_active)
        is distinct from (old.sku, old.barcode, old.desi, old.is_active) then
    perform private.require_permission('catalog.write');
  end if;
  return new;
end;
$$;
create trigger variants_permission before insert or update on public.product_variants
for each row execute function private.check_variant_permission();

create function private.record_price()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.price_history (variant_id, old_price, new_price, changed_by)
    values (new.id, null, new.price, auth.uid());
  elsif new.price <> old.price then
    insert into public.price_history (variant_id, old_price, new_price, changed_by)
    values (new.id, old.price, new.price, auth.uid());
  end if;
  return null;
end;
$$;
create trigger variants_price_history after insert or update of price on public.product_variants
for each row execute function private.record_price();

create trigger price_history_append_only before update or delete on public.price_history
for each row execute function private.forbid_change();
create trigger price_history_no_truncate before truncate on public.price_history
for each statement execute function private.forbid_change();

-- Yayın şartları. Ürün satırı kilitlenir: son iki görseli aynı anda silen iki istekten biri durur.
create function private.assert_publishable(p_product uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.products;
begin
  select * into v from public.products where id = p_product for update;
  if v.status is distinct from 'published' then
    return;
  end if;

  if v.product_type = 'personal_care' then
    raise exception 'Kişisel bakım ürünleri mevzuat kontrolü tamamlanana kadar yayınlanamaz.'
      using errcode = '22023';
  end if;
  if btrim(v.description) = '' or btrim(v.material) = '' then
    raise exception 'Yayın için açıklama ve malzeme bilgisi gerekir.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.product_categories where product_id = p_product and is_primary
  ) then
    raise exception 'Yayın için ana kategori gerekir.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.product_variants where product_id = p_product and is_active
  ) then
    raise exception 'Yayın için en az bir aktif varyant gerekir.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.product_variants
    where product_id = p_product and is_active and (color_id is null or size_id is null)
  ) then
    raise exception 'Giyim ürününün aktif varyantlarında renk ve beden gerekir.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.product_images where product_id = p_product) then
    raise exception 'Yayın için en az bir görsel gerekir.' using errcode = '22023';
  end if;
end;
$$;

create function private.check_published()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  perform private.assert_publishable(
    (case when tg_table_name = 'products' then v_row ->> 'id' else v_row ->> 'product_id' end)::uuid);
  return null;
end;
$$;

-- İşlem sonunda denetlenir; böylece tek işlemde eski görsel silinip yenisi eklenebilir.
create constraint trigger products_published after update on public.products
deferrable initially deferred for each row execute function private.check_published();
create constraint trigger categories_published after update or delete on public.product_categories
deferrable initially deferred for each row execute function private.check_published();
create constraint trigger variants_published after insert or update or delete on public.product_variants
deferrable initially deferred for each row execute function private.check_published();
create constraint trigger images_published after update or delete on public.product_images
deferrable initially deferred for each row execute function private.check_published();

-- Katalog değişiklikleri işlem geçmişine yazılır; güncellemede yalnızca değişen alanlar.
create function private.audit_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_keys text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key) into v_keys
    from jsonb_each(v_new) n
    where n.key <> 'updated_at' and n.value is distinct from v_old -> n.key;
    if v_keys is null then
      return null;
    end if;
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
    into v_old, v_new
    from unnest(v_keys) k;
  end if;

  perform private.write_audit(
    tg_table_name || '.' || lower(tg_op), tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'product_id', v_row ->> 'variant_id')::uuid,
    v_old, v_new);
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['categories', 'brands', 'colors', 'sizes', 'size_charts', 'products',
    'product_variants', 'variant_costs', 'product_images']
  loop
    execute format('create trigger %I before update on public.%I
      for each row execute function private.touch_updated_at()', t || '_touch', t);
  end loop;
  foreach t in array array['categories', 'brands', 'colors', 'sizes', 'size_charts', 'products',
    'product_categories', 'product_variants', 'variant_costs', 'product_images']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I
      for each row execute function private.audit_row()', t || '_audit', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Yayın durumu
-- ---------------------------------------------------------------------------

create function public.set_product_status(p_product uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
begin
  perform private.require_permission('catalog.write');
  select status into v_status from public.products where id = p_product for update;
  if v_status is null then
    raise exception 'Ürün bulunamadı.' using errcode = 'P0002';
  end if;
  if p_status is null or p_status not in ('draft', 'published', 'archived') then
    raise exception 'Geçersiz durum.' using errcode = '22023';
  end if;
  if v_status = p_status then
    return;
  end if;
  if v_status = 'archived' and p_status = 'published' then
    raise exception 'Arşivdeki ürün önce taslağa alınmalıdır.' using errcode = '22023';
  end if;

  update public.products
  set status = p_status, archived_at = case when p_status = 'archived' then now() end
  where id = p_product;
  perform private.assert_publishable(p_product);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS ve erişim izinleri
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['categories', 'brands', 'colors', 'sizes', 'size_charts', 'products',
    'product_categories', 'product_variants', 'variant_costs', 'price_history', 'product_images']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    if t <> 'variant_costs' then
      execute format('create policy "katalog okur" on public.%I for select to authenticated
        using ((select private.has_permission(''catalog.read'')))', t);
    end if;
  end loop;

  foreach t in array array['categories', 'brands', 'colors', 'sizes', 'size_charts', 'products',
    'product_categories', 'product_images']
  loop
    execute format('create policy "katalog ekler" on public.%I for insert to authenticated
      with check ((select private.has_permission(''catalog.write'')))', t);
    execute format('create policy "katalog değiştirir" on public.%I for update to authenticated
      using ((select private.has_permission(''catalog.write'')))
      with check ((select private.has_permission(''catalog.write'')))', t);
  end loop;

  -- Ürün ve varyant silinmez; arşivlenir veya pasifleştirilir.
  foreach t in array array['categories', 'brands', 'colors', 'sizes', 'size_charts',
    'product_categories', 'product_images']
  loop
    execute format('grant delete on public.%I to authenticated', t);
    execute format('create policy "katalog siler" on public.%I for delete to authenticated
      using ((select private.has_permission(''catalog.write'')))', t);
  end loop;
end;
$$;

grant insert (parent_id, name, slug, sort_order, is_active),
  update (parent_id, name, slug, sort_order, is_active) on public.categories to authenticated;
grant insert (name, slug), update (name, slug) on public.brands to authenticated;
grant insert (name, hex, slug, code), update (name, hex, slug, code) on public.colors to authenticated;
grant insert (size_group, name, code, age_min_months, age_max_months, sort_order),
  update (size_group, name, code, age_min_months, age_max_months, sort_order)
  on public.sizes to authenticated;
grant insert (name, category_id, rows), update (name, category_id, rows)
  on public.size_charts to authenticated;
grant insert (name, slug, description, product_type, audience, gender, brand_id, material, care, vat_bps),
  update (name, slug, description, product_type, audience, gender, brand_id, material, care, vat_bps)
  on public.products to authenticated;
grant insert (product_id, category_id, is_primary), update (is_primary)
  on public.product_categories to authenticated;
grant insert (product_id, color_id, size_id, sku, barcode, price, compare_at_price, desi, is_active),
  update (sku, barcode, price, compare_at_price, desi, is_active)
  on public.product_variants to authenticated;
grant insert (product_id, color_id, path, width, height, alt, sort_order),
  update (color_id, alt, sort_order) on public.product_images to authenticated;
grant insert (variant_id, cost), update (cost) on public.variant_costs to authenticated;

create policy "varyant ekler" on public.product_variants for insert to authenticated
with check ((select private.has_permission('catalog.write')) and (select private.has_permission('prices.write')));
-- Hangi alanın hangi izinle değiştiğini variants_permission tetikleyicisi denetler.
create policy "varyant değiştirir" on public.product_variants for update to authenticated
using ((select private.has_permission('catalog.write')) or (select private.has_permission('prices.write')))
with check ((select private.has_permission('catalog.write')) or (select private.has_permission('prices.write')));

create policy "maliyet okur" on public.variant_costs for select to authenticated
using ((select private.has_permission('costs.read')));
create policy "maliyet ekler" on public.variant_costs for insert to authenticated
with check ((select private.has_permission('costs.write')));
create policy "maliyet değiştirir" on public.variant_costs for update to authenticated
using ((select private.has_permission('costs.write')))
with check ((select private.has_permission('costs.write')));

revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.is_active_session(), private.has_permission(text) to authenticated;
revoke all on function public.set_product_status(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_product_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Görsel deposu: herkes okur, yalnızca catalog.write yazar ve siler; üzerine yazılamaz.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 4194304, array['image/webp'])
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "ürün görseli okur" on storage.objects for select to authenticated
using (bucket_id = 'product-images' and (select private.has_permission('catalog.read')));
create policy "ürün görseli ekler" on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$'
  and (select private.has_permission('catalog.write'))
);
create policy "ürün görseli siler" on storage.objects for delete to authenticated
using (bucket_id = 'product-images' and (select private.has_permission('catalog.write')));
