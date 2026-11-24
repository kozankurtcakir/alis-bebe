-- Aşama 5 testleri: Excel planının saklanması ve uygulanması. Sonunda geri alınır.
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

insert into public.products (name, slug, audience, gender, vat_bps)
values ('Excel Test', 'excel-test', 'baby', 'unisex', 1000);
insert into public.product_variants (product_id, color_id, size_id, sku, price)
select p.id, c.id, s.id, 'XL-' || s.code, 10000
from public.products p, public.colors c, public.sizes s
where p.slug = 'excel-test' and c.code = 'HAR' and s.code in ('3-6A', '6-9A');

create function tests.v(p_sku text default 'XL-3-6A') returns uuid language sql as $$
  select id from public.product_variants where sku = p_sku $$;
create function tests.p(p_slug text default 'excel-test') returns uuid language sql as $$
  select id from public.products where slug = p_slug $$;
create function tests.color(p_code text) returns uuid language sql as $$ select id from public.colors where code = p_code $$;
create function tests.size(p_code text) returns uuid language sql as $$ select id from public.sizes where code = p_code $$;

/* Satır kısayolları */
create function tests.r(p_no integer, p_action text, p_parsed jsonb, p_before jsonb default '{}', p_errors jsonb default '[]')
returns jsonb language sql as $$
  select jsonb_build_object('row_no', p_no, 'action', p_action, 'raw', '{}'::jsonb, 'parsed', p_parsed,
    'before', p_before, 'summary', '[]'::jsonb, 'errors', p_errors) $$;
create function tests.price_row(p_no integer, p_old bigint, p_new bigint, p_sku text default 'XL-3-6A')
returns jsonb language sql as $$
  select tests.r(p_no, 'update',
    jsonb_build_object('product_id', tests.p(), 'variant_id', tests.v(p_sku), 'variant', jsonb_build_object('price', p_new)),
    jsonb_build_object('variant', jsonb_build_object('price', p_old))) $$;
create function tests.stock_row(p_no integer, p_quantity integer, p_on_hand integer, p_sku text default 'XL-3-6A')
returns jsonb language sql as $$
  select tests.r(p_no, 'update', jsonb_build_object('variant_id', tests.v(p_sku), 'quantity', p_quantity),
    jsonb_build_object('on_hand', p_on_hand)) $$;
create function tests.new_row(p_no integer, p_key text, p_sku text, p_size text, p_product jsonb default null)
returns jsonb language sql as $$
  select tests.r(p_no, 'create', jsonb_strip_nulls(jsonb_build_object('product_key', p_key, 'product', p_product,
    'variant', jsonb_build_object('sku', p_sku, 'price', 5000, 'barcode', '00' || p_sku,
      'color_id', tests.color('HAR'), 'size_id', tests.size(p_size))))) $$;

create sequence tests.hash_seq;
/* Planı saklar ve işin kimliğini döndürür; yetki denenmeyecekse postgres olarak okunur. */
create function tests.make(p_user text, p_kind text, p_rows jsonb, p_mode text default null, p_hash text default null)
returns text language sql as $$
  select tests.run_as(p_user, format('select public.create_import(%L, %L, %L, %L, %L)', p_kind, p_mode, 'deneme.xlsx',
    coalesce(p_hash, lpad(to_hex(nextval('tests.hash_seq')), 64, '0')), p_rows)) $$;
create function tests.apply(p_user text, p_job text, p_prices boolean default false, p_repeat boolean default false, p_aal text default 'aal2')
returns text language sql as $$
  select tests.run_as(p_user, format('select public.apply_import(%L, %L, %L)', p_job, p_prices, p_repeat), p_aal) $$;
create function tests.price(p_sku text default 'XL-3-6A') returns bigint language sql as $$
  select price from public.product_variants where sku = p_sku $$;
create function tests.stock(p_sku text default 'XL-3-6A') returns integer language sql as $$
  select on_hand from public.inventory where variant_id = tests.v(p_sku) $$;
create temp table job (name text primary key, id text);

-- ---------------------------------------------------------------------------
-- Yetkiler
-- ---------------------------------------------------------------------------
select is(has_table_privilege(r, t, x), false, format('%s: %s üzerinde %s yok', r, t, x))
from unnest(array['anon', 'authenticated', 'service_role']) r,
  unnest(array['public.import_jobs', 'public.import_rows']) t,
  unnest(array['insert', 'update', 'delete', 'truncate']) x;
