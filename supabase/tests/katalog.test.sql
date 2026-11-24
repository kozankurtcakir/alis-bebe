-- Aşama 3 testleri: katalog kuralları ve izinleri. Sonunda geri alınır.
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

-- Ertelenmiş yayın denetimleri de aynı adımda çalıştırılır.
create function tests.run_as(p_name text, p_sql text, p_aal text default 'aal2')
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
    set constraints all immediate;
    set constraints all deferred;
    perform set_config('role', 'postgres', true);
  exception when others then
    v_result := 'HATA ' || sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end $$;

select tests.new_user('sa', 'super_admin');
select tests.new_user('admin', 'admin');
select tests.new_user('pm', 'product_manager');
select tests.new_user('sm', 'stock_manager');
select tests.new_user('om', 'order_manager');
select tests.new_user('cs', 'customer_service');
select tests.new_user('musteri');

-- ---------------------------------------------------------------------------
-- Genel
-- ---------------------------------------------------------------------------
select set_eq(
  $$ select c.relname::text from pg_class c where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, 'delete') $$,
  array['categories', 'brands', 'colors', 'sizes', 'size_charts', 'product_categories', 'product_images'],
  'silme hakkı yalnızca listedeki tablolarda; ürün ve varyant silinemez');
select is((select count(*) from public.sizes where size_group = 'child'), 13::bigint, 'çocuk bedenleri 2-14 yaş');

-- ---------------------------------------------------------------------------
-- Rol başına izin/red
-- ---------------------------------------------------------------------------
select is(tests.run_as(u, 'select count(*) > 0 from public.colors'), 'true', u || ': katalog okur')
from unnest(array['sa', 'admin', 'pm', 'sm', 'om', 'cs']) u;
select is(tests.run_as('musteri', 'select count(*) from public.colors'), '0', 'müşteri katalog tablolarını okuyamaz');
select is(tests.run_as(null, 'select count(*) from public.products'), 'HATA 42501', 'anon okuyamaz');
select is(tests.run_as('pm', 'select count(*) from public.colors', 'aal1'), '0', 'aal1 ile okunamaz');

select is(tests.run_as(u, format($$ insert into public.brands (name, slug) values (%L, %L) returning 1 $$, 'Marka ' || u, 'marka-' || u)),
  '1', u || ': marka ekler') from unnest(array['sa', 'admin', 'pm']) u;
select is(tests.run_as(u, format($$ insert into public.brands (name, slug) values (%L, %L) returning 1 $$, 'Marka ' || u, 'marka-' || u)),
  'HATA 42501', u || ': marka ekleyemez') from unnest(array['sm', 'om', 'cs', 'musteri']) u;
select is(tests.run_as(u, $$ with x as (update public.brands set name = 'X' where slug = 'marka-pm' returning 1) select count(*) from x $$),
  '0', u || ': marka değiştiremez') from unnest(array['sm', 'om', 'cs', 'musteri']) u;
select is(tests.run_as(u, $$ with x as (delete from public.brands where slug = 'marka-pm' returning 1) select count(*) from x $$),
  '0', u || ': marka silemez') from unnest(array['sm', 'om', 'cs', 'musteri']) u;

