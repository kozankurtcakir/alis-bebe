-- Aşama 7 testleri: sepet, favori, adres ve ileti izinleri. Sonunda geri alınır.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create schema tests;
create table tests.users (name text primary key, id uuid not null, session_id uuid not null);

create function tests.new_user(p_name text, p_role text default null)
returns void language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_name || '@pgtap.test', now());
  insert into auth.sessions (id, user_id) values (v_session, v_id);
  insert into tests.users values (p_name, v_id, v_session);
  insert into public.user_roles (user_id, role_id)
  select v_id, id from public.roles where key = p_role;
end $$;

-- Müşteri iki adımlı doğrulama kullanmaz; varsayılan aal1'dir.
create function tests.run_as(p_name text, p_sql text, p_aal text default 'aal1')
returns text language plpgsql as $$
declare
  v_user tests.users;
  v_result text;
begin
  select * into v_user from tests.users where name = p_name;
  perform set_config('request.jwt.claims', case when p_name is null then '{"role":"anon"}' else
    json_build_object('sub', v_user.id, 'role', 'authenticated', 'aal', p_aal,
      'session_id', v_user.session_id)::text end, true);
  begin
    perform set_config('role', case when p_name is null then 'anon' else 'authenticated' end, true);
    execute p_sql into v_result;
    perform set_config('role', 'postgres', true);
  exception when others then
    v_result := 'HATA ' || sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end $$;

create function tests.uid(p_name text) returns uuid language sql as
$$ select id from tests.users where name = p_name $$;

select tests.new_user('a');
select tests.new_user('b');
select tests.new_user('pasif');
select tests.new_user('kapali');
select tests.new_user('sa', 'super_admin');
select tests.new_user('cs', 'customer_service');
update public.profiles set is_active = false where id = tests.uid('pasif');
delete from auth.sessions where user_id = tests.uid('kapali');

-- Fiyatı ve stoğu bilinen ürünler
create table tests.v (name text primary key, id uuid not null);
create function tests.product(p_slug text, p_status text default 'published')
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.products (name, slug, audience, gender, vat_bps, description, material)
  values ('Ürün ' || p_slug, p_slug, 'baby', 'unisex', 1000, 'Açıklama', 'Pamuk')
  returning id into v_id;
  insert into public.product_categories (product_id, category_id, is_primary)
  select v_id, id, true from public.categories where slug = 't-sepet';
  insert into public.product_images (product_id, color_id, path, width, height, alt, sort_order) values
    (v_id, null, gen_random_uuid() || '.webp', 800, 1000, 'Genel', 0),
    (v_id, (select id from public.colors where slug = 'mavi'), gen_random_uuid() || '.webp', 800, 1000, 'Mavi', 1);
  update public.products set status = p_status where id = v_id;
  return v_id;
end $$;
create function tests.variant(p_name text, p_product uuid, p_color text, p_size text, p_price bigint, p_stock integer)
returns void language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.product_variants (product_id, color_id, size_id, sku, price, is_active)
  values (p_product, (select id from public.colors where slug = p_color),
    (select id from public.sizes where code = p_size),
    upper('TST-' || substr(md5(gen_random_uuid()::text), 1, 12)), p_price, true)
  returning id into v_id;
  update public.inventory set on_hand = p_stock where variant_id = v_id;
  insert into tests.v values (p_name, v_id);
end $$;
create function tests.v(p_name text) returns uuid language sql as
$$ select id from tests.v where name = p_name $$;

insert into public.categories (name, slug, sort_order) values ('Sepet', 't-sepet', 900);
do $$
declare
  x uuid := tests.product('t-s1');
  y uuid := tests.product('t-s2');
  z uuid := tests.product('t-s3', 'draft');
begin
  perform tests.variant('bol', x, 'mavi', '3-6A', 19990, 50);
  perform tests.variant('az', x, 'hardal', '3-6A', 10000, 4);
  perform tests.variant('yok', x, 'hardal', '6-9A', 10000, 0);
  perform tests.variant('baska', y, 'mavi', '3-6A', 500, 50);
  perform tests.variant('taslak', z, 'mavi', '3-6A', 500, 50);
  perform tests.variant('kapali', x, 'lila', '3-6A', 500, 50);
end $$;
update public.product_variants set is_active = false where id = tests.v('kapali');
-- Ayrılan stok satılamaz: 4 adet rafta, 1'i ayrılmış.
update public.inventory set reserved = 1 where variant_id = tests.v('az');

create function tests.add(p_as text, p_variant text, p_quantity integer default 1, p_token text default null)
returns text language sql as $$
  select tests.run_as(p_as, format('select public.cart_add(%L, %L, %L)', p_token, tests.v(p_variant), p_quantity)) $$;
create function tests.cset(p_as text, p_variant text, p_quantity integer, p_token text default null)
returns text language sql as $$
  select tests.run_as(p_as, format('select public.cart_set(%L, %L, %L)', p_token, tests.v(p_variant), p_quantity)) $$;
create function tests.get(p_as text, p_token text default null)
returns jsonb language sql as $$
  select tests.run_as(p_as, format('select public.cart_get(%L)', p_token))::jsonb $$;
-- Sepetin özeti: "bol:2 az:1"
create function tests.lines(p_as text, p_token text default null)
returns text language sql as $$
  select coalesce(string_agg(v.name || ':' || (i ->> 'quantity'), ' ' order by v.name), '')
  from jsonb_array_elements(tests.get(p_as, p_token) -> 'items') i
  join tests.v v on v.id = (i ->> 'variant_id')::uuid $$;
