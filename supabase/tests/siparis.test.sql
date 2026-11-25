-- Aşama 8 testleri: sipariş, EFT, kapıda ödeme, mağazadan teslim. Sonunda geri alınır.
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

-- Personel aal2, müşteri aal1 ile çalışır. Hata iletisi de döner.
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
    perform set_config('role', 'postgres', true);
  exception when others then
    v_result := 'HATA ' || sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end $$;
create function tests.uid(p_name text) returns uuid language sql as
$$ select id from tests.users where name = p_name $$;

select tests.new_user('a');
select tests.new_user('b');
select tests.new_user('pasif');
select tests.new_user('sa', 'super_admin');
select tests.new_user('sa2', 'super_admin');
select tests.new_user('ad', 'admin');
select tests.new_user('om', 'order_manager');
select tests.new_user('cs', 'customer_service');
select tests.new_user('pm', 'product_manager');
select tests.new_user('sm', 'stock_manager');

-- Ürünler
create table tests.v (name text primary key, id uuid not null);
create function tests.product(p_slug text) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.products (name, slug, audience, gender, vat_bps, description, material)
  values ('Ürün ' || p_slug, p_slug, 'baby', 'unisex', 1000, 'Açıklama', 'Pamuk') returning id into v_id;
  insert into public.product_categories (product_id, category_id, is_primary)
  select v_id, id, true from public.categories where slug = 't-siparis';
  insert into public.product_images (product_id, path, width, height, alt, sort_order)
  values (v_id, gen_random_uuid() || '.webp', 800, 1000, 'Genel', 0);
  update public.products set status = 'published' where id = v_id;
  return v_id;
end $$;
create function tests.variant(p_name text, p_product uuid, p_size text, p_price bigint, p_stock integer)
returns void language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.product_variants (product_id, color_id, size_id, sku, price, is_active)
  values (p_product, (select id from public.colors where slug = 'mavi'),
    (select id from public.sizes where code = p_size),
    upper('TST-' || substr(md5(gen_random_uuid()::text), 1, 12)), p_price, true) returning id into v_id;
  insert into tests.v values (p_name, v_id);
  perform private.apply_stock(private.lock_inventory(v_id), p_stock, 'initial', null, gen_random_uuid());
end $$;
create function tests.v(p_name text) returns uuid language sql as $$ select id from tests.v where name = p_name $$;
insert into public.categories (name, slug, sort_order) values ('Sipariş', 't-siparis', 900);
do $$
declare
  x uuid := tests.product('t-o1');
begin
  perform tests.variant('ucuz', x, '3-6A', 10000, 1000);
  perform tests.variant('tam', x, '6-9A', 100000, 1000);
  perform tests.variant('az', x, '9-12A', 99999, 2);
end $$;

create function tests.stock(p_name text) returns text language sql as
$$ select on_hand || '/' || reserved from public.inventory where variant_id = tests.v(p_name) $$;

create sequence tests.n;
create table tests.o (name text primary key, id uuid, no text, token text, key uuid);

create function tests.addr() returns jsonb language sql as
$$ select '{"recipient":"Deneme Kişi","phone":"+905550000000","city":"Eskişehir","district":"Odunpazarı","line":"Deneme Mahallesi 1","postal_code":"26000"}'::jsonb $$;
create function tests.docs() returns jsonb language sql as
$$ select jsonb_agg(id) from (select distinct on (kind) id from public.legal_documents order by kind, version desc) d $$;

create function tests.req(p_total bigint, p_over jsonb default '{}') returns jsonb language sql volatile as $$
  select jsonb_build_object('key', gen_random_uuid(), 'email', 'm' || n || '@ornek.test',
    'phone', '+90555' || lpad(n::text, 7, '0'), 'name', 'Deneme Kişi', 'delivery', 'shipping',
    'payment', 'transfer', 'gift', false, 'expected_total', p_total, 'documents', tests.docs(),
    'address', tests.addr()) || p_over
  from (select nextval('tests.n') as n) x $$;

-- Sepeti doldurur; misafirse kodunu döndürür.
create function tests.fill(p_as text, p_variant text, p_qty integer) returns text language plpgsql as $$
declare
  r text := tests.run_as(p_as, format('select public.cart_add(null, %L, %s)', tests.v(p_variant), p_qty), 'aal1');
begin
  if r like 'HATA%' then raise exception 'sepet: %', r; end if;
  return r::jsonb ->> 'token';
end $$;
create function tests.place(p_as text, p_token text, p jsonb) returns text language sql volatile as
$$ select tests.run_as(p_as, format('select public.place_order(%L, %L)', p_token, p), 'aal1') $$;

-- Tek adımda sipariş verir ve adıyla saklar.
create function tests.order(p_name text, p_as text, p_variant text, p_qty integer, p_total bigint, p_over jsonb default '{}')
returns text language plpgsql as $$
declare
  v_token text := tests.fill(p_as, p_variant, p_qty);
  r text := tests.place(p_as, v_token, tests.req(p_total, p_over));
begin
  if r like 'HATA%' then return r; end if;
  insert into tests.o select p_name, o.id, o.order_no, r::jsonb ->> 'token', o.idempotency_key
  from public.orders o where o.order_no = r::jsonb ->> 'order_no';
  return 'ok';
end $$;
create function tests.o(p_name text) returns uuid language sql as $$ select id from tests.o where name = p_name $$;
create function tests.st(p_name text) returns text language sql as
$$ select order_status || '/' || payment_status from public.orders where id = tests.o(p_name) $$;
create function tests.call(p_as text, p_fn text, p_name text, p_rest text default '', p_aal text default 'aal2')
returns text language sql as
$$ select tests.run_as(p_as, format('select public.%s(%L%s)', p_fn, tests.o(p_name), p_rest), p_aal) $$;
create function tests.match(p_as text, p_name text, p_amount bigint, p_ref text) returns text language sql volatile as
$$ select tests.call(p_as, 'match_transfer', p_name, format(', %s, %L, %L', p_amount, p_ref, gen_random_uuid())) $$;
create function tests.confirm(p_as text, p_ref text, p_over boolean default false) returns text language sql volatile as
$$ select tests.run_as(p_as, format('select public.confirm_transfer(%L, %L)',
     (select id from public.bank_transfers where reference = p_ref), p_over)) $$;
create function tests.set(p jsonb, p_as text default 'sa') returns text language sql volatile as
$$ select tests.run_as(p_as, format('select public.set_settings(%L)', p)) $$;

-- ---------------------------------------------------------------------------
-- Ayarlar
-- ---------------------------------------------------------------------------
select is(left(tests.set('{"gift_fee": 600}', u), 10), 'HATA 42501', coalesce(u, 'ziyaretçi') || ': ayar değiştiremez')
from unnest(array[null, 'a', 'ad', 'om', 'cs', 'pm', 'sm']) u;
select is(left(tests.run_as('sa', $$ select public.set_settings('{"gift_fee": 600}') $$, 'aal1'), 10), 'HATA 42501', 'iki adımsız ayar değişmez');
select is(tests.run_as(u, 'select count(*) from public.settings'), '0', u || ': ayar okuyamaz') from unnest(array['a', 'ad', 'om']) u;
select is(tests.run_as('sa', 'select count(*) from public.settings'), (select count(*)::text from public.settings), 'Super Admin ayar okur');
select is(left(tests.set(x), 10), 'HATA 22023', 'geçersiz ayar: ' || x::text)
from unnest(array['{"uydurma": 1}', '{"gift_fee": -1}', '{"gift_fee": 1.5}', '{"gift_fee": "5"}', '{"gift_fee": null}',
  '{"phone_check": 1}', '{"transfer_days": 0}', '{"transfer_days": 31}', '{"max_unpaid": 0}', '{"link_days": 366}',
  '{"shipping_vat_bps": 10001}', '{"holidays": "2026-01-01"}', '{"holidays": ["2026-13-01"]}', '{"holidays": [1]}',
  '{"bank_iban": "TR330006100519786457841327", "bank_holder": "X"}', '{"bank_iban": "DE330006100519786457841326", "bank_holder": "X"}',
  '{"bank_iban": "TR330006100519786457841326"}', '{"cod_enabled": true}', '{"pickup_address": " "}',
  '{"test_mode": false}', '[]', '1']::jsonb[]) x;
