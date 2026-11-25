-- Aşama 7: sepet, favoriler, adresler ve ileti izinleri. Kurallar: docs/veritabani.md.

-- ---------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------

-- Üye sepeti süresizdir; misafir sepeti kodun özetiyle bulunur ve 30 gün sonra biter.
create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles (id) on delete restrict,
  token_hash text unique,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((user_id is null) <> (token_hash is null)),
  check ((user_id is null) = (expires_at is not null))
);
create index on public.carts (expires_at) where user_id is null;

-- Fiyat saklanmaz; her okumada varyanttan alınır.
create table public.cart_items (
  cart_id uuid not null references public.carts (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id) on delete restrict,
  quantity integer not null check (quantity between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cart_id, variant_id)
);
create index on public.cart_items (variant_id);

create table public.favorites (
  user_id uuid not null references public.profiles (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index on public.favorites (product_id);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 40),
  recipient text not null check (char_length(recipient) between 2 and 100),
  phone text not null check (phone ~ '^\+905[0-9]{9}$'),
  city text not null check (city in (
    'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Aksaray', 'Amasya', 'Ankara', 'Antalya',
    'Ardahan', 'Artvin', 'Aydın', 'Balıkesir', 'Bartın', 'Batman', 'Bayburt', 'Bilecik', 'Bingöl',
    'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır',
    'Düzce', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun',
    'Gümüşhane', 'Hakkâri', 'Hatay', 'Iğdır', 'Isparta', 'İstanbul', 'İzmir', 'Kahramanmaraş',
    'Karabük', 'Karaman', 'Kars', 'Kastamonu', 'Kayseri', 'Kilis', 'Kırıkkale', 'Kırklareli',
    'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Mardin', 'Mersin', 'Muğla',
    'Muş', 'Nevşehir', 'Niğde', 'Ordu', 'Osmaniye', 'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop',
    'Sivas', 'Şanlıurfa', 'Şırnak', 'Tekirdağ', 'Tokat', 'Trabzon', 'Tunceli', 'Uşak', 'Van',
    'Yalova', 'Yozgat', 'Zonguldak')),
  district text not null check (char_length(district) between 2 and 60),
  line text not null check (char_length(line) between 10 and 300),
  postal_code text check (postal_code ~ '^[0-9]{5}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.addresses (user_id);
create unique index addresses_one_default on public.addresses (user_id) where is_default;

-- İzni kaldırmak da yeni kayıttır; geçerli olan son kayıttır (seq).
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  user_id uuid not null references public.profiles (id) on delete restrict,
  kind text not null check (kind in ('email_marketing', 'sms_marketing')),
  granted boolean not null,
  source text not null check (source in ('account')),
  at timestamptz not null default now()
);
create index on public.consents (user_id, kind, seq desc);

create trigger carts_touch before update on public.carts
for each row execute function private.touch_updated_at();
create trigger cart_items_touch before update on public.cart_items
for each row execute function private.touch_updated_at();
create trigger addresses_touch before update on public.addresses
for each row execute function private.touch_updated_at();
create trigger consents_append_only before update or delete on public.consents
for each row execute function private.forbid_change();
create trigger consents_no_truncate before truncate on public.consents
for each statement execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- Ortak denetimler
-- ---------------------------------------------------------------------------

create function private.require_session()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_active_session() then
    raise exception 'Oturumunuz kapanmış. Yeniden giriş yapın.' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;

-- Kişinin kendi kayıtlarına aynı anda yapılan değişiklikleri sıraya koyar.
create function private.lock_me()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_session();
begin
  perform 1 from public.profiles where id = v_user for no key update;
  return v_user;
end;
$$;

-- Satılabilir adet; varyant mağazada görünmüyorsa null.
create function private.sellable(p_variant uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select i.on_hand - i.reserved
  from public.product_variants v
  join public.products p on p.id = v.product_id
  join public.inventory i on i.variant_id = v.id
  where v.id = p_variant and v.is_active and p.status = 'published'
$$;

-- ---------------------------------------------------------------------------
-- Sepet: giriş yapan kişi yalnızca kendi sepetine, misafir yalnızca kodunun sepetine ulaşır.
-- ---------------------------------------------------------------------------

create function private.cart_hash(p_token text)
returns text
language sql immutable set search_path = ''
as $$
  select case when p_token ~ '^[0-9a-f]{64}$'
    then encode(sha256(convert_to(p_token, 'UTF8')), 'hex') end
$$;

create function private.find_cart(p_token text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select id from public.carts
  where (select auth.uid()) is null
    and token_hash = private.cart_hash(p_token) and expires_at > now()
  union all
  select id from public.carts
  where user_id = (select auth.uid()) and (select private.is_active_session())
$$;

-- Yazmak için sepeti kilitler; yoksa oluşturur. Misafirin yeni kodu burada üretilir.
create function private.open_cart(p_token text, out cart_id uuid, out token text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
begin
  if (select auth.uid()) is not null then
    v_user := private.require_session();
    insert into public.carts (user_id) values (v_user) on conflict (user_id) do nothing;
    select c.id into cart_id from public.carts c where c.user_id = v_user for update;
    return;
  end if;

  update public.carts c set expires_at = now() + interval '30 days'
  where c.id = private.find_cart(p_token)
  returning c.id into cart_id;
  if found then
    token := p_token;
    return;
  end if;

  -- Süresi dolan sepetler yeni sepet açılırken azar azar silinir.
  delete from public.carts c where c.id in (
    select x.id from public.carts x where x.expires_at < now()
    limit 100 for update skip locked);

  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.carts (token_hash, expires_at)
  values (private.cart_hash(token), now() + interval '30 days')
  returning id into cart_id;
end;
$$;

create function public.cart_count(p_token text default null)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(quantity), 0)::integer from public.cart_items
  where cart_id = private.find_cart(p_token)
$$;

-- Satıştan kalkan ürünün hiçbir bilgisi verilmez; tükenen ve kalkan toplama girmez.
create function public.cart_get(p_token text default null)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with lines as (
    select ci.variant_id, ci.quantity, ci.created_at, v.price, s.available,
      p.name, p.slug, c.name as color, z.name as size, g.path, g.alt
    from public.cart_items ci
    join public.product_variants v on v.id = ci.variant_id
    join public.products p on p.id = v.product_id
    cross join lateral (select private.sellable(v.id) as available) s
    left join public.colors c on c.id = v.color_id
    left join public.sizes z on z.id = v.size_id
    left join lateral (
      select i.path, i.alt from public.product_images i
      where i.product_id = p.id
      order by coalesce(i.color_id = v.color_id, false) desc, i.sort_order, i.created_at, i.id
      limit 1
    ) g on true
    where ci.cart_id = private.find_cart(p_token)
  )
  select jsonb_build_object(
    'subtotal', coalesce(sum(price * quantity) filter (where available > 0), 0),
    'items', coalesce(jsonb_agg(
      case when available is null then
        jsonb_build_object('variant_id', variant_id, 'quantity', quantity, 'state', 'gone')
      else
        jsonb_build_object('variant_id', variant_id, 'quantity', quantity,
          'state', case when available = 0 then 'out' when available < quantity then 'short' else 'ok' end,
          'name', name, 'slug', slug, 'color', color, 'size', size, 'price', price,
          'image_path', path, 'image_alt', alt)
      end order by created_at, variant_id), '[]'))
  from lines
$$;

create function public.cart_add(p_token text, p_variant uuid, p_quantity integer default 1)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_available integer := private.sellable(p_variant);
  v_cart uuid;
  v_token text;
  v_quantity integer;
begin
  if p_quantity is null or p_quantity not between 1 and 10 then
    raise exception 'Geçersiz adet.' using errcode = '22023';
  end if;
  if v_available is null then
    raise exception 'Bu ürün artık satışta değil.' using errcode = 'P0002';
  end if;
  if v_available = 0 then
    raise exception 'Bu ürün tükendi.' using errcode = '22023';
  end if;

  select o.cart_id, o.token into v_cart, v_token from private.open_cart(p_token) o;

  select quantity into v_quantity from public.cart_items
  where cart_id = v_cart and variant_id = p_variant;
  if not found and (select count(*) from public.cart_items where cart_id = v_cart) >= 50 then
    raise exception 'Sepetinizde en fazla 50 çeşit ürün olabilir.' using errcode = '22023';
  end if;
  v_quantity := coalesce(v_quantity, 0) + p_quantity;
  if v_quantity > 10 then
    raise exception 'Bir üründen en fazla 10 adet alabilirsiniz.' using errcode = '22023';
  end if;
  if v_quantity > v_available then
    raise exception 'Bu üründen istediğiniz kadar kalmadı.' using errcode = '22023';
  end if;

  insert into public.cart_items (cart_id, variant_id, quantity)
  values (v_cart, p_variant, v_quantity)
  on conflict (cart_id, variant_id) do update set quantity = excluded.quantity;

  return jsonb_build_object('token', v_token);
end;
$$;

-- Sepetteki ürünün adedini değiştirir; 0 kaldırır. Azaltmak her zaman serbesttir.
create function public.cart_set(p_token text, p_variant uuid, p_quantity integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_cart uuid;
  v_current integer;
  v_available integer;
begin
  if p_quantity is null or p_quantity not between 0 and 10 then
    raise exception 'Geçersiz adet.' using errcode = '22023';
  end if;
  if (select auth.uid()) is not null then
    perform private.require_session();
  end if;
  -- Satır kilidi değişiklikleri sıraya koyar; misafirin süresi de yenilenir.
  update public.carts set expires_at = case when user_id is null then now() + interval '30 days' end
  where id = private.find_cart(p_token)
  returning id into v_cart;
  select quantity into v_current from public.cart_items
  where cart_id = v_cart and variant_id = p_variant;
  if not found then
    if p_quantity = 0 then return; end if;
    raise exception 'Bu ürün sepetinizde yok.' using errcode = 'P0002';
  end if;

  if p_quantity = 0 then
    delete from public.cart_items where cart_id = v_cart and variant_id = p_variant;
    return;
  end if;
  if p_quantity > v_current then
    v_available := private.sellable(p_variant);
    if v_available is null then
      raise exception 'Bu ürün artık satışta değil.' using errcode = 'P0002';
    end if;
    if p_quantity > v_available then
      raise exception 'Bu üründen istediğiniz kadar kalmadı.' using errcode = '22023';
    end if;
  end if;
  update public.cart_items set quantity = p_quantity
  where cart_id = v_cart and variant_id = p_variant;
end;
$$;

-- Girişte misafir sepetini üye sepetine katar. Aynı üründe büyük adet kalır.
-- Tekrarlanırsa misafir sepeti artık olmadığı için hiçbir şey değişmez.
create function public.cart_merge(p_token text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_guest uuid;
  v_member uuid;
begin
  perform private.require_session();
  select id into v_guest from public.carts
  where token_hash = private.cart_hash(p_token) and expires_at > now()
  for update;
  if not found then return false; end if;

  select o.cart_id into v_member from private.open_cart(null) o;

  -- Üye sepeti 50 çeşidi aşmaz; sığmayanlar eklenme sırasıyla dışarıda kalır.
  insert into public.cart_items (cart_id, variant_id, quantity, created_at)
  select v_member, g.variant_id, g.quantity, g.created_at
  from (
    select gi.*, mi.variant_id is not null as known,
      row_number() over (
        partition by mi.variant_id is not null order by gi.created_at, gi.variant_id) as n
    from public.cart_items gi
    left join public.cart_items mi on mi.cart_id = v_member and mi.variant_id = gi.variant_id
    where gi.cart_id = v_guest
  ) g
  where g.known or g.n <= 50 - (select count(*) from public.cart_items where cart_id = v_member)
  on conflict (cart_id, variant_id)
  do update set quantity = greatest(public.cart_items.quantity, excluded.quantity);

  delete from public.carts where id = v_guest;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Favoriler
-- ---------------------------------------------------------------------------

create function public.set_favorite(p_slug text, p_on boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.lock_me();
  v_product uuid;
begin
  if p_on is not true then
    delete from public.favorites f using public.products p
    where f.user_id = v_user and p.id = f.product_id and p.slug = p_slug;
    return;
  end if;
  select id into v_product from public.products where slug = p_slug and status = 'published';
  if not found then
    raise exception 'Bu ürün artık satışta değil.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.favorites where user_id = v_user and product_id <> v_product) >= 200 then
    raise exception 'En fazla 200 favoriniz olabilir.' using errcode = '22023';
  end if;
  insert into public.favorites (user_id, product_id) values (v_user, v_product)
  on conflict do nothing;
end;
$$;

-- Oturum geçerli değilse null.
create function public.is_favorite(p_slug text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case when private.is_active_session() then exists (
    select 1 from public.favorites f join public.products p on p.id = f.product_id
    where f.user_id = (select auth.uid()) and p.slug = p_slug) end
$$;

-- Yalnızca hâlâ yayında olanlar; alanlar mağaza listesiyle aynıdır.
create function public.list_favorites()
returns table (
  name text, slug text, price bigint, compare_at_price bigint, has_more_prices boolean,
  color_count integer, sold_out boolean, image_path text, image_alt text
)
language sql stable security definer set search_path = ''
as $$
  select p.name, p.slug, v.price, v.compare_at_price, v.has_more_prices, v.color_count,
    v.sold_out, g.path, g.alt
  from public.favorites f
  join public.products p on p.id = f.product_id and p.status = 'published'
  cross join lateral (
    select min(x.price) as price, max(x.price) > min(x.price) as has_more_prices,
      (array_agg(x.compare_at_price order by x.price, x.compare_at_price desc nulls last))[1]
        as compare_at_price,
      count(distinct x.color_id)::integer as color_count,
      bool_and(i.on_hand = i.reserved) as sold_out
    from public.product_variants x join public.inventory i on i.variant_id = x.id
    where x.product_id = p.id and x.is_active
  ) v
  left join lateral (
    select i.path, i.alt from public.product_images i where i.product_id = p.id
    order by i.sort_order, i.created_at, i.id limit 1
  ) g on true
  where f.user_id = (select auth.uid()) and (select private.is_active_session())
  order by f.created_at desc, p.id
$$;

-- ---------------------------------------------------------------------------
-- Adresler. İşlem geçmişine yazılmaz: kişisel veri silinemeyen kayıtta birikmez.
-- ---------------------------------------------------------------------------

-- p_id boşsa yeni adres. İlk adres varsayılan olur; varsayılan işareti buradan kaldırılamaz.
create function public.save_address(
  p_id uuid, p_title text, p_recipient text, p_phone text, p_city text, p_district text,
  p_line text, p_postal_code text, p_default boolean
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.lock_me();
  v_count integer;
  v_default boolean;
  v_id uuid;
begin
  if p_id is null then
    select count(*) into v_count from public.addresses where user_id = v_user;
    if v_count >= 10 then
      raise exception 'En fazla 10 adres kaydedebilirsiniz.' using errcode = '22023';
    end if;
    v_default := v_count = 0 or p_default is true;
  else
    select is_default or p_default is true into v_default from public.addresses
    where id = p_id and user_id = v_user;
    if not found then
      raise exception 'Adres bulunamadı.' using errcode = 'P0002';
    end if;
  end if;

  if v_default then
    update public.addresses set is_default = false
    where user_id = v_user and is_default and id is distinct from p_id;
  end if;

  if p_id is null then
    insert into public.addresses (
      user_id, title, recipient, phone, city, district, line, postal_code, is_default)
    values (v_user, btrim(p_title), btrim(p_recipient), p_phone, p_city, btrim(p_district),
      btrim(p_line), p_postal_code, v_default)
    returning id into v_id;
  else
    update public.addresses set title = btrim(p_title), recipient = btrim(p_recipient),
      phone = p_phone, city = p_city, district = btrim(p_district), line = btrim(p_line),
      postal_code = p_postal_code, is_default = v_default
    where id = p_id and user_id = v_user
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Varsayılan silinirse en son eklenen adres varsayılan olur.
create function public.delete_address(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.lock_me();
  v_was_default boolean;
begin
  delete from public.addresses where id = p_id and user_id = v_user
  returning is_default into v_was_default;
  if not found then
    raise exception 'Adres bulunamadı.' using errcode = 'P0002';
  end if;
  if v_was_default then
    update public.addresses set is_default = true where id = (
      select id from public.addresses where user_id = v_user
      order by created_at desc, id limit 1);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- İleti izinleri
-- ---------------------------------------------------------------------------

create function public.set_consent(p_kind text, p_granted boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.lock_me();
  v_current boolean;
begin
  if p_kind is null or p_kind not in ('email_marketing', 'sms_marketing') or p_granted is null then
    raise exception 'Geçersiz izin.' using errcode = '22023';
  end if;
  if p_kind = 'sms_marketing' and p_granted
     and (select phone from public.profiles where id = v_user) is null then
    raise exception 'SMS izni için önce telefon numaranızı ekleyin.' using errcode = '22023';
  end if;
  select granted into v_current from public.consents
  where user_id = v_user and kind = p_kind order by seq desc limit 1;
  -- Değişmeyen seçim yeni kayıt üretmez.
  if coalesce(v_current, false) <> p_granted then
    insert into public.consents (user_id, kind, granted, source)
    values (v_user, p_kind, p_granted, 'account');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Erişim izinleri
-- ---------------------------------------------------------------------------

alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.favorites enable row level security;
alter table public.addresses enable row level security;
alter table public.consents enable row level security;

revoke all on public.carts, public.cart_items, public.favorites, public.addresses, public.consents
from public, anon, authenticated, service_role;
revoke all on sequence public.consents_seq_seq from public, anon, authenticated, service_role;

-- Sepet ve favori tabloları doğrudan okunamaz. Yazma her yerde yalnızca fonksiyonla yapılır.
grant select on public.addresses, public.consents to authenticated;
create policy "kendi adreslerini okur" on public.addresses for select to authenticated
using (user_id = (select auth.uid()) and (select private.is_active_session()));
create policy "kendi izinlerini okur" on public.consents for select to authenticated
using (user_id = (select auth.uid()) and (select private.is_active_session()));

revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.is_active_session(), private.has_permission(text),
  private.fold_tr(text) to authenticated;

revoke all on function
  public.cart_count(text), public.cart_get(text), public.cart_add(text, uuid, integer),
  public.cart_set(text, uuid, integer), public.cart_merge(text),
  public.set_favorite(text, boolean), public.is_favorite(text), public.list_favorites(),
  public.save_address(uuid, text, text, text, text, text, text, text, boolean),
  public.delete_address(uuid), public.set_consent(text, boolean)
from public, anon, authenticated, service_role;
grant execute on function
  public.cart_count(text), public.cart_get(text), public.cart_add(text, uuid, integer),
  public.cart_set(text, uuid, integer)
to anon, authenticated;
grant execute on function
  public.cart_merge(text), public.set_favorite(text, boolean), public.is_favorite(text),
  public.list_favorites(),
  public.save_address(uuid, text, text, text, text, text, text, text, boolean),
  public.delete_address(uuid), public.set_consent(text, boolean)
to authenticated;
