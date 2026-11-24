-- Aşama 2: kimlik ve yetki. Kurallar: docs/kurallar.md bölüm 1, docs/veritabani.md.

-- Yeni fonksiyonlar kendiliğinden herkese açılmasın; her biri açıkça yetkilendirilir.
alter default privileges revoke execute on functions from public;

-- API'ye açılmayan iç fonksiyonlar.
create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null default '' check (char_length(full_name) <= 100),
  phone text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text not null
);

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete restrict,
  permission_id uuid not null references public.permissions (id) on delete restrict,
  primary key (role_id, permission_id)
);
create index on public.role_permissions (permission_id);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete restrict,
  role_id uuid not null references public.roles (id) on delete restrict,
  granted_by uuid references public.profiles (id) on delete restrict,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index on public.user_roles (role_id);
create index on public.user_roles (granted_by);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete restrict,
  action text not null,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  ip inet,
  created_at timestamptz not null default now()
);
create index on public.audit_logs (actor_id);
create index on public.audit_logs (created_at desc);
create index on public.audit_logs (entity, entity_id);

-- ---------------------------------------------------------------------------
-- Sabit roller ve izinler
-- ---------------------------------------------------------------------------

insert into public.roles (key, name) values
  ('super_admin', 'Super Admin'),
  ('admin', 'Admin'),
  ('product_manager', 'Ürün Yöneticisi'),
  ('stock_manager', 'Stok Yöneticisi'),
  ('order_manager', 'Sipariş Yöneticisi'),
  ('customer_service', 'Müşteri Hizmetleri'),
  ('customer', 'Müşteri');

insert into public.permissions (key, description) values
  ('dashboard.read', 'Panel özetini görme'),
  ('catalog.read', 'Kataloğu görme'),
  ('catalog.write', 'Kataloğu düzenleme'),
  ('prices.write', 'Fiyat değiştirme'),
  ('costs.read', 'Maliyetleri görme'),
  ('costs.write', 'Maliyetleri değiştirme'),
  ('stock.read', 'Stoğu görme'),
  ('stock.adjust', 'Stok düzeltme'),
  ('import.products', 'Excel ile ürün aktarma'),
  ('import.stock', 'Excel ile stok aktarma'),
  ('orders.read', 'Siparişleri görme'),
  ('orders.note', 'Siparişe not ekleme'),
  ('orders.approve', 'Sipariş onaylama'),
  ('orders.cancel', 'Sipariş iptal etme'),
  ('transfers.match', 'Havale eşleştirme'),
  ('transfers.confirm', 'Havale onaylama'),
  ('refunds.request', 'Para iadesi isteme'),
  ('refunds.approve', 'Para iadesi onaylama'),
  ('returns.open', 'İade talebi açma'),
  ('returns.receive', 'İade teslim alma'),
  ('returns.decide', 'İade kararı verme'),
  ('shipping.read', 'Kargoyu görme'),
  ('shipping.write', 'Kargo işlemi yapma'),
  ('cod.reconcile', 'Kapıda ödeme mutabakatı'),
  ('customers.read', 'Müşteri bilgisi görme'),
  ('customers.export', 'Müşteri verisi indirme'),
  ('reports.products', 'Ürün raporları'),
  ('reports.stock', 'Stok raporları'),
  ('reports.orders', 'Sipariş raporları'),
  ('staff.manage', 'Personel yönetimi'),
  ('roles.manage', 'Yönetici rollerini yönetme'),
  ('settings.basic', 'Temel ayarlar'),
  ('settings.critical', 'Kritik ayarlar'),
  ('audit.read', 'İşlem geçmişini görme');

-- Super Admin: hepsi. Admin: iki izin dışında hepsi.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'super_admin'
   or (r.key = 'admin' and p.key not in ('roles.manage', 'settings.critical'));

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('product_manager', array[
    'dashboard.read', 'catalog.read', 'catalog.write', 'prices.write', 'stock.read',
    'import.products', 'reports.products']),
  ('stock_manager', array[
    'dashboard.read', 'catalog.read', 'stock.read', 'stock.adjust', 'import.stock',
    'returns.receive', 'reports.stock']),
  ('order_manager', array[
    'dashboard.read', 'catalog.read', 'stock.read', 'orders.read', 'orders.note',
    'orders.approve', 'orders.cancel', 'transfers.match', 'refunds.request',
    'returns.open', 'returns.receive', 'returns.decide', 'shipping.read',
    'shipping.write', 'customers.read', 'reports.orders']),
  ('customer_service', array[
    'dashboard.read', 'catalog.read', 'stock.read', 'orders.read', 'orders.note',
    'returns.open', 'shipping.read', 'customers.read'])
) as m (role_key, permission_keys)
join public.roles r on r.key = m.role_key
join public.permissions p on p.key = any (m.permission_keys);

-- ---------------------------------------------------------------------------
-- Yetki kontrolü
-- ---------------------------------------------------------------------------

-- Oturum hâlâ açık ve hesap aktif mi? Oturum silinince eski token da geçersiz sayılır.
create function private.is_active_session()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join auth.sessions s on s.user_id = p.id
    where p.id = (select auth.uid())
      and p.is_active
      and s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
      and (s.not_after is null or s.not_after > now())
  );
