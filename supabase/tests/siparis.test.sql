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
  'legal_documents', 'order_legal_acceptances', 'outbox_jobs', 'payment_attempts', 'payment_events',
  'carriers', 'shipments', 'shipment_items', 'shipment_events', 'cod_settlements', 'cod_receipts']);
select is(left(tests.run_as(null, 'select count(*) from public.' || t), 10), 'HATA 42501', 'ziyaretçi okuyamaz: ' || t) from tests.tables;
select is(left(tests.run_as('sa', 'select count(*) from public.' || t), 10), 'HATA 42501', 'kimse okuyamaz: ' || t)
from unnest(array['order_access_tokens', 'outbox_jobs', 'legal_documents', 'shipments', 'shipment_items', 'shipment_events',
  'cod_settlements', 'cod_receipts']) t;
select is_empty($$ select t, r, x from tests.tables, unnest(array['anon', 'authenticated', 'service_role']) r,
  unnest(array['insert', 'update', 'delete', 'truncate']) x
  where has_table_privilege(r, 'public.' || t, x)
     or case when x in ('insert', 'update') then has_any_column_privilege(r, 'public.' || t, x) else false end $$,
  'bu tablolara kimse doğrudan yazamaz');
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
select matches(tests.call('om', 'advance_order', 'c1', $$, 'shipped'$$), 'Önce gönderiyi işleyin', 'gönderisiz kargolanamaz');
create function tests.shp(p_name text) returns uuid language sql as
$$ select id from public.shipments where order_id = tests.o(p_name) and status <> 'cancelled' $$;
create function tests.ship(p_as text, p_name text, p_to text) returns text language sql volatile as
$$ select tests.run_as(p_as, format('select public.advance_shipment(%L, %L)', tests.shp(p_name), p_to)) $$;
create function tests.track(p_as text, p_name text, p_no text, p_carrier text default 'Pgtap Kargo') returns text language sql volatile as
$$ select tests.run_as(p_as, format('select public.update_shipment(%L, %L, %L)', tests.shp(p_name),
     (select id from public.carriers where name = p_carrier), p_no)) $$;
create function tests.carrier(p_as text, p_name text, p_url text, p_active boolean default true, p_id uuid default null) returns text language sql volatile as
$$ select tests.run_as(p_as, format('select public.save_carrier(%L, %L, %L, %L)', p_id, p_name, p_url, p_active)) $$;
select ok(tests.carrier('ad', 'Pgtap Kargo', 'https://kargo.test/takip?no={no}') not like 'HATA%', 'firma eklenir');
select ok(tests.call('om', 'create_shipment', 'c1') not like 'HATA%', 'gönderi oluşur');
select is(tests.track('om', 'c1', 'CC11111'), '', 'takip numarası');
select is(tests.ship('om', 'c1', 'handed_over'), '', 'kargoda');
select is(left(tests.call('om', 'cancel_order', 'c1', $$, 'x'$$), 10), 'HATA 22023', 'kargodaki iptal edilemez');
select matches(tests.call('om', 'advance_order', 'c1', $$, 'delivered'$$), 'Önce gönderiyi işleyin', 'sipariş gönderisiz teslim edilemez');
select is(tests.ship('om', 'c1', 'delivered'), '', 'teslim');
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
create function tests.step(p_from text, p_to text, p_delivery text, p_paid text, p_ship text default null) returns text language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.orders (order_no, contact_name, email, phone, delivery_method, payment_method, order_status,
    payment_status, subtotal, shipping_fee, gift_fee, cod_fee, total, gift_wrap, payment_due_at, cancel_code, idempotency_key)
  values (private.new_order_no(), 'Geçiş Deneme', 'g@ornek.test', '+905550000000', p_delivery, 'transfer', p_from,
    p_paid, 1000, 0, 0, 0, 1000, false, now(), case when p_from = 'cancelled' then 'staff' end, gen_random_uuid())
  returning id into v_id;
  begin
    update public.orders set order_status = p_to, cancel_code = case when p_to = 'cancelled' then 'staff' end,
      shipment_status = coalesce(p_ship, shipment_status) where id = v_id;
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
select is(tests.step(f.s, t.s, yol, 'paid', case when yol = 'shipping' then case t.s when 'shipped' then 'handed_over'
    when 'delivered' then 'delivered' when 'returned_to_sender' then 'returned' end end),
  case when exists (select 1 from tests.allowed a where a.f = f.s and a.t = t.s and a.d = yol) then 'olur' else 'olmaz' end,
  yol || ': ' || f.s || ' -> ' || t.s)
from tests.states f, tests.states t, unnest(array['shipping', 'pickup']) yol where f.s <> t.s;
select is(tests.step(f, t, 'shipping', 'paid', g), 'olmaz', f || ' -> ' || t || ', gönderi ' || coalesce(g, 'yok')) from (values
  ('preparing', 'shipped', null), ('preparing', 'shipped', 'created'), ('shipped', 'delivered', null), ('shipped', 'delivered', 'handed_over'),
  ('shipped', 'returned_to_sender', null), ('shipped', 'returned_to_sender', 'delivered')) x (f, t, g);
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
-- Kart ödemesi (Aşama 9)
-- ---------------------------------------------------------------------------
create table tests.a (name text primary key, id uuid);
create function tests.a(p_name text) returns uuid language sql as $$ select id from tests.a where name = p_name $$;
create function tests.tok(p_name text) returns text language sql as $$ select token from tests.o where name = p_name $$;
create function tests.no(p_name text) returns text language sql as $$ select no from tests.o where name = p_name $$;
create function tests.kart(p_name text, p_over jsonb default '{}') returns text language sql volatile as
$$ select tests.order(p_name, null, 'ucuz', 1, 30000, '{"payment": "card"}' || p_over) $$;
create function tests.begin(p_as text, p_name text, p_token text, p_inst text default '1') returns text language sql volatile as
$$ select tests.run_as(p_as, format('select public.begin_card_payment(%L, %L, %s)', tests.no(p_name), p_token, p_inst), 'aal1') $$;
create function tests.mine(p_name text, p_call text) returns text language sql volatile as
$$ select tests.run_as(null, format('select public.' || p_call, tests.no(p_name), tests.tok(p_name))) $$;
-- Denemeyi sahibinin koduyla başlatır ve adıyla saklar.
create function tests.try(p_name text, p_order text) returns text language plpgsql as $$
declare
  r text := tests.begin(null, p_order, tests.tok(p_order));
begin
  if r like 'HATA%' then return r; end if;
  insert into tests.a values (p_name, (r::jsonb ->> 'attempt')::uuid);
  return 'ok';
end $$;
create function tests.srv(p_sql text) returns text language plpgsql as $$
declare
  r text;
begin
  begin
    perform set_config('role', 'service_role', true);
    execute p_sql into r;
    perform set_config('role', 'postgres', true);
  exception when others then
    r := 'HATA ' || sqlstate || ' ' || sqlerrm;
  end;
  return r;
end $$;
create function tests.event(p_attempt text, p_event text, p_status text, p_amount bigint default 30000,
  p_currency text default 'TRY', p_ref text default null, p_provider text default 'fake') returns text language sql volatile as