create function tests.count(p_as text, p_token text default null)
returns text language sql as $$ select tests.run_as(p_as, format('select public.cart_count(%L)', p_token)) $$;
create function tests.state(p_as text, p_variant text, p_token text default null)
returns text language sql as $$
  select i ->> 'state' from jsonb_array_elements(tests.get(p_as, p_token) -> 'items') i
  where (i ->> 'variant_id')::uuid = tests.v(p_variant) $$;

-- ---------------------------------------------------------------------------
-- Tablolara doğrudan erişim yok
-- ---------------------------------------------------------------------------
select is(tests.run_as(u, 'select count(*) from public.' || t), 'HATA 42501', coalesce(u, 'ziyaretçi') || ' okuyamaz: ' || t)
from unnest(array[null, 'a', 'sa']) u, unnest(array['carts', 'cart_items', 'favorites']) t;
select is(tests.run_as(null, 'select count(*) from public.' || t), 'HATA 42501', 'ziyaretçi okuyamaz: ' || t)
from unnest(array['addresses', 'consents']) t;
select is_empty(
  $$ select c.relname, r, x from pg_class c, unnest(array['anon', 'authenticated', 'service_role']) r,
       unnest(array['insert', 'update', 'delete', 'truncate']) x
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('carts', 'cart_items', 'favorites', 'addresses', 'consents')
       and has_table_privilege(r, c.oid, x) $$, 'beş tabloya kimse doğrudan yazamaz');
select is_empty(
  $$ select c.relname, a.attname from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0
     where c.relnamespace = 'public'::regnamespace
       and c.relname in ('carts', 'cart_items', 'favorites', 'addresses', 'consents')
       and (has_column_privilege('authenticated', c.oid, a.attnum, 'insert')
         or has_column_privilege('authenticated', c.oid, a.attnum, 'update')) $$,
  'sütun bazında da yazma izni yok');
select is(tests.run_as(null, 'select ' || f), 'HATA 42501', 'ziyaretçi çağıramaz: ' || f)
from unnest(array['public.cart_merge(null)', 'public.set_favorite(''t-s1'', true)',
  'public.is_favorite(''t-s1'')', 'count(*) from public.list_favorites()',
  'public.delete_address(gen_random_uuid())', 'public.set_consent(''email_marketing'', true)',
  'public.save_address(null, ''E'', ''Ad'', ''x'', ''x'', ''x'', ''x'', null, true)']) f;
select is(tests.run_as(u, 'select ' || f), 'HATA 42501', coalesce(u, 'ziyaretçi') || ' çağıramaz: ' || f)
from unnest(array[null, 'a']) u, unnest(array['private.find_cart(null)', 'cart_id from private.open_cart(null)',
  'private.sellable(null)', 'private.cart_hash(null)', 'private.lock_me()', 'private.require_session()']) f;

-- ---------------------------------------------------------------------------
-- Üye sepeti
-- ---------------------------------------------------------------------------
select is(tests.get('a'), '{"items": [], "subtotal": 0}', 'yeni üyenin sepeti boş');
select is(tests.count('a'), '0', 'yeni üyenin adedi 0');
select is(tests.add('a', 'bol', 2), '{"token": null}', 'üye ekler, kod almaz');
select is(tests.add('a', 'bol'), '{"token": null}', 'aynı ürün yeniden eklenir');
select is(tests.lines('a'), 'bol:3', 'aynı varyant tek satırda toplanır');
select is(tests.count('a'), '3', 'adet toplamı');
select is(tests.get('a') -> 'subtotal', '59970', 'tutar veritabanındaki fiyattan hesaplanır');
select is((tests.get('a') -> 'items' -> 0) - 'image_path', jsonb_build_object(
  'variant_id', tests.v('bol'), 'quantity', 3, 'state', 'ok', 'name', 'Ürün t-s1', 'slug', 't-s1',
  'color', 'Mavi', 'size', '3-6 Ay', 'price', 19990, 'image_alt', 'Mavi'),
  'yalnızca seçilmiş alanlar ve rengin kendi görseli verilir');
update public.product_variants set price = 15000 where id = tests.v('bol');
select is(tests.get('a') -> 'subtotal', '45000', 'fiyat değişince tutar da değişir');

select is(tests.add('a', 'bol', 8), 'HATA 22023', '10 adet sınırı eklemede uygulanır');
select is(tests.add('a', 'bol', 7), '{"token": null}', '10 adede kadar eklenir');
select is(tests.add('a', 'baska', q), 'HATA 22023', 'geçersiz adet: ' || coalesce(q::text, 'boş'))
from unnest(array[0, -1, 11, null]) q;
select is(tests.add('a', 'az', 4), 'HATA 22023', 'ayrılan stok eklenemez');
select is(tests.add('a', 'az', 3), '{"token": null}', 'satılabilir kadar eklenir');
select is(tests.add('a', 'az', 1), 'HATA 22023', 'sepettekiyle birlikte stok aşılamaz');
select is(tests.add('a', 'yok'), 'HATA 22023', 'tükenen ürün eklenemez');
select throws_ok(format('select public.cart_add(null, %L, 1)', tests.v('yok')), '22023', 'Bu ürün tükendi.', 'tükenen ürünün iletisi');
select is(tests.add('a', x), 'HATA P0002', 'satışta olmayan eklenemez: ' || x) from unnest(array['taslak', 'kapali']) x;
select is(tests.run_as('a', 'select public.cart_add(null, gen_random_uuid(), 1)'), 'HATA P0002', 'olmayan varyant eklenemez');
select is(tests.run_as('a', 'select public.cart_add(null, null, 1)'), 'HATA P0002', 'boş varyant eklenemez');
select is(tests.lines('a'), 'az:3 bol:10', 'reddedilenler sepeti değiştirmedi');
select is((select reserved from public.inventory where variant_id = tests.v('bol')), 0, 'sepet stok ayırmaz');