select is(tests.make(u, 'products', jsonb_build_array(tests.price_row(2, 10000, 10100))), 'HATA 42501', u || ': ürün dosyası yükleyemez')
from unnest(array['sm', 'om', 'cs', 'musteri']) u;
select is(tests.make(u, 'stock', jsonb_build_array(tests.stock_row(2, 1, 0)), 'purchase'), 'HATA 42501', u || ': stok dosyası yükleyemez')
from unnest(array['pm', 'om', 'cs', 'musteri']) u;
select is(tests.run_as(null, $$ select public.create_import('products', null, 'a', 'b', '[]') $$), 'HATA 42501', 'anon yükleyemez');
select is(tests.run_as(u, 'select count(*) from public.list_imports()'), 'HATA 42501', u || ': yükleme listesini göremez')
from unnest(array['om', 'cs', 'musteri']) u;

insert into job values ('p1', tests.make('pm', 'products', jsonb_build_array(tests.price_row(2, 10000, 10100))));
insert into job values ('s1', tests.make('sm', 'stock', jsonb_build_array(tests.stock_row(2, 7, 0)), 'purchase'));
select matches(id, '^[0-9a-f-]{36}$', name || ' saklandı') from job;
select is(tests.run_as(u, format('select count(*) from public.import_jobs where id in (%L, %L)',
  (select id from job where name = 'p1'), (select id from job where name = 's1'))), n, u || ': yalnızca kendi türünü görür')
from (values ('sa', '2'), ('admin', '2'), ('pm', '1'), ('sm', '1'), ('om', '0'), ('cs', '0'), ('musteri', '0')) x (u, n);
select is(tests.run_as('sm', format('select count(*) from public.import_rows where job_id = %L', (select id from job where name = 'p1'))), '0', 'SM ürün satırlarını göremez');
select is(tests.run_as('pm', format('select count(*) from public.list_imports(1, %L)', (select id from job where name = 's1'))), '0', 'PM stok yüklemesini listede göremez');
select is(tests.run_as('pm', format('select is_own from public.list_imports(1, %L)', (select id from job where name = 'p1'))), 'true', 'yükleyen kendisi');
select is(tests.run_as('sa', format('delete from public.import_rows where job_id = %L returning 1', (select id from job where name = 'p1'))), 'HATA 42501', 'SA satır silemez');
select throws_ok('delete from public.import_rows', '42501', null, 'veritabanı sahibi de satır silemez');
select throws_ok($$ update public.import_rows set action = 'skip' $$, '42501', null, 'plan sonradan değiştirilemez');

select is(tests.apply('sa', id), 'HATA P0002', 'başkasının yüklemesini SA da uygulayamaz') from job where name = 'p1';
select is(tests.apply(null, id), 'HATA 42501', 'anon uygulayamaz') from job where name = 'p1';
select is(tests.apply('pm', id, false, false, 'aal1'), 'HATA 42501', 'aal1 ile uygulanamaz') from job where name = 'p1';

-- Uygulamada katalog, fiyat ve stok izinleri de gerekir.
delete from public.role_permissions where role_id = (select id from public.roles where key = 'product_manager')
  and permission_id = (select id from public.permissions where key = 'prices.write');
select is(tests.apply('pm', id), 'HATA 42501', 'prices.write yoksa ürün dosyası uygulanamaz') from job where name = 'p1';
insert into public.role_permissions select r.id, p.id from public.roles r, public.permissions p
where r.key = 'product_manager' and p.key = 'prices.write';
delete from public.role_permissions where role_id = (select id from public.roles where key = 'product_manager')
  and permission_id = (select id from public.permissions where key = 'catalog.write');
select is(tests.apply('pm', id), 'HATA 42501', 'catalog.write yoksa ürün dosyası uygulanamaz') from job where name = 'p1';
insert into public.role_permissions select r.id, p.id from public.roles r, public.permissions p
where r.key = 'product_manager' and p.key = 'catalog.write';
delete from public.role_permissions where role_id = (select id from public.roles where key = 'stock_manager')
  and permission_id = (select id from public.permissions where key = 'stock.adjust');
select is(tests.apply('sm', id), 'HATA 42501', 'stock.adjust yoksa stok dosyası uygulanamaz') from job where name = 's1';
insert into public.role_permissions select r.id, p.id from public.roles r, public.permissions p
where r.key = 'stock_manager' and p.key = 'stock.adjust';
delete from public.role_permissions where role_id = (select id from public.roles where key = 'product_manager')
  and permission_id = (select id from public.permissions where key = 'import.products');