$$ select tests.srv(format('select public.record_card_event(%L, %L, %L, %L, %L, %L, %L, %L)', p_provider, p_event,
  tests.a(p_attempt), coalesce(p_ref, 'ref-' || tests.a(p_attempt)), p_status, p_amount, p_currency, 'kod')) $$;
create function tests.attach(p_attempt text, p_ref text, p_url text) returns text language sql volatile as
$$ select tests.srv(format('select public.attach_card_attempt(%L, %L, %L)', tests.a(p_attempt), p_ref, p_url)) $$;
create function tests.ast(p_name text) returns text language sql as
$$ select status from public.payment_attempts where id = tests.a(p_name) $$;
create function tests.rez(p_name text) returns text language sql as $$ select r.status from public.stock_reservations r
  join public.order_items i on i.id = r.order_item_id where i.order_id = tests.o(p_name) $$;

-- Ayar ve kapalı hâl
select is(left(tests.set(x), 10), 'HATA 22023', 'geçersiz kart ayarı: ' || x::text)
from unnest(array['{"card_enabled": 1}', '{"card_minutes": 4}', '{"card_minutes": 121}', '{"card_provider": "iyzico"}',
  '{"card_max_installments": 6}']::jsonb[]) x;
select matches(tests.kart('x'), 'Kart ödemesi şu anda kapalı', 'kart kapalı başlar');
select is(tests.run_as(null, $$ select public.checkout_options() ->> 'card' $$), 'false', 'kapalıyken seçenek görünmez');
select is(tests.set('{"card_enabled": true}'), '', 'kart açılır');
select is(tests.run_as(null, $$ select public.checkout_options() ->> 'card' $$), 'true', 'açıkken seçenek görünür');
select matches(tests.set('{"test_mode": false}'), 'Sahte kart ödemesi', 'sahte sağlayıcıyla deneme modu kapanmaz');

-- Sipariş
select is(tests.kart('y' || i), 'ok', 'kart siparişi ' || i) from generate_series(1, 14) i;
select is(tests.st('y1'), 'pending_payment/pending', 'kart ödeme bekler');
select is((select payment_due_at from public.orders where id = tests.o('y1')), now() + interval '30 minutes', '30 dakika süre');
select is((select provider || ':' || status from public.payments where order_id = tests.o('y1')), 'card:pending', 'ödeme kaydı');
select is(tests.rez('y1'), 'active', 'stok ayrılır');
select is(left(tests.call('om', 'approve_order', 'y1'), 10), 'HATA 22023', 'ödenmemiş kart siparişi onaylanamaz');
select matches(tests.match('om', 'y1', 30000, 'R-kart'), 'havale yazılamaz', 'kart siparişine havale yazılamaz');
select is(tests.mine('y1', 'get_order(%L, %L) ->> ''can_pay'''), 'true', 'müşteri ödeyebilir');

-- Kim başlatabilir
select is(left(tests.begin(u, 'y1', t), 10), 'HATA P0002', 'başlatamaz: ' || coalesce(u, 'ziyaretçi') || coalesce(left(t, 4), ''))
from (values (null, null), (null, ''), (null, repeat('0', 64)), ('b', null), ('sa', null)) x (u, t);
select is(left(tests.begin(null, 'y1', tests.tok('y2')), 10), 'HATA P0002', 'başka siparişin kodu açmaz');
select is(tests.order('yu', 'a', 'ucuz', 1, 30000, '{"payment": "card"}'), 'ok', 'üye kart siparişi');
select is(left(tests.begin('b', 'yu', null), 10), 'HATA P0002', 'başka üye başlatamaz');
select ok(tests.begin('a', 'yu', null) not like 'HATA%', 'üye kendi siparişini öder');
select is(left(tests.begin(null, 'y1', tests.tok('y1'), x), 10), 'HATA 22023', 'taksit yok: ' || x) from unnest(array['0', '2', 'null']) x;
select is(left(tests.begin(null, 'k6', tests.tok('k6')), 10), 'HATA 22023', 'EFT siparişi kartla ödenmez');
select is(tests.try('a1', 'y1'), 'ok', 'deneme başlar');
select is((tests.begin(null, 'y1', tests.tok('y1'))::jsonb ->> 'attempt')::uuid, tests.a('a1'), 'ikinci tıklama aynı denemeyi döndürür');
select is((select amount || ':' || installments || ':' || status from public.payment_attempts where id = tests.a('a1')), '30000:1:started', 'tutar siparişten alınır');
update public.settings set value = 'false' where key = 'test_mode';
select matches(tests.try('x', 'y2'), 'kapalı', 'deneme modu kapalıyken sahte ödeme başlamaz');
select matches(tests.kart('x'), 'kapalı', 'deneme modu kapalıyken sahte kart siparişi olmaz');
update public.settings set value = 'true' where key = 'test_mode';

-- Sunucu dışında kimse para bildiremez
select is(left(tests.run_as(u, format(q, tests.a('a1'))), 10), 'HATA 42501', coalesce(u, 'ziyaretçi') || ' çağıramaz: ' || left(q, 30))
from unnest(array[null, 'a', 'sa']) u, unnest(array[
  'select public.record_card_event(''fake'', ''s'', %L, ''r'', ''paid'', 30000, ''TRY'')',
  'select public.attach_card_attempt(%L, ''r'', ''u'')',
  'select count(*) from public.claim_card_checks(null) where attempt = %L',
  'select count(*) from public.payment_attempts where id = %L',
  'select count(*) from public.payment_events where attempt_id = %L']) q;
select is_empty($$ select column_name from information_schema.columns where table_schema = 'public'
  and table_name in ('payments', 'payment_attempts', 'payment_events') and column_name ~ 'card|cvv|cvc|pan|holder|expir|payload|raw' $$, 'kart bilgisi veya ham bildirim alanı yok');

-- Sayfa adresi: ilk yazan geçerli
select is(tests.attach('a1', 'ref-' || tests.a('a1'), 'https://bir.test'), 'https://bir.test', 'adres yazılır');
select is(tests.attach('a1', 'ref-baska', 'https://iki.test'), 'https://bir.test', 'ikinci adres yazılmaz');
select is((select provider_ref from public.payment_attempts where id = tests.a('a1')), 'ref-' || tests.a('a1'), 'numara değişmez');

-- Sahte veya bozuk bildirim
select is(left(tests.event('a1', 'b1', 'paid', 30000, 'TRY', 'ref-baska'), 10), 'HATA 22023', 'başka numaralı bildirim reddedilir');
select is(left(tests.event('a1', 'b2', 'paid', 30000, 'TRY', null, 'iyzico'), 10), 'HATA P0002', 'başka sağlayıcının bildirimi reddedilir');
select is(left(tests.event('yok', 'b3', 'paid', 30000, 'TRY', 'x'), 10), 'HATA P0002', 'olmayan deneme');
select is(left(tests.event('a1', e, s), 10), 'HATA 22023', 'geçersiz bildirim') from (values (null, 'paid'), ('b4', null), ('b5', 'refunded')) x (e, s);
select is(tests.st('y1') || (select count(*) from public.payment_events where attempt_id = tests.a('a1')), 'pending_payment/pending0', 'reddedilen bildirim iz bırakmaz');

