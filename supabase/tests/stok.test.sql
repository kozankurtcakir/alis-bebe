-- Aşama 4 testleri: stok kuralları ve izinleri. Sonunda geri alınır.
-- Eşzamanlılık testi e2e/stok.spec.ts içindedir.
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
values ('Stok%Test', 'stok-test', 'baby', 'unisex', 1000);
insert into public.product_variants (product_id, color_id, size_id, sku, barcode, price)
select p.id, c.id, s.id, 'STOK-' || s.code, '00' || 'STOK' || s.code, 100
from public.products p, public.colors c, public.sizes s
where p.slug = 'stok-test' and c.code = 'HAR' and s.code in ('3-6A', '6-9A');

create function tests.v(p_sku text default 'STOK-3-6A') returns uuid language sql as $$
  select id from public.product_variants where sku = p_sku $$;
create function tests.adj(p_reason text, p_quantity integer, p_note text default 'not',
  p_key uuid default gen_random_uuid(), p_expected integer default null, p_sku text default 'STOK-3-6A')
returns text language sql as $$
  select format('select public.adjust_stock(%L, %L, %L, %L, %L, %L)',
    tests.v(p_sku), p_reason, p_quantity, p_note, p_key, p_expected) $$;
create function tests.rev(p_seq_desc integer, p_note text default 'hata', p_key uuid default gen_random_uuid())
returns text language sql as $$
  select format('select public.reverse_stock_movement(%L, %L, %L)',
    (select id from public.stock_movements where variant_id = tests.v() order by seq desc
     offset p_seq_desc limit 1), p_note, p_key) $$;
create function tests.stock() returns integer language sql as $$
  select on_hand from public.inventory where variant_id = tests.v() $$;
create function tests.moves() returns bigint language sql as $$
  select count(*) from public.stock_movements where variant_id = tests.v() $$;

-- ---------------------------------------------------------------------------
-- Başlangıç ve doğrudan yazma
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select on_hand, reserved, critical_level from public.inventory where variant_id = tests.v() $$,
  $$ values (0, 0, 3) $$, 'yeni varyant 0 stok ve 3 kritik seviyeyle başlar');
select is((select count(*) from public.product_variants v where not exists (
  select 1 from public.inventory i where i.variant_id = v.id)), 0::bigint, 'her varyantın stok kaydı var');
select is(has_table_privilege(r, t, x), false, format('%s: %s üzerinde %s yok', r, t, x))
from unnest(array['anon', 'authenticated', 'service_role']) r,
  unnest(array['public.inventory', 'public.stock_movements']) t,
  unnest(array['insert', 'update', 'delete', 'truncate']) x;
select is((select count(*) from information_schema.column_privileges
  where table_schema = 'public' and table_name in ('inventory', 'stock_movements')
    and grantee in ('anon', 'authenticated', 'service_role') and privilege_type <> 'SELECT'),
  0::bigint, 'sütun bazında da yazma hakkı yok');
select is(tests.run_as('sa', 'update public.inventory set on_hand = 5 returning 1'), 'HATA 42501', 'SA stoğu doğrudan yazamaz');