select is(tests.cset('a', 'bol', 4), '', 'adet azaltılır');
select is(tests.cset('a', 'bol', 5), '', 'adet artırılır');
select is(tests.cset('a', 'bol', q), 'HATA 22023', 'geçersiz yeni adet: ' || coalesce(q::text, 'boş'))
from unnest(array[-1, 11, null]) q;
select is(tests.cset('a', 'baska', 1), 'HATA P0002', 'sepette olmayan ürünün adedi değişmez');
select is(tests.cset('a', 'baska', 0), '', 'sepette olmayanı kaldırmak hata değildir');
select is(tests.cset('a', 'az', 4), 'HATA 22023', 'adet stoğun üstüne çıkarılamaz');
select is(tests.lines('a'), 'az:3 bol:5', 'sepet beklenen durumda');

-- Sonradan değişen stok ve yayın durumu
update public.inventory set on_hand = 3 where variant_id = tests.v('az');
select is(tests.state('a', 'az'), 'short', 'stok yetmezse uyarı durumu');
select is(tests.get('a') -> 'subtotal', '105000', 'yetersiz satır toplamda kalır');
select is(tests.cset('a', 'az', 4), 'HATA 22023', 'yetersizken artırılamaz');
select is(tests.cset('a', 'az', 2), '', 'azaltmak her zaman serbest');
select is(tests.state('a', 'az'), 'ok', 'yeten adet tamam');
update public.inventory set on_hand = 1 where variant_id = tests.v('az');
select is(tests.state('a', 'az'), 'out', 'tümü ayrılmışsa tükendi');
select is(tests.get('a') -> 'subtotal', '75000', 'tükenen toplama girmez');
select is(tests.cset('a', 'az', 1), '', 'tükenen satır azaltılabilir');
update public.product_variants set is_active = false where id = tests.v('az');
select is(
  (select i from jsonb_array_elements(tests.get('a') -> 'items') i where (i ->> 'variant_id')::uuid = tests.v('az')),
  jsonb_build_object('variant_id', tests.v('az'), 'quantity', 1, 'state', 'gone'),
  'satıştan kalkan satırın adı ve fiyatı verilmez');
select is(tests.get('a') -> 'subtotal', '75000', 'satıştan kalkan toplama girmez');
select is(tests.cset('a', 'az', 2), 'HATA P0002', 'satıştan kalkan artırılamaz');
select is(tests.cset('a', 'az', 0), '', 'satıştan kalkan kaldırılabilir');
update public.product_variants set is_active = true where id = tests.v('az');
update public.inventory set on_hand = 4 where variant_id = tests.v('az');

-- ---------------------------------------------------------------------------
-- Başkasının sepeti
-- ---------------------------------------------------------------------------
select is(tests.lines('b'), '', 'b, a''nın sepetini görmez');
select is(tests.cset('b', 'bol', 1), 'HATA P0002', 'b, a''nın adedini değiştiremez');
select is(tests.cset('b', 'bol', 0), '', 'b''nin kaldırması a''yı etkilemez');
select is(tests.add('b', 'baska', 2), '{"token": null}', 'b kendi sepetine ekler');
select is(tests.lines('a'), 'bol:5', 'a''nın sepeti değişmedi');
select is(tests.lines('b'), 'baska:2', 'b''nin sepeti ayrı');
select is(tests.lines('sa'), '', 'personel de müşteri sepetini görmez');
select is(tests.run_as(u, 'select public.cart_add(null, ' || quote_literal(tests.v('bol')) || ', 1)'), 'HATA 42501',
  u || ': sepete ekleyemez')
from unnest(array['pasif', 'kapali']) u;
select is(tests.cset(u, 'bol', 1), 'HATA 42501', u || ': adet değiştiremez') from unnest(array['pasif', 'kapali']) u;
select is(tests.get(u), '{"items": [], "subtotal": 0}', u || ': sepet okuyamaz') from unnest(array['pasif', 'kapali']) u;
insert into public.carts (user_id) values (tests.uid('pasif'));
insert into public.cart_items (cart_id, variant_id, quantity)
select id, tests.v('bol'), 1 from public.carts where user_id = tests.uid('pasif');
select is(tests.lines('pasif'), '', 'pasif hesap eski sepetini okuyamaz');
select is(tests.count('pasif'), '0', 'pasif hesap adet okuyamaz');

-- ---------------------------------------------------------------------------
-- Misafir sepeti
-- ---------------------------------------------------------------------------
create table tests.tokens (name text primary key, token text not null);
create function tests.t(p_name text) returns text language sql as $$ select token from tests.tokens where name = p_name $$;