select is((select value from public.settings where key = 'cod_enabled'), 'false'::jsonb, 'reddedilen ayar yazılmaz');
select is(tests.set('{"bank_iban": "TR330006100519786457841326", "bank_holder": "Deneme"}'), '', 'IBAN girilir');
select is((select count(*) from public.audit_logs where action = 'settings.update' and actor_id = tests.uid('sa')), 2::bigint, 'her değişen ayar geçmişe yazılır');
select is(tests.set('{"bank_holder": "Deneme"}'), '', 'değişmeyen ayar');
select is((select count(*) from public.audit_logs where action = 'settings.update' and actor_id = tests.uid('sa')), 2::bigint, 'değişmeyen ayar yazılmaz');
select is(left(tests.set('{"test_mode": false, "shipping_vat_bps": 2000, "gift_vat_bps": 2000, "cod_vat_bps": 2000}'), 10),
  'HATA 22023', 'taslak metinle deneme modu kapanmaz');
update public.legal_documents set is_draft = false;
select is(left(tests.set('{"test_mode": false}'), 10), 'HATA 22023', 'KDV oranı girilmeden deneme modu kapanmaz');
update public.legal_documents set is_draft = true;

-- İş günü: 27.11.2026 Cuma
select is(private.add_business_days('2026-11-27 10:00+03', 2), '2026-12-01 10:00+03'::timestamptz, 'hafta sonu sayılmaz');
update public.settings set value = '["2026-11-30"]' where key = 'holidays';
select is(private.add_business_days('2026-11-27 10:00+03', 2), '2026-12-02 10:00+03'::timestamptz, 'tatil sayılmaz');
update public.settings set value = '[]' where key = 'holidays';

-- ---------------------------------------------------------------------------
-- Erişim
-- ---------------------------------------------------------------------------
create table tests.tables (t text);
insert into tests.tables select unnest(array['settings', 'orders', 'order_items', 'order_addresses',
  'order_status_history', 'order_access_tokens', 'stock_reservations', 'payments', 'bank_transfers',
  'legal_documents', 'order_legal_acceptances', 'outbox_jobs']);
select is(left(tests.run_as(null, 'select count(*) from public.' || t), 10), 'HATA 42501', 'ziyaretçi okuyamaz: ' || t) from tests.tables;
select is(left(tests.run_as('sa', 'select count(*) from public.' || t), 10), 'HATA 42501', 'kimse okuyamaz: ' || t)
from unnest(array['order_access_tokens', 'outbox_jobs', 'legal_documents']) t;
select is_empty($$ select t, r, x from tests.tables, unnest(array['anon', 'authenticated', 'service_role']) r,
  unnest(array['insert', 'update', 'delete', 'truncate']) x
  where has_table_privilege(r, 'public.' || t, x)
     or case when x in ('insert', 'update') then has_any_column_privilege(r, 'public.' || t, x) else false end $$,
  'on iki tabloya kimse doğrudan yazamaz');
select ok((select bool_and(c.relrowsecurity) from pg_class c join tests.tables t on c.oid = ('public.' || t.t)::regclass), 'RLS hepsinde açık');

-- ---------------------------------------------------------------------------
-- Tutar
-- ---------------------------------------------------------------------------
select is(tests.order('k1', null, 'ucuz', 2, 40000), 'ok', 'kargo 200 TL eklenir');
select is(tests.order('k2', null, 'tam', 1, 100000), 'ok', 'tam 1.000 TL kargosuz');
select is(tests.order('k3', null, 'az', 1, 119999), 'ok', '999,99 TL kargolu');
select is(left(tests.order('x', null, 'ucuz', 2, 39999), 10), 'HATA 22023', 'eksik tutar reddedilir');
select is(left(tests.order('x', null, 'ucuz', 2, 1), 10), 'HATA 22023', 'uydurma tutar reddedilir');
select is(left(tests.order('x', null, 'ucuz', 2, 40000, '{"expected_total": null}'), 10), 'HATA 22023', 'boş tutar reddedilir');
select is(tests.order('k4', null, 'ucuz', 1, 30500, '{"gift": true}'), 'ok', 'hediye paketi 5 TL');
select is(left(tests.order('x', null, 'az', 1, 100499, '{"gift": true}'), 10), 'HATA 22023', 'hediye paketi ücretsiz kargoya saydırmaz');
select is(tests.order('k5', null, 'ucuz', 3, 30500, '{"gift": true, "delivery": "pickup", "payment": "store", "address": null, "invoice": {"recipient":"Ad Soyad","phone":"+905550000000","city":"Bursa","district":"Nilüfer","line":"Deneme Mah. 1"}}'), 'ok', 'mağazadan teslim kargosuz, hediye sipariş başına');
select is(tests.st('k1'), 'pending_payment/pending', 'EFT ödeme bekler');
select is(tests.st('k5'), 'awaiting_approval/pending', 'mağazada ödeme onay bekler');
select is((select total || ':' || shipping_fee || ':' || gift_fee from public.orders where id = tests.o('k4')), '30500:20000:500', 'tutar parçaları');
select is((select name || ':' || unit_price || ':' || quantity || ':' || vat_bps from public.order_items where order_id = tests.o('k1')), 'Ürün t-o1:10000:2:1000', 'ürün bilgisi kopyalanır');
update public.product_variants set price = 12000 where id = tests.v('ucuz');
select is((select unit_price from public.order_items where order_id = tests.o('k1')), 10000::bigint, 'fiyat değişince eski sipariş değişmez');
select is(left(tests.order('x', null, 'ucuz', 2, 40000), 10), 'HATA 22023', 'fiyat değiştiyse yeniden onay istenir');
update public.product_variants set price = 10000 where id = tests.v('ucuz');
select is((select count(*) from public.order_addresses where order_id = tests.o('k1')), 2::bigint, 'teslimat ve fatura adresi');
select is((select string_agg(kind, ',') from public.order_addresses where order_id = tests.o('k5')), 'invoice', 'mağazada teslimat adresi yok');
select is((select count(*) from public.order_legal_acceptances where order_id = tests.o('k1')), 2::bigint, 'iki sözleşme saklanır');
select ok((select bool_and(rendered_body like '%TASLAK%') from public.order_legal_acceptances where order_id = tests.o('k1')), 'metnin kendisi saklanır');
select is((select count(*) from public.outbox_jobs where payload ->> 'order_id' = tests.o('k1')::text), 1::bigint, 'e-posta kuyruğa girer');
select is_empty($$ select 1 from public.outbox_jobs j, tests.o o where o.token is not null and j.payload::text like '%' || o.token || '%' $$, 'gizli kod kuyrukta durmaz');