-- Başarılı ödeme ve tekrarlar
select is(tests.event('a1', 'e1', 'paid'), 'paid', 'ödeme doğrulanır');
select is(tests.st('y1'), 'awaiting_approval/paid', 'yönetici onayına düşer');
select is((select status from public.payments where order_id = tests.o('y1')), 'paid', 'ödeme kaydı');
select is(tests.event('a1', 'e1', 'paid'), 'duplicate', 'aynı olay bir kez işlenir');
select is(left(tests.event('a1', 'e1', 'failed'), 10), 'HATA 22023', 'aynı numara başka sonuçla gelemez');
select is(tests.event('a1', 'e1b', 'paid'), 'ignored', 'aynı ödemenin ikinci haberi');
select is(tests.event('a1', 'e1c', 'failed'), 'ignored', 'sonradan gelen red ödemeyi bozmaz');
select is(tests.st('y1') || tests.ast('a1'), 'awaiting_approval/paidpaid', 'durum korunur');
select is((select count(*) from public.order_status_history where order_id = tests.o('y1') and field = 'order_status'), 2::bigint, 'tek geçiş');
select is(left(tests.begin(null, 'y1', tests.tok('y1')), 10), 'HATA 22023', 'ödenmiş sipariş yeniden ödenmez');
select is(tests.mine('y1', 'get_order(%L, %L) ->> ''can_pay'''), 'false', 'ödenince düğme kalkar');
select is(tests.call('om', 'approve_order', 'y1', ', true'), '', 'sorunsuz kart siparişi toplu onaylanır');
select is(tests.call('om', 'cancel_order', 'y1', $$, 'x'$$), '', 'onaydan sonra iptal');
select is(tests.st('y1'), 'cancelled/refund_pending', 'karttan gelen para iade bekler');

-- Red ve yeniden deneme
select is(tests.try('a2', 'y2'), 'ok', 'deneme');
select is(tests.event('a2', 'e2', 'failed'), 'failed', 'kart reddedildi');
select is(tests.st('y2'), 'pending_payment/failed', 'sipariş beklemede kalır');
select is((select error_code from public.payment_attempts where id = tests.a('a2')), 'kod', 'red nedeni');
select is(left(tests.event('a2', 'e1b', 'paid'), 10), 'HATA 22023', 'başka denemenin olay numarası kullanılamaz');
select is(tests.mine('y2', 'get_order(%L, %L) ->> ''can_pay'''), 'true', 'yeniden denenebilir');
select is(tests.try('a2b', 'y2'), 'ok', 'yeni deneme');
select isnt(tests.a('a2b'), tests.a('a2'), 'ayrı deneme');
select is(tests.st('y2'), 'pending_payment/pending', 'yeniden beklemede');
select is(tests.event('a2', 'e2x', 'failed'), 'ignored', 'eski denemenin reddi yenisini etkilemez');
select is(tests.st('y2'), 'pending_payment/pending', 'durum değişmez');

-- İki deneme de ödendi
select is(tests.event('a2', 'e2p', 'paid'), 'paid', 'reddedilen denemenin parası sonradan geldi');
select is(tests.event('a2b', 'e2q', 'paid'), 'refund_due', 'ikinci para iade bekler');
select is(tests.st('y2'), 'awaiting_approval/paid', 'sipariş sürer');
select ok(tests.call('om', 'order_detail', 'y2')::jsonb -> 'flags' ? 'double', 'panelde uyarı');
select is(tests.run_as('om', format('select count(*) from public.list_orders(''refund'', %L)', tests.no('y2'))), '1', 'iade süzgecinde görünür');
select is(tests.run_as('om', format('select count(*) from public.list_orders(''refund'', %L)', tests.no('y3'))), '0', 'iadesi olmayan görünmez');
select is(left(tests.call('om', 'approve_order', 'y2', ', true'), 10), 'HATA 22023', 'fazla ödeme toplu onaya girmez');
select is(tests.call('om', 'approve_order', 'y2'), '', 'tek tek onaylanır');
select is(tests.run_as('om', 'select refund from public.order_summary()'), (select count(*)::text from public.orders o where payment_status = 'refund_pending'
  or exists (select 1 from public.payment_attempts a join public.payments y on y.id = a.payment_id where y.order_id = o.id and a.status = 'refund_due')), 'özet fazla ödemeyi sayar');

-- Yanlış tutar veya para birimi
select is(tests.try('a' || i, 'y' || i), 'ok', 'deneme ' || i) from generate_series(3, 9) i;
select is(tests.event(a, 'w' || a, 'paid', t, c), 'review', 'farklı tutar incelemeye düşer: ' || coalesce(t::text, 'yok') || coalesce(c, ''))
from (values ('a3', 29999::bigint, 'TRY'), ('a4', 30001, 'TRY'), ('a5', null, 'TRY'), ('a6', 30000, 'USD'), ('a7', 30000, null)) x (a, t, c);
select is(tests.st('y' || i), 'pending_payment/review', 'onaya geçmez') from generate_series(3, 7) i;
select is((select paid_amount from public.payment_attempts where id = tests.a('a3')), 29999::bigint, 'gelen tutar yazılır');
select is(left(tests.begin(null, 'y3', tests.tok('y3')), 10), 'HATA 22023', 'incelemedeyken yeniden ödenmez');
select is(tests.event('a3', 'w3b', 'paid'), 'ignored', 'incelenen deneme ikinci haberle ödenmiş sayılmaz');
update public.orders set payment_due_at = now() - interval '1 second' where id in (tests.o('y3'), tests.o('y8'), tests.o('y9'), tests.o('y10'));
select is(tests.mine('y4', 'cancel_my_order(%L, %L)'), '', 'müşteri iptal eder');
select is(tests.st('y4'), 'cancelled/refund_pending', 'incelenen para unutulmaz');

-- Süre bitimi
select is(left(tests.begin(null, 'y10', tests.tok('y10')), 10), 'HATA 22023', 'süre dolunca ödeme başlamaz');
select is(tests.event('a9', 'e9f', 'failed'), 'failed', 'süresi dolanın kartı reddedildi');
select is(private.expire_orders(), 3, 'bekleyen ve reddedilenler düşer, incelenen düşmez');
select is(tests.st('y3') || ' ' || tests.st('y8') || ' ' || tests.st('y9'), 'pending_payment/review cancelled/cancelled cancelled/cancelled', 'durumlar');
select is(tests.event('a8', 'e8', 'paid'), 'paid', 'geç gelen para, stok var');
select is(tests.st('y8'), 'awaiting_approval/paid', 'sipariş sürer');
select is(tests.rez('y8'), 'active', 'stok yeniden ayrılır');
update public.inventory set reserved = on_hand where variant_id = tests.v('ucuz');
select is(tests.event('a9', 'e9', 'paid'), 'refund_due', 'geç gelen para, stok yok');
select is(tests.st('y9'), 'cancelled/refund_pending', 'iade bekler');
update public.inventory set reserved = (select coalesce(sum(quantity), 0) from public.stock_reservations
  where variant_id = tests.v('ucuz') and status = 'active') where variant_id = tests.v('ucuz');
select is(tests.event('a9', 'e9b', 'paid'), 'ignored', 'iade bekleyen para stok gelince siparişi açmaz');
select is(tests.st('y9'), 'cancelled/refund_pending', 'iptal kalır');