-- ---------------------------------------------------------------------------
-- Kategori döngüsü ve adres biçimi
-- ---------------------------------------------------------------------------
insert into public.categories (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000c1', 'Bir', 'test-bir'),
  ('00000000-0000-4000-8000-0000000000c2', 'İki', 'test-iki'),
  ('00000000-0000-4000-8000-0000000000c3', 'Üç', 'test-uc');
update public.categories set parent_id = '00000000-0000-4000-8000-0000000000c1' where slug = 'test-iki';
update public.categories set parent_id = '00000000-0000-4000-8000-0000000000c2' where slug = 'test-uc';
select is(tests.run_as('pm', $$ update public.categories set parent_id = '00000000-0000-4000-8000-0000000000c3' where slug = 'test-bir' returning 1 $$), 'HATA 22023', 'döngü reddedilir');
select is(tests.run_as('pm', $$ update public.categories set parent_id = id where slug = 'test-bir' returning 1 $$), 'HATA 22023', 'kategori kendisinin altı olamaz');
select is(tests.run_as('pm', $$ delete from public.categories where slug = 'test-bir' returning 1 $$), 'HATA 23503', 'alt kategorisi olan silinemez');
select is(tests.run_as('pm', $$ insert into public.categories (name, slug) values ('X', 'Büyük Harf') returning 1 $$), 'HATA 23514', 'bozuk adres reddedilir');
select is(tests.run_as('pm', $$ insert into public.categories (name, slug) values ('X', 'test-bir') returning 1 $$), 'HATA 23505', 'yinelenen adres reddedilir');

-- ---------------------------------------------------------------------------
-- Ürün ve varyant
-- ---------------------------------------------------------------------------
select is(tests.run_as('pm', $$ insert into public.products (name, slug, audience, gender, vat_bps, description, material)
  values ('Test Zıbın', 'test-zibin', 'baby', 'unisex', 1000, 'Açıklama', '%100 pamuk') returning status $$), 'draft', 'ürün taslak başlar');
select is(tests.run_as('pm', $$ insert into public.products (name, slug, audience, gender)
  values ('KDV yok', 'kdv-yok', 'baby', 'unisex') returning 1 $$), 'HATA 23502', 'KDV seçilmeden ürün eklenemez');
select is(tests.run_as('pm', $$ insert into public.products (name, slug, audience, gender, vat_bps, status)
  values ('Hile', 'hile', 'baby', 'unisex', 1000, 'published') returning 1 $$), 'HATA 42501', 'durum doğrudan yazılamaz');
select is(tests.run_as('pm', $$ update public.products set status = 'published' where slug = 'test-zibin' returning 1 $$), 'HATA 42501', 'durum doğrudan değiştirilemez');
select is(tests.run_as('om', $$ insert into public.products (name, slug, audience, gender, vat_bps)
  values ('OM', 'om-urun', 'baby', 'unisex', 1000) returning 1 $$), 'HATA 42501', 'OM ürün ekleyemez');

create function tests.pid() returns uuid language sql as $$ select id from public.products where slug = 'test-zibin' $$;
create function tests.variant_sql(p_sku text, p_size text, p_price bigint, p_barcode text default null, p_compare bigint default null)
returns text language sql as $$
  select format('insert into public.product_variants (product_id, color_id, size_id, sku, barcode, price, compare_at_price)
    values (%L, %L, %L, %L, %L, %L, %L) returning sku', tests.pid(),
    (select id from public.colors where code = 'HAR'), (select id from public.sizes where code = p_size),
    p_sku, p_barcode, p_price, p_compare) $$;

select is(tests.run_as('pm', tests.variant_sql('TEST-1', '3-6A', 24990, '0012345678905')), 'TEST-1', 'varyant eklenir');
select is((select barcode from public.product_variants where sku = 'TEST-1'), '0012345678905', 'barkodun baştaki sıfırı korunur');
select is(tests.run_as('pm', tests.variant_sql('TEST-1', '6-9A', 24990)), 'HATA 23505', 'yinelenen SKU reddedilir');
select is(tests.run_as('pm', tests.variant_sql('test-1', '6-9A', 24990)), 'HATA 23514', 'küçük harfle SKU kopyası reddedilir');
select is(tests.run_as('pm', tests.variant_sql('TEST-2', '3-6A', 24990)), 'HATA 23505', 'aynı renk ve beden ikinci kez eklenemez');
select is(tests.run_as('pm', tests.variant_sql('TEST-2', '6-9A', 24990, '0012345678905')), 'HATA 23505', 'yinelenen barkod reddedilir');
select is(tests.run_as('pm', tests.variant_sql('TEST-2', '6-9A', 0)), 'HATA 23514', 'sıfır fiyat reddedilir');
select is(tests.run_as('pm', tests.variant_sql('TEST-2', '6-9A', -5)), 'HATA 23514', 'eksi fiyat reddedilir');
select is(tests.run_as('pm', tests.variant_sql('TEST-2', '6-9A', 24990, null, 20000)), 'HATA 23514', 'eski fiyat yeni fiyattan küçük olamaz');
select is(tests.run_as('pm', tests.variant_sql('TEST-2', '6-9A', 24990)), 'TEST-2', 'ikinci beden eklenir');
select is(tests.run_as(u, tests.variant_sql('TEST-3', '9-12A', 24990)), 'HATA 42501', u || ': varyant ekleyemez')
from unnest(array['sm', 'om', 'cs', 'musteri']) u;
select is(tests.run_as('pm', format($$ insert into public.product_variants (product_id, sku, price) values (%L, 'TEST-N1', 100) returning 1 $$, tests.pid())), '1', 'renksiz ve bedensiz varyant (kişisel bakım için)');
select is(tests.run_as('pm', format($$ insert into public.product_variants (product_id, sku, price) values (%L, 'TEST-N2', 100) returning 1 $$, tests.pid())), 'HATA 23505', 'boş renk ve beden de yinelenemez');
select is(tests.run_as('pm', $$ update public.product_variants set is_active = false where sku = 'TEST-N1' returning 1 $$), '1', 'varyant pasifleştirilir');
select is(tests.run_as('sa', $$ delete from public.product_variants returning 1 $$), 'HATA 42501', 'SA da varyant silemez');
select is(tests.run_as('sa', $$ delete from public.products returning 1 $$), 'HATA 42501', 'SA da ürün silemez');

-- ---------------------------------------------------------------------------
-- Fiyat izni ve geçmişi
-- ---------------------------------------------------------------------------
select is(tests.run_as('pm', $$ update public.product_variants set price = 19990 where sku = 'TEST-1' returning price $$), '19990', 'fiyat değişir');
select results_eq(
  $$ select h.old_price, h.new_price from public.price_history h join public.product_variants v on v.id = h.variant_id
     where v.sku = 'TEST-1' order by h.old_price nulls first $$,
  $$ values (null::bigint, 24990::bigint), (24990, 19990) $$, 'fiyat geçmişi tutulur');
select is((select count(distinct changed_by) from public.price_history h join public.product_variants v on v.id = h.variant_id where v.sku = 'TEST-1'), 1::bigint, 'değiştiren kişi kaydedilir');
select is(tests.run_as('sa', 'delete from public.price_history returning 1'), 'HATA 42501', 'SA fiyat geçmişini silemez');
select throws_ok('delete from public.price_history', '42501', null, 'veritabanı sahibi de fiyat geçmişini silemez');
select is(tests.run_as('sa', format($$ insert into public.price_history (variant_id, new_price) values (%L, 1) returning 1 $$, gen_random_uuid())), 'HATA 42501', 'fiyat geçmişine elle yazılamaz');

-- İki izin gerçekten ayrı mı? Geçici olarak PM'den ve SM'den/SM'ye izin alınıp verilir.
delete from public.role_permissions where role_id = (select id from public.roles where key = 'product_manager')
  and permission_id = (select id from public.permissions where key = 'prices.write');
insert into public.role_permissions select r.id, p.id from public.roles r, public.permissions p
where r.key = 'stock_manager' and p.key = 'prices.write';
select is(tests.run_as('pm', $$ update public.product_variants set price = 1 where sku = 'TEST-1' returning 1 $$), 'HATA 42501', 'prices.write yoksa fiyat değişmez');
select is(tests.run_as('pm', $$ update public.product_variants set compare_at_price = 99990 where sku = 'TEST-1' returning 1 $$), 'HATA 42501', 'prices.write yoksa eski fiyat değişmez');
select is(tests.run_as('pm', $$ update public.product_variants set desi = 1 where sku = 'TEST-1' returning 1 $$), '1', 'catalog.write ile diğer alan değişir');
select is(tests.run_as('pm', tests.variant_sql('TEST-3', '9-12A', 24990)), 'HATA 42501', 'prices.write yoksa varyant eklenemez');
select is(tests.run_as('sm', $$ update public.product_variants set price = 19991 where sku = 'TEST-1' returning 1 $$), '1', 'prices.write ile fiyat değişir');
select is(tests.run_as('sm', $$ update public.product_variants set sku = 'CALINTI' where sku = 'TEST-1' returning 1 $$), 'HATA 42501', 'catalog.write yoksa SKU değişmez');
delete from public.role_permissions where role_id = (select id from public.roles where key = 'stock_manager')
  and permission_id = (select id from public.permissions where key = 'prices.write');
insert into public.role_permissions select r.id, p.id from public.roles r, public.permissions p
where r.key = 'product_manager' and p.key = 'prices.write';

-- ---------------------------------------------------------------------------
-- Maliyet
-- ---------------------------------------------------------------------------
create function tests.cost_sql() returns text language sql as $$
  select format('insert into public.variant_costs (variant_id, cost) values (%L, 9000) returning 1',
    (select id from public.product_variants where sku = 'TEST-1')) $$;
select is(tests.run_as(u, tests.cost_sql()), 'HATA 42501', u || ': maliyet yazamaz')
from unnest(array['pm', 'sm', 'om', 'cs', 'musteri']) u;
select is(tests.run_as('admin', tests.cost_sql()), '1', 'admin maliyet yazar');
select is(tests.run_as(u, 'select count(*) from public.variant_costs'), '0', u || ': maliyeti göremez')
from unnest(array['pm', 'sm', 'om', 'cs', 'musteri']) u;
select is(tests.run_as('sa', 'select count(*) > 0 from public.variant_costs'), 'true', 'SA maliyeti görür');

-- ---------------------------------------------------------------------------
-- Yayın şartları
-- ---------------------------------------------------------------------------
create function tests.status_sql(p_status text) returns text language sql as $$
  select format('select public.set_product_status(%L, %L)', tests.pid(), p_status) $$;

select is(tests.run_as(u, tests.status_sql('published')), 'HATA 42501', u || ': yayınlayamaz')
from unnest(array['sm', 'om', 'cs', 'musteri']) u;
select is(tests.run_as(null, tests.status_sql('published')), 'HATA 42501', 'anon yayınlayamaz');
select is(tests.run_as('pm', tests.status_sql('published')), 'HATA 22023', 'kategorisiz ve görselsiz yayınlanamaz');
select is(tests.run_as('pm', format($$ insert into public.product_categories (product_id, category_id, is_primary)
  values (%L, '00000000-0000-4000-8000-0000000000c1', true) returning 1 $$, tests.pid())), '1', 'ana kategori eklenir');
select is(tests.run_as('pm', format($$ insert into public.product_categories (product_id, category_id, is_primary)
  values (%L, '00000000-0000-4000-8000-0000000000c2', true) returning 1 $$, tests.pid())), 'HATA 23505', 'ikinci ana kategori reddedilir');
select is(tests.run_as('pm', tests.status_sql('published')), 'HATA 22023', 'görselsiz yayınlanamaz');
select is(tests.run_as('pm', format($$ insert into public.product_images (product_id, path, width, height, alt)
  values (%L, 'kotu/../yol.svg', 100, 100, 'x') returning 1 $$, tests.pid())), 'HATA 23514', 'bozuk görsel yolu reddedilir');
select is(tests.run_as('pm', format($$ insert into public.product_images (product_id, path, width, height, alt)
  values (%L, '00000000-0000-4000-8000-000000000001.webp', 100, 100, '  ') returning 1 $$, tests.pid())), 'HATA 23514', 'boş açıklama metni reddedilir');
select is(tests.run_as('pm', format($$ insert into public.product_images (product_id, path, width, height, alt)
  values (%L, '00000000-0000-4000-8000-000000000001.webp', 100, 100, 'Hardal zıbın') returning 1 $$, tests.pid())), '1', 'görsel eklenir');
select is(tests.run_as('pm', tests.status_sql('published')), '', 'şartlar tamamsa PM yayınlar');
select is((select status from public.products where id = tests.pid()), 'published', 'ürün yayında');

select is(tests.run_as('pm', format('delete from public.product_images where product_id = %L returning 1', tests.pid())), 'HATA 22023', 'yayındaki ürünün son görseli silinemez');
select is(tests.run_as('pm', format('delete from public.product_categories where product_id = %L returning 1', tests.pid())), 'HATA 22023', 'yayındaki ürünün ana kategorisi silinemez');
select is(tests.run_as('pm', format('update public.product_variants set is_active = false where product_id = %L returning 1', tests.pid())), 'HATA 22023', 'yayındaki ürünün bütün varyantları kapatılamaz');
select is(tests.run_as('pm', $$ update public.product_variants set is_active = true where sku = 'TEST-N1' returning 1 $$), 'HATA 22023', 'yayındaki giyimde renksiz varyant açılamaz');
select is(tests.run_as('pm', $$ update public.products set material = ' ' where slug = 'test-zibin' returning 1 $$), 'HATA 22023', 'yayındaki ürünün malzemesi boşaltılamaz');
select is(tests.run_as('pm', $$ update public.products set product_type = 'personal_care' where slug = 'test-zibin' returning 1 $$), 'HATA 22023', 'kişisel bakım yayında olamaz');
select is(tests.run_as('pm', tests.status_sql('archived')), '', 'arşivlenir');
select is(tests.run_as('pm', tests.status_sql('published')), 'HATA 22023', 'arşivden doğrudan yayına geçilemez');
select is(tests.run_as('pm', tests.status_sql('draft')), '', 'arşivden taslağa döner');
select is(tests.run_as('pm', tests.status_sql('silindi')), 'HATA 22023', 'bilinmeyen durum reddedilir');
select is(tests.run_as('pm', $$ update public.products set product_type = 'personal_care' where slug = 'test-zibin' returning 1 $$), '1', 'taslakta tür değişir');
select is(tests.run_as('pm', tests.status_sql('published')), 'HATA 22023', 'kişisel bakım yayınlanamaz');

-- ---------------------------------------------------------------------------
-- Kategorilerin tek işlemde değişmesi
-- ---------------------------------------------------------------------------
create function tests.cats_sql(p_primary text, p_others text default '{}') returns text language sql as $$
  select format('select public.set_product_categories(%L, %s, %L)', tests.pid(),
    case when p_primary is null then 'null' else quote_literal('00000000-0000-4000-8000-0000000000' || p_primary) end, p_others) $$;
create function tests.cats() returns text language sql as $$
  select string_agg(right(category_id::text, 2) || case when is_primary then '*' else '' end, ',' order by category_id)
  from public.product_categories where product_id = tests.pid() $$;

select is(tests.run_as(u, tests.cats_sql('c2')), 'HATA 42501', u || ': kategori değiştiremez')
from unnest(array['sm', 'om', 'cs', 'musteri']) u;
select is(tests.run_as(null, tests.cats_sql('c2')), 'HATA 42501', 'anon kategori değiştiremez');
select is(tests.run_as('pm', tests.cats_sql('c2'), 'aal1'), 'HATA 42501', 'aal1 ile kategori değişmez');
update public.products set product_type = 'clothing' where id = tests.pid();
select is(tests.run_as('pm', tests.status_sql('published')), '', 'ürün yeniden yayınlanır');
select is(tests.run_as('pm', tests.cats_sql('c2', '{00000000-0000-4000-8000-0000000000c1}')), '', 'yayındayken ana kategori değişir');
select is(tests.cats(), 'c1,c2*', 'tek ana kategori kalır');
select is(tests.run_as('pm', tests.cats_sql('c1', '{00000000-0000-4000-8000-0000000000c1}')), '', 'ana kategori diğerlerinde de seçiliyse sorun olmaz');
select is(tests.cats(), 'c1*', 'fazlası kaldırılır');
select is(tests.run_as('pm', tests.cats_sql(null)), 'HATA 22023', 'yayındaki ürün kategorisiz kalamaz');
select is(tests.run_as('pm', tests.cats_sql(null, '{00000000-0000-4000-8000-0000000000c1}')), 'HATA 22023', 'ana kategorisiz diğer kategori seçilemez');
select is(tests.run_as('pm', tests.cats_sql('ff')), 'HATA 23503', 'olmayan kategori reddedilir');
select is(tests.cats(), 'c1*', 'hata olunca hiçbir şey değişmez');
select is(tests.run_as('pm', tests.status_sql('draft')), '', 'taslağa alınır');
select is(tests.run_as('pm', tests.cats_sql(null)), '', 'taslakta kategoriler boşaltılabilir');
select is(tests.run_as('pm', $$ select public.set_product_categories(gen_random_uuid(), null, '{}') $$), 'HATA P0002', 'olmayan ürün');

select is(
  tests.run_as('admin', $$ select count(*) > 0 from public.list_audit_logs()
    where action = 'products.update' and target = 'Test Zıbın' and created_at = now() $$),
  'true', 'işlem geçmişi ürün adını gösterir');

-- ---------------------------------------------------------------------------
-- İşlem geçmişi
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select before ->> 'price', after ->> 'price' from public.audit_logs
     where action = 'product_variants.update' and created_at = now() and after ->> 'price' = '19990' $$,
  $$ values ('24990', '19990') $$, 'fiyat değişikliği geçmişte');
