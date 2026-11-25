-- Aşama 6 testleri: ziyaretçinin gördükleri, arama, süzgeç ve sıralama. Sonunda geri alınır.
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

create function tests.run_as(p_name text, p_sql text)
returns text language plpgsql as $$
declare
  v_user tests.users;
  v_result text;
begin
  select * into v_user from tests.users where name = p_name;
  perform set_config('request.jwt.claims', case when p_name is null then '{"role":"anon"}' else
    json_build_object('sub', v_user.id, 'role', 'authenticated', 'aal', 'aal2',
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

select tests.new_user('pm', 'product_manager');
select tests.new_user('cs', 'customer_service');
select tests.new_user('musteri');

-- Gerçek kayıtlar sonuçları etkilemesin; işlem sonunda geri alınır.
update public.products set status = 'draft' where status = 'published';

-- ---------------------------------------------------------------------------
-- Veri: t-ust > t-alt > t-torun ve kapalı t-kapali > t-kapali-alt
-- ---------------------------------------------------------------------------
insert into public.categories (name, slug, sort_order, is_active) values
  ('Üst', 't-ust', 900, true), ('Kapalı', 't-kapali', 901, false);
insert into public.categories (name, slug, parent_id)
select 'Alt', 't-alt', id from public.categories where slug = 't-ust';
insert into public.categories (name, slug, parent_id)
select 'Torun', 't-torun', id from public.categories where slug = 't-alt';
insert into public.categories (name, slug, parent_id)
select 'Kapalı alt', 't-kapali-alt', id from public.categories where slug = 't-kapali';
insert into public.brands (name, slug) values ('Çınar', 't-cinar');

-- Varyantlar: renk|beden|fiyat|eski fiyat|stok|ayrılan|aktif
create function tests.product(
  p_slug text, p_name text, p_category text, p_published timestamptz, p_variants text[],
  p_status text default 'published', p_brand text default null, p_gender text default 'unisex'
)
returns uuid language plpgsql as $$
declare
  v_id uuid;
  x text;
  a text[];
  v_variant uuid;
begin
  insert into public.products (name, slug, audience, gender, vat_bps, description, material, brand_id)
  values (p_name, p_slug, 'baby', p_gender, 1000, 'Açıklama', 'Pamuk',
    (select id from public.brands where slug = p_brand))
  returning id into v_id;
  insert into public.product_categories (product_id, category_id, is_primary)
  select v_id, id, true from public.categories where slug = p_category;
  insert into public.product_images (product_id, path, width, height, alt)
  values (v_id, gen_random_uuid() || '.webp', 800, 1000, p_name);
  foreach x in array p_variants loop
    a := string_to_array(x, '|');
    insert into public.product_variants (product_id, color_id, size_id, sku, barcode, price, compare_at_price, is_active)
    values (v_id, (select id from public.colors where slug = a[1]), (select id from public.sizes where code = a[2]),
      upper('TST-' || substr(md5(gen_random_uuid()::text), 1, 12)), '0' || substr(md5(gen_random_uuid()::text), 1, 12),
      a[3]::bigint, nullif(a[4], '')::bigint, a[7]::boolean)
    returning id into v_variant;
    update public.inventory set on_hand = a[5]::int, reserved = a[6]::int where variant_id = v_variant;
  end loop;
  update public.products set status = p_status, published_at = p_published where id = v_id;
  return v_id;
end $$;

select tests.product('t-zibin', 'Işıklı İnce Zıbın', 't-torun', '2030-01-03', array[
  'hardal|3-6A|20000|25000|10|0|true', 'hardal|6-9A|22000||3|0|true',
  'mavi|3-6A|30000||5|5|true', 'mavi|6-9A|30000||4|0|true', 'pembe|3-6A|100||50|0|false'],
  p_brand => 't-cinar', p_gender => 'female');
select tests.product('t-takim', 'Kadife Takım', 't-alt', '2030-01-02', array['lila|3-6A|50000||9|0|true']);
select tests.product('t-tukenen', 'Tükenen Şort', 't-ust', '2030-01-09', array['lila|3-6A|1000||0|0|true']);
select tests.product('t-ust-sort', 'Uzun Işıksız Şort', 't-ust', '2030-01-01', array['beyaz|YD|30000||9|0|true'], p_gender => 'male');
select tests.product('t-taslak', 'Işıklı Taslak', 't-ust', null, array['lila|3-6A|1000||5|0|true'], 'draft');
select tests.product('t-kapali-urun', 'Kapalı Bölüm Ürünü', 't-kapali-alt', '2029-01-01', array['beyaz|YD|30000||9|0|true']);
insert into public.size_charts (name, category_id, rows)
select 'T tablo ' || slug, id, '[["Beden"],["A"]]' from public.categories
where slug in ('t-ust', 't-torun', 't-kapali');

create function tests.slugs(p_args text, p_as text default null)
returns text language sql as $$
  select tests.run_as(p_as, format(
    'select string_agg(slug, '','' order by ord) from (select slug, row_number() over () ord from public.shop_products(%s)) x', p_args)) $$;
create function tests.p(p_slug text) returns jsonb language sql as $$
  select tests.run_as(null, format('select public.shop_product(%L)', p_slug))::jsonb $$;

-- ---------------------------------------------------------------------------
-- İzin ve gizlilik
-- ---------------------------------------------------------------------------
select is(tests.run_as(null, 'select count(*) from ' || t), 'HATA 42501', 'ziyaretçi okuyamaz: ' || t)
from unnest(array['public.products', 'public.product_variants', 'public.inventory', 'public.categories',
  'public.product_images', 'public.variant_costs', 'public.price_history', 'public.colors']) t;
select is(tests.run_as('musteri', 'select count(*) from ' || t), '0', 'müşteri tabloda satır görmez: ' || t)
from unnest(array['public.products', 'public.product_variants', 'public.inventory', 'public.categories']) t;
select is(tests.run_as(null, 'select count(*) from ' || f), 'HATA 42501', 'ziyaretçi çağıramaz: ' || f)
from unnest(array['private.shop_matches(null, null)', 'private.shop_category_tree()',
  'private.fold_tr(''a'')', 'public.search_products(''a'')', 'public.list_stock(null, null, 1)']) f;
select is(tests.run_as('musteri', 'select count(*) from private.shop_matches(null, null)'), 'HATA 42501',
  'müşteri iç fonksiyonu çağıramaz');

select is(tests.slugs('p_category => ''t-ust''', 'musteri'), tests.slugs('p_category => ''t-ust'''),
  'müşteri ve ziyaretçi aynı listeyi görür');
select is(tests.slugs('p_category => ''t-ust''', 'pm'), tests.slugs('p_category => ''t-ust'''),
  'personel de mağazada taslağı görmez');

select is(tests.p('t-taslak'), null, 'taslak açılmaz');
select is(tests.p('olmayan'), null, 'olmayan ürün açılmaz');
select is(tests.p(null), null, 'boş adres açılmaz');
update public.products set status = 'archived', archived_at = now() where slug = 't-takim';
select is(tests.p('t-takim'), null, 'arşivdeki ürün açılmaz');
select ok(tests.slugs('p_category => ''t-ust''') not like '%t-takim%', 'arşivdeki ürün listelenmez');
update public.products set status = 'draft', archived_at = null where slug = 't-takim';
update public.products set status = 'published' where slug = 't-takim';

select set_eq($$ select jsonb_object_keys(tests.p('t-zibin')) $$,
  array['name', 'description', 'material', 'care', 'brand', 'categories', 'images', 'variants', 'size_charts'],
  'ürün yalnızca listedeki alanları verir');
select set_eq($$ select distinct jsonb_object_keys(v) from jsonb_array_elements(tests.p('t-zibin') -> 'variants') v $$,
  array['id', 'price', 'compare_at_price', 'color', 'size', 'stock'], 'varyant yalnızca listedeki alanları verir');
select is(jsonb_array_length(tests.p('t-zibin') -> 'variants'), 4, 'pasif varyant görünmez');
select results_eq(
  $$ select v #>> '{color,slug}', v #>> '{size,code}', v ->> 'stock'
     from jsonb_array_elements(tests.p('t-zibin') -> 'variants') v $$,
  $$ values ('hardal', '3-6A', 'in'), ('hardal', '6-9A', 'low'), ('mavi', '3-6A', 'out'), ('mavi', '6-9A', 'in') $$,
  'stok yalnızca durum olarak verilir; ayrılan adet düşülür; renk ve beden sıralıdır');
select is(tests.p('t-zibin') -> 'categories', '[{"name":"Üst","slug":"t-ust"},{"name":"Alt","slug":"t-alt"},{"name":"Torun","slug":"t-torun"}]',
  'sayfa yolu üstten alta sıralıdır');
select is(tests.p('t-zibin') -> 'size_charts', '[{"name":"T tablo t-torun","rows":[["Beden"],["A"]]},{"name":"T tablo t-ust","rows":[["Beden"],["A"]]}]',
  'kategorinin ve üstünün beden tabloları gelir');
select is(tests.p('t-kapali-urun') -> 'categories', '[]', 'kapalı kategorinin adı sızmaz');
select is(tests.p('t-kapali-urun') -> 'size_charts', '[]', 'kapalı kategorinin tablosu sızmaz');
select is(tests.p('t-zibin') ->> 'brand', 'Çınar', 'marka adı gelir');

-- ---------------------------------------------------------------------------
-- Kategoriler
-- ---------------------------------------------------------------------------
select is(tests.run_as(null, $$ select string_agg(slug || ':' || coalesce(parent_slug, '-'), ',')
  from public.shop_categories() where slug like 't-%' $$),
  't-ust:-,t-alt:t-ust,t-torun:t-alt', 'kapalı kategori ve altı görünmez');
select is(tests.slugs('p_category => ''t-ust'''), 't-zibin,t-takim,t-ust-sort,t-tukenen',
  'alt kategoriler dahildir; yeni yayın önce, tükenen sonda');
select is(tests.slugs('p_category => ''t-alt'''), 't-zibin,t-takim', 'alt kategori üstünü kapsamaz');
select is(tests.slugs('p_category => ''t-kapali'''), null, 'kapalı kategori ürün vermez');
select is(tests.slugs('p_category => ''t-kapali-alt'''), null, 'kapalı kategorinin altı ürün vermez');
select is(tests.slugs('p_category => ''olmayan'''), null, 'olmayan kategori bütün ürünleri vermez');
select is(tests.slugs('p_category => '''''), null, 'boş kategori bütün ürünleri vermez');
select is(tests.slugs(''), 't-zibin,t-takim,t-ust-sort,t-kapali-urun,t-tukenen', 'kapsam yoksa yayındaki bütün ürünler');

-- ---------------------------------------------------------------------------
-- Türkçe arama
-- ---------------------------------------------------------------------------
select is(private.fold_tr(x), 'isiktan istanbul', 'katlama: ' || x)
from unnest(array['Işıktan İstanbul', 'IŞIKTAN İSTANBUL', 'ışıktan istanbul', 'isiktan ISTANBUL',
  normalize('Işıktan İstanbul', NFD), U&'i\015F\0131ktan i\0307stanbul']) x;
select is(private.search_words('  %100 Pamuk--T-Shirt! Âlâ '), '100 pamuk t shirt ala', 'sözcükler ayrılır');

select is(tests.slugs(format('p_query => %L', q)), 't-zibin', 'arama: ' || q)
from unnest(array['Işıklı', 'IŞIKLI', 'ışıklı', 'isikli', 'İŞİKLİ', 'ince zıbın', 'INCE ZIBIN',
  'çınar', 'CINAR', 'işıklı pamuk', 'torun', 'mavi hardal', 'zıb', 'kız zıbın', normalize('Işıklı', NFD)]) q;
select is(tests.slugs(format('p_query => %L', q)), null, 'bulunmaz: ' || q)
from unnest(array['şıklı', 'ışıklı takım', 'taslak', 'TST', 'pembe', 'ışıklı''; drop table x',
  repeat('xq ', 5000)]) q;
select is(tests.slugs('p_category => ''t-ust'', p_query => ''ışık'''), 't-zibin,t-ust-sort', 'sözcük başı eşleşir');
select is(tests.slugs(format('p_category => ''t-ust'', p_query => %L', q)), tests.slugs('p_category => ''t-ust'''),
  'yalnızca işaretten oluşan arama süzmez: ' || q)
from unnest(array['%', '_', '  ', '\', '''']) q;
-- Adında geçen ürün, başka alanda geçenden önce gelir.
update public.products set material = 'Şort kumaşı' where slug = 't-zibin';
select is(tests.slugs('p_category => ''t-ust'', p_query => ''şort''') , 't-ust-sort,t-zibin,t-tukenen', 'adda eşleşme öne geçer');
select is(tests.slugs('p_category => ''t-ust'', p_query => ''şort'', p_sort => ''price_asc'''), 't-zibin,t-ust-sort,t-tukenen',
  'seçilen sıralama eşleşmenin önündedir');
update public.products set material = 'Pamuk' where slug = 't-zibin';

-- ---------------------------------------------------------------------------
-- Süzgeç, sıralama, sayfa
-- ---------------------------------------------------------------------------
create function tests.f(p_args text) returns text language sql as $$
  select tests.slugs('p_category => ''t-ust'', ' || p_args) $$;
select is(tests.f('p_sizes => ''{3-6A}'''), 't-zibin,t-takim,t-tukenen', 'beden');
select is(tests.f('p_sizes => ''{YD,6-9A}'''), 't-zibin,t-ust-sort', 'iki bedenden biri yeter');
select is(tests.f('p_colors => ''{lila}'''), 't-takim,t-tukenen', 'renk');
select is(tests.f('p_colors => ''{pembe}'''), null, 'pasif varyantın rengi sayılmaz');
select is(tests.f('p_brands => ''{t-cinar}'''), 't-zibin', 'marka');
select is(tests.f('p_genders => ''{male}'''), 't-ust-sort', 'cinsiyet');
select is(tests.f('p_min => 50000'), 't-takim', 'en az fiyat dahil');
select is(tests.f('p_max => 1000'), 't-tukenen', 'en çok fiyat dahil');
select is(tests.f('p_max => 999'), null, 'pasif varyantın fiyatı sayılmaz');
select is(tests.f('p_in_stock => true'), 't-zibin,t-takim,t-ust-sort', 'stokta olanlar');
select is(tests.f('p_sizes => ''{3-6A}'', p_colors => ''{mavi}'', p_in_stock => true'), null,
  'süzgeçlerin hepsine tek varyant uymalı (beden, renk, stok)');
select is(tests.f('p_sizes => ''{3-6A}'', p_colors => ''{hardal}'', p_min => 21000'), null,
  'süzgeçlerin hepsine tek varyant uymalı (beden, renk, fiyat)');
select is(tests.f('p_sizes => null, p_colors => null, p_brands => null, p_genders => null, p_in_stock => null, p_sort => null, p_page => null, p_limit => null'),
  't-zibin,t-takim,t-ust-sort,t-tukenen', 'boş değerler süzmez');
select is(tests.f('p_sort => ''price_asc'''), 't-zibin,t-ust-sort,t-takim,t-tukenen', 'fiyat artan; tükenen sonda');
select is(tests.f('p_sort => ''price_desc'''), 't-takim,t-ust-sort,t-zibin,t-tukenen', 'fiyat azalan; tükenen sonda');
select is(tests.f('p_limit => 2'), 't-zibin,t-takim', 'sayfa boyu');
select is(tests.f('p_limit => 2, p_page => 2'), 't-ust-sort,t-tukenen', 'ikinci sayfa');
select is(tests.f('p_limit => 2, p_page => 3'), null, 'son sayfadan sonrası boş');
select is(tests.f('p_limit => -5, p_page => -1'), 't-zibin', 'eksi sayfa ilk sayfadır');
select is(tests.run_as(null, 'select max(total) from public.shop_products(''t-ust'', p_limit => 2)'), '4', 'toplam bütün sayfaları sayar');

select is(tests.run_as(null, $$ select concat_ws('|', price, compare_at_price, has_more_prices, color_count, sold_out, image_alt)
  from public.shop_products('t-ust') where slug = 't-zibin' $$), '20000|25000|t|2|f|Işıklı İnce Zıbın',
  'kart en ucuz aktif varyantı gösterir');
select is(tests.run_as(null, $$ select concat_ws('|', price, has_more_prices, color_count, sold_out)
  from public.shop_products('t-ust', p_colors => '{mavi}', p_sizes => '{3-6A}') $$), '30000|f|1|t',
  'kart süzgece uyan varyantın fiyatını ve stoğunu gösterir');
insert into public.product_images (product_id, color_id, path, width, height, alt, sort_order)
select p.id, c.id, gen_random_uuid() || '.webp', 800, 1000, 'Mavi görsel', 5
from public.products p, public.colors c where p.slug = 't-zibin' and c.slug = 'mavi';
select is(tests.run_as(null, $$ select image_alt from public.shop_products('t-ust', p_colors => '{mavi}') $$), 'Mavi görsel',
  'renk süzülünce o rengin görseli çıkar');
select is(tests.run_as(null, $$ select image_alt from public.shop_products('t-ust') where slug = 't-zibin' $$), 'Işıklı İnce Zıbın',
  'süzgeç yoksa ilk görsel çıkar');

-- ---------------------------------------------------------------------------
-- Süzgeç seçenekleri
-- ---------------------------------------------------------------------------
select is(tests.run_as(null, 'select public.shop_facets(''t-torun'')')::jsonb,
  '{"sizes":[{"label":"3-6 Ay","value":"3-6A"},{"label":"6-9 Ay","value":"6-9A"}],
    "colors":[{"hex":"#f4b942","label":"Hardal","value":"hardal"},{"hex":"#4f86c6","label":"Mavi","value":"mavi"}],
    "brands":[{"label":"Çınar","value":"t-cinar"}], "genders":["female"], "has_products":true}',
  'yalnızca aktif varyantların seçenekleri');
select is(tests.run_as(null, 'select public.shop_facets(''t-kapali'')')::jsonb ->> 'has_products', 'false', 'kapalı kategoride seçenek yok');
select is(tests.run_as(null, 'select public.shop_facets(null, ''taslak'')')::jsonb ->> 'has_products', 'false', 'taslak seçenek vermez');

-- ---------------------------------------------------------------------------
-- Yayın tarihi ve panel araması
-- ---------------------------------------------------------------------------
select is((select published_at from public.products where slug = 't-taslak'), null, 'taslağın yayın tarihi yok');
update public.products set status = 'published' where slug = 't-taslak';
select is((select published_at from public.products where slug = 't-taslak'), now(), 'ilk yayında tarih yazılır');
update public.products set published_at = '2020-01-01' where slug = 't-taslak';
update public.products set status = 'draft' where slug = 't-taslak';
update public.products set status = 'published' where slug = 't-taslak';
select is((select published_at from public.products where slug = 't-taslak'), '2020-01-01'::timestamptz, 'yeniden yayın tarihi değiştirmez');
select is(tests.run_as('pm', 'update public.products set published_at = now() where slug = ''t-zibin'' returning 1'), 'HATA 42501',
  'personel yayın tarihini elle değiştiremez');

select is(tests.run_as('cs', format('select string_agg(slug, '','' order by slug) from public.search_products(%L)', q)),
  't-taslak,t-zibin', 'panel araması: ' || q)
from unnest(array['IŞIKLI', 'ışıklı', 'isikli', 'İŞİKLİ']) q;
select is(tests.run_as('cs', format('select string_agg(slug, '','') from public.search_products(%L)',
  (select lower(v.sku) from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 't-takim'))),
  't-takim', 'panel araması SKU ile bulur');
select is(tests.run_as('cs', format('select string_agg(slug, '','') from public.search_products(%L)',
  (select v.barcode from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 't-takim'))),
  't-takim', 'panel araması barkodla bulur');
select is(tests.run_as('cs', 'select count(*) from public.search_products(''%'')'), '0', 'panel aramasında % joker değildir');
select is(tests.run_as('musteri', 'select count(*) from public.search_products(''işıklı'')'), '0', 'müşteri panel aramasında kayıt görmez');
select is(tests.run_as('cs', 'select count(*) from public.list_stock(''IŞIKLI ince'', null, 1)'), '5', 'stok araması Türkçe harfleri tanır');
select is(tests.run_as('musteri', 'select count(*) from public.list_stock(''IŞIKLI'', null, 1)'), '0', 'müşteri stok görmez');

select * from finish();
rollback;
