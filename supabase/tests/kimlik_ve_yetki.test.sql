-- Aşama 2 testleri: her rol için izin/red ve yetki yükseltme denemeleri.
-- Tamamı tek işlemde çalışır ve sonunda geri alınır.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Yardımcılar
-- ---------------------------------------------------------------------------
create schema tests;
create table tests.users (name text primary key, id uuid not null, session_id uuid not null);

create function tests.new_user(p_name text, p_role text default null, p_confirmed boolean default true)
returns void language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_name || '@pgtap.test', case when p_confirmed then now() end,
    '{"full_name": "Test Kişisi", "role": "super_admin", "is_staff": true}');
  insert into auth.sessions (id, user_id) values (v_session, v_id);
  insert into tests.users values (p_name, v_id, v_session);
  if p_role is not null then
    insert into public.user_roles (user_id, role_id)
    select v_id, id from public.roles where key = p_role;
  end if;
end $$;

create function tests.uid(p_name text) returns uuid language sql as
$$ select id from tests.users where name = p_name $$;

-- SQL'i verilen kişi olarak çalıştırır. Sonucu ya da 'HATA <kod>' döndürür. p_name boşsa anon.
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
select tests.new_user('sa2', 'super_admin');
select tests.new_user('admin', 'admin');
select tests.new_user('admin2', 'admin');
select tests.new_user('pm', 'product_manager');
select tests.new_user('sm', 'stock_manager');
select tests.new_user('om', 'order_manager');
select tests.new_user('cs', 'customer_service');
select tests.new_user('musteri');
select tests.new_user('musteri2');
select tests.new_user('onaysiz', null, false);

-- Yerelde kayıtlı başka hesaplar sonucu etkilemesin (işlem sonunda geri alınır).
alter table public.profiles disable trigger profiles_guard;
update public.profiles set is_active = false where id not in (select id from tests.users);
alter table public.profiles enable trigger profiles_guard;

-- ---------------------------------------------------------------------------
-- Genel güvenlik: tablolar ve fonksiyonlar
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select relname from pg_class where relnamespace = 'public'::regnamespace
     and relkind in ('r', 'p') and not relrowsecurity $$,
  'her tabloda RLS açık');

select is_empty(
  $$ select p.oid::regprocedure from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and (has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('service_role', p.oid, 'execute')) $$,
  'anon ve service_role hiçbir fonksiyonu çalıştıramaz');

select set_eq(
  $$ select p.proname::text from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and has_function_privilege('authenticated', p.oid, 'execute') $$,
  array['my_access', 'assign_role', 'revoke_role', 'set_user_active', 'reset_mfa',
    'list_staff', 'find_user_by_email', 'list_audit_logs', 'is_active_session', 'has_permission'],
  'giriş yapan kullanıcı yalnızca listedeki fonksiyonları çalıştırabilir');

select is_empty(
  $$ select p.oid::regprocedure from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'security definer fonksiyonlarda search_path sabit');

select is_empty(
  $$ select c.relname from pg_class c, unnest(array['select', 'insert', 'update', 'delete', 'truncate']) x
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and has_table_privilege('anon', c.oid, x) $$,
  'anon hiçbir tabloya erişemez');

select is_empty(
  $$ select c.relname from pg_class c, unnest(array['insert', 'update', 'delete', 'truncate']) x
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and has_table_privilege('authenticated', c.oid, x) $$,
  'giriş yapan kullanıcının tablo genelinde yazma hakkı yok');

-- ---------------------------------------------------------------------------
-- Rol-izin matrisi (docs/kurallar.md): 7 rol x 34 izin
-- ---------------------------------------------------------------------------
create table tests.matrix (permission text primary key, roles text not null);
insert into tests.matrix values
  ('dashboard.read', 'sa admin pm sm om cs'), ('catalog.read', 'sa admin pm sm om cs'),
  ('catalog.write', 'sa admin pm'), ('prices.write', 'sa admin pm'),
  ('costs.read', 'sa admin'), ('costs.write', 'sa admin'),
  ('stock.read', 'sa admin pm sm om cs'), ('stock.adjust', 'sa admin sm'),
  ('import.products', 'sa admin pm'), ('import.stock', 'sa admin sm'),
  ('orders.read', 'sa admin om cs'), ('orders.note', 'sa admin om cs'),
  ('orders.approve', 'sa admin om'), ('orders.cancel', 'sa admin om'),
  ('transfers.match', 'sa admin om'), ('transfers.confirm', 'sa admin'),
  ('refunds.request', 'sa admin om'), ('refunds.approve', 'sa admin'),
  ('returns.open', 'sa admin om cs'), ('returns.receive', 'sa admin sm om'),
  ('returns.decide', 'sa admin om'), ('shipping.read', 'sa admin om cs'),
  ('shipping.write', 'sa admin om'), ('cod.reconcile', 'sa admin'),
  ('customers.read', 'sa admin om cs'), ('customers.export', 'sa admin'),
  ('reports.products', 'sa admin pm'), ('reports.stock', 'sa admin sm'),
  ('reports.orders', 'sa admin om'), ('staff.manage', 'sa admin'),
  ('roles.manage', 'sa'), ('settings.basic', 'sa admin'),
  ('settings.critical', 'sa'), ('audit.read', 'sa admin');