-- ---------------------------------------------------------------------------
-- Girdi denetimi
-- ---------------------------------------------------------------------------
select is(left(tests.order('x', null, 'ucuz', 1, 30000, o), 10), 'HATA 22023', 'reddedilir: ' || o::text)
from unnest(array['{"documents": []}', '{"documents": null}', '{"documents": ["x"]}', '{"key": null}', '{"key": "x"}',
  '{"delivery": "drone"}', '{"payment": "card"}', '{"payment": "cod"}', '{"payment": "store"}', '{"phone": null}',
  '{"email": null}', '{"address": null}', '{"gift": "evet"}']::jsonb[]) o;
select is(left(tests.order('x', null, 'ucuz', 1, 30000, o), 10), 'HATA 23514', 'kural dışı: ' || o::text)
from unnest(array['{"phone": "05550000000"}', '{"email": "eposta"}', '{"name": "A"}']::jsonb[]) o;
select is(left(tests.order('x', null, 'ucuz', 1, 30000, jsonb_build_object('address', tests.addr() || a)), 10), 'HATA ' || c, 'adres: ' || a::text)
from (values ('{"city": "Atlantis"}'::jsonb, '22023'), ('{"line": "kısa"}', '23514'), ('{"phone": "1"}', '23514'), ('{"postal_code": "1"}', '23514')) x (a, c);
select is(left(tests.order('x', null, 'ucuz', 1, 30000, jsonb_build_object('invoice', tests.addr() || a)), 10), 'HATA 23514', 'fatura: ' || a::text)
from unnest(array['{"company": "Şirket"}', '{"company": "Şirket", "tax_office": "VD", "tax_no": "123"}']::jsonb[]) a;
select is(tests.order('k6', null, 'ucuz', 1, 30000, jsonb_build_object('invoice', tests.addr() || '{"company": "Şirket", "tax_office": "VD", "tax_no": "1234567890"}')), 'ok', 'kurumsal fatura');
select is(left(tests.place(null, null, tests.req(30000)), 16), 'HATA 22023 Sepet', 'boş sepetten sipariş çıkmaz');
select is(left(tests.place(null, repeat('0', 64), tests.req(30000)), 16), 'HATA 22023 Sepet', 'uydurma sepet koduyla sipariş çıkmaz');
do $$
declare
  t text := tests.fill(null, 'ucuz', 1);
  r text := tests.place(null, t, tests.req(30000));
begin
  insert into tests.o (name, no) values ('bos', r || '|' || tests.run_as(null, format('select public.cart_count(%L)', t)));
end $$;
select matches((select no from tests.o where name = 'bos'), '^[{].*[|]0$', 'sipariş verince sepet boşalır');
update public.settings set value = 'false' where key = 'pickup_enabled';
select is(left(tests.order('x', null, 'ucuz', 1, 10000, '{"delivery": "pickup"}'), 10), 'HATA 22023', 'kapalıyken mağazadan teslim yok');
update public.settings set value = 'true' where key = 'pickup_enabled';
update public.settings set value = 'false' where key = 'pickup_pay';
select is(left(tests.order('x', null, 'ucuz', 1, 10000, '{"delivery": "pickup", "payment": "store"}'), 10), 'HATA 22023', 'kapalıyken mağazada ödeme yok');
update public.settings set value = 'true' where key = 'pickup_pay';
update public.settings set value = '""' where key = 'bank_iban';
select is(left(tests.order('x', null, 'ucuz', 1, 30000), 10), 'HATA 22023', 'IBAN yokken EFT yok');
update public.settings set value = '"TR330006100519786457841326"' where key = 'bank_iban';

-- ---------------------------------------------------------------------------
-- Tekrar ve sınırlar
-- ---------------------------------------------------------------------------
do $$
declare
  t text := tests.fill(null, 'ucuz', 1);
  q jsonb := tests.req(30000);
  r1 text := tests.place(null, t, q);
  r2 text := tests.place(null, t, q);
begin
  insert into tests.o (name, no, token, key) values ('r1', r1::jsonb ->> 'order_no', r1::jsonb ->> 'token', (q ->> 'key')::uuid),
    ('r2', r2::jsonb ->> 'order_no', r2::jsonb ->> 'token', (q ->> 'key')::uuid);
  insert into tests.o (name, no) values ('r3', tests.place(null, t, q || '{"email": "baska@ornek.test"}')),
    ('r4', tests.place('a', null, q));
end $$;
select is((select no from tests.o where name = 'r2'), (select no from tests.o where name = 'r1'), 'aynı istek ikinci sipariş üretmez');
select is((select count(*) from public.orders where idempotency_key = (select key from tests.o where name = 'r1')), 1::bigint, 'tek kayıt');
select is(left((select no from tests.o where name = x), 10), 'HATA 22023', 'başkası aynı anahtarla siparişe ulaşamaz: ' || x) from unnest(array['r3', 'r4']) x;

select is(tests.order('s' || i, null, 'ucuz', 1, 30000, '{"phone": "+905559999999"}'), 'ok', 'ödenmemiş sipariş ' || i) from generate_series(1, 3) i;
select is(left(tests.order('x', null, 'ucuz', 1, 30000, '{"phone": "+905559999999"}'), 10), 'HATA 22023', 'aynı telefonla dördüncü reddedilir');
select is(tests.order('baskatel', null, 'ucuz', 1, 30000), 'ok', 'başka telefon etkilenmez');
select is(tests.call('om', 'cancel_order', 's1', $$, 'deneme'$$), '', 'biri iptal edilir');
select is(tests.order('s4', null, 'ucuz', 1, 30000, '{"phone": "+905559999999"}'), 'ok', 'iptalden sonra yer açılır');
select is(tests.order('e' || i, null, 'ucuz', 1, 30000, '{"email": "ayni@ornek.test"}'), 'ok', 'e-posta ' || i) from generate_series(1, 3) i;
select is(left(tests.order('x', null, 'ucuz', 1, 30000, '{"email": " AYNI@ornek.test "}'), 10), 'HATA 22023', 'aynı e-postayla dördüncü reddedilir');

-- ---------------------------------------------------------------------------
-- Stok
-- ---------------------------------------------------------------------------
select is(tests.stock('az'), '2/1', 'sipariş stoğu ayırır, düşürmez');
select is(tests.order('z1', null, 'az', 1, 119999), 'ok', 'kalan son ürün');
select is(tests.stock('az'), '2/2', 'tümü ayrıldı');
select is(left(tests.run_as(null, format('select public.cart_add(null, %L, 1)', tests.v('az'))), 10), 'HATA 22023', 'ayrılan stok satılamaz');
select is(tests.call('om', 'cancel_order', 'z1', $$, 'deneme'$$), '', 'onaysız iptal');
select is(tests.stock('az'), '2/1', 'ayırma kalkar');
select is(tests.st('z1'), 'cancelled/cancelled', 'ödenmemiş iptal');
do $$
declare
  t text := tests.fill(null, 'az', 1);
begin
  update public.inventory set reserved = 2 where variant_id = tests.v('az');
  insert into tests.o (name, no) values ('gec', tests.place(null, t, tests.req(119999)));
  update public.inventory set reserved = 1 where variant_id = tests.v('az');
end $$;
select is(left((select no from tests.o where name = 'gec'), 10), 'HATA 22023', 'sepetteyken tükenen ürün sipariş edilemez');