-- ---------------------------------------------------------------------------
-- Roller
-- ---------------------------------------------------------------------------
select is(tests.run_as(u, tests.adj('purchase', 1)), 'HATA 42501', u || ': stok değiştiremez')
from unnest(array['pm', 'om', 'cs', 'musteri']) u;
select is(tests.run_as(null, tests.adj('purchase', 1)), 'HATA 42501', 'anon stok değiştiremez');
select is(tests.run_as('sm', tests.adj('purchase', 1), 'aal1'), 'HATA 42501', 'aal1 ile stok değişmez');
select is(tests.run_as(u, format('select public.set_critical_level(%L, 5)', tests.v())), 'HATA 42501', u || ': kritik seviyeyi değiştiremez')
from unnest(array['pm', 'om', 'cs', 'musteri']) u;
select is(tests.run_as(u, format('select on_hand from public.inventory where variant_id = %L', tests.v())), '0', u || ': stoğu okur')
from unnest(array['sa', 'admin', 'pm', 'sm', 'om', 'cs']) u;
select is(tests.run_as('musteri', 'select count(*) from public.inventory'), '0', 'müşteri stoğu okuyamaz');
select is(tests.run_as('sm', 'select count(*) from public.inventory', 'aal1'), '0', 'aal1 ile stok okunamaz');
select is(tests.run_as(null, 'select count(*) from public.inventory'), 'HATA 42501', 'anon stoğu okuyamaz');
select is(tests.run_as('musteri', $$ select count(*) from public.list_stock('', 'all', 1) $$), '0', 'müşteri stok listesi boş');
select is(tests.run_as('musteri', format('select count(*) from public.list_stock_movements(%L)', tests.v())), 'HATA 42501', 'müşteri hareketleri göremez');

-- ---------------------------------------------------------------------------
-- İşlemler
-- ---------------------------------------------------------------------------
select is(tests.run_as('sm', tests.adj('initial', 20, null)), '20', 'ilk stok');
select is(tests.run_as('sm', tests.adj('initial', 20)), 'HATA 22023', 'ilk stok ikinci kez girilemez');
select is(tests.run_as('admin', tests.adj('purchase', 5, null)), '25', 'mal girişi, notsuz olur');
select is(tests.run_as('sa', tests.adj('damage', 2)), '23', 'hasar düşer');
select is(tests.run_as('sm', tests.adj('damage', 2, '  ')), 'HATA 22023', 'hasarda not zorunlu');
select is(tests.run_as('sm', tests.adj('damage', 24)), 'HATA 22023', 'stok eksiye düşmez');
select is(tests.run_as('sm', tests.adj('purchase', q)), 'HATA 22023', format('miktar %s reddedilir', coalesce(q::text, 'boş')))
from unnest(array[0, -5, 100001, null]) q;
select is(tests.run_as('sm', tests.adj(r, 1)), 'HATA 22023', r || ' elle girilemez')
from unnest(array['sale', 'cancel', 'return', 'import', 'reversal', 'uydurma']) r;
select is(tests.run_as('sm', tests.adj('purchase', 1, repeat('x', 501))), 'HATA 22023', 'uzun not reddedilir');
select is(tests.run_as('sm', tests.adj('purchase', 1, 'n', null)), 'HATA 22023', 'anahtarsız istek reddedilir');
select is(tests.run_as('sm', format($$ select public.adjust_stock(%L, 'purchase', 1, null, %L) $$, gen_random_uuid(), gen_random_uuid())), 'HATA P0002', 'olmayan varyant');
select is(tests.stock(), 23, 'reddedilen istekler stoğu değiştirmez');
select is(tests.moves(), 3::bigint, 'reddedilen istekler hareket yazmaz');
select is((select actor_id from public.stock_movements where variant_id = tests.v() order by seq limit 1),
  (select id from tests.users where name = 'sm'), 'hareketi yapan kişi kaydedilir');

-- Sayım
select is(tests.run_as('sm', tests.adj('adjustment', 17)), 'HATA 22023', 'beklenen stok verilmeden sayım olmaz');
select is(tests.run_as('sm', tests.adj('adjustment', 17, null, gen_random_uuid(), 23)), 'HATA 22023', 'sayımda not zorunlu');
select is(tests.run_as('sm', tests.adj('adjustment', 17, 'sayım', gen_random_uuid(), 22)), 'HATA 22023', 'eski sayım reddedilir');
select is(tests.run_as('sm', tests.adj('adjustment', 17, 'sayım', gen_random_uuid(), 23)), '17', 'sayım farkı yazar');
select is((select delta from public.stock_movements where variant_id = tests.v() order by seq desc limit 1), -6, 'sayım farkı -6');
select is(tests.run_as('sm', tests.adj('adjustment', 17, 'sayım', gen_random_uuid(), 17)), '17', 'aynı sayım sonucu kabul edilir');
select is(tests.moves(), 4::bigint, 'farksız sayım hareket yazmaz');