select is(tests.get(null), '{"items": [], "subtotal": 0}', 'kodsuz ziyaretçinin sepeti boş');
insert into tests.tokens select 'g1', tests.add(null, 'bol', 2)::jsonb ->> 'token';
insert into tests.tokens select 'g2', tests.add(null, 'baska', 1)::jsonb ->> 'token';
select matches(tests.t('g1'), '^[0-9a-f]{64}$', 'kod 64 karakter');
select isnt(tests.t('g1'), tests.t('g2'), 'her misafirin kodu ayrı');
select is_empty(format($$ select 1 from public.carts where token_hash = %L $$, tests.t('g1')), 'kodun kendisi saklanmaz');
select is(private.cart_hash('x'), null, 'biçimi bozuk kodun özeti yoktur');
select is(tests.lines(null, tests.t('g1')), 'bol:2', 'misafir koduyla sepetini görür');
select is(tests.lines(null, tests.t('g2')), 'baska:1', 'öbür misafir yalnızca kendininkini görür');
select is(tests.count(null, tests.t('g1')), '2', 'misafir adedi');
select is(tests.add(null, 'bol', 1, tests.t('g1'))::jsonb ->> 'token', tests.t('g1'), 'kod değişmez');
select is(tests.cset(null, 'bol', 4, tests.t('g1')), '', 'misafir adet değiştirir');
select is(tests.lines(null, tests.t('g1')), 'bol:4', 'misafir sepeti güncellendi');
select is(tests.lines(null, x), '', 'geçersiz kod: ' || left(coalesce(x, 'boş'), 20))
from unnest(array[null, '', 'x', repeat('0', 64), upper(tests.t('g1')), tests.t('g1') || ' ',
  (select token_hash from public.carts where token_hash = encode(sha256(convert_to(tests.t('g1'), 'UTF8')), 'hex'))]) x;
select is(tests.cset(null, 'bol', 1, repeat('0', 64)), 'HATA P0002', 'yanlış kodla adet değişmez');
select isnt(tests.add(null, 'bol', 1, repeat('a', 64))::jsonb ->> 'token', repeat('a', 64),
  'dışarıdan uydurulan kod benimsenmez');
select is(tests.lines('b', tests.t('g1')), 'baska:2', 'giriş yapan kişi kodla misafir sepetini okuyamaz');

-- Süre
select ok((select bool_and(expires_at between now() + interval '29 days' and now() + interval '31 days')
  from public.carts where user_id is null), 'misafir sepeti 30 gün sonra biter');
select ok((select bool_and(expires_at is null) from public.carts where user_id is not null), 'üye sepeti süresizdir');
update public.carts set expires_at = now() + interval '1 day' where token_hash = encode(sha256(convert_to(tests.t('g1'), 'UTF8')), 'hex');
select is(tests.cset(null, 'bol', 3, tests.t('g1')), '', 'kullanılan sepet');
select ok((select expires_at > now() + interval '29 days' from public.carts
  where token_hash = encode(sha256(convert_to(tests.t('g1'), 'UTF8')), 'hex')), 'kullanılınca süre yenilenir');
update public.carts set expires_at = now() + interval '1 day' where token_hash = encode(sha256(convert_to(tests.t('g1'), 'UTF8')), 'hex');
select is(tests.add(null, 'baska', 1, tests.t('g1'))::jsonb ->> 'token', tests.t('g1'), 'süresi azalan sepete ekleme');
select ok((select expires_at > now() + interval '29 days' from public.carts
  where token_hash = encode(sha256(convert_to(tests.t('g1'), 'UTF8')), 'hex')), 'ekleme de süreyi yeniler');
select is(tests.cset(null, 'baska', 0, tests.t('g1')), '', 'eklenen kaldırılır');
update public.carts set expires_at = now() - interval '1 second' where token_hash = encode(sha256(convert_to(tests.t('g2'), 'UTF8')), 'hex');
select is(tests.lines(null, tests.t('g2')), '', 'süresi dolan sepet okunmaz');
select is(tests.count(null, tests.t('g2')), '0', 'süresi dolan sepetin adedi 0');
select is(tests.cset(null, 'baska', 2, tests.t('g2')), 'HATA P0002', 'süresi dolan sepet değişmez');
select is(tests.run_as('b', format('select public.cart_merge(%L)', tests.t('g2'))), 'false', 'süresi dolan sepet birleşmez');
insert into tests.tokens select 'g3', tests.add(null, 'baska', 1, tests.t('g2'))::jsonb ->> 'token';
select isnt(tests.t('g3'), tests.t('g2'), 'süresi dolan kod yeniden kullanılmaz');
select is_empty(format($$ select 1 from public.carts where token_hash = %L $$,
  encode(sha256(convert_to(tests.t('g2'), 'UTF8')), 'hex')), 'süresi dolan sepet silinir');
select is(tests.lines(null, tests.t('g1')), 'bol:3', 'süresi dolmayan sepet silinmez');
select is(tests.lines('a'), 'bol:5', 'üye sepeti temizlikte silinmez');

-- Kurallar doğrudan yazımda da geçerli
select throws_ok($$ insert into public.carts (expires_at) values (now()) $$, '23514', null, 'sahipsiz sepet olmaz');
select throws_ok($$ insert into public.carts (user_id, token_hash, expires_at) values (tests.uid('cs'), 'x', now()) $$, '23514', null, 'sepetin iki sahibi olmaz');
select throws_ok($$ insert into public.carts (token_hash) values ('x') $$, '23514', null, 'misafir sepeti süresiz olmaz');
select throws_ok($$ insert into public.carts (user_id) values (tests.uid('a')) $$, '23505', null, 'üye başına tek sepet');