-- ---------------------------------------------------------------------------
-- EFT
-- ---------------------------------------------------------------------------
select is(left(tests.match(u, 'k1', 40000, 'R-yetki'), 10), 'HATA 42501', u || ': havale eşleştiremez') from unnest(array['a', 'cs', 'pm', 'sm']) u;
select is(left(tests.match('om', 'k1', x, 'R-x'), 10), 'HATA 22023', 'geçersiz tutar ' || x) from unnest(array[0, -5]) x;
select is(left(tests.match('om', 'k1', 40000, ' '), 10), 'HATA 22023', 'banka numarası zorunlu');
select is(left(tests.match('om', 'k5', 30500, 'R-5'), 10), 'HATA 22023', 'EFT olmayan siparişe havale yazılamaz');
select ok(tests.match('om', 'k1', 40000, 'R-1') not like 'HATA%', 'eşleşir');
select is(tests.st('k1'), 'pending_payment/pending', 'eşleşme ödeme sayılmaz');
select is(left(tests.match('om', 'k2', 100000, 'R-1'), 10), 'HATA 22023', 'aynı banka işlemi ikinci siparişe yazılamaz');
select is(left(tests.confirm(u, 'R-1'), 10), 'HATA 42501', u || ': havale onaylayamaz') from unnest(array['a', 'om', 'cs', 'pm', 'sm']) u;
select is(tests.confirm('ad', 'R-1'), 'paid', 'tam tutar ödendi sayılır');
select is(tests.st('k1'), 'awaiting_approval/paid', 'onay bekler');
select is(tests.confirm('ad', 'R-1'), 'paid', 'ikinci onay işlemez');
select is((select count(*) from public.order_status_history where order_id = tests.o('k1') and field = 'order_status'), 2::bigint, 'geçmişte tek geçiş');
select is((select status from public.payments where order_id = tests.o('k1')), 'paid', 'ödeme kaydı');
-- Tek kişi yeterli
select ok(tests.match('sa', 'k2', 60000, 'R-2a') not like 'HATA%', 'eksik havale');
select is(tests.confirm('sa', 'R-2a'), 'review', 'eksik tutar incelemeye düşer');
select is(tests.st('k2'), 'pending_payment/review', 'eksik tutarla onaya geçmez');
select ok(tests.match('sa', 'k2', 40000, 'R-2b') not like 'HATA%', 'kalan havale');
select is(tests.confirm('sa', 'R-2b'), 'paid', 'toplam tamamlanınca ödendi');
select ok(tests.match('sa', 'k4', 30600, 'R-4') not like 'HATA%', 'fazla havale');
select is(tests.confirm('sa', 'R-4'), 'review', 'fazla tutar incelemeye düşer');
select is(tests.confirm('sa', 'R-4', true), 'paid', 'fazla tutar bilerek kabul edilir');
select is(left(tests.call('om', 'approve_order', 'k4', ', true'), 10), 'HATA 22023', 'tutar uyuşmazlığı toplu onaya girmez');
select is(left(tests.call('om', 'approve_order', 'k4', ', null'), 10), 'HATA 22023', 'boş değer toplu sayılır');
-- İki kişi ayarı
select is(tests.set('{"transfer_two_person": true}'), '', 'iki kişi şartı açılır');
select ok(tests.match('sa', 'k6', 30000, 'R-6') not like 'HATA%', 'eşleştirme');
select is(left(tests.confirm('sa', 'R-6'), 10), 'HATA 42501', 'eşleştiren onaylayamaz');
select is(tests.confirm('sa2', 'R-6'), 'paid', 'başkası onaylar');
select is(tests.set('{"transfer_two_person": false}'), '', 'iki kişi şartı kapanır');
-- Tekrar
do $$
declare
  k uuid := gen_random_uuid();
begin
  insert into tests.o (name, no) select 't' || i, tests.call('om', 'match_transfer', 's2', format(', %s, %L, %L', a, 'R-t', k))
  from (values (1, 30000), (2, 30000), (3, 29999)) x (i, a) order by i;
end $$;
select is((select no from tests.o where name = 't2'), (select no from tests.o where name = 't1'), 'aynı eşleştirme tek kayıt');
select is(left((select no from tests.o where name = 't3'), 10), 'HATA 22023', 'aynı anahtar başka tutarla kullanılamaz');

-- ---------------------------------------------------------------------------
-- Süre bitimi ve geç gelen para
-- ---------------------------------------------------------------------------
select is(tests.order('d' || i, null, 'ucuz', 1, 30000), 'ok', 'süre siparişi ' || i) from generate_series(1, 5) i;
select ok(tests.match('sa', 'd2', 30000, 'R-d2') not like 'HATA%', 'd2 parası görüldü');
update public.orders set payment_due_at = now() - interval '1 second' where id in (tests.o('d1'), tests.o('d2'), tests.o('d4'), tests.o('d5'));
create temp table bas as select tests.stock('ucuz') as s;
select is(private.expire_orders(), 3, 'yalnızca parası görülmemiş üç sipariş düşer');
select is(tests.st('d1'), 'cancelled/cancelled', 'süresi dolan iptal');
select is((select cancel_code from public.orders where id = tests.o('d1')), 'expired', 'iptal nedeni');
select is(tests.st('d2'), 'pending_payment/pending', 'parası görülen iptal olmaz');
select is(tests.st('d3'), 'pending_payment/pending', 'süresi dolmayan iptal olmaz');
select is(split_part(tests.stock('ucuz'), '/', 2)::int, (select split_part(s, '/', 2)::int - 3 from bas), 'ayırma kalkar');
select is(private.expire_orders(), 0, 'ikinci çalışma değiştirmez');
select ok(tests.match('sa', 'd1', 30000, 'R-d1') not like 'HATA%', 'geç gelen para eşleşir');
select is(tests.confirm('sa', 'R-d1'), 'paid', 'stok varsa sipariş sürer');
select is(tests.st('d1'), 'awaiting_approval/paid', 'onay bekler');
select is((select count(*) from public.stock_reservations r join public.order_items i on i.id = r.order_item_id
  where i.order_id = tests.o('d1') and r.status = 'active'), 1::bigint, 'stok yeniden ayrılır');
select ok(tests.match('sa', 'd4', 20000, 'R-d4') not like 'HATA%', 'geç ve eksik para');
select is(tests.confirm('sa', 'R-d4'), 'refund_pending', 'eksik geç para iade bekler');
update public.inventory set reserved = on_hand where variant_id = tests.v('ucuz');
select ok(tests.match('sa', 'd5', 30000, 'R-d5') not like 'HATA%', 'geç para, stok yok');
select is(tests.confirm('sa', 'R-d5'), 'refund_pending', 'stok yoksa iade bekler');
select is(tests.st('d5'), 'cancelled/refund_pending', 'sipariş iptal kalır');
update public.inventory set reserved = (select coalesce(sum(quantity), 0) from public.stock_reservations
  where variant_id = tests.v('ucuz') and status = 'active') where variant_id = tests.v('ucuz');
select is(left(tests.match('sa', 's1', 30000, 'R-s1'), 10), 'HATA 22023', 'personelin iptal ettiğine havale yazılamaz');