-- Bildirim sayfa adresinden önce gelirse numarası korunur
select is(tests.kart('kz' || i, jsonb_build_object('phone', '+90555777000' || i)), 'ok', 'kart siparişi z' || i) from generate_series(1, 4) i;
select is(tests.try('kz1', 'kz1'), 'ok', 'deneme');
select is(left(tests.srv(format('select public.record_card_event(''fake'', ''zn'', %L, null, ''paid'', 30000, ''TRY'')', tests.a('kz1'))), 10), 'HATA 22023', 'numarasız bildirim reddedilir');
select set_config('app.order_note', 'sızan not', true);
select is(tests.event('kz1', 'kz1', 'failed'), 'failed', 'adres yazılmadan gelen bildirim');
select is((select count(*) from public.order_status_history where order_id = tests.o('kz1') and note is not null), 0::bigint, 'önceki not taşınmaz');
select is((select provider_ref from public.payment_attempts where id = tests.a('kz1')), 'ref-' || tests.a('kz1'), 'numara bildirimden alınır');
select is(tests.attach('kz1', 'ref-baska', 'https://baska.test'), null, 'başka numarayla adres yazılmaz');

-- İncelenen para, öbür denemenin reddiyle unutulmaz; ödenince iade uyarısı kalır
select is(tests.try('kz1b', 'kz1'), 'ok', 'ikinci deneme');
select is(tests.event('kz1', 'kz1w', 'paid', 100), 'review', 'eski denemeden eksik para');
select is(tests.event('kz1b', 'kz1f', 'failed'), 'failed', 'yeni deneme reddedildi');
select is(tests.st('kz1'), 'pending_payment/review', 'inceleme sürer');
select is(tests.run_as('om', format('select count(*) from public.list_orders(''refund'', %L)', tests.no('kz1'))), '0', 'incelenen henüz iade listesinde değil');
select is(tests.event('kz1b', 'kz1p', 'paid'), 'paid', 'tam para geldi');
select ok(tests.call('om', 'order_detail', 'kz1')::jsonb -> 'flags' ? 'double', 'eksik gelen para uyarıda kalır');
select is((select paid_amount from public.payment_attempts where id = tests.a('a2b')), 30000::bigint, 'iade edilecek tutar yazılır');

-- Açık kalan başka deneme varken red, siparişi reddedildi yapmaz
update public.settings set value = '2' where key = 'card_max_installments';
select is(tests.try('kz2', 'kz2'), 'ok', 'tek çekim');
select ok(tests.begin(null, 'kz2', tests.tok('kz2'), '2') not like 'HATA%', 'taksitli deneme');
select is(tests.event('kz2', 'kz2f', 'failed'), 'failed', 'tek çekim reddedildi');
select is(tests.st('kz2'), 'pending_payment/pending', 'öbür deneme bekleniyor');
update public.settings set value = '1' where key = 'card_max_installments';

-- Süresi dolmamış, ödeme bekleyen EFT siparişi de kartla ödenmez
select is(tests.order('kze', null, 'ucuz', 1, 30000, '{"payment": "transfer", "phone": "+905557770009"}'), 'ok', 'EFT siparişi');
select is(tests.st('kze'), 'pending_payment/pending', 'ödeme bekliyor');
select is(left(tests.begin(null, 'kze', tests.tok('kze')), 10), 'HATA 22023', 'EFT siparişine kart denemesi açılmaz');

select is(tests.try('a' || i, 'y' || i), 'ok', 'deneme ' || i) from generate_series(11, 12) i;
select is(tests.mine('y' || i, 'cancel_my_order(%L, %L)'), '', 'ödeme sürerken iptal ' || i) from generate_series(11, 12) i;
select is(tests.st('y11'), 'cancelled/cancelled', 'iptal');
select is(tests.event('a11', 'e11', 'paid'), 'refund_due', 'iptalden sonra gelen para siparişi açmaz');
select is(tests.st('y11'), 'cancelled/refund_pending', 'iade bekler');
select is(tests.event('a12', 'e12', 'paid', 100), 'review', 'iptalden sonra yanlış tutar');
select is(tests.st('y12'), 'cancelled/refund_pending', 'yanlış tutar da iade bekler');

-- Sınırlar
do $$
begin
  for i in 1..10 loop
    perform tests.try('l' || i, 'y13');
    perform tests.event('l' || i, 'l' || i, 'failed');
  end loop;
end $$;
select is((select count(*) from public.payment_attempts a join public.payments y on y.id = a.payment_id where y.order_id = tests.o('y13')), 10::bigint, 'on deneme');
select matches(tests.try('l11', 'y13'), 'Çok fazla deneme', 'on birinci deneme reddedilir');
select is(tests.kart('p' || i, '{"phone": "+905558888888"}'), 'ok', 'ödenmemiş ' || i) from generate_series(1, 3) i;
select is(tests.try('p' || i, 'p' || i), 'ok', 'deneme') from generate_series(1, 3) i;
select is(tests.event('p' || i, 'p' || i, 'failed'), 'failed', 'red ' || i) from generate_series(1, 3) i;
select matches(tests.kart('x', '{"phone": "+905558888888"}'), 'Ödenmemiş siparişleriniz', 'reddedilen kart da ödenmemiş sayılır');

-- Sorgu sırası
select is(tests.try('a14', 'y14'), 'ok', 'deneme');
create function tests.check(p_no text default null) returns text language sql volatile as
$$ select tests.srv(format('select count(*) from public.claim_card_checks(%L) where attempt = %L', p_no, tests.a('a14'))) $$;
select is(tests.check(tests.no('y14')), '0', 'numarası olmayan sorgulanmaz');
select is(tests.attach('a14', 'ref-' || tests.a('a14'), 'https://a14.test'), 'https://a14.test', 'numara');
select is(tests.check(), '0', 'yeni deneme sıraya girmez');
select is(tests.check(tests.no('y13')), '0', 'başka siparişin denemesi gelmez');
select is(tests.check(tests.no('y14')), '1', 'siparişin denemesi gelir');
select is(tests.check(tests.no('y14')), '0', 'hemen ardından yeniden sorgulanmaz');
update public.payment_attempts set created_at = now() - interval '10 minutes', checked_at = now() - interval '1 minute' where id = tests.a('a14');
select is(tests.check(), '0', 'yakında sorgulanan beklenir');
update public.payment_attempts set checked_at = null where id = tests.a('a14');
select is(tests.check(), '1', 'beklenen sonuç sorgulanır');
update public.payment_attempts set checked_at = null, created_at = now() - interval '2 days' where id = tests.a('a14');
select is(tests.check(), '0', 'bir günden eski sorgulanmaz');
update public.payment_attempts set created_at = now() - interval '10 minutes', status = 'failed' where id = tests.a('a14');
select is(tests.check(), '0', 'sonucu bilinen sorgulanmaz');

select throws_ok('update public.payment_events set result = ''paid''', '42501', null, 'olay kaydı değişmez');
select throws_ok('delete from public.payment_events', '42501', null, 'olay kaydı silinmez');
select is(jsonb_array_length(tests.call('cs', 'order_detail', 'y2')::jsonb -> 'attempts'), 2, 'panel denemeleri görür');
select ok(position('bir.test' in tests.call('cs', 'order_detail', 'y1')) = 0, 'ödeme adresi panele verilmez');