-- ---------------------------------------------------------------------------
-- Birleştirme
-- ---------------------------------------------------------------------------
select is(tests.add('a', 'az', 1), '{"token": null}', 'üye sepeti: az 1, bol 5');
select is(tests.add(null, 'az', 3, tests.t('g1'))::jsonb ->> 'token', tests.t('g1'), 'misafir: az 3');
select is(tests.add(null, 'baska', 2, tests.t('g1'))::jsonb ->> 'token', tests.t('g1'), 'misafir: baska 2, bol 3');
select is(tests.run_as(u, format('select public.cart_merge(%L)', tests.t('g1'))), 'HATA 42501', u || ': birleştiremez')
from unnest(array['pasif', 'kapali']) u;
select is(tests.run_as('a', 'select public.cart_merge(' || x || ')'), 'false', 'olmayan kod birleşmez: ' || x)
from unnest(array['null', '''''', quote_literal(repeat('0', 64))]) x;
select is(tests.run_as(u, 'select public.cart_merge(null)'), 'HATA 42501', u || ': kod olmadan da reddedilir')
from unnest(array['pasif', 'kapali']) u;
select is(tests.run_as('a', format('select public.cart_merge(%L)', tests.t('g1'))), 'true', 'a birleştirir');
select is(tests.lines('a'), 'az:3 baska:2 bol:5', 'aynı üründe büyük adet kalır, yeni ürün eklenir');
select is(tests.run_as('a', format('select public.cart_merge(%L)', tests.t('g1'))), 'false', 'ikinci birleştirme işlemez');
select is(tests.lines('a'), 'az:3 baska:2 bol:5', 'tekrar adet artırmaz');
select is(tests.run_as('b', format('select public.cart_merge(%L)', tests.t('g1'))), 'false', 'birleşen kod başkasına yaramaz');
select is(tests.lines(null, tests.t('g1')), '', 'misafir sepeti kalmaz');
select is(tests.lines('b'), 'baska:2', 'b etkilenmedi');
select is(tests.run_as('cs', format('select public.cart_merge(%L)', tests.t('g3'))), 'true', 'sepeti olmayan üyeye sepet açılır');
select is(tests.lines('cs'), 'baska:1', 'misafir sepeti taşındı');

-- 50 çeşit sınırı
do $$
declare
  p uuid := tests.product('t-cok');
  i integer := 0;
  c text;
  s text;
begin
  for c, s in select x.slug, z.code from public.colors x, public.sizes z where z.size_group = 'baby'
    order by x.slug, z.code limit 60 loop
    i := i + 1;
    perform tests.variant('n' || lpad(i::text, 2, '0'), p, c, s, 100, 10);
  end loop;
end $$;
select is((select count(*) from tests.v where name like 'n%'), 60::bigint, 'sınır testi için 60 varyant');
select tests.new_user('c');
insert into public.carts (user_id) values (tests.uid('c'));
insert into public.cart_items (cart_id, variant_id, quantity)
select (select id from public.carts where user_id = tests.uid('c')), id, 1 from tests.v where name between 'n01' and 'n49';
select is(tests.add('c', 'n50'), '{"token": null}', '50. çeşit eklenir');
select is(tests.add('c', 'n51'), 'HATA 22023', '51. çeşit reddedilir');
select is(tests.add('c', 'n50'), '{"token": null}', 'doluyken var olan ürün artırılabilir');
select is(tests.cset('c', 'n01', 0), '', 'bir çeşit kaldırılır');
insert into tests.tokens select 'g4', tests.add(null, 'n52', 5)::jsonb ->> 'token';
select is(tests.add(null, x, 5, tests.t('g4'))::jsonb ->> 'token', tests.t('g4'), 'misafir ekler: ' || x)
from unnest(array['n02', 'n53', 'n54']) x;
update public.cart_items set created_at = now() - interval '1 hour' where variant_id = tests.v('n53');
select is(tests.run_as('c', format('select public.cart_merge(%L)', tests.t('g4'))), 'true', 'dolu sepete birleştirme');
select is((select count(*) from public.cart_items ci join public.carts c on c.id = ci.cart_id where c.user_id = tests.uid('c')),
  50::bigint, 'birleşme 50 çeşidi aşmaz');
select is((select string_agg(v.name || ':' || ci.quantity, ' ' order by v.name) from public.cart_items ci
  join public.carts c on c.id = ci.cart_id join tests.v v on v.id = ci.variant_id
  where c.user_id = tests.uid('c') and v.name in ('n02', 'n52', 'n53', 'n54')),
  'n02:5 n53:5', 'var olan ürün büyük adetle, kalan yere önce eklenen');
-- Var olan ürün yer tutmaz: 49 çeşide var olan ile birlikte gelen yeni ürün sığar.
select tests.new_user('d');
insert into public.carts (user_id) values (tests.uid('d'));
insert into public.cart_items (cart_id, variant_id, quantity)
select (select id from public.carts where user_id = tests.uid('d')), id, 1 from tests.v where name between 'n01' and 'n49';
insert into tests.tokens select 'g5', tests.add(null, 'n01', 3)::jsonb ->> 'token';
select is(tests.add(null, 'n60', 3, tests.t('g5'))::jsonb ->> 'token', tests.t('g5'), 'misafir: var olan ve yeni ürün');
update public.cart_items ci set created_at = now() - interval '1 hour' from public.carts k
where k.id = ci.cart_id and k.user_id is null and ci.variant_id = tests.v('n01');
select is(tests.run_as('d', format('select public.cart_merge(%L)', tests.t('g5'))), 'true', '49 çeşide birleştirme');
select is((select string_agg(v.name || ':' || ci.quantity, ' ' order by v.name) from public.cart_items ci
  join public.carts k on k.id = ci.cart_id join tests.v v on v.id = ci.variant_id
  where k.user_id = tests.uid('d') and v.name in ('n01', 'n60')), 'n01:3 n60:3', 'var olan ürün yer tutmaz');