-- ---------------------------------------------------------------------------
-- Onay
-- ---------------------------------------------------------------------------
select is(left(tests.call(u, 'approve_order', 'k1'), 10), 'HATA 42501', u || ': onaylayamaz') from unnest(array['a', 'cs', 'pm', 'sm']) u;
select is(left(tests.call('om', 'approve_order', 'k1', '', 'aal1'), 10), 'HATA 42501', 'iki adımsız onay yok');
select is(left(tests.call('om', 'approve_order', 'k3'), 10), 'HATA 22023', 'ödenmemiş EFT onaylanamaz');
create temp table once as select tests.stock('ucuz') as s;
select is(tests.call('om', 'approve_order', 'k1', ', true'), '', 'sorunsuz sipariş toplu onaylanır');
select is(tests.st('k1'), 'approved/paid', 'onaylandı');
select is(tests.stock('ucuz'), (select (split_part(s, '/', 1)::int - 2) || '/' || (split_part(s, '/', 2)::int - 2) from once), 'onayda stok ve ayırma birlikte düşer');
select is((select delta || ':' || reason from public.stock_movements where order_id = tests.o('k1')), '-2:sale', 'satış hareketi siparişe bağlı');
select is((select approved_by from public.orders where id = tests.o('k1')), tests.uid('om'), 'onaylayan kayıtlı');
select is(left(tests.call('om', 'approve_order', 'k1'), 10), 'HATA 22023', 'ikinci onay reddedilir');
select is(left(tests.run_as('sa', format('select public.reverse_stock_movement(%L, %L, %L)',
  (select id from public.stock_movements where order_id = tests.o('k1')), 'x', gen_random_uuid())), 10), 'HATA 22023', 'satış hareketi elle ters çevrilemez');
-- Onaydan sonra iptal
select is(tests.call('om', 'cancel_order', 'k1', $$, 'müşteri vazgeçti'$$), '', 'onaydan sonra iptal');
select is(tests.st('k1'), 'cancelled/refund_pending', 'ödenmiş iptal iade bekler');
select is(tests.stock('ucuz'), (select split_part(s, '/', 1) || '/' || (split_part(s, '/', 2)::int - 2) from once), 'stok geri gelir');
select is((select string_agg(delta || ':' || reason, ' ' order by seq) from public.stock_movements where order_id = tests.o('k1')), '-2:sale 2:cancel', 'ters stok kaydı');
select is(left(tests.call('om', 'cancel_order', 'k1', $$, 'x'$$), 10), 'HATA 22023', 'iptal yinelenmez');
select is((select note from public.order_status_history where order_id = tests.o('k1') and to_value = 'cancelled'), 'müşteri vazgeçti', 'neden geçmişte');
select is(tests.call('ad', 'approve_order', 'k4'), '', 'fazla ödenen tek tek onaylanır');
select is((select note from public.order_status_history where order_id = tests.o('k4') and to_value = 'approved'), null, 'not başka işleme taşınmaz');
select is(tests.call('sa', 'approve_order', 'k2'), '', 'Super Admin onaylar');
select is(left(tests.call('om', 'cancel_order', 'k2', $$, ' '$$), 10), 'HATA 22023', 'iptal nedeni zorunlu');
select is(left(tests.call(u, 'cancel_order', 'k2', $$, 'x'$$), 10), 'HATA 42501', u || ': iptal edemez') from unnest(array['a', 'cs', 'pm', 'sm']) u;
-- Parası görülmüş ama onaylanmamış sipariş iptali
select is(tests.call('om', 'cancel_order', 'd2', $$, 'x'$$), '', 'parası görülmüş sipariş iptali');
select is(tests.st('d2'), 'cancelled/refund_pending', 'görülen para unutulmaz');

-- ---------------------------------------------------------------------------
-- Kapıda ödeme
-- ---------------------------------------------------------------------------
select is(left(tests.order('x', null, 'ucuz', 1, 30000, '{"payment": "cod"}'), 10), 'HATA 22023', 'kapalıyken kapıda ödeme yok');
select is(tests.set('{"cod_enabled": true, "cod_limit": 50000, "cod_fee": 1500}'), '', 'kapıda ödeme açılır');
select is(tests.order('c1', null, 'ucuz', 1, 31500, '{"payment": "cod"}'), 'ok', 'kapıda ödeme ücretiyle');
select is(tests.st('c1'), 'awaiting_approval/cod_due', 'kapıda ödeme onay bekler');
select is(left(tests.order('x', null, 'ucuz', 3, 51500, '{"payment": "cod"}'), 10), 'HATA 22023', 'sınır üstü reddedilir');
select is(left(tests.order('x', null, 'ucuz', 1, 11500, '{"payment": "cod", "delivery": "pickup"}'), 10), 'HATA 22023', 'mağazadan teslimde kapıda ödeme yok');
select is(left(tests.call('om', 'approve_order', 'c1'), 10), 'HATA 22023', 'telefon doğrulanmadan onaylanmaz');
select is(left(tests.call(u, 'verify_order_phone', 'c1'), 10), 'HATA 42501', u || ': telefon doğrulayamaz') from unnest(array['a', 'pm', 'sm']) u;
select is(tests.call('cs', 'verify_order_phone', 'c1'), '', 'müşteri hizmetleri doğrular');
select is(tests.call('om', 'verify_order_phone', 'c1'), '', 'yinelenen doğrulama hata değil');
select is((select phone_verified_by from public.orders where id = tests.o('c1')), tests.uid('cs'), 'ilk doğrulayan kalır');
select is(tests.set('{"cod_limit": 20000}'), '', 'sınır düşürülür');
select is(left(tests.call('om', 'approve_order', 'c1', ', true'), 10), 'HATA 22023', 'sınır üstü toplu onaya girmez');
select is(tests.call('om', 'approve_order', 'c1'), '', 'tek tek onaylanır');
select is(tests.set('{"cod_limit": 50000, "phone_check": false}'), '', 'telefon doğrulaması kapatılır');
select is(tests.order('c2', null, 'ucuz', 1, 31500, '{"payment": "cod"}'), 'ok', 'ikinci kapıda ödeme');
select is(tests.call('om', 'approve_order', 'c2', ', true'), '', 'ayar kapalıyken doğrulama istenmez');
select is(tests.set('{"phone_check": true}'), '', 'doğrulama açılır');
select is(tests.call('om', 'advance_order', 'c1', $$, 'preparing'$$), '', 'hazırlanıyor');
select is(left(tests.call('om', 'advance_order', 'c1', $$, 'ready_for_pickup'$$), 10), 'HATA 22023', 'kargolu sipariş mağazada hazır olamaz');
select is(tests.call('om', 'advance_order', 'c1', $$, 'shipped'$$), '', 'kargoda');
select is(left(tests.call('om', 'cancel_order', 'c1', $$, 'x'$$), 10), 'HATA 22023', 'kargodaki iptal edilemez');
select is(tests.call('om', 'advance_order', 'c1', $$, 'delivered'$$), '', 'teslim');
select is(tests.st('c1'), 'delivered/cod_due', 'teslim tahsilat sayılmaz');