-- ---------------------------------------------------------------------------
-- Kargo: firmalar
-- ---------------------------------------------------------------------------
select is(left(tests.carrier(u, 'Yetkisiz Kargo', null), 10), 'HATA 42501', coalesce(u, 'ziyaretçi') || ': firma ekleyemez')
from unnest(array[null, 'a', 'om', 'cs', 'pm', 'sm']) u;
select is(left(tests.run_as('sa', $$ select public.save_carrier(null, 'Yetkisiz Kargo', null, true) $$, 'aal1'), 10), 'HATA 42501', 'iki adımsız firma eklenmez');
select is(tests.run_as(u, 'select count(*) from public.carriers'), '0', u || ': firma okuyamaz') from unnest(array['a', 'pm', 'sm']) u;
select is(tests.run_as(u, $$ select count(*) from public.carriers where name = 'Pgtap Kargo' $$), '1', u || ': firma okur') from unnest(array['sa', 'ad', 'om', 'cs']) u;
select is(left(tests.carrier('sa', 'Kötü Adres', x), 10), 'HATA 23514', 'geçersiz takip adresi: ' || x)
from unnest(array['http://kargo.test/{no}', 'javascript:alert(1)//{no}', 'https://kargo.test/takip', 'https://{no}.kargo.test/',
  'https://kargo.test{no}', 'https://kargo/{no}', 'https://kisi@kargo.test/{no}', 'https://kargo.test/a b{no}',
  'https://kargo.test/"{no}', 'https://kargo.test/<{no}', 'https://kargo.test/{no}{no}', 'https://kargo.test/{x}{no}',
  'https://kargo.test/{no}' || repeat('a', 300)]) x;
select is(left(tests.carrier('sa', x, null), 10), 'HATA 23514', 'geçersiz firma adı: ' || x) from unnest(array['x', ' ', repeat('a', 61)]) x;
select is(left(tests.carrier('sa', null, null), 10), 'HATA 23502', 'adsız firma olmaz');
select is(left(tests.carrier('sa', 'pgtap kargo', null), 10), 'HATA 23505', 'aynı ad iki kez olmaz');
select is(left(tests.carrier('sa', 'Boş', null, null), 10), 'HATA 22023', 'kullanım durumu boş olamaz');
select is(left(tests.carrier('sa', 'Yok', null, true, gen_random_uuid()), 10), 'HATA P0002', 'olmayan firma');
select ok(tests.carrier('sa', ' Pgtap Eski ', '  ') not like 'HATA%', 'adresi olmayan firma');
select is((select name || coalesce(url_template, '-') from public.carriers where name like 'Pgtap Eski%'), 'Pgtap Eski-', 'boşluk atılır');
select is((select count(*) from public.audit_logs where action = 'carriers.insert' and actor_id in (tests.uid('sa'), tests.uid('ad'))), 2::bigint, 'ekleme geçmişe yazılır');

-- Gönderi
select is(tests.set('{"cod_limit": 50000, "phone_check": false, "cod_enabled": true}'), '', 'kapıda ödeme açık');
create function tests.ready(p_name text, p_over jsonb default '{"payment": "cod"}', p_qty integer default 1) returns text language plpgsql as $f$
declare
  r text := tests.order(p_name, null, 'ucuz', p_qty, 10000 * p_qty + 21500, p_over);
begin
  if r <> 'ok' then return r; end if;
  return tests.call('om', 'approve_order', p_name) || tests.call('om', 'advance_order', p_name, $$, 'preparing'$$);
end $f$;
create function tests.create_ship(p_as text, p_name text) returns text language sql volatile as
$$ select tests.call(p_as, 'create_shipment', p_name) $$;
select is(tests.ready('krg1', '{"payment": "cod"}', 2), '', 'hazırlanan sipariş');
select is(left(tests.create_ship(u, 'krg1'), 10), 'HATA 42501', coalesce(u, 'ziyaretçi') || ': gönderi oluşturamaz')
from unnest(array[null, 'a', 'cs', 'pm', 'sm']) u;
select is(left(tests.call('om', 'create_shipment', 'krg1', '', 'aal1'), 10), 'HATA 42501', 'iki adımsız gönderi yok');
select is(left(tests.run_as('om', format('select public.create_shipment(%L)', gen_random_uuid())), 10), 'HATA P0002', 'olmayan sipariş');
select is(left(tests.create_ship('om', x), 10), 'HATA 22023', 'gönderi olmaz: ' || tests.st(x)) from unnest(array['c1', 'c2', 'k2', 'k5', 'm1']) x;
create table tests.s as select tests.create_ship('om', 'krg1') as id;
select is(tests.create_ship(u, 'krg1'), (select id from tests.s), u || ': ikinci istek aynı gönderi') from unnest(array['om', 'ad', 'sa']) u;
select is((select string_agg(our_ref || ':' || status || ':' || provider, ',') from public.shipments where order_id = tests.o('krg1')), tests.no('krg1') || '-1:created:manual', 'tek gönderi');
select is((select string_agg(i.quantity || '', ',') from public.shipment_items i where i.shipment_id = tests.shp('krg1')), '2', 'gönderi satırı');
select is((select shipment_status from public.orders where id = tests.o('krg1')), 'created', 'siparişte gönderi durumu');
select throws_ok(format($$ insert into public.shipments (order_id, our_ref) values (%L, 'X') $$, tests.o('krg1')), '23505', null, 'veritabanı ikinci gönderiyi reddeder');
select is(tests.run_as(null, format('select (public.get_order(%L, %L) -> ''shipment'')::text', tests.no('krg1'), tests.tok('krg1'))), 'null', 'yola çıkmayan gönderi müşteriye görünmez');

-- Takip bilgisi
create function tests.see(p_name text) returns jsonb language sql volatile as
$$ select tests.mine(p_name, 'get_order(%L, %L)')::jsonb -> 'shipment' $$;
select matches(tests.ship('om', 'krg1', 'handed_over'), 'takip numarasını yazın', 'takip numarasız verilemez');
select is(left(tests.track(u, 'krg1', 'AB12345'), 10), 'HATA 42501', coalesce(u, 'ziyaretçi') || ': takip yazamaz') from unnest(array[null, 'a', 'cs', 'pm', 'sm']) u;
select is(left(tests.track('om', 'krg1', x), 10), 'HATA 22023', 'geçersiz takip: ' || coalesce(x, 'yok'))
from unnest(array['1234', '', ' ', null, 'ABC_12', 'ÇA12345', 'ıabcde', 'AB12/34', repeat('1', 41)]) x;
select is(left(tests.track('om', 'krg1', 'AB12345', 'Uydurma'), 10), 'HATA 22023', 'olmayan firma seçilmez');
select is(tests.carrier('sa', 'Pgtap Eski', null, false, (select id from public.carriers where name = 'Pgtap Eski')) not like 'HATA%', true, 'firma kapatılır');
select is((select count(*) from public.audit_logs where action = 'carriers.update' and (before ->> 'is_active') = 'true' and (after ->> 'is_active') = 'false'
  and entity_id = (select id from public.carriers where name = 'Pgtap Eski')), 1::bigint, 'değişiklik geçmişte');