$$;

-- Personel izni: aktif oturum + iki adımlı doğrulama (aal2) + role bağlı izin.
create function private.has_permission(p_key text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
    and private.is_active_session()
    and exists (
      select 1
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.permissions p on p.id = rp.permission_id
      where ur.user_id = (select auth.uid()) and p.key = p_key
    );
$$;

create function private.require_permission(p_key text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.has_permission(p_key) then
    raise exception 'Bu işlem için yetkiniz yok.' using errcode = '42501';
  end if;
end;
$$;

create function private.has_role(p_user uuid, p_keys text[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = p_user and r.key = any (p_keys)
  );
$$;

create function private.write_audit(
  p_action text, p_entity text, p_entity_id uuid, p_before jsonb, p_after jsonb
)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.audit_logs (actor_id, action, entity, entity_id, before, after)
  values ((select auth.uid()), p_action, p_entity, p_entity_id, p_before, p_after);
$$;

-- ---------------------------------------------------------------------------
-- Tetikleyiciler
-- ---------------------------------------------------------------------------

create function private.touch_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
for each row execute function private.touch_updated_at();

-- Yeni üye yalnızca Customer olur; tarayıcıdan gelen üstveriden sadece ad alınır.
create function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 100));

  insert into public.user_roles (user_id, role_id)
  select new.id, r.id from public.roles r where r.key = 'customer';

  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

create function private.forbid_change()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'Bu kayıt değiştirilemez ve silinemez.' using errcode = '42501';
end;
$$;

create trigger audit_logs_append_only before update or delete on public.audit_logs
for each row execute function private.forbid_change();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
for each statement execute function private.forbid_change();

-- Son aktif Super Admin korunur. Kilit, iki eşzamanlı isteğin birbirini kaçırmasını önler.
create function private.guard_last_super_admin()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
begin
  if tg_table_name = 'user_roles' then
    if not exists (
      select 1 from public.roles r where r.id = old.role_id and r.key = 'super_admin'
    ) then
      return coalesce(new, old);
    end if;
    v_user := old.user_id;
  else
    if not (old.is_active and not new.is_active)
       or not private.has_role(old.id, array['super_admin']) then
      return new;
    end if;
    v_user := old.id;
  end if;

  perform pg_advisory_xact_lock(hashtext('super_admin_guard'));

  if not exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.key = 'super_admin'
    join public.profiles p on p.id = ur.user_id and p.is_active
    where ur.user_id <> v_user
  ) then
    raise exception 'Son Super Admin kaldırılamaz veya pasifleştirilemez.' using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger user_roles_guard before update or delete on public.user_roles
for each row execute function private.guard_last_super_admin();
create trigger profiles_guard before update on public.profiles
for each row execute function private.guard_last_super_admin();

-- ---------------------------------------------------------------------------
-- Personel yönetimi
-- ---------------------------------------------------------------------------

-- Kilit önce alınır, yetki sonra okunur: sırada bekleyen istek güncel durumu görür.
create function private.begin_staff_change(p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('super_admin_guard'));
  perform private.require_permission('staff.manage');

  if p_user = auth.uid() then
    raise exception 'Kendi yetkinizi değiştiremezsiniz.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Kullanıcı bulunamadı.' using errcode = 'P0002';
  end if;
  if private.has_role(p_user, array['super_admin', 'admin']) then
    perform private.require_permission('roles.manage');
  end if;
end;
$$;

create function private.staff_role_id(p_role text)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.roles where key = p_role and key <> 'customer';
  if v_id is null then
    raise exception 'Geçersiz rol.' using errcode = '22023';
  end if;
  if p_role in ('super_admin', 'admin') then
    perform private.require_permission('roles.manage');
  end if;
  return v_id;
end;
$$;