select is(tests.apply('pm', id), 'HATA 42501', 'izni alınan kişi eski yüklemesini uygulayamaz') from job where name = 'p1';
insert into public.role_permissions select r.id, p.id from public.roles r, public.permissions p
where r.key = 'product_manager' and p.key = 'import.products';

-- ---------------------------------------------------------------------------
-- Plan biçimi
-- ---------------------------------------------------------------------------
select is(tests.make('pm', 'products', '[]'), 'HATA 22023', 'boş dosya');
select is(tests.make('pm', 'products', (select jsonb_agg(tests.price_row(n, 10000, 10100)) from generate_series(2, 1002) n)), 'HATA 22023', '1.001 satır reddedilir');
select is(tests.make('pm', 'uydurma', '[]'), 'HATA 22023', 'bilinmeyen tür');
select is(tests.make('sm', 'stock', jsonb_build_array(tests.stock_row(2, 1, 0))), 'HATA 23514', 'stok türü seçilmeli');
select is(tests.make('pm', 'products', jsonb_build_array(tests.price_row(2, 1, 2), tests.price_row(2, 1, 2))), 'HATA 23505', 'aynı satır numarası');
select is(tests.make('pm', 'products', jsonb_build_array(tests.r(2, 'error', '{}'))), 'HATA 23514', 'hatalı satırın hatası yazılmalı');
select is(tests.make('pm', 'products', jsonb_build_array(tests.r(2, 'create', '{}', '{}', '["x"]'))), 'HATA 23514', 'hatası olan satır uygulanabilir sayılamaz');
insert into job values ('bad', tests.make('pm', 'products', jsonb_build_array(
  tests.price_row(2, 10000, 10100), tests.r(3, 'error', '{}', '{}', '["Beden bulunamadı"]'))));
select is(tests.apply('pm', id), 'HATA 22023', 'tek hatalı satır bütün dosyayı durdurur') from job where name = 'bad';
select is(tests.price(), 10000::bigint, 'hatalı dosya hiçbir şey değiştirmedi');

-- ---------------------------------------------------------------------------
-- Güncelleme, eski değer denetimi, çift uygulama
-- ---------------------------------------------------------------------------
update public.product_variants set price = 10050 where sku = 'XL-3-6A';
select is(tests.apply('pm', id), 'HATA 22023', 'önizlemeden sonra değişen kayıt uygulamayı durdurur') from job where name = 'p1';
update public.product_variants set price = 10000 where sku = 'XL-3-6A';
select is(tests.apply('pm', id), '1', 'PM uygular') from job where name = 'p1';
select is(tests.price(), 10100::bigint, 'fiyat değişti');
select is((select changed_by from public.price_history where variant_id = tests.v() order by changed_at desc, new_price desc limit 1),
  (select id from tests.users where name = 'pm'), 'fiyat geçmişine uygulayan yazılır');
select is(tests.apply('pm', id), 'HATA 22023', 'ikinci kez uygulanamaz') from job where name = 'p1';
select is(tests.run_as('admin', $$ select count(*) from public.list_audit_logs() where action = 'import.apply' and target = 'deneme.xlsx' and created_at = now() $$), '1', 'işlem geçmişinde');

-- ---------------------------------------------------------------------------
-- %10 fiyat uyarısı
-- ---------------------------------------------------------------------------
create function tests.warned(p_old bigint, p_new bigint) returns boolean language plpgsql as $$
declare v_job text := tests.make('pm', 'products', jsonb_build_array(tests.price_row(2, p_old, p_new)));
begin return (select big_price_change from public.import_rows where job_id = v_job::uuid); end $$;
select is(tests.warned(10000, n), e, format('100,00 → %s kuruş uyarısı: %s', n, e))
from (values (10999::bigint, false), (11000, true), (11001, true), (9001, false), (9000, true), (8999, true), (10000, false), (100000, true), (1, true)) x (n, e);
select is(tests.warned(1, 1), false, 'aynı fiyat uyarı vermez');
insert into job values ('big', tests.make('pm', 'products', jsonb_build_array(tests.price_row(2, 10100, 20200))));
select is(tests.apply('pm', id), 'HATA 22023', 'büyük fiyat değişimi onaysız uygulanamaz') from job where name = 'big';
select is(tests.apply('pm', id, null), 'HATA 22023', 'boş onay onay değildir') from job where name = 'big';
select is(tests.price(), 10100::bigint, 'fiyat değişmedi');
select is(tests.run_as('pm', format('select price_warnings from public.list_imports(1, %L)', id)), '1', 'uyarı sayısı listede') from job where name = 'big';
select is(tests.apply('pm', id, true), '1', 'onayla uygulanır') from job where name = 'big';
select is(tests.price(), 20200::bigint, 'fiyat onayla değişti');