-- Sepet doluyken de var olan ürünün büyük adedi alınır.
insert into tests.tokens select 'g6', tests.add(null, 'n02', 4)::jsonb ->> 'token';
select is(tests.run_as('d', format('select public.cart_merge(%L)', tests.t('g6'))), 'true', 'dolu sepete var olan ürün');
select is((select ci.quantity from public.cart_items ci join public.carts k on k.id = ci.cart_id
  where k.user_id = tests.uid('d') and ci.variant_id = tests.v('n02')), 4, 'doluyken büyük adet alınır');

-- ---------------------------------------------------------------------------
-- Favoriler
-- ---------------------------------------------------------------------------
create function tests.favs(p_as text) returns text language sql as $$
  select tests.run_as(p_as, 'select string_agg(slug, '' '' order by slug) from public.list_favorites()') $$;
create function tests.fav(p_as text, p_slug text, p_on boolean default true) returns text language sql as $$
  select tests.run_as(p_as, format('select public.set_favorite(%L, %L)', p_slug, p_on)) $$;

select is(tests.fav('a', 't-s1'), '', 'favori eklenir');
select is(tests.fav('a', 't-s1'), '', 'ikinci ekleme hata vermez');
select is(tests.fav('a', 't-s2'), '', 'ikinci ürün eklenir');
select is(tests.fav('a', x), 'HATA P0002', 'favoriye eklenemez: ' || coalesce(x, 'boş')) from unnest(array['t-s3', 'olmayan', null]) x;
select is(tests.favs('a'), 't-s1 t-s2', 'a''nın favorileri');
select is(tests.favs('b'), null, 'b, a''nın favorilerini görmez');
select is(tests.run_as('a', $$ select public.is_favorite('t-s1') $$), 'true', 'favori işareti');
select is(tests.run_as('b', $$ select public.is_favorite('t-s1') $$), 'false', 'b''nin işareti yok');
select is(tests.fav('b', 't-s1', false), '', 'b''nin kaldırması');
select is(tests.favs('a'), 't-s1 t-s2', 'a''nın favorisini etkilemez');
select is(tests.run_as('a', $$ select to_jsonb(f) - 'image_path' from public.list_favorites() f where slug = 't-s1' $$)::jsonb,
  '{"name": "Ürün t-s1", "slug": "t-s1", "price": 10000, "compare_at_price": null, "has_more_prices": true,
    "color_count": 2, "sold_out": false, "image_alt": "Genel"}', 'pasif varyant fiyata ve renge girmez');
update public.products set status = 'draft' where slug = 't-s2';
select is(tests.favs('a'), 't-s1', 'yayından kalkan favori listelenmez');
select is(tests.fav('a', 't-s2', false), '', 'yayından kalkan favori kaldırılabilir');
update public.products set status = 'published' where slug = 't-s2';
select is(tests.favs('a'), 't-s1', 'kaldırılan favori geri gelmez');
select is(tests.fav(u, 't-s1'), 'HATA 42501', u || ': favori ekleyemez') from unnest(array['pasif', 'kapali']) u;
insert into public.favorites (user_id, product_id)
select u.id, p.id from tests.users u, public.products p where u.name in ('pasif', 'kapali') and p.slug = 't-s1';
select is(tests.favs(u), null, u || ': favori okuyamaz') from unnest(array['pasif', 'kapali']) u;
select is(tests.run_as(u, $$ select public.is_favorite('t-s1') $$), null, u || ': favori işareti okuyamaz')
from unnest(array['pasif', 'kapali']) u;
insert into public.products (name, slug, audience, gender, vat_bps)
select 'Dolgu ' || i, 't-dolgu-' || i, 'baby', 'unisex', 1000 from generate_series(1, 200) i;
insert into public.favorites (user_id, product_id) select tests.uid('b'), id from public.products where slug like 't-dolgu-%';
select is(tests.fav('b', 't-s1'), 'HATA 22023', '200 favori sınırı');

-- ---------------------------------------------------------------------------
-- Adresler
-- ---------------------------------------------------------------------------
create function tests.addr(
  p_as text, p_title text, p_id uuid default null, p_default boolean default false,
  p_phone text default '+905550000000', p_city text default 'Eskişehir',
  p_line text default 'Deneme Mahallesi 1', p_postal text default '26000',
  p_recipient text default 'Deneme Kişi', p_district text default 'Odunpazarı')
returns text language sql as $$
  select tests.run_as(p_as, format('select public.save_address(%L, %L, %L, %L, %L, %L, %L, %L, %L)',
    p_id, p_title, p_recipient, p_phone, p_city, p_district, p_line, p_postal, p_default)) $$;
create function tests.addrs(p_as text) returns text language sql as $$
  select tests.run_as(p_as, $q$ select string_agg(title || case when is_default then '*' else '' end, ' ' order by title)
    from public.addresses $q$) $$;
create table tests.a (name text primary key, id uuid);