select is(left(tests.track('om', 'krg1', 'AB12345', 'Pgtap Eski'), 10), 'HATA 22023', 'kapalı firma seçilmez');
select is(left(tests.track('om', 'krg1', 'CC11111'), 10), 'HATA 22023', 'başka gönderinin numarası yazılmaz');
select is((select tracking_no from public.shipments where id = tests.shp('krg1')), null, 'reddedilen yazılmaz');
select is(tests.track('om', 'krg1', ' ab 123-45 '), '', 'boşluk ve küçük harf düzelir');
select is((select tracking_no from public.shipments where id = tests.shp('krg1')), 'AB123-45', 'düzelmiş numara');
select is(tests.see('krg1'), 'null'::jsonb, 'numara yazılsa da yola çıkmadan görünmez');
select is(tests.track('om', 'krg1', 'AB123-45'), '', 'aynı değer');
select is((select count(*) from public.shipment_events where shipment_id = tests.shp('krg1') and field = 'tracking_no'), 1::bigint, 'değişmeyen geçmişe yazılmaz');

-- Durumlar
select is(left(tests.ship(u, 'krg1', x), 10), 'HATA 42501', coalesce(u, 'ziyaretçi') || ': ' || x || ' yapamaz')
from unnest(array[null, 'a', 'cs', 'pm', 'sm']) u, unnest(array['handed_over', 'delivered', 'returned', 'cancelled']) x;
select is(left(tests.ship('om', 'krg1', x), 10), 'HATA 22023', 'created -> ' || coalesce(x, 'boş')) from unnest(array['delivered', 'returned', 'created', 'in_transit', 'uydurma', null]) x;
select is(left(tests.run_as('om', format('select public.advance_shipment(%L, ''handed_over'')', gen_random_uuid())), 10), 'HATA P0002', 'olmayan gönderi');
select is(tests.ship('om', 'krg1', 'handed_over'), '', 'kargoya verildi');
select is(tests.ship('om', 'krg1', 'handed_over'), '', 'ikinci tıklama hata değil');
select is(tests.st('krg1'), 'shipped/cod_due', 'sipariş kargoda');
select is((select count(*) from public.outbox_jobs where payload = jsonb_build_object('order_id', tests.o('krg1'), 'status', 'shipped')), 1::bigint, 'tek e-posta');
select is((select handed_over_at is not null and closed_at is null from public.shipments where id = tests.shp('krg1')), true, 'veriliş zamanı');
select is(left(tests.ship('om', 'krg1', x), 10), 'HATA 22023', 'handed_over -> ' || coalesce(x, 'boş')) from unnest(array['cancelled', 'created', 'uydurma', null]) x;
select is(left(tests.call('om', 'cancel_order', 'krg1', $$, 'x'$$), 10), 'HATA 22023', 'yola çıkan iptal edilemez');
select is(tests.create_ship('om', 'krg1') like 'HATA 22023%', true, 'yola çıkan siparişe yeni gönderi yok');
select is((select count(*) from public.shipments where order_id = tests.o('krg1')), 1::bigint, 'hâlâ tek gönderi');

-- Müşterinin gördüğü
select is(tests.see('krg1') - 'handed_over_at', '{"status": "handed_over", "carrier": "Pgtap Kargo", "tracking_no": "AB123-45",
  "url": "https://kargo.test/takip?no=AB123-45", "closed_at": null}'::jsonb, 'müşteri takip bilgisini görür');
select is(tests.run_as(x, format('select public.get_order(%L, %L)', tests.no('krg1'), 'yanlis-kod')), null, coalesce(x, 'ziyaretçi') || ': başkasının gönderisini göremez') from unnest(array[null, 'a']) x;

-- Kargodayken düzeltme
select is(tests.track('om', 'krg1', 'DUZELT99'), '', 'numara düzeltilir');
select is(tests.see('krg1') ->> 'tracking_no', 'DUZELT99', 'müşteri yenisini görür');
select is((select string_agg(field || ':' || coalesce(from_value, '-') || '>' || to_value || ':' || (actor_id = tests.uid('om')), ' ' order by seq)
  from public.shipment_events where shipment_id = tests.shp('krg1')),
  'status:->created:true carrier:->Pgtap Kargo:true tracking_no:->AB123-45:true status:created>handed_over:true tracking_no:AB123-45>DUZELT99:true', 'geçmiş eksiksiz');
select is(tests.carrier('sa', 'Pgtap Kargo', 'https://kargo.test/takip?no={no}', false, (select id from public.carriers where name = 'Pgtap Kargo')) not like 'HATA%', true, 'kullanılan firma kapanır');
select is(tests.track('om', 'krg1', 'DUZELT98'), '', 'kapanan firmadaki gönderi düzeltilebilir');
select is(tests.carrier('sa', 'Pgtap Kargo', 'https://kargo.test/takip?no={no}', true, (select id from public.carriers where name = 'Pgtap Kargo')) not like 'HATA%', true, 'yeniden açılır');
select throws_ok(format('update public.shipment_events set to_value = ''x'' where shipment_id = %L', tests.shp('krg1')), '42501', null, 'gönderi geçmişi değişmez');
select throws_ok('delete from public.shipment_events', '42501', null, 'gönderi geçmişi silinmez');
select throws_ok('truncate public.shipment_events', '42501', null, 'gönderi geçmişi boşaltılamaz');

-- İletide takip bilgisi
update public.outbox_jobs set status = 'sent' where payload ->> 'order_id' <> tests.o('krg1')::text or payload ->> 'status' is distinct from 'shipped';
update public.outbox_jobs set status = 'pending', attempts = 0, run_after = now() where payload = jsonb_build_object('order_id', tests.o('krg1'), 'status', 'shipped');
select is((select x -> 'shipment' from public.claim_emails() x), '{"carrier": "Pgtap Kargo", "tracking_no": "DUZELT98", "url": "https://kargo.test/takip?no=DUZELT98"}'::jsonb, 'iletide takip bilgisi');