-- ---------------------------------------------------------------------------
-- Yeni ürün: ya hepsi ya hiçbiri
-- ---------------------------------------------------------------------------
create function tests.new_product(p_slug text) returns jsonb language sql as $$
  select jsonb_build_object('name', 'Yeni Ürün', 'slug', p_slug, 'audience', 'baby', 'gender', 'unisex', 'vat_bps', 1000) $$;
insert into job values ('fail', tests.make('pm', 'products', jsonb_build_array(
  tests.new_row(2, 'k', 'XN-1', '3-6A', tests.new_product('excel-yeni')),
  tests.new_row(3, 'k', 'XN-2', '3-6A'))));
select is(tests.apply('pm', id), 'HATA 23505', 'aynı renk ve beden: uygulama durur') from job where name = 'fail';
select is(tests.p('excel-yeni'), null, 'ilk satırdaki ürün de geri alındı');
select is((select status from public.import_jobs where id = (select j.id::uuid from job j where name = 'fail')), 'validated', 'iş uygulanmış sayılmaz');

insert into job values ('new', tests.make('pm', 'products', jsonb_build_array(
  tests.new_row(2, 'k', 'XN-1', '3-6A', tests.new_product('excel-yeni')),
  tests.new_row(3, 'k', 'XN-2', '6-9A'),
  jsonb_set(tests.new_row(4, 'x', 'XN-3', '9-12A'), '{parsed}', (tests.new_row(4, 'x', 'XN-3', '9-12A') -> 'parsed') - 'product_key' || jsonb_build_object('product_id', tests.p())),
  tests.r(5, 'skip', '{}'))));
select is(tests.apply('pm', id), '3', 'yeni ürün ve varyantlar eklenir') from job where name = 'new';
select is((select status from public.products where slug = 'excel-yeni'), 'draft', 'yeni ürün taslak');
select is((select count(*) from public.product_variants where product_id = tests.p('excel-yeni')), 2::bigint, 'aynı anahtar tek ürün');
select is((select product_id from public.product_variants where sku = 'XN-3'), tests.p(), 'mevcut ürüne varyant eklenir');
select is((select barcode from public.product_variants where sku = 'XN-1'), '00XN-1', 'barkodun baştaki sıfırı korunur');
select is((select count(*) from public.inventory where variant_id = tests.v('XN-1')), 1::bigint, 'stok kaydı açılır');
insert into job values ('dup', tests.make('pm', 'products', jsonb_build_array(tests.new_row(2, 'd', 'XN-1', '3-6A', tests.new_product('excel-baska')))));
select is(tests.apply('pm', id), 'HATA 23505', 'bu sırada eklenmiş SKU reddedilir') from job where name = 'dup';
insert into job values ('status', tests.make('pm', 'products', jsonb_build_array(
  tests.new_row(2, 's', 'XN-9', '3-6A', tests.new_product('excel-hile') || '{"status": "published"}'))));
select is(tests.apply('pm', id), '1', 'fazladan alan yok sayılır') from job where name = 'status';
select is((select status from public.products where slug = 'excel-hile'), 'draft', 'Excel ile yayınlanamaz');

-- Ürün bilgisi ve ana kategori
create function tests.cat(p_slug text) returns uuid language sql as $$ select id from public.categories where slug = p_slug $$;
create function tests.info_row(p_cat text, p_before_cat uuid, p_product jsonb, p_before jsonb) returns jsonb language sql as $$
  select tests.r(2, 'update', jsonb_build_object('product_id', tests.p(), 'variant_id', tests.v(), 'product', p_product,
    'primary_category', tests.cat(p_cat)), jsonb_build_object('product', p_before, 'primary_category', p_before_cat)) $$;
insert into job values ('info', tests.make('pm', 'products', jsonb_build_array(
  tests.info_row('bebek', null, '{"name": "Yeni Ad", "vat_bps": 2000}', '{"name": "Excel Test", "vat_bps": 1000}'))));