insert into tests.a select 'ev', tests.addr('a', ' Ev ')::uuid;
insert into tests.a select 'is', tests.addr('a', 'İş')::uuid;
select is(tests.addrs('a'), 'Ev* İş', 'ilk adres varsayılan olur, başlık kırpılır');
insert into tests.a select 'yazlik', tests.addr('a', 'Yazlık', null, true)::uuid;
select is(tests.addrs('a'), 'Ev İş Yazlık*', 'yeni varsayılan eskisinin yerine geçer');
select is(tests.addr('a', 'Ofis', (select id from tests.a where name = 'is'), true), (select id::text from tests.a where name = 'is'), 'adres güncellenir');
select is(tests.addrs('a'), 'Ev Ofis* Yazlık', 'güncellemede varsayılan değişir');
select is(tests.addr('a', 'Ofis', (select id from tests.a where name = 'is'), false), (select id::text from tests.a where name = 'is'), 'varsayılan yeniden kaydedilir');
select is(tests.addrs('a'), 'Ev Ofis* Yazlık', 'varsayılan işareti doğrudan kaldırılamaz');

select is(tests.addrs('b'), null, 'b, a''nın adreslerini görmez');
select is(tests.addrs(u), null, u || ': müşteri adresini görmez') from unnest(array['sa', 'cs']) u;
select is(tests.run_as('sa', 'select count(*) from public.addresses', 'aal2'), '0', 'Super Admin iki adımla da göremez');
select is(tests.addr('b', 'Çalıntı', (select id from tests.a where name = 'ev')), 'HATA P0002', 'b, a''nın adresini değiştiremez');
select is(tests.run_as('b', format('select public.delete_address(%L)', (select id from tests.a where name = 'ev'))), 'HATA P0002', 'b, a''nın adresini silemez');
select is(tests.addr('b', 'Benim', null, true) is not null, true, 'b kendi adresini ekler');
select is(tests.addrs('a'), 'Ev Ofis* Yazlık', 'a''nın varsayılanı b''den etkilenmez');
select is(tests.run_as('a', 'update public.addresses set title = ''x'' returning 1'), 'HATA 42501', 'doğrudan güncellenemez');
select is(tests.run_as('a', format('insert into public.addresses (user_id, title, recipient, phone, city, district, line)
  values (%L, ''x'', ''yy'', ''+905550000000'', ''Bursa'', ''yy'', ''yyyyyyyyyyy'') returning 1', tests.uid('b'))), 'HATA 42501', 'başkası adına eklenemez');
select is(tests.run_as('a', 'delete from public.addresses returning 1'), 'HATA 42501', 'doğrudan silinemez');

select is(tests.addr('b', 'x', p_phone => x), 'HATA 23514', 'geçersiz telefon: ' || x)
from unnest(array['05550000000', '+902220000000', '+9055500000000', '+90555000000a', '']) x;
select is(tests.addr('b', 'x', p_city => x), 'HATA 23514', 'geçersiz il: ' || x) from unnest(array['Atlantis', 'eskişehir', '']) x;
select is(tests.addr('b', 'x', p_postal => x), 'HATA 23514', 'geçersiz posta kodu: ' || x) from unnest(array['2600', '260000', 'abcde', '']) x;
select is(tests.addr('b', 'x', p_line => x), 'HATA 23514', 'geçersiz adres: ' || left(x, 12)) from unnest(array['kısa', repeat(' ', 20), repeat('a', 301)]) x;
select is(tests.addr('b', x), 'HATA 23514', 'geçersiz başlık') from unnest(array['', '  ', repeat('a', 41)]) x;
select is(tests.addr('b', 'x', p_recipient => x), 'HATA 23514', 'geçersiz alıcı') from unnest(array['a', repeat('a', 101)]) x;
select is(tests.addr('b', 'x', p_district => x), 'HATA 23514', 'geçersiz ilçe') from unnest(array['a', 'Nilüfer', 'odunpazarı', repeat('a', 61)]) x;
select is(tests.addr('b', null), 'HATA 23502', 'boş başlık');
select is(tests.addr('b', 'Kodsuz', p_postal => null) is not null, true, 'posta kodu isteğe bağlı');
select is(tests.addrs('b'), 'Benim* Kodsuz', 'reddedilenler yazılmadı');
select is((select count(distinct m[1]) from pg_constraint,
  regexp_matches(pg_get_constraintdef(oid), '''([^'']+)''::text', 'g') m where conname = 'addresses_city_check'), 81::bigint, '81 il tanımlı');

select is(tests.run_as('a', format('select public.delete_address(%L)', (select id from tests.a where name = 'is'))), '', 'varsayılan silinir');
select is(tests.run_as('a', 'select count(*) from public.addresses where is_default'), '1', 'kalanlardan biri varsayılan olur');
update public.addresses set created_at = now() - interval '1 hour' where id = (select id from tests.a where name = 'ev');
update public.addresses set is_default = id = (select id from tests.a where name = 'ev') where user_id = tests.uid('a') and is_default;
insert into tests.a select 'yeni', tests.addr('a', 'Yeni', null, true)::uuid;
update public.addresses set created_at = now() - interval '2 hours' where id = (select id from tests.a where name = 'yeni');
select is(tests.run_as('a', format('select public.delete_address(%L)', (select id from tests.a where name = 'yeni'))), '', 'yeni varsayılan silinir');
select is(tests.addrs('a'), 'Ev Yazlık*', 'en son eklenen varsayılan olur');
update public.addresses set created_at = now() - interval '30 minutes' where id = (select id from tests.a where name = 'yazlik');
insert into tests.a select 'son', tests.addr('a', 'Son')::uuid;
select is(tests.run_as('a', format('select public.delete_address(%L)', (select id from tests.a where name = 'ev'))), '', 'varsayılan olmayan silinir');
select is(tests.addrs('a'), 'Son Yazlık*', 'daha yeni adres varsayılanı almaz');
select is(tests.run_as('a', format('select public.delete_address(%L)', (select id from tests.a where name = 'son'))), '', 'en yeni adres silinir');
select is(tests.addrs('a'), 'Yazlık*', 'varsayılan yerinde kalır');
select is(count(tests.addr('a', 'A' || i)), 9::bigint, '10 adrese kadar eklenir') from generate_series(1, 9) i;
select is(tests.addr('a', 'Fazla'), 'HATA 22023', '11. adres reddedilir');
select is(tests.run_as('a', 'select count(*) from public.addresses'), '10', 'adres sayısı 10');
select throws_ok(format($$ update public.addresses set is_default = true where user_id = %L $$, tests.uid('a')), '23505', null, 'iki varsayılan olamaz');

select is(tests.addr(u, 'x'), 'HATA 42501', u || ': adres ekleyemez') from unnest(array['pasif', 'kapali']) u;
insert into public.addresses (user_id, title, recipient, phone, city, district, line)
select id, 'Ev', 'Ad', '+905550000000', 'Bursa', 'Nilüfer', 'Deneme Mah. 1' from tests.users where name in ('pasif', 'kapali');
select is(tests.addrs(u), null, u || ': adres okuyamaz') from unnest(array['pasif', 'kapali']) u;
select is((select count(*) from public.audit_logs where created_at = now() and entity in ('addresses', 'carts', 'favorites', 'consents')),
  0::bigint, 'kişisel kayıtlar işlem geçmişine yazılmaz');

-- ---------------------------------------------------------------------------
-- İleti izinleri
-- ---------------------------------------------------------------------------
create function tests.consent(p_as text, p_kind text, p_on boolean) returns text language sql as $$
  select tests.run_as(p_as, format('select public.set_consent(%L, %L)', p_kind, p_on)) $$;
create function tests.consents(p_as text) returns text language sql as $$
  select tests.run_as(p_as, $q$ select string_agg(kind || ':' || granted || ':' || source, ' ' order by seq) from public.consents $q$) $$;

select is(tests.consents('a'), null, 'başta izin yoktur');
select is(tests.consent('a', 'email_marketing', false), '', 'verilmemiş izni kaldırmak hata değildir');
select is(tests.consents('a'), null, 've kayıt üretmez');
select is(tests.consent('a', 'email_marketing', true), '', 'e-posta izni verilir');
select is(tests.consent('a', 'email_marketing', true), '', 'aynı seçim yeniden kaydedilir');
select is(tests.consents('a'), 'email_marketing:true:account', 'tekrar yeni kayıt üretmez');
select is(tests.consent('a', 'email_marketing', false), '', 'izin geri alınır');
select is(tests.consents('a'), 'email_marketing:true:account email_marketing:false:account', 'geri alma da kayda geçer');
select is(tests.consent('a', 'email_marketing', true), '', 'izin yeniden verilir');
select is(tests.consent('a', 'email_marketing', false), '', 've yeniden geri alınır');
select is((select string_agg(granted::text, ' ' order by seq) from public.consents where user_id = tests.uid('a')),
  'true false true false', 'son kayda göre karar verilir');
select is(tests.consent('a', 'sms_marketing', true), 'HATA 22023', 'telefonsuz SMS izni verilmez');
select is(tests.consent('a', 'sms_marketing', false), '', 'telefonsuz SMS izni kaldırılabilir');
select is(tests.run_as('a', $$ update public.profiles set phone = '+905550000000' returning 1 $$), '1', 'telefon eklenir');
select is(tests.consent('a', 'sms_marketing', true), '', 'telefonla SMS izni verilir');
select is(tests.consent('a', x, true), 'HATA 22023', 'geçersiz tür: ' || coalesce(x, 'boş')) from unnest(array['push', null]) x;
select is(tests.consent('a', 'email_marketing', null), 'HATA 22023', 'boş seçim reddedilir');
select is(tests.consents('b'), null, 'b, a''nın izinlerini görmez');
select is(tests.run_as('sa', 'select count(*) from public.consents', 'aal2'), '0', 'Super Admin de buradan göremez');
select is(tests.consent(u, 'email_marketing', true), 'HATA 42501', u || ': izin veremez') from unnest(array['pasif', 'kapali']) u;
insert into public.consents (user_id, kind, granted, source)
select id, 'email_marketing', true, 'account' from tests.users where name in ('pasif', 'kapali');
select is(tests.consents(u), null, u || ': izin okuyamaz') from unnest(array['pasif', 'kapali']) u;
select is(tests.run_as('a', 'insert into public.consents (user_id, kind, granted, source)
  select auth.uid(), ''email_marketing'', true, ''account'' returning 1'), 'HATA 42501', 'doğrudan izin yazılamaz');
select throws_ok('delete from public.consents', '42501', null, 'izin kaydı silinemez');
select throws_ok('update public.consents set granted = true', '42501', null, 'izin kaydı değiştirilemez');
select throws_ok('truncate public.consents', '42501', null, 'izin kayıtları boşaltılamaz');

select * from finish();
rollback;