-- Aynı istek
select is(tests.run_as('sm', tests.adj('purchase', 3, 'n', '00000000-0000-4000-8000-00000000000a')), '20', 'anahtarlı giriş');
select is(tests.run_as('sm', tests.adj('purchase', 3, 'n', '00000000-0000-4000-8000-00000000000a')), '20', 'aynı istek aynı sonucu verir');
select is(tests.stock(), 20, 'aynı istek iki kez işlenmez');
select is(tests.run_as('sm', tests.adj('purchase', 4, 'n', '00000000-0000-4000-8000-00000000000a')), 'HATA 22023', 'aynı anahtar, farklı miktar');
select is(tests.run_as('sm', tests.adj('damage', 3, 'n', '00000000-0000-4000-8000-00000000000a')), 'HATA 22023', 'aynı anahtar, farklı işlem');
select is(tests.run_as('admin', tests.adj('purchase', 3, 'n', '00000000-0000-4000-8000-00000000000a')), 'HATA 22023', 'aynı anahtar, başka kişi');
select is(tests.run_as('sm', tests.adj('purchase', 3, 'n', '00000000-0000-4000-8000-00000000000a', null, 'STOK-6-9A')), 'HATA 22023', 'aynı anahtar, başka varyant');

-- Ayrılmış stok korunur
update public.inventory set reserved = 18 where variant_id = tests.v();
select is(tests.run_as('sm', tests.adj('damage', 3)), 'HATA 22023', 'ayrılmış stok düşülemez');
select is(tests.run_as('sm', tests.adj('adjustment', 17, 'n', gen_random_uuid(), 20)), 'HATA 22023', 'sayım ayrılmışın altına inemez');
select is(tests.run_as('sm', tests.adj('damage', 2)), '18', 'ayrılmış kadar stok kalabilir');
select throws_ok('update public.inventory set reserved = 19 where variant_id = tests.v()', '23514', null, 'ayrılmış, eldekini aşamaz');
select throws_ok('update public.inventory set reserved = -1 where variant_id = tests.v()', '23514', null, 'ayrılmış eksi olamaz');
update public.inventory set reserved = 0 where variant_id = tests.v();

-- ---------------------------------------------------------------------------
-- Ters kayıt
-- ---------------------------------------------------------------------------
select is(tests.run_as(u, tests.rev(0)), 'HATA 42501', u || ': ters kayıt yapamaz')
from unnest(array['pm', 'om', 'cs', 'musteri']) u;
select is(tests.run_as('sm', tests.rev(0, ' ')), 'HATA 22023', 'ters kayıtta not zorunlu');
create temp table rev_call as select tests.rev(0, 'hata', '00000000-0000-4000-8000-00000000000b') as q;
grant select on rev_call to authenticated;
select is(tests.run_as('sm', q), '20', 'hasar geri alınır') from rev_call;
select is(tests.run_as('sm', q), '20', 'aynı ters kayıt isteği ikinci kez işlenmez') from rev_call;
select is(tests.stock(), 20, 'stok bir kez geri geldi');
select is(tests.run_as('sm', replace(q, '00000000000b', '00000000000c')), 'HATA 22023', 'hareket ikinci kez ters çevrilemez') from rev_call;
select is(tests.run_as('sm', tests.rev(0)), 'HATA 22023', 'ters kayıt ters çevrilemez');
select is(tests.run_as('sm', tests.rev(2, 'n', '00000000-0000-4000-8000-00000000000a')), 'HATA 22023', 'kullanılmış anahtarla ters kayıt olmaz');
select is(tests.run_as('sm', format($$ select public.reverse_stock_movement(%L, 'n', %L) $$, gen_random_uuid(), gen_random_uuid())), 'HATA P0002', 'olmayan hareket');
select is(tests.run_as('sm', tests.adj('damage', 19)), '1', 'stok 1 kaldı');
select is(tests.run_as('sm', tests.rev(3)), 'HATA 22023', 'stoğu eksiye düşürecek ters kayıt reddedilir');