select is(tests.apply('pm', id), '1', 'ürün bilgisi güncellenir') from job where name = 'info';
select results_eq($$ select name, vat_bps, gender from public.products where id = tests.p() $$, $$ values ('Yeni Ad', 2000, 'unisex') $$, 'yalnızca yazılan alanlar değişir');
insert into job values ('cat', tests.make('pm', 'products', jsonb_build_array(
  tests.info_row('cocuk', tests.cat('bebek'), '{}', '{}'))));
insert into job values ('cat-old', tests.make('pm', 'products', jsonb_build_array(
  tests.info_row('yetiskin', tests.cat('bebek'), '{}', '{}'))));
select is(tests.apply('pm', id), '1', 'ana kategori değişir') from job where name = 'cat';
select is((select category_id from public.product_categories where product_id = tests.p() and is_primary), tests.cat('cocuk'), 'tek ana kategori');
select is(tests.apply('pm', id), 'HATA 22023', 'bu sırada değişen ana kategori uygulamayı durdurur') from job where name = 'cat-old';
insert into job values ('name-old', tests.make('pm', 'products', jsonb_build_array(
  tests.info_row('cocuk', tests.cat('cocuk'), '{"name": "Z"}', '{"name": "Excel Test"}'))));
select is(tests.apply('pm', id), 'HATA 22023', 'bu sırada değişen ürün adı uygulamayı durdurur') from job where name = 'name-old';

-- Yayın şartı bozulursa bütün dosya geri alınır.
update public.products set status = 'draft', description = 'a', material = 'b' where id = tests.p();
insert into public.product_images (product_id, path, width, height, alt)
values (tests.p(), '00000000-0000-4000-8000-0000000000aa.webp', 1, 1, 'x');
select is(tests.run_as('pm', format('select public.set_product_status(%L, %L)', tests.p(), 'published')), '', 'ürün yayında');
insert into job values ('care', tests.make('pm', 'products', jsonb_build_array(
  tests.price_row(2, 10000, 10100, 'XL-6-9A'),
  tests.r(3, 'update', jsonb_build_object('product_id', tests.p(), 'variant_id', tests.v(), 'product', '{"product_type": "personal_care"}'::jsonb),
    '{"product": {"product_type": "clothing"}}'))));
select is(tests.apply('pm', id), 'HATA 22023', 'yayın şartını bozan dosya reddedilir') from job where name = 'care';
select is(tests.price('XL-6-9A'), 10000::bigint, 'sağlam satır da geri alındı');

-- ---------------------------------------------------------------------------
-- Stok
-- ---------------------------------------------------------------------------
select is(tests.apply('sm', id), '1', 'SM stok dosyasını uygular') from job where name = 's1';
select is(tests.stock(), 7, 'mal girişi eklendi');
select results_eq($$ select reason, delta, note from public.stock_movements where variant_id = tests.v() $$,
  $$ values ('import', 7, 'Excel girişi · deneme.xlsx') $$, 'hareket yazıldı');
select is(tests.apply('sm', id), 'HATA 22023', 'stok dosyası ikinci kez uygulanamaz') from job where name = 's1';
insert into job values ('count', tests.make('sm', 'stock', jsonb_build_array(
  tests.stock_row(2, 5, 7), tests.stock_row(3, 4, 0, 'XL-6-9A')), 'adjustment'));
insert into job values ('count-old', tests.make('sm', 'stock', jsonb_build_array(
  tests.stock_row(2, 9, 0, 'XL-6-9A'), tests.stock_row(3, 9, 7)), 'adjustment'));
select is(tests.apply('sm', id), '2', 'sayım uygulanır') from job where name = 'count';
select is(tests.stock() || ',' || tests.stock('XL-6-9A'), '5,4', 'sayım toplamı yazar');
select is(tests.apply('sm', id), 'HATA 22023', 'eski sayım reddedilir') from job where name = 'count-old';
select is(tests.stock() || ',' || tests.stock('XL-6-9A'), '5,4', 'eski sayım hiçbir satırı değiştirmez');
update public.inventory set reserved = 3 where variant_id = tests.v('XL-6-9A');
insert into job values ('reserved', tests.make('sm', 'stock', jsonb_build_array(
  tests.stock_row(2, 50, 5), tests.stock_row(3, 2, 4, 'XL-6-9A')), 'adjustment'));