create function public.assign_role(p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_role uuid;
begin
  perform private.begin_staff_change(p_user);
  v_role := private.staff_role_id(p_role);

  -- Doğrulanmamış e-posta başkasına ait olabilir.
  if not exists (
    select 1
    from auth.users u
    join public.profiles p on p.id = u.id
    where u.id = p_user and u.email_confirmed_at is not null and p.is_active
  ) then
    raise exception 'Hesap aktif ve e-postası doğrulanmış olmalıdır.' using errcode = '22023';
  end if;

  insert into public.user_roles (user_id, role_id, granted_by)
  values (p_user, v_role, auth.uid())
  on conflict do nothing;

  if found then
    perform private.write_audit(
      'role.assign', 'user', p_user, null, jsonb_build_object('role', p_role));
  end if;
end;
$$;

create function public.revoke_role(p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_role uuid;
begin
  perform private.begin_staff_change(p_user);
  v_role := private.staff_role_id(p_role);

  delete from public.user_roles where user_id = p_user and role_id = v_role;

  if found then
    perform private.write_audit(
      'role.revoke', 'user', p_user, jsonb_build_object('role', p_role), null);
  end if;
end;
$$;

create function public.set_user_active(p_user uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_before boolean;
begin
  if p_active is null then
    raise exception 'Geçersiz değer.' using errcode = '22023';
  end if;
  perform private.begin_staff_change(p_user);

  select is_active into v_before from public.profiles where id = p_user for update;
  if v_before = p_active then
    return;
  end if;

  update public.profiles set is_active = p_active where id = p_user;
  if not p_active then
    delete from auth.sessions where user_id = p_user;
  end if;

  perform private.write_audit(
    case when p_active then 'user.activate' else 'user.deactivate' end, 'user', p_user,
    jsonb_build_object('is_active', v_before), jsonb_build_object('is_active', p_active));
end;
$$;

-- Telefonunu kaybeden personel için; yalnızca Super Admin.
create function public.reset_mfa(p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.begin_staff_change(p_user);
  perform private.require_permission('roles.manage');

  delete from auth.mfa_factors where user_id = p_user;
  delete from auth.sessions where user_id = p_user;

  perform private.write_audit('mfa.reset', 'user', p_user, null, null);
end;
$$;

create function private.user_summary(p_user uuid)
returns table (
  id uuid, email text, full_name text, is_active boolean, roles text[], mfa_enabled boolean
)
language sql stable security definer set search_path = ''
as $$
  select p.id, u.email::text, p.full_name, p.is_active,
    array(
      select r.key
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = p.id and r.key <> 'customer'
      order by r.key
    ),
    exists (
      select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified'
    )
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_user;
$$;

create function public.list_staff()
returns table (
  id uuid, email text, full_name text, is_active boolean, roles text[], mfa_enabled boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_permission('staff.manage');
  return query
    select s.*
    from (
      select distinct ur.user_id
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where r.key <> 'customer'
    ) x
    cross join lateral private.user_summary(x.user_id) s
    order by s.full_name, s.email;
end;
$$;

-- Yalnızca tam e-posta eşleşmesi; müşteri listesi gezilemez.
create function public.find_user_by_email(p_email text)
returns table (
  id uuid, email text, full_name text, is_active boolean, roles text[], mfa_enabled boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_permission('staff.manage');
  return query
    select s.*
    from auth.users u
    cross join lateral private.user_summary(u.id) s
    where u.email = lower(btrim(p_email));
end;
$$;

-- Giriş yapan kişinin kendi durumu. aal2 değilse izin listesi boştur.
create function public.my_access()
returns table (is_active boolean, is_staff boolean, permissions text[])
language sql stable security definer set search_path = ''
as $$
  select private.is_active_session(),
    exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = (select auth.uid()) and r.key <> 'customer'
    ),
    array(
      select p.key from public.permissions p where private.has_permission(p.key) order by p.key
    );
$$;

-- İlk Super Admin: yalnızca veritabanı sahibi çalıştırır, yalnızca bir kez.
create function private.bootstrap_super_admin(p_email text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
begin
  perform pg_advisory_xact_lock(hashtext('super_admin_guard'));

  if exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where r.key = 'super_admin'
  ) then
    raise exception 'Super Admin zaten var.';
  end if;

  select u.id into v_user
  from auth.users u
  where u.email = lower(btrim(p_email)) and u.email_confirmed_at is not null;
  if v_user is null then
    raise exception 'E-postası doğrulanmış kullanıcı bulunamadı.';
  end if;

  insert into public.user_roles (user_id, role_id)
  select v_user, r.id from public.roles r where r.key = 'super_admin';

  perform private.write_audit(
    'role.bootstrap', 'user', v_user, null, jsonb_build_object('role', 'super_admin'));
  return v_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS ve erişim izinleri
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_logs enable row level security;

revoke all on all tables in schema public from public, anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;

grant select, update (full_name, phone) on public.profiles to authenticated;
grant select on public.roles, public.permissions, public.role_permissions,
  public.user_roles, public.audit_logs to authenticated;

grant execute on function private.is_active_session(), private.has_permission(text) to authenticated;
grant execute on function
  public.my_access(), public.assign_role(uuid, text), public.revoke_role(uuid, text),
  public.set_user_active(uuid, boolean), public.reset_mfa(uuid),
  public.list_staff(), public.find_user_by_email(text)
to authenticated;

create policy "kendi profilini okur" on public.profiles for select to authenticated
using (id = (select auth.uid()) and (select private.is_active_session()));
create policy "kendi profilini günceller" on public.profiles for update to authenticated
using (id = (select auth.uid()) and (select private.is_active_session()))
with check (id = (select auth.uid()));

create policy "kendi rollerini okur" on public.user_roles for select to authenticated
using (user_id = (select auth.uid()) and (select private.is_active_session()));

create policy "personel yöneticisi okur" on public.roles for select to authenticated
using ((select private.has_permission('staff.manage')));
create policy "personel yöneticisi okur" on public.permissions for select to authenticated
using ((select private.has_permission('staff.manage')));
create policy "personel yöneticisi okur" on public.role_permissions for select to authenticated
using ((select private.has_permission('staff.manage')));

create policy "yetkili işlem geçmişini okur" on public.audit_logs for select to authenticated
using ((select private.has_permission('audit.read')));