-- ---------------------------------------------------------------------------
-- Mağazadan teslim
-- ---------------------------------------------------------------------------
select is(left(tests.call('om', 'collect_store_payment', 'k5', $$, 'cash'$$), 10), 'HATA 22023', 'hazır olmadan tahsilat yok');
select is(tests.call('om', 'approve_order', 'k5', ', true'), '', 'mağaza siparişi onaylanır');
select is(tests.call('om', 'advance_order', 'k5', $$, 'preparing'$$), '', 'hazırlanıyor');
select is(left(tests.call('om', 'advance_order', 'k5', $$, 'shipped'$$), 10), 'HATA 22023', 'mağaza siparişi kargolanamaz');
select is(left(tests.call('sm', 'advance_order', 'k5', $$, 'ready_for_pickup'$$), 10), 'HATA 42501', 'yetkisiz ilerletemez');
select is(tests.call('om', 'advance_order', 'k5', $$, 'ready_for_pickup'$$), '', 'mağazada hazır');
select is(left(tests.call('om', 'advance_order', 'k5', $$, 'delivered'$$), 10), 'HATA 22023', 'tahsilatsız teslim edilemez');
select is(left(tests.call(u, 'collect_store_payment', 'k5', $$, 'cash'$$), 10), 'HATA 42501', u || ': tahsilat yazamaz') from unnest(array['a', 'cs', 'pm', 'sm']) u;
select is(left(tests.call('om', 'collect_store_payment', 'k5', $$, 'çek'$$), 10), 'HATA 22023', 'geçersiz tahsilat türü');
create function tests.overdue() returns boolean language sql as
$$ select tests.run_as('om', format('select overdue::text from public.list_orders(null, %L)', (select no from tests.o where name = 'k5')))::boolean $$;
select is(tests.overdue(), false, 'süre dolmadan uyarı yok');
update public.orders set ready_at = now() - interval '8 days' where id = tests.o('k5');
select is(tests.overdue(), true, '7 gün sonra uyarı');
select is(tests.st('k5'), 'ready_for_pickup/pending', 'uyarı siparişi iptal etmez');
select is(tests.call('om', 'collect_store_payment', 'k5', $$, 'card'$$), '', 'POS tahsilatı');
select is(left(tests.call('om', 'collect_store_payment', 'k5', $$, 'cash'$$), 10), 'HATA 22023', 'ikinci tahsilat yok');
select is(tests.call('om', 'advance_order', 'k5', $$, 'delivered'$$), '', 'teslim edildi');
select is((select collected_as || ':' || status from public.payments where order_id = tests.o('k5')), 'card:paid', 'tahsilat kaydı');

-- ---------------------------------------------------------------------------
-- Bütün durum geçişleri (izinli ve yasak), doğrudan yazımda
-- ---------------------------------------------------------------------------
create function tests.step(p_from text, p_to text, p_delivery text, p_paid text) returns text language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.orders (order_no, contact_name, email, phone, delivery_method, payment_method, order_status,
    payment_status, subtotal, shipping_fee, gift_fee, cod_fee, total, gift_wrap, payment_due_at, cancel_code, idempotency_key)
  values (private.new_order_no(), 'Geçiş Deneme', 'g@ornek.test', '+905550000000', p_delivery, 'transfer', p_from,
    p_paid, 1000, 0, 0, 0, 1000, false, now(), case when p_from = 'cancelled' then 'staff' end, gen_random_uuid())
  returning id into v_id;
  begin
    update public.orders set order_status = p_to, cancel_code = case when p_to = 'cancelled' then 'staff' end where id = v_id;
    return 'olur';
  exception when sqlstate '22023' then
    return 'olmaz';
  end;
end $$;
create table tests.allowed (f text, t text, d text);
insert into tests.allowed
select f, t, d from unnest(array['shipping', 'pickup']) d, (values
  ('pending_payment', 'awaiting_approval'), ('pending_payment', 'cancelled'), ('awaiting_approval', 'approved'),
  ('awaiting_approval', 'cancelled'), ('approved', 'preparing'), ('approved', 'cancelled'), ('preparing', 'cancelled'),
  ('ready_for_pickup', 'delivered'), ('ready_for_pickup', 'cancelled'), ('shipped', 'delivered'), ('shipped', 'returned_to_sender')) x (f, t)
union all values ('preparing', 'shipped', 'shipping'), ('preparing', 'ready_for_pickup', 'pickup');
create table tests.states (s text);
insert into tests.states select unnest(array['pending_payment', 'awaiting_approval', 'approved', 'preparing',
  'ready_for_pickup', 'shipped', 'delivered', 'cancelled', 'returned_to_sender']);
select is(tests.step(f.s, t.s, yol, 'paid'),
  case when exists (select 1 from tests.allowed a where a.f = f.s and a.t = t.s and a.d = yol) then 'olur' else 'olmaz' end,
  yol || ': ' || f.s || ' -> ' || t.s)
from tests.states f, tests.states t, unnest(array['shipping', 'pickup']) yol where f.s <> t.s;
select is(tests.step('pending_payment', 'awaiting_approval', 'shipping', 'pending'), 'olmaz', 'ödenmeden onaya geçilemez');
select is(tests.step('ready_for_pickup', 'delivered', 'pickup', 'pending'), 'olmaz', 'ödenmeden mağazadan teslim olmaz');
select is(left(tests.call('om', 'advance_order', 'k2', format(', %L', s)), 10), 'HATA 22023', 'approved -> ' || s || ' atlanamaz')
from unnest(array['ready_for_pickup', 'shipped', 'delivered', 'returned_to_sender', 'approved', 'cancelled', 'uydurma']) s;
select throws_ok(format('update public.orders set total = 1, subtotal = 1, shipping_fee = 0 where id = %L', tests.o('k2')), '42501', null, 'tutar sonradan değişmez');
select throws_ok(format('update public.orders set user_id = %L where id = %L', tests.uid('b'), tests.o('k2')), '42501', null, 'sahibi değişmez');
select throws_ok(format('delete from public.orders where id = %L', tests.o('k2')), '42501', null, 'sipariş silinemez');
select throws_ok('delete from public.order_status_history', '42501', null, 'geçmiş silinemez');
select throws_ok('update public.order_legal_acceptances set rendered_body = ''x''', '42501', null, 'sözleşme kaydı değişmez');
select throws_ok(format($$ insert into public.stock_movements (variant_id, delta, on_hand_after, reason, idempotency_key)
  values (%L, -1, 1, 'sale', gen_random_uuid()) $$, tests.v('az')), '23514', null, 'siparişsiz satış hareketi olmaz');