select set_eq('select key from public.permissions', 'select permission from tests.matrix',
  'izin listesi belgeyle aynı');

select is(
  tests.run_as(u, format('select private.has_permission(%L)', m.permission)),
  case when u = any (string_to_array(m.roles, ' ')) then 'true' else 'false' end,
  u || ' / ' || m.permission)
from tests.matrix m, unnest(array['sa', 'admin', 'pm', 'sm', 'om', 'cs', 'musteri']) u;

select is(
  tests.run_as(u, 'select cardinality(permissions) from public.my_access()', 'aal1'), '0',
  u || ': iki adımlı doğrulama olmadan izin yok')
from unnest(array['sa', 'admin', 'pm', 'sm', 'om', 'cs', 'musteri']) u;

select is(tests.run_as('sa', 'select is_staff from public.my_access()', 'aal1'), 'true', 'personel tanınır');
select is(tests.run_as('musteri', 'select is_staff from public.my_access()'), 'false', 'müşteri personel değildir');
select is(tests.run_as(null, 'select is_staff from public.my_access()'), 'HATA 42501', 'anon my_access çağıramaz');

-- ---------------------------------------------------------------------------
-- Yeni üye
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select r.key from public.user_roles ur join public.roles r on r.id = ur.role_id
     where ur.user_id = tests.uid('musteri') $$,
  array['customer'], 'üstveride super_admin yazsa da yeni üye yalnızca customer olur');

-- ---------------------------------------------------------------------------
-- Satır erişimi
-- ---------------------------------------------------------------------------
select is(tests.run_as('musteri', 'select count(*) from public.profiles'), '1', 'müşteri yalnızca kendi profilini görür');
select is(tests.run_as('admin', 'select count(*) from public.profiles'), '1', 'admin de profilleri toplu göremez');
select is(tests.run_as('musteri', 'select count(*) from public.user_roles'), '1', 'müşteri yalnızca kendi rolünü görür');
select is(tests.run_as('musteri', 'select count(*) from public.roles'), '0', 'müşteri rol tanımlarını göremez');
select is(tests.run_as('admin', 'select count(*) from public.roles'), '7', 'admin rol tanımlarını görür');
select is(tests.run_as('admin', 'select count(*) from public.roles', 'aal1'), '0', 'admin aal1 ile göremez');
select is(tests.run_as(null, 'select count(*) from public.profiles'), 'HATA 42501', 'anon profil okuyamaz');

select is(
  tests.run_as('musteri', $$ with x as (update public.profiles set full_name = 'Yeni Ad' returning 1) select count(*) from x $$),
  '1', 'güncelleme yalnızca kendi satırını etkiler');
select is(
  (select full_name from public.profiles where id = tests.uid('musteri2')), 'Test Kişisi',
  'başkasının profili değişmedi');
select is(tests.run_as('musteri', 'update public.profiles set is_active = true returning 1'), 'HATA 42501', 'is_active değiştirilemez');
select is(tests.run_as('musteri', 'update public.profiles set id = gen_random_uuid() returning 1'), 'HATA 42501', 'profil kimliği değiştirilemez');
select is(tests.run_as('musteri', $$ update public.profiles set phone = '<script>' returning 1 $$), 'HATA 23514', 'geçersiz telefon reddedilir');

-- ---------------------------------------------------------------------------
-- Yetki yükseltme denemeleri
-- ---------------------------------------------------------------------------
select is(
  tests.run_as(u, format($$ insert into public.user_roles (user_id, role_id)
    values (%L, %L) returning 1 $$, tests.uid(u), (select id from public.roles where key = 'super_admin'))),
  'HATA 42501', u || ': user_roles tablosuna doğrudan yazamaz')
from unnest(array['musteri', 'cs', 'admin', 'sa']) u;

select is(
  tests.run_as(u, format($$ insert into public.role_permissions (role_id, permission_id) values (%L, %L) returning 1 $$,
    gen_random_uuid(), gen_random_uuid())),
  'HATA 42501', u || ': rol izinlerini değiştiremez')
from unnest(array['musteri', 'admin', 'sa']) u;

select is(tests.run_as(u, format('select public.assign_role(%L, %L)', tests.uid('musteri2'), 'customer_service')),
  'HATA 42501', u || ': rol veremez')