select is((select is_reversed from public.stock_movements m
  cross join lateral (select exists (select 1 from public.stock_movements r where r.reverses_id = m.id) as is_reversed) x
  where m.variant_id = tests.v() order by seq desc offset 2 limit 1), true, 'ters çevrilen hareket işaretli');

-- ---------------------------------------------------------------------------
-- Değişmezler
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from public.inventory i where i.on_hand <> (
    select coalesce(sum(delta), 0) from public.stock_movements m where m.variant_id = i.variant_id)),
  0::bigint, 'stok, hareketlerin toplamına eşit');
select is(
  (select count(*) from (
    select on_hand_after, sum(delta) over (partition by variant_id order by seq) as running
    from public.stock_movements) x where on_hand_after <> running),
  0::bigint, 'her hareketin sonraki stoğu doğru');
select is(tests.run_as('sa', 'delete from public.stock_movements returning 1'), 'HATA 42501', 'SA hareketi silemez');
select throws_ok('delete from public.stock_movements', '42501', null, 'veritabanı sahibi de hareketi silemez');
select throws_ok('update public.stock_movements set delta = 1', '42501', null, 'hareket değiştirilemez');
select throws_ok('truncate public.stock_movements', '42501', null, 'hareket tablosu boşaltılamaz');

-- ---------------------------------------------------------------------------
-- Kritik seviye ve listeler
-- ---------------------------------------------------------------------------
create function tests.listed(p_query text, p_state text default 'all') returns text language sql as $$
  select format('select count(*) from public.list_stock(%L, %L, 1) where sku like ''STOK-%%''', p_query, p_state) $$;
select is(tests.run_as('cs', tests.listed('Stok%Test')), '2', 'ürün adıyla bulunur');
select is(tests.run_as('cs', tests.listed('stok-3')), '1', 'SKU başıyla bulunur');
select is(tests.run_as('cs', tests.listed('00STOK6-9A')), '1', 'barkodla bulunur');
select is(tests.run_as('cs', tests.listed('S%t')), '0', 'joker karakter etkisiz');
select is(tests.run_as('cs', tests.listed('_tok')), '0', 'alt çizgi etkisiz');
select is(tests.run_as('cs', tests.listed('', 'critical')), '1', '1 adet kritik');
select is(tests.run_as('cs', tests.listed('', 'out')), '1', '0 adet tükendi');
select is(tests.run_as('sm', format('select public.set_critical_level(%L, 0)', tests.v())), '', 'SM kritik seviyeyi değiştirir');
select is(tests.run_as('cs', tests.listed('', 'critical')), '0', 'seviye 0 iken kritik değil');
select is(tests.run_as('sm', format('select public.set_critical_level(%L, %L)', tests.v(), l)), 'HATA 22023', format('kritik seviye %s reddedilir', coalesce(l::text, 'boş')))
from unnest(array[-1, 10001, null]) l;
select is(tests.run_as('admin', $$ select count(*) from public.list_audit_logs() where action = 'stock.critical_level' and target = 'STOK-3-6A' and created_at = now() $$), '1', 'kritik seviye geçmişte');
update public.product_variants set is_active = false where sku = 'STOK-6-9A';
select is(tests.run_as('cs', tests.listed('', 'out')), '0', 'pasif varyant uyarı vermez');
select is(tests.run_as('cs', tests.listed('')), '2', 'pasif varyant listede kalır');
select is(tests.run_as('sm', tests.adj('initial', 4, null, gen_random_uuid(), null, 'STOK-6-9A')), '4', 'pasif varyantın stoğu değişebilir');
select is(tests.run_as('cs', format('select count(*) from public.list_stock_movements(%L)', tests.v())), tests.moves()::text, 'CS hareketleri görür');

select * from finish();
rollback;