-- ---------------------------------------------------------------------------
-- Başkasının siparişi
-- ---------------------------------------------------------------------------
select is(tests.order('ua', 'a', 'ucuz', 1, 30000, '{"email": "baskasi@ornek.test"}'), 'ok', 'üye siparişi');
select is((select email from public.orders where id = tests.o('ua')), 'a@pgtap.test', 'üyenin e-postası hesabından alınır');
select is((select token from tests.o where name = 'ua'), null, 'üyeye gizli bağlantı verilmez');
create function tests.get(p_as text, p_name text, p_token text default null) returns text language sql as
$$ select tests.run_as(p_as, format('select public.get_order(%L, %L) ->> ''order_no''', (select no from tests.o where name = p_name), p_token), 'aal1') $$;
select is(tests.get('a', 'ua'), (select no from tests.o where name = 'ua'), 'üye kendi siparişini görür');
select is(tests.get(u, 'ua'), null, coalesce(u, 'ziyaretçi') || ': göremez') from unnest(array[null, 'b', 'sa']) u;
select is(tests.get(null, 'k4'), null, 'sipariş numarası tek başına yetmez');
select is(tests.get(null, 'k2', (select token from tests.o where name = 'k2')), (select no from tests.o where name = 'k2'), 'misafir koduyla görür');
select is(tests.get(null, 'k2', x), null, 'yanlış kod: ' || coalesce(left(x, 8), 'boş'))
from unnest(array[null, '', repeat('0', 64), (select token from tests.o where name = 'k4'), (select upper(token) from tests.o where name = 'k2')]) x;
select is_empty($$ select 1 from public.order_access_tokens t join tests.o on o.token = t.token_hash $$, 'kodun kendisi saklanmaz');
update public.order_access_tokens set expires_at = now() - interval '1 second' where order_id = tests.o('k2');
select is(tests.get(null, 'k2', (select token from tests.o where name = 'k2')), null, 'süresi dolan kod açmaz');
select is(left(tests.run_as(u, format('select public.cancel_my_order(%L)', (select no from tests.o where name = 'ua')), 'aal1'), 10), 'HATA P0002', coalesce(u, 'ziyaretçi') || ': başkasınınkini iptal edemez') from unnest(array[null, 'b']) u;
select is(tests.run_as('a', 'select count(*) from public.my_orders()', 'aal1'), '1', 'a''nın siparişleri');
select is(tests.run_as('b', 'select count(*) from public.my_orders()', 'aal1'), '0', 'b''nin siparişi yok');
select is(left(tests.run_as(null, 'select count(*) from public.my_orders()'), 10), 'HATA 42501', 'ziyaretçi listeleyemez');
select is(tests.run_as('a', 'select count(*) from public.' || t, 'aal1'), '0', 'müşteri tablodan okuyamaz: ' || t)
from unnest(array['orders', 'order_items', 'order_addresses', 'order_status_history', 'payments', 'bank_transfers', 'stock_reservations', 'order_legal_acceptances']) t;
select is(tests.run_as(u, 'select count(*) from public.orders'), '0', u || ': sipariş okuyamaz') from unnest(array['pm', 'sm']) u;
select isnt(tests.run_as(u, 'select count(*) from public.orders'), '0', u || ': sipariş okur') from unnest(array['sa', 'ad', 'om', 'cs']) u;
select is(tests.run_as('om', 'select count(*) from public.orders', 'aal1'), '0', 'iki adımsız okunmaz');
select is(left(tests.run_as(u, 'select count(*) from public.list_orders()'), 10), 'HATA 42501', u || ': listeleyemez') from unnest(array['a', 'pm', 'sm']) u;
select is(tests.run_as('cs', format('select count(*) from public.list_orders(null, %L)', (select no from tests.o where name = 'ua'))), '1', 'numarayla aranır');
select is(left(tests.call(u, 'add_order_note', 'ua', $$, 'not'$$), 10), 'HATA 42501', u || ': not yazamaz') from unnest(array['a', 'pm', 'sm']) u;
select is(tests.call('cs', 'add_order_note', 'ua', $$, 'Arandı'$$), '', 'not yazılır');
select is(left(tests.call('cs', 'add_order_note', 'ua', format(', %L', repeat('a', 501))), 10), 'HATA 22023', 'uzun not reddedilir');
select is(tests.run_as('a', format('select public.cancel_my_order(%L)', (select no from tests.o where name = 'ua')), 'aal1'), '', 'üye iptal eder');
select is((select cancel_code from public.orders where id = tests.o('ua')), 'customer', 'iptal eden müşteri');
select is(left(tests.run_as('a', format('select public.cancel_my_order(%L)', (select no from tests.o where name = 'ua')), 'aal1'), 10), 'HATA 22023', 'iki kez iptal olmaz');
select is(tests.run_as(null, format('select public.cancel_my_order(%L, %L)', no, token)), '', 'misafir koduyla iptal eder') from tests.o where name = 'd3';
select is(left(tests.run_as(null, format('select public.cancel_my_order(%L, %L)', no, token)), 10), 'HATA 22023', 'onaylanan sipariş müşteri tarafından iptal edilemez') from tests.o where name = 'k4';
select tests.fill('pasif', 'ucuz', 1);
update public.profiles set is_active = false where id = tests.uid('pasif');
select is(left(tests.place('pasif', null, tests.req(30000)), 10), 'HATA 42501', 'pasif hesap sipariş veremez');

-- ---------------------------------------------------------------------------
-- Mutasyon denetiminin gösterdiği eksikler
-- ---------------------------------------------------------------------------
-- Sepetteyken yayından kalkan ürün; stok vardır ama satılamaz.
do $$
declare
  t text := tests.fill(null, 'tam', 1);
begin
  update public.products set status = 'draft' where slug = 't-o1';
  insert into tests.o (name, no) values ('yayinsiz', tests.place(null, t, tests.req(100000)));
  update public.products set status = 'published' where slug = 't-o1';
end $$;
select matches((select no from tests.o where name = 'yayinsiz'), '^HATA 22023 Sepetinizdeki', 'yayından kalkan ürün sipariş edilemez');
select matches(tests.place(null, null, tests.req(30000)), 'Sepetiniz boş', 'boş sepet kendi iletisiyle reddedilir');

-- Üye, kendi e-postasıyla verilmiş misafir siparişine istek anahtarıyla ulaşamaz.
select is(tests.order('misafir_a', null, 'ucuz', 1, 30000, '{"email": "a@pgtap.test"}'), 'ok', 'misafir, üyenin e-postasıyla');
select is(left(tests.place('a', null, tests.req(30000, jsonb_build_object('key', (select key from tests.o where name = 'misafir_a')))), 10),
  'HATA 22023', 'aynı e-posta kimlik sayılmaz');

-- Kapıda ödeme: tutar ve sınır uygunken bile kapalıysa reddedilir.
update public.settings set value = 'false' where key = 'cod_enabled';
select matches(tests.order('x', null, 'ucuz', 1, 31500, '{"payment": "cod"}'), 'Kapıda ödeme kullanılamaz', 'kapalı kapıda ödeme');
update public.settings set value = 'true' where key = 'cod_enabled';

-- Teslim edilmiş kapıda ödeme ödenmemiş sipariş sayılmaz.
update public.settings set value = '1' where key = 'max_unpaid';
select is(tests.order('c3', null, 'ucuz', 1, 30000, jsonb_build_object('phone', (select phone from public.orders where id = tests.o('c1')))), 'ok', 'teslim edilen sınıra sayılmaz');
update public.settings set value = '3' where key = 'max_unpaid';

select is_empty($$ select 1 from public.outbox_jobs where kind = 'order_placed' and payload - 'order_id' <> '{}' $$, 'kuyrukta sipariş kimliğinden başka bilgi yok');

-- Yalnızca onaylanan havale sayılır.
select is(tests.order('h1', null, 'ucuz', 1, 30000), 'ok', 'iki parça havale');
select ok(tests.match('sa', 'h1', 15000, 'R-h1a') not like 'HATA%', 'ilk parça');
select ok(tests.match('sa', 'h1', 15000, 'R-h1b') not like 'HATA%', 'ikinci parça');
select is(tests.confirm('sa', 'R-h1a'), 'review', 'onaylanmayan parça toplanmaz');
select is(tests.confirm('sa', 'R-h1b'), 'paid', 'ikisi onaylanınca ödendi');

-- Ayrılmış stoğu olmayan sipariş hiçbir yolla onaylanmaz.
create temp table ayr as select s.* from public.stock_reservations s join public.order_items i on i.id = s.order_item_id where i.order_id = tests.o('h1');
update public.stock_reservations set status = 'released' where order_item_id in (select order_item_id from ayr);
select matches(tests.call('om', 'approve_order', 'h1', x), 'ayrılmış stoğu yok', 'stok ayrılmamışsa onay yok' || x) from unnest(array['', ', true']) x;
update public.stock_reservations set status = 'active' where order_item_id in (select order_item_id from ayr);
select is(tests.call('om', 'approve_order', 'h1'), '', 'ayrılınca onaylanır');