from unnest(array['pm', 'sm', 'om', 'cs', 'musteri']) u;

select is(tests.run_as(null, format('select public.assign_role(%L, %L)', tests.uid('musteri'), 'super_admin')), 'HATA 42501', 'anon rol veremez');
select is(tests.run_as('sa', format('select public.assign_role(%L, %L)', tests.uid('musteri'), 'admin'), 'aal1'), 'HATA 42501', 'SA bile aal1 ile rol veremez');
select is(tests.run_as('admin', format('select public.assign_role(%L, %L)', tests.uid('musteri'), 'admin')), 'HATA 42501', 'admin, admin atayamaz');
select is(tests.run_as('admin', format('select public.assign_role(%L, %L)', tests.uid('musteri'), 'super_admin')), 'HATA 42501', 'admin, super admin atayamaz');
select is(tests.run_as('admin', format('select public.assign_role(%L, %L)', tests.uid('admin'), 'product_manager')), 'HATA 42501', 'admin kendi rolünü değiştiremez');
select is(tests.run_as('sa', format('select public.revoke_role(%L, %L)', tests.uid('sa'), 'super_admin')), 'HATA 42501', 'SA kendi rolünü kaldıramaz');
select is(tests.run_as('admin', format('select public.assign_role(%L, %L)', tests.uid('admin2'), 'product_manager')), 'HATA 42501', 'admin, başka admine dokunamaz');
select is(tests.run_as('admin', format('select public.revoke_role(%L, %L)', tests.uid('admin2'), 'admin')), 'HATA 42501', 'admin, adminlik kaldıramaz');
select is(tests.run_as('admin', format('select public.set_user_active(%L, false)', tests.uid('sa'))), 'HATA 42501', 'admin, SA pasifleştiremez');
select is(tests.run_as('admin', format('select public.reset_mfa(%L)', tests.uid('cs'))), 'HATA 42501', 'admin MFA sıfırlayamaz');
select is(tests.run_as('sa', format('select public.assign_role(%L, %L)', tests.uid('musteri'), 'customer')), 'HATA 22023', 'customer rolü elle verilmez');
select is(tests.run_as('sa', format('select public.assign_role(%L, %L)', tests.uid('musteri'), 'yok')), 'HATA 22023', 'olmayan rol reddedilir');
select is(tests.run_as('sa', format('select public.assign_role(%L, %L)', gen_random_uuid(), 'admin')), 'HATA P0002', 'olmayan kullanıcı reddedilir');
select is(tests.run_as('sa', format('select public.assign_role(%L, %L)', tests.uid('onaysiz'), 'admin')), 'HATA 22023', 'e-postası doğrulanmamış kişiye rol verilmez');
select is(tests.run_as('sa', $$ select private.bootstrap_super_admin('musteri@pgtap.test') $$), 'HATA 42501', 'bootstrap API kullanıcısına kapalı');
select is(tests.run_as('sa', $$ select private.write_audit('x', 'x', null, null, null) $$), 'HATA 42501', 'işlem geçmişine elle yazılamaz');
select throws_ok($$ select private.bootstrap_super_admin('musteri@pgtap.test') $$, 'P0001', 'Super Admin zaten var.', 'bootstrap bir kez çalışır');

-- Yukarıdaki denemeler hiçbir şeyi değiştirmemiş olmalı.
select is((select count(*) from tests.users u join public.user_roles ur on ur.user_id = u.id join public.roles r on r.id = ur.role_id where r.key <> 'customer'), 8::bigint, 'personel rolü sayısı değişmedi');
select is((select count(*) from public.audit_logs where created_at = now()), 0::bigint, 'reddedilen işlem geçmişe yazılmadı');

-- ---------------------------------------------------------------------------
-- İzin verilen işlemler ve işlem geçmişi
-- ---------------------------------------------------------------------------
select is(tests.run_as('admin', format('select public.assign_role(%L, %L)', tests.uid('musteri'), 'customer_service')), '', 'admin, CS atar');
select is(tests.run_as('musteri', $$ select private.has_permission('orders.read') $$), 'true', 'yeni rol hemen geçerli');
select is(tests.run_as('admin', format('select public.revoke_role(%L, %L)', tests.uid('musteri'), 'customer_service')), '', 'admin, CS kaldırır');
select is(tests.run_as('musteri', $$ select private.has_permission('orders.read') $$), 'false', 'kaldırılan rol hemen kesilir');
select is(tests.run_as('sa', format('select public.assign_role(%L, %L)', tests.uid('musteri'), 'admin')), '', 'SA, admin atar');
select is(tests.run_as('sa', format('select public.revoke_role(%L, %L)', tests.uid('musteri'), 'admin')), '', 'SA, admin kaldırır');
select set_eq(
  $$ select action, count(*) from public.audit_logs where created_at = now() group by 1 $$,
  $$ values ('role.assign', 2::bigint), ('role.revoke', 2::bigint) $$, 'her değişiklik geçmişte');