select is(tests.apply('sm', id), 'HATA 22023', 'ayrılmış stoğun altına inen sayım reddedilir') from job where name = 'reserved';
select is(tests.stock(), 5, 'diğer satır da geri alındı');
update public.inventory set reserved = 0 where variant_id = tests.v('XL-6-9A');
insert into job values ('neg', tests.make('sm', 'stock', jsonb_build_array(tests.stock_row(2, -3, 5)), 'purchase'));
select is(tests.apply('sm', id), 'HATA 22023', 'eksi miktar reddedilir') from job where name = 'neg';
insert into job values ('ghost', tests.make('sm', 'stock', jsonb_build_array(
  tests.r(2, 'update', jsonb_build_object('variant_id', gen_random_uuid(), 'quantity', 1), '{"on_hand": 0}')), 'purchase'));
select is(tests.apply('sm', id), 'HATA P0002', 'olmayan varyant') from job where name = 'ghost';

insert into job values ('hidden', tests.make('pm', 'products', jsonb_build_array(
  tests.r(2, 'update', jsonb_build_object('product_id', tests.p(), 'variant_id', tests.v('XL-6-9A'), 'variant', '{"price": 99000}'::jsonb)))));
select is(tests.apply('pm', id), 'HATA 22023', 'eski fiyatı gizleyen satır uygulanamaz') from job where name = 'hidden';
insert into job values ('create-old', tests.make('pm', 'products', jsonb_build_array(
  tests.r(2, 'create', (tests.new_row(2, 'x', 'XN-8', '18-24A') -> 'parsed') - 'product_key'
    || jsonb_build_object('product_id', tests.p(), 'product', '{"name": "Q"}'::jsonb), '{"product": {"name": "Eski Ad"}}'))));
select is(tests.apply('pm', id), 'HATA 22023', 'yeni varyant satırı da eski ürün bilgisiyle uygulanamaz') from job where name = 'create-old';
select is(tests.v('XN-8'), null, 'varyant eklenmedi');

-- Aynı dosya yeniden yüklenirse ayrıca onay ister.
insert into job values ('once', tests.make('sm', 'stock', jsonb_build_array(tests.stock_row(2, 1, 5)), 'purchase', repeat('a', 64)));
insert into job values ('again', tests.make('sm', 'stock', jsonb_build_array(tests.stock_row(2, 1, 6)), 'purchase', repeat('a', 64)));
select is(tests.apply('sm', id), '1', 'ilk uygulama') from job where name = 'once';
select is(tests.run_as('sm', format('select applied_before from public.list_imports(1, %L)', id)), 'true', 'daha önce uygulandığı gösterilir') from job where name = 'again';
select is(tests.apply('sm', id), 'HATA 22023', 'aynı dosya onaysız yeniden uygulanamaz') from job where name = 'again';
select is(tests.apply('sm', id, false, true), '1', 'onayla uygulanır') from job where name = 'again';
select is(tests.stock(), 7, 'iki giriş');

-- Excel hareketi ters çevrilebilir.
select is(tests.run_as('sm', format($$ select public.reverse_stock_movement(%L, 'yanlış dosya', %L) $$,
  (select id from public.stock_movements where variant_id = tests.v() order by seq desc limit 1), gen_random_uuid())), '6', 'Excel hareketi ters çevrilir');
select is(
  (select count(*) from public.inventory i where i.on_hand <> (
    select coalesce(sum(delta), 0) from public.stock_movements m where m.variant_id = i.variant_id)),
  0::bigint, 'stok, hareketlerin toplamına eşit');

-- ---------------------------------------------------------------------------
-- Arama
-- ---------------------------------------------------------------------------
select is(tests.run_as('pm', $$ select jsonb_array_length(public.import_lookup(array['XL-3-6A', 'YOK'], '{}', '{}', '{}') -> 'variants') $$), '1', 'SKU ile bulunur');
select is(tests.run_as('pm', $$ select public.import_lookup('{}', array['00XN-1'], '{}', '{}') -> 'barcodes' ->> '00XN-1' $$), tests.v('XN-1')::text, 'barkod sahibi bulunur');
select is(tests.run_as('pm', $$ select jsonb_array_length(public.import_lookup('{}', '{}', '{}', array['excel-test']) -> 'slugs') $$), '1', 'alınmış adres bulunur');
select is(tests.run_as('musteri', $$ select public.import_lookup(array['XL-3-6A'], '{}', '{}', '{}') -> 'variants' $$), '[]', 'müşteri hiçbir şey göremez');
select is(tests.run_as('pm', $$ select public.import_lookup(array['XL-3-6A'], '{}', '{}', '{}')::text like '%cost%' $$), 'false', 'maliyet dönmez');

select * from finish();
rollback;