select is(left(tests.call('cs', 'verify_order_phone', 'h1'), 10), 'HATA 22023', 'onaylanmış siparişte telefon doğrulanmaz');
select is(left(tests.call('cs', 'add_order_note', 'h1', format(', %L', x)), 10), 'HATA 22023', 'boş not yazılmaz') from unnest(array['', '  ', null]) x;
select is(left(tests.call('cs', 'advance_order', 'h1', format(', %L', x)), 10), 'HATA 42501', 'müşteri hizmetleri ilerletemez: ' || x)
from unnest(array['preparing', 'shipped', 'delivered']) x;

-- Mağazada hazır: süre, liste, özet ve ödenmiş iptal
select is(tests.order('m1', null, 'ucuz', 1, 10000, '{"delivery": "pickup", "payment": "store"}'), 'ok', 'mağaza siparişi');
select is(tests.call('om', 'approve_order', 'm1'), '', 'onay');
select is(tests.call('om', 'advance_order', 'm1', format(', %L', x)), '', x) from unnest(array['preparing', 'ready_for_pickup']) with ordinality u (x, n) order by n;
select is((select ready_at from public.orders where id = tests.o('m1')), now(), 'hazır olma zamanı yazılır');
create function tests.late() returns text language sql as
$$ select tests.run_as('om', format('select overdue from public.list_orders(null, %L)', (select no from tests.o where name = 'm1')))
  || ':' || tests.run_as('om', 'select overdue from public.order_summary()') $$;
update public.orders set ready_at = now() - interval '6 days' where id = tests.o('m1');
select is(tests.late(), 'false:0', 'altıncı günde uyarı yok');
update public.orders set ready_at = now() - interval '8 days' where id = tests.o('m1');
select is(tests.late(), 'true:1', 'sekizinci günde listede ve özette uyarı');
select is(tests.run_as('om', $$ select string_agg(distinct order_status, ',') from public.list_orders('ready_for_pickup') $$), 'ready_for_pickup', 'durum süzgeci');
select is(tests.call('om', 'collect_store_payment', 'm1', $$, 'cash'$$), '', 'nakit tahsilat');
select is(tests.call('om', 'cancel_order', 'm1', $$, 'müşteri vazgeçti'$$), '', 'ödenmiş mağaza siparişi iptali');
select is(tests.st('m1'), 'cancelled/refund_pending', 'mağazada alınan para iade bekler');
select is_empty($$ select 1 from public.orders o join public.order_items i on i.order_id = o.id
  join public.stock_reservations s on s.order_item_id = i.id
  where o.order_status = 'cancelled' and s.status <> 'released' $$, 'iptal edilen siparişte açık ayırma kalmaz');

-- ---------------------------------------------------------------------------
-- Panel ayrıntısı, özet ve e-posta kuyruğu
-- ---------------------------------------------------------------------------
select is(left(tests.call(u, 'order_detail', 'k1'), 10), 'HATA 42501', u || ': ayrıntı göremez') from unnest(array['a', 'pm', 'sm']) u;
select is(left(tests.call('om', 'order_detail', 'k1', '', 'aal1'), 10), 'HATA 42501', 'iki adımsız ayrıntı yok');
select is((tests.call(u, 'order_detail', 'k1')::jsonb ->> 'order_no'), (select no from tests.o where name = 'k1'), u || ': ayrıntı görür') from unnest(array['sa', 'ad', 'om', 'cs']) u;
select is(tests.run_as('om', format('select public.order_detail(%L)', gen_random_uuid())), null, 'olmayan sipariş');
select is((tests.call('om', 'order_detail', 'k6')::jsonb #>> '{addresses,invoice,tax_no}'), '1234567890', 'kurumsal fatura bilgisi görünür');
select is(jsonb_array_length(tests.call('om', 'order_detail', 'k2')::jsonb -> 'transfers'), 2, 'havaleler görünür');
select is((tests.call('om', 'order_detail', 'k2')::jsonb -> 'flags'), '[]'::jsonb, 'onaylanmış siparişte uyarı yok');
select ok(position('token' in tests.call('om', 'order_detail', 'k2')) = 0, 'ayrıntıda gizli kod yok');
select is(left(tests.run_as(u, 'select awaiting from public.order_summary()'), 10), 'HATA 42501', u || ': özet göremez') from unnest(array['a', 'pm', 'sm']) u;
select is(tests.run_as('cs', 'select awaiting || '':'' || review || '':'' || refund || '':'' || overdue from public.order_summary()'),
  (select count(*) filter (where order_status = 'awaiting_approval') || ':' || count(*) filter (where payment_status = 'review')
    || ':' || count(*) filter (where payment_status = 'refund_pending')
    || ':' || count(*) filter (where order_status = 'ready_for_pickup' and ready_at < now() - interval '7 days') from public.orders), 'özet sayıları');
select is(left(tests.run_as(u, 'select count(*) from public.claim_emails()'), 10), 'HATA 42501', coalesce(u, 'ziyaretçi') || ': kuyruğu okuyamaz') from unnest(array[null, 'a', 'sa']) u;
select is(left(tests.run_as('sa', format('select public.finish_email(%L, true)', gen_random_uuid())), 10), 'HATA 42501', 'kuyruk kapatılamaz');
update public.outbox_jobs set status = 'sent' where payload ->> 'order_id' not in (tests.o('k4')::text, tests.o('ua')::text) or kind <> 'order_placed';
create temp table posta as select x from public.claim_emails() x;
select is((select count(*) from posta), 2::bigint, 'bekleyen iletiler alınır');
select is((select count(*) from public.claim_emails()), 0::bigint, 'aynı ileti ikinci kez alınmaz');
select is(tests.get(null, 'k4', (select x ->> 'token' from posta where x ->> 'order_no' = (select no from tests.o where name = 'k4'))), (select no from tests.o where name = 'k4'), 'iletideki kod siparişi açar');
select is((select x ->> 'token' from posta where x ->> 'order_no' = (select no from tests.o where name = 'ua')), null, 'üye iletisinde kod yok');
select public.finish_email((x ->> 'id')::uuid, false) from posta;
update public.outbox_jobs set run_after = now() where status = 'pending';
select is((select count(*) from public.claim_emails()), 2::bigint, 'gönderilemeyen ileti yeniden denenir');
update public.outbox_jobs set attempts = 5 where status = 'pending';
select public.finish_email((x ->> 'id')::uuid, x ->> 'token' is null) from posta;
select is((select string_agg(status, ',' order by status) from public.outbox_jobs where id in (select (x ->> 'id')::uuid from posta)), 'failed,sent', 'beşinci başarısızlıkta durur');

-- ---------------------------------------------------------------------------
-- Değişmez eşitlikler
-- ---------------------------------------------------------------------------
select is_empty($$ select v.name from tests.v v join public.inventory i on i.variant_id = v.id
  where i.on_hand <> (select sum(delta) from public.stock_movements m where m.variant_id = v.id) $$, 'stok = hareket toplamı');
select is_empty($$ select v.name from tests.v v join public.inventory i on i.variant_id = v.id
  where i.reserved <> (select coalesce(sum(quantity), 0) from public.stock_reservations r where r.variant_id = v.id and r.status = 'active') $$, 'ayrılan = aktif ayırma toplamı');
select is((select count(*) from cron.job where jobname = 'siparis-suresi' and active), 1::bigint, 'süre zamanlayıcısı kurulu');

select * from finish();
rollback;