select is(
  (select array_agg(k order by k) from public.audit_logs, jsonb_object_keys(after) k
   where action = 'product_variants.update' and created_at = now() and after ->> 'price' = '19990'),
  array['price'], 'yalnızca değişen alan yazılır');
select isnt_empty($$ select 1 from public.audit_logs where action = 'variant_costs.insert' and created_at = now() $$, 'maliyet değişikliği geçmişte');
select isnt_empty($$ select 1 from public.audit_logs where action = 'product_categories.insert' and created_at = now() $$, 'kategori bağlama geçmişte');

-- ---------------------------------------------------------------------------
-- Görsel deposu
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'product-images' $$,
  $$ values (true, 4194304::bigint, array['image/webp']) $$, 'depo yalnızca 4 MB altı WebP kabul eder');
create function tests.object_sql(p_name text, p_bucket text default 'product-images') returns text language sql as $$
  select format('insert into storage.objects (bucket_id, name) values (%L, %L) returning 1', p_bucket, p_name) $$;
select is(tests.run_as(u, tests.object_sql(gen_random_uuid() || '.webp')), '1', u || ': görsel yükler')
from unnest(array['sa', 'admin', 'pm']) u;
select is(tests.run_as(u, tests.object_sql(gen_random_uuid() || '.webp')), 'HATA 42501', u || ': görsel yükleyemez')
from unnest(array['sm', 'om', 'cs', 'musteri']) u;
select is(tests.run_as(null, tests.object_sql(gen_random_uuid() || '.webp')), 'HATA 42501', 'anon görsel yükleyemez');
select is(tests.run_as('pm', tests.object_sql(gen_random_uuid() || '.webp'), 'aal1'), 'HATA 42501', 'aal1 ile görsel yüklenemez');
select is(tests.run_as('pm', tests.object_sql('kotu.svg')), 'HATA 42501', 'başka adla dosya yüklenemez');
select is(tests.run_as('pm', tests.object_sql('a/' || gen_random_uuid() || '.webp')), 'HATA 42501', 'klasöre yüklenemez');

select * from finish();
rollback;