-- Panel
create function tests.detail(p_name text, p_as text default 'cs') returns jsonb language sql volatile as
$$ select tests.call(p_as, 'order_detail', p_name)::jsonb $$;
select is(tests.detail('krg1') #>> '{shipment,our_ref}', tests.no('krg1') || '-1', 'panel gönderiyi görür');
select is(jsonb_array_length(tests.detail('krg1') -> 'shipment_events'), 6, 'panel geçmişi görür');
select is(tests.detail('krg1') -> 'cod', 'null'::jsonb, 'teslimden önce tahsilat kaydı yok');

-- Teslim ve tahsilat
select is(tests.ship('om', 'krg1', 'delivered'), '', 'teslim');
select is(tests.ship('om', 'krg1', 'delivered'), '', 'ikinci teslim hata değil');
select is(left(tests.ship('om', 'krg1', x), 10), 'HATA 22023', 'delivered -> ' || x) from unnest(array['handed_over', 'returned', 'cancelled']) x;
select is(left(tests.track('om', 'krg1', 'SONRA123'), 10), 'HATA 22023', 'teslim edilen düzeltilemez');
select is(tests.st('krg1'), 'delivered/cod_due', 'teslim tahsilat sayılmaz');
create function tests.cod_id(p_name text) returns uuid language sql as
$$ select x.id from public.cod_settlements x join public.shipments s on s.id = x.shipment_id where s.order_id = tests.o(p_name) $$;
create function tests.cod(p_as text, p_name text, p_amount bigint, p_key uuid default gen_random_uuid(), p_ref text default 'Dekont', p_aal text default 'aal2') returns text language sql volatile as
$$ select tests.run_as(p_as, format('select public.record_cod(%L, %L, %L, %L)', tests.cod_id(p_name), p_amount, p_ref, p_key), p_aal) $$;
select is((select expected || ':' || status from public.cod_settlements where id = tests.cod_id('krg1')), '41500:pending', 'beklenen tutar');
create function tests.waiting(p_name text) returns boolean language sql volatile as
$$ select tests.run_as('om', format('select count(*) from public.list_orders(''cod'', %L)', tests.no(p_name))) = '1' $$;
create function tests.codsum() returns bigint language sql volatile as $$ select tests.run_as('om', 'select cod from public.order_summary()')::bigint $$;
create table tests.before as select tests.codsum() as n;
select ok(tests.waiting('krg1'), 'para beklenenler listesinde');
select is(left(tests.cod(u, 'krg1', 41500), 10), 'HATA 42501', coalesce(u, 'ziyaretçi') || ': tahsilat yazamaz') from unnest(array[null, 'a', 'om', 'cs', 'pm', 'sm']) u;
select is(left(tests.cod('sa', 'krg1', 41500, p_aal => 'aal1'), 10), 'HATA 42501', 'iki adımsız tahsilat yok');
select is(left(tests.cod('sa', 'krg1', x), 10), 'HATA 22023', 'geçersiz tutar: ' || coalesce(x::text, 'yok')) from unnest(array[0, null, 1000000001, -1000000001]::bigint[]) x;
select is(left(tests.cod('sa', 'krg1', 100, p_ref => x), 10), 'HATA 22023', 'geçersiz açıklama: ' || coalesce(x, 'yok')) from unnest(array['', ' ', null, repeat('a', 101)]) x;
select is(left(tests.cod('sa', 'krg1', 100, null), 10), 'HATA 22023', 'anahtarsız istek yok');
select is(left(tests.run_as('sa', format('select public.record_cod(%L, 1, ''x'', %L)', gen_random_uuid(), gen_random_uuid())), 10), 'HATA P0002', 'olmayan tahsilat');
select is(left(tests.cod('sa', 'krg1', -1), 10), 'HATA 22023', 'düzeltme kaydı eksiye düşüremez');
select is((select count(*) from public.cod_receipts where settlement_id = tests.cod_id('krg1')), 0::bigint, 'reddedilen kayıt yazılmaz');
create table tests.k as select gen_random_uuid() as k;
select is(tests.cod('ad', 'krg1', 41000, (select k from tests.k)), 'short', 'eksik para');
select is(tests.cod('ad', 'krg1', 41000, (select k from tests.k)), 'short', 'yinelenen istek');
select is(left(tests.cod('ad', 'krg1', 500, (select k from tests.k)), 10), 'HATA 22023', 'anahtar başka tutarda kullanılmaz');
select is((select count(*) || ':' || sum(amount) from public.cod_receipts where settlement_id = tests.cod_id('krg1')), '1:41000', 'para bir kez sayılır');
select is(tests.st('krg1'), 'delivered/cod_due', 'eksik para tahsilat sayılmaz');
select ok(tests.waiting('krg1'), 'eksik uyarıda kalır');
select is(tests.cod('sa', 'krg1', 500), 'settled', 'tamamlandı');
select is(tests.st('krg1'), 'delivered/cod_collected', 'tahsil edildi');
select is((select status || (paid_at is not null) from public.payments where order_id = tests.o('krg1')), 'paidtrue', 'ödeme kaydı');
select ok(not tests.waiting('krg1'), 'uyarı kalkar');
select is(tests.codsum(), (select n - 1 from tests.before), 'özet azalır');
select is(tests.cod('sa', 'krg1', 1), 'over', 'fazla para');
select is(tests.st('krg1'), 'delivered/cod_collected', 'fazlada da tahsil edilmiş');
select ok(tests.waiting('krg1'), 'fazla uyarıda kalır');
select is(tests.cod('sa', 'krg1', -1001, p_ref => 'Yanlış kayıt'), 'short', 'eksi kayıtla düzeltilir');
select is(tests.st('krg1') || (select status || (paid_at is null) from public.payments where order_id = tests.o('krg1')), 'delivered/cod_duependingtrue', 'düzeltme geri alır');
select is(tests.cod('sa', 'krg1', -40500), 'pending', 'sıfıra inen kayıt beklemeye döner');
select is(tests.cod('sa', 'krg1', 41500), 'settled', 'yeniden tamam');
select is(jsonb_array_length(tests.detail('krg1') #> '{cod,receipts}'), 6, 'panelde bütün kayıtlar');
select is((select recorded_by from public.cod_receipts where idempotency_key = (select k from tests.k)), tests.uid('ad'), 'kaydeden kişi');
select throws_ok('update public.cod_receipts set amount = 1', '42501', null, 'tahsilat kaydı değişmez');
select throws_ok('delete from public.cod_receipts', '42501', null, 'tahsilat kaydı silinmez');
select throws_ok('truncate public.cod_receipts', '42501', null, 'tahsilat kaydı boşaltılamaz');

-- Geri dönüş: ürün kontrol edilmeden stoğa eklenmez
select is(tests.ready('krg2'), '', 'dönecek sipariş');
select ok(tests.create_ship('om', 'krg2') not like 'HATA%', 'gönderi');
select is(tests.track('om', 'krg2', 'DONEN123'), '', 'takip');
select is(tests.ship('om', 'krg2', 'handed_over'), '', 'verildi');
create table tests.st2 as select tests.stock('ucuz') as v;
select is(tests.ship('om', 'krg2', 'returned'), '', 'geri döndü');
select is(tests.st('krg2') || ':' || (select shipment_status from public.orders where id = tests.o('krg2')), 'returned_to_sender/cancelled:returned', 'kapıda ödeme beklenmez');
select is((select status from public.payments where order_id = tests.o('krg2')), 'cancelled', 'ödeme kaydı kapanır');
select is(tests.stock('ucuz'), (select v from tests.st2), 'dönen ürün kendiliğinden stoğa girmez');
select is(tests.cod_id('krg2'), null, 'dönen gönderide tahsilat beklenmez');
select is(left(tests.ship('om', 'krg2', x), 10), 'HATA 22023', 'returned -> ' || x) from unnest(array['handed_over', 'delivered', 'cancelled']) x;
select is(tests.see('krg2') ->> 'status', 'returned', 'müşteri geri dönüşü görür');

-- Önceden ödenmiş sipariş
select is(tests.order('krg3', null, 'ucuz', 1, 30000), 'ok', 'havale siparişi');
select ok(tests.match('om', 'krg3', 30000, 'KRG3') not like 'HATA%', 'para görüldü');
select is(tests.confirm('sa', 'KRG3'), 'paid', 'onaylandı');
select is(tests.call('om', 'approve_order', 'krg3') || tests.call('om', 'advance_order', 'krg3', $$, 'preparing'$$), '', 'hazırlanıyor');
select ok(tests.create_ship('om', 'krg3') not like 'HATA%', 'gönderi');

-- Gönderi iptali ve yenisi
select is(tests.track('om', 'krg3', 'TEKRAR01'), '', 'takip');
select is(tests.ship('om', 'krg3', 'cancelled'), '', 'gönderi iptal edilir');
select is(tests.st('krg3') || ':' || (select shipment_status from public.orders where id = tests.o('krg3')), 'preparing/paid:none', 'sipariş hazırlanmaya devam eder');
select is(tests.detail('krg3') -> 'shipment', 'null'::jsonb, 'iptal edilen panelde açık görünmez');
select ok(tests.create_ship('om', 'krg3') not like 'HATA%', 'yeni gönderi');
select is((select string_agg(our_ref || status, ',' order by our_ref) from public.shipments where order_id = tests.o('krg3')), tests.no('krg3') || '-1cancelled,' || tests.no('krg3') || '-2created', 'numaralar ayrı');
select is(tests.track('om', 'krg3', 'TEKRAR01'), '', 'iptal edilenin numarası yeniden kullanılabilir');
select is(tests.ship('om', 'krg3', 'handed_over') || tests.ship('om', 'krg3', 'delivered'), '', 'teslim');
select is(tests.st('krg3'), 'delivered/paid', 'ödenmiş sipariş teslim');
select is(tests.cod_id('krg3'), null, 'ödenmişte kapıda tahsilat yok');

-- Sipariş iptali açık gönderiyi kapatır
select is(tests.ready('krg4'), '', 'iptal edilecek sipariş');
select ok(tests.create_ship('om', 'krg4') not like 'HATA%', 'gönderi');
select is(tests.call('om', 'cancel_order', 'krg4', $$, 'vazgeçti'$$), '', 'sipariş iptal');
select is((select s.status || ':' || o.shipment_status from public.shipments s join public.orders o on o.id = s.order_id where o.id = tests.o('krg4')), 'cancelled:none', 'gönderi de iptal');
select is(tests.run_as('om', format('select public.advance_shipment(%L, ''handed_over'')', (select id from public.shipments where order_id = tests.o('krg4')))) like 'HATA 22023%', true, 'iptal edilen gönderi yola çıkamaz');
select is(left(tests.create_ship('om', 'krg4'), 10), 'HATA 22023', 'iptal edilen siparişe gönderi yok');

-- Mağaza siparişi, ödenmiş geri dönüş, başka kaydın anahtarı ve not sızıntısı
select is(tests.order('krg5', null, 'ucuz', 1, 10000, '{"delivery": "pickup", "payment": "store"}'), 'ok', 'mağaza siparişi');
select is(tests.call('om', 'approve_order', 'krg5') || tests.call('om', 'advance_order', 'krg5', $$, 'preparing'$$), '', 'hazırlanıyor');
select is(left(tests.create_ship('om', 'krg5'), 10), 'HATA 22023', 'mağazadan teslimde gönderi yok');
select is(tests.order('krg6', null, 'ucuz', 1, 30000), 'ok', 'havale siparişi');
select ok(tests.match('om', 'krg6', 30000, 'KRG6') not like 'HATA%', 'para görüldü');
select is(tests.confirm('sa', 'KRG6'), 'paid', 'onaylandı');
select is(tests.call('om', 'approve_order', 'krg6') || tests.call('om', 'advance_order', 'krg6', $$, 'preparing'$$), '', 'hazırlanıyor');
select ok(tests.create_ship('om', 'krg6') not like 'HATA%', 'gönderi');
select is(tests.track('om', 'krg6', 'KRG66666'), '', 'takip');
select throws_ok(format('update public.shipments set tracking_no = ''CC11111'' where id = %L', tests.shp('krg6')), '23505', null, 'veritabanı aynı takip numarasını reddeder');
select is(tests.call('om', 'cancel_order', 'krg5', $$, 'başkasının notu'$$), '', 'başka sipariş iptal');
select is(tests.ship('om', 'krg6', 'handed_over'), '', 'verildi');
select is((select note from public.order_status_history where order_id = tests.o('krg6') and to_value = 'shipped'), null, 'başka siparişin notu yazılmaz');
select is(tests.ship('om', 'krg6', 'returned'), '', 'geri döndü');
select is(tests.st('krg6') || (select status from public.payments where order_id = tests.o('krg6')), 'returned_to_sender/paidpaid', 'ödenmiş para kaybolmaz');
select is(tests.ready('krg7'), '', 'ikinci kapıda ödeme');
select ok(tests.create_ship('om', 'krg7') not like 'HATA%', 'gönderi');
select is(tests.track('om', 'krg7', 'KRG77777') || tests.ship('om', 'krg7', 'handed_over') || tests.ship('om', 'krg7', 'delivered'), '', 'teslim');
select is(left(tests.cod('ad', 'krg7', 41000, (select k from tests.k)), 10), 'HATA 22023', 'başka tahsilatın anahtarı kullanılmaz');

-- İlçe listesi
select is(private.valid_district(c, d), s, c || '/' || d) from (values ('Eskişehir', 'Odunpazarı', true), ('Eskişehir', 'Nilüfer', false),
  ('Bursa', 'Nilüfer', true), ('Samsun', '19 Mayıs', true), ('Uydurma', 'Merkez', false), ('Eskişehir', 'odunpazarı', false), ('Eskişehir', '', false)) x (c, d, s);
select is(private.valid_district(c, d), false, 'boş il veya ilçe') from (values (null, 'Odunpazarı'), ('Eskişehir', null), (null, null)) x (c, d);
select is(left(tests.order('ilce', null, 'ucuz', 1, 30000, jsonb_build_object('address', tests.addr() || jsonb_build_object('district', x))), 10), 'HATA 22023', 'sipariş adresinde ilçe listede yok: ' || coalesce(x, 'yok'))
from unnest(array['Nilüfer', 'Uydurma', '', null]) x;

-- ---------------------------------------------------------------------------
-- Değişmez eşitlikler
-- ---------------------------------------------------------------------------
select is_empty($$ select v.name from tests.v v join public.inventory i on i.variant_id = v.id
  where i.on_hand <> (select sum(delta) from public.stock_movements m where m.variant_id = v.id) $$, 'stok = hareket toplamı');
select is_empty($$ select v.name from tests.v v join public.inventory i on i.variant_id = v.id
  where i.reserved <> (select coalesce(sum(quantity), 0) from public.stock_reservations r where r.variant_id = v.id and r.status = 'active') $$, 'ayrılan = aktif ayırma toplamı');
select is_empty($$ select o.order_no from public.orders o join tests.o t on t.id = o.id left join public.shipments s on s.order_id = o.id and s.status <> 'cancelled'
  where o.shipment_status <> coalesce(s.status, 'none') $$, 'siparişin ve gönderinin durumu aynı');
select is_empty($$ select s.id from public.shipments s join tests.o t on t.id = s.order_id, public.order_items i where i.order_id = s.order_id
  and i.quantity is distinct from (select x.quantity from public.shipment_items x where x.shipment_id = s.id and x.order_item_id = i.id) $$, 'gönderi bütün siparişi kapsar');
select is((select count(*) from cron.job where jobname = 'siparis-suresi' and active), 1::bigint, 'süre zamanlayıcısı kurulu');

select * from finish();
rollback;