select is((select count(*) from public.audit_logs where actor_id = tests.uid('admin')), 2::bigint, 'işlemi yapan doğru kaydedilir');

select is(tests.run_as('admin', 'select count(*) from public.audit_logs where created_at = now()'), '4', 'admin geçmişi okur');
select is(tests.run_as('om', 'select count(*) from public.audit_logs'), '0', 'OM geçmişi okuyamaz');
select is(tests.run_as('admin', 'select count(*) from public.list_audit_logs() where created_at = now()'), '4', 'admin geçmiş listesini görür');
select is(tests.run_as('admin', 'select count(*) from public.list_audit_logs(-5) where created_at = now()'), '4', 'geçersiz sayfa numarası ilk sayfadır');
select is(tests.run_as(u, 'select count(*) from public.list_audit_logs()'), 'HATA 42501', u || ': geçmiş listesini göremez')
from unnest(array['pm', 'sm', 'om', 'cs', 'musteri']) u;
select is(tests.run_as('sa', 'select count(*) from public.list_audit_logs()', 'aal1'), 'HATA 42501', 'SA aal1 ile geçmişi göremez');
select is(tests.run_as('sa', 'delete from public.audit_logs returning 1'), 'HATA 42501', 'SA geçmişi silemez');
select throws_ok('delete from public.audit_logs', '42501', null, 'veritabanı sahibi de geçmişi silemez');
select throws_ok($$ update public.audit_logs set action = 'x' $$, '42501', null, 'veritabanı sahibi de geçmişi değiştiremez');
select throws_ok('truncate public.audit_logs', '42501', null, 'geçmiş toptan boşaltılamaz');

select is(tests.run_as('admin', $$ select count(*) from public.list_staff() where email like '%@pgtap.test' $$), '8', 'personel listesi müşterileri içermez');
select is(tests.run_as('om', 'select count(*) from public.list_staff()'), 'HATA 42501', 'OM personel listesini göremez');
select is(tests.run_as('admin', $$ select count(*) from public.find_user_by_email(' MUSTERI@pgtap.test ') $$), '1', 'tam e-posta bulunur');
select is(tests.run_as('admin', $$ select count(*) from public.find_user_by_email('%') $$), '0', 'joker karakterle arama yapılamaz');
select is(tests.run_as('cs', $$ select count(*) from public.find_user_by_email('musteri@pgtap.test') $$), 'HATA 42501', 'CS e-posta arayamaz');

-- ---------------------------------------------------------------------------
-- Pasifleştirme, MFA sıfırlama, son Super Admin
-- ---------------------------------------------------------------------------
select is(tests.run_as('admin', format('select public.set_user_active(%L, false)', tests.uid('om'))), '', 'admin, OM pasifleştirir');
select is(tests.run_as('om', $$ select private.has_permission('orders.read') $$), 'false', 'pasif personelin eski token ile izni yok');
select is(tests.run_as('om', 'select count(*) from public.profiles'), '0', 'pasif kullanıcı kendi profilini de göremez');
select is((select count(*) from auth.sessions where user_id = tests.uid('om')), 0::bigint, 'pasif kullanıcının oturumları silindi');
select is(tests.run_as('sa', format('select public.assign_role(%L, %L)', tests.uid('om'), 'stock_manager')), 'HATA 22023', 'pasif kullanıcıya rol verilmez');

insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at, secret)
values (gen_random_uuid(), tests.uid('cs'), 'totp', 'verified', now(), now(), 'test');
select is(tests.run_as('sa', format('select public.reset_mfa(%L)', tests.uid('cs'))), '', 'SA, MFA sıfırlar');
select is((select count(*) from auth.mfa_factors where user_id = tests.uid('cs')), 0::bigint, 'doğrulama kaydı silindi');
select is(tests.run_as('cs', $$ select private.has_permission('orders.read') $$), 'false', 'sıfırlanan kişinin eski oturumu geçersiz');

select is(tests.run_as('sa', format('select public.set_user_active(%L, false)', tests.uid('sa2'))), '', 'SA, diğer SA''yı pasifleştirebilir');
select throws_ok(
  format('update public.profiles set is_active = false where id = %L', tests.uid('sa')),
  '42501', null, 'son aktif SA veritabanından bile pasifleştirilemez');
select throws_ok(
  format('delete from public.user_roles where user_id = %L', tests.uid('sa')),
  '42501', null, 'son aktif SA rolü veritabanından bile kaldırılamaz');

select * from finish();
rollback;
