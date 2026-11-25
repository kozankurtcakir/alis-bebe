-- Aşama 8: sipariş, EFT, kapıda ödeme, mağazadan teslim. Kurallar: docs/kurallar.md bölüm 2-7.

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Ayarlar
-- ---------------------------------------------------------------------------

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now()
);
create index on public.settings (updated_by);

insert into public.settings (key, value) values
  ('test_mode', 'true'),             -- Kapatmak için hukuki metinler ve KDV oranları tamam olmalıdır.
  ('shipping_fee', '20000'),
  ('free_shipping_from', '100000'),
  ('gift_fee', '500'),
  ('shipping_vat_bps', 'null'),
  ('gift_vat_bps', 'null'),
  ('cod_vat_bps', 'null'),
  ('bank_holder', '""'),
  ('bank_iban', '""'),
  ('transfer_days', '2'),
  ('transfer_two_person', 'false'),
  ('holidays', '[]'),
  ('cod_enabled', 'false'),
  ('cod_limit', '0'),
  ('cod_fee', '0'),
  ('cod_card', 'false'),
  ('phone_check', 'true'),
  ('pickup_enabled', 'true'),
  ('pickup_pay', 'true'),
  ('pickup_days', '7'),
  ('pickup_address', '"Aliş Bebe, Eskişehir"'),
  ('max_unpaid', '3'),
  ('link_days', '90');

create function private.setting(p_key text)
returns jsonb
language sql stable security definer set search_path = ''
as $$ select value from public.settings where key = p_key $$;

create function private.setting_int(p_key text)
returns bigint
language sql stable security definer set search_path = ''
as $$ select (private.setting(p_key) #>> '{}')::bigint $$;

create function private.setting_on(p_key text)
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((private.setting(p_key) #>> '{}')::boolean, false) $$;

-- ---------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique check (order_no ~ '^AB[2-9A-HJ-NP-Z]{10}$'),
  user_id uuid references public.profiles (id) on delete restrict,
  contact_name text not null check (char_length(contact_name) between 2 and 100),
  email text not null check (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text not null check (phone ~ '^\+905[0-9]{9}$'),
  delivery_method text not null check (delivery_method in ('shipping', 'pickup')),
  payment_method text not null check (payment_method in ('transfer', 'cod', 'store')),
  order_status text not null check (order_status in (
    'pending_payment', 'awaiting_approval', 'approved', 'preparing', 'ready_for_pickup',
    'shipped', 'delivered', 'cancelled', 'returned_to_sender')),
  payment_status text not null check (payment_status in (
    'pending', 'review', 'paid', 'cancelled', 'cod_due', 'cod_collected',
    'refund_pending', 'partially_refunded', 'refunded')),
  shipment_status text not null default 'none' check (shipment_status in (
    'none', 'created', 'handed_over', 'in_transit', 'delivered', 'failed', 'returned')),
  subtotal bigint not null check (subtotal > 0),
  shipping_fee bigint not null check (shipping_fee >= 0),
  gift_fee bigint not null check (gift_fee >= 0),
  cod_fee bigint not null check (cod_fee >= 0),
  discount bigint not null default 0 check (discount >= 0),
  total bigint not null check (total = subtotal + shipping_fee + gift_fee + cod_fee - discount and total > 0),
  gift_wrap boolean not null,
  phone_verified_by uuid references public.profiles (id) on delete restrict,
  phone_verified_at timestamptz,
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  payment_due_at timestamptz,
  ready_at timestamptz,
  cancel_code text check (cancel_code in ('customer', 'staff', 'expired')),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((payment_method = 'store') <= (delivery_method = 'pickup')),
  check ((payment_method = 'cod') <= (delivery_method = 'shipping')),
  check (delivery_method = 'shipping' or shipping_fee = 0),
  check (payment_method = 'cod' or cod_fee = 0),
  check ((payment_method = 'transfer') = (payment_due_at is not null)),
  check ((approved_by is null) = (approved_at is null)),
  check ((phone_verified_by is null) = (phone_verified_at is null)),
  check ((order_status = 'cancelled') = (cancel_code is not null))
);
create index on public.orders (user_id, created_at desc);
create index on public.orders (order_status, created_at);
create index on public.orders (phone);
create index on public.orders (email);
create index on public.orders (approved_by);
create index on public.orders (phone_verified_by);
create index on public.orders (payment_due_at) where order_status = 'pending_payment';

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  variant_id uuid not null references public.product_variants (id) on delete restrict,
  name text not null,
  sku text not null,
  color text,
  size text,
  unit_price bigint not null check (unit_price > 0),
  vat_bps integer not null check (vat_bps between 0 and 10000),
  quantity integer not null check (quantity between 1 and 10),
  cancelled_qty integer not null default 0 check (cancelled_qty >= 0),
  returned_qty integer not null default 0 check (returned_qty >= 0),
  unique (order_id, variant_id),
  check (cancelled_qty + returned_qty <= quantity)
);
create index on public.order_items (variant_id);

create table public.order_addresses (
  order_id uuid not null references public.orders (id) on delete restrict,
  kind text not null check (kind in ('delivery', 'invoice')),
  recipient text not null check (char_length(recipient) between 2 and 100),
  phone text not null check (phone ~ '^\+905[0-9]{9}$'),
  city text not null,
  district text not null check (char_length(district) between 2 and 60),
  line text not null check (char_length(line) between 10 and 300),
  postal_code text check (postal_code ~ '^[0-9]{5}$'),
  company text check (char_length(company) between 2 and 200),
  tax_office text check (char_length(tax_office) between 2 and 100),
  tax_no text check (tax_no ~ '^[0-9]{10}$'),
  primary key (order_id, kind),
  check (kind = 'invoice' or company is null),
  check ((company is null) = (tax_office is null) and (company is null) = (tax_no is null))
);

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  order_id uuid not null references public.orders (id) on delete restrict,
  field text not null check (field in ('order_status', 'payment_status', 'phone', 'note')),
  from_value text,
  to_value text,
  actor_id uuid references public.profiles (id) on delete restrict,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index on public.order_status_history (order_id, seq);
create index on public.order_status_history (actor_id);

create table public.order_access_tokens (
  token_hash text primary key,
  order_id uuid not null references public.orders (id) on delete restrict,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on public.order_access_tokens (order_id);

create table public.stock_reservations (
  order_item_id uuid primary key references public.order_items (id) on delete restrict,
  variant_id uuid not null references public.inventory (variant_id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status text not null default 'active' check (status in ('active', 'consumed', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.stock_reservations (variant_id) where status = 'active';

-- Kart numarası veya CVV alanı yoktur.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete restrict,
  provider text not null check (provider in ('transfer', 'cod', 'store')),
  amount bigint not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  collected_as text check (collected_as in ('cash', 'card')),
  collected_by uuid references public.profiles (id) on delete restrict,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.payments (collected_by);

create table public.bank_transfers (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,
  amount bigint not null check (amount between 1 and 100000000000),
  -- Aynı banka hareketi iki siparişe yazılamaz.
  reference text not null unique check (char_length(reference) between 1 and 100),
  matched_by uuid not null references public.profiles (id) on delete restrict,
  matched_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles (id) on delete restrict,
  confirmed_at timestamptz,
  idempotency_key uuid not null unique,
  check ((confirmed_by is null) = (confirmed_at is null))
);
create index on public.bank_transfers (payment_id);
create index on public.bank_transfers (matched_by);
create index on public.bank_transfers (confirmed_by);

create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pre_info', 'distance_sales')),
  version integer not null check (version > 0),
  title text not null,
  body text not null,
  is_draft boolean not null default true,
  published_at timestamptz not null default now(),
  unique (kind, version)
);
insert into public.legal_documents (kind, version, title, body) values
  ('pre_info', 1, 'Ön Bilgilendirme Formu',
   'TASLAK METİN. Hukuki geçerliliği yoktur; uzman kontrolünden sonra değiştirilecektir.'),
  ('distance_sales', 1, 'Mesafeli Satış Sözleşmesi',
   'TASLAK METİN. Hukuki geçerliliği yoktur; uzman kontrolünden sonra değiştirilecektir.');

create table public.order_legal_acceptances (
  order_id uuid not null references public.orders (id) on delete restrict,
  document_id uuid not null references public.legal_documents (id) on delete restrict,
  rendered_body text not null,
  accepted_at timestamptz not null default now(),
  primary key (order_id, document_id)
);
create index on public.order_legal_acceptances (document_id);

-- E-posta kuyruğu. Gizli bağlantı burada durmaz; gönderilirken üretilir.
create table public.outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('order_placed', 'order_status')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.outbox_jobs (run_after) where status = 'pending';

alter table public.stock_movements
  add column order_id uuid references public.orders (id) on delete restrict,
  add constraint stock_movements_order_reason
    check ((reason in ('sale', 'cancel', 'return')) = (order_id is not null));
create index on public.stock_movements (order_id);

create trigger orders_touch before update on public.orders
for each row execute function private.touch_updated_at();
create trigger stock_reservations_touch before update on public.stock_reservations
for each row execute function private.touch_updated_at();
create trigger payments_touch before update on public.payments
for each row execute function private.touch_updated_at();
create trigger outbox_touch before update on public.outbox_jobs
for each row execute function private.touch_updated_at();
create trigger order_history_append_only before update or delete on public.order_status_history
for each row execute function private.forbid_change();
create trigger order_history_no_truncate before truncate on public.order_status_history
for each statement execute function private.forbid_change();
create trigger order_acceptances_append_only before update or delete on public.order_legal_acceptances
for each row execute function private.forbid_change();
create trigger order_acceptances_no_truncate before truncate on public.order_legal_acceptances
for each statement execute function private.forbid_change();

-- ---------------------------------------------------------------------------
-- Durum geçişleri: kuralın tek yeri. Doğrudan yazımda da geçerlidir.
-- ---------------------------------------------------------------------------

create function private.order_step_allowed(p_from text, p_to text, p_delivery text)
returns boolean
language sql immutable set search_path = ''
as $$
  select case p_from
    when 'pending_payment' then p_to in ('awaiting_approval', 'cancelled')
    when 'awaiting_approval' then p_to in ('approved', 'cancelled')
    when 'approved' then p_to in ('preparing', 'cancelled')
    when 'preparing' then p_to = 'cancelled'
      or p_to = (case p_delivery when 'pickup' then 'ready_for_pickup' else 'shipped' end)
    when 'ready_for_pickup' then p_to in ('delivered', 'cancelled')
    when 'shipped' then p_to in ('delivered', 'returned_to_sender')
    else false
  end
$$;

create function private.guard_order()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (new.id, new.order_no, new.user_id, new.email, new.phone, new.contact_name, new.delivery_method,
      new.payment_method, new.subtotal, new.shipping_fee, new.gift_fee, new.cod_fee, new.discount,
      new.total, new.gift_wrap, new.idempotency_key, new.created_at)
     is distinct from
     (old.id, old.order_no, old.user_id, old.email, old.phone, old.contact_name, old.delivery_method,
      old.payment_method, old.subtotal, old.shipping_fee, old.gift_fee, old.cod_fee, old.discount,
      old.total, old.gift_wrap, old.idempotency_key, old.created_at) then
    raise exception 'Siparişin içeriği değiştirilemez.' using errcode = '42501';
  end if;
  if new.order_status <> old.order_status then
    -- Süresi dolan siparişin parası sonradan gelir ve stok yeterse sipariş sürer.
    if not private.order_step_allowed(old.order_status, new.order_status, new.delivery_method)
       and not (old.order_status = 'cancelled' and old.cancel_code = 'expired'
         and new.order_status = 'awaiting_approval' and new.payment_status = 'paid') then
      raise exception 'Sipariş bu duruma geçemez.' using errcode = '22023';
    end if;
    if new.order_status = 'awaiting_approval' and new.payment_status <> 'paid' then
      raise exception 'Ödeme doğrulanmadan onaya geçilemez.' using errcode = '22023';
    end if;
    if new.order_status = 'delivered' and new.delivery_method = 'pickup'
       and new.payment_status <> 'paid' then
      raise exception 'Tahsilat yazılmadan teslim edilemez.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger orders_guard before update on public.orders
for each row execute function private.guard_order();

create function private.forbid_order_delete()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'Sipariş silinemez.' using errcode = '42501';
end;
$$;
create trigger orders_no_delete before delete on public.orders
for each row execute function private.forbid_order_delete();
create trigger orders_no_truncate before truncate on public.orders
for each statement execute function private.forbid_order_delete();

create function private.record_order_status()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_note text := nullif(current_setting('app.order_note', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (order_id, field, to_value, actor_id) values
      (new.id, 'order_status', new.order_status, (select auth.uid())),
      (new.id, 'payment_status', new.payment_status, (select auth.uid()));
    return null;
  end if;
  if new.order_status <> old.order_status then
    insert into public.order_status_history (order_id, field, from_value, to_value, actor_id, note)
    values (new.id, 'order_status', old.order_status, new.order_status, (select auth.uid()), v_note);
    insert into public.outbox_jobs (kind, payload, dedupe_key)
    values ('order_status', jsonb_build_object('order_id', new.id, 'status', new.order_status),
      new.id || ':' || gen_random_uuid());
  end if;
  if new.payment_status <> old.payment_status then
    insert into public.order_status_history (order_id, field, from_value, to_value, actor_id, note)
    values (new.id, 'payment_status', old.payment_status, new.payment_status, (select auth.uid()), v_note);
  end if;
  return null;
end;
$$;
create trigger orders_history after insert or update on public.orders
for each row execute function private.record_order_status();

-- ---------------------------------------------------------------------------
-- Stok: hareket siparişe bağlanır. Öncekinden tek farkı p_order.
-- ---------------------------------------------------------------------------

drop function private.apply_stock(public.inventory, integer, text, text, uuid, uuid);
create function private.apply_stock(
  p_stock public.inventory, p_delta integer, p_reason text, p_note text, p_key uuid,
  p_reverses uuid default null, p_order uuid default null
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_after integer := p_stock.on_hand + p_delta;
begin
  if v_after < p_stock.reserved then
    raise exception 'Stok yetersiz: satılabilir % adet.', p_stock.on_hand - p_stock.reserved
      using errcode = '22023';
  end if;
  if v_after > 1000000 then
    raise exception 'Stok en fazla 1.000.000 olabilir.' using errcode = '22023';
  end if;
  update public.inventory set on_hand = v_after where variant_id = p_stock.variant_id;
  insert into public.stock_movements (
    variant_id, delta, on_hand_after, reason, note, actor_id, idempotency_key, reverses_id, order_id)
  values (p_stock.variant_id, p_delta, v_after, p_reason, p_note, (select auth.uid()), p_key,
    p_reverses, p_order);
  return v_after;
end;
$$;

-- Siparişin ürünlerini ayırır. Yetmezse false döner ve hiçbir şey değişmez.
create function private.reserve_order(p_order uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.inventory where variant_id in (
    select variant_id from public.order_items where order_id = p_order)
  order by variant_id for update;
  if exists (
    select 1 from public.order_items oi join public.inventory i on i.variant_id = oi.variant_id
    where oi.order_id = p_order and i.on_hand - i.reserved < oi.quantity
  ) then
    return false;
  end if;
  update public.inventory i set reserved = i.reserved + oi.quantity
  from public.order_items oi where oi.order_id = p_order and oi.variant_id = i.variant_id;
  insert into public.stock_reservations (order_item_id, variant_id, quantity)
  select id, variant_id, quantity from public.order_items where order_id = p_order
  on conflict (order_item_id) do update set status = 'active';
  return true;
end;
$$;

-- Ayrılan stoğu serbest bırakır; p_sell ise satış olarak düşer.
create function private.close_reservations(p_order uuid, p_sell boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v public.inventory;
begin
  for r in
    select s.order_item_id, s.variant_id, s.quantity
    from public.stock_reservations s join public.order_items oi on oi.id = s.order_item_id
    where oi.order_id = p_order and s.status = 'active' order by s.variant_id
  loop
    perform private.lock_inventory(r.variant_id);
    update public.inventory set reserved = reserved - r.quantity
    where variant_id = r.variant_id returning * into v;
    update public.stock_reservations set status = case when p_sell then 'consumed' else 'released' end
    where order_item_id = r.order_item_id;
    if p_sell then
      perform private.apply_stock(v, -r.quantity, 'sale', null, gen_random_uuid(), null, p_order);
    end if;
  end loop;
end;
$$;

-- Onaydan sonra iptal: satılan ürün geri eklenir.
create function private.restock_order(p_order uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select s.order_item_id, s.variant_id, s.quantity
    from public.stock_reservations s join public.order_items oi on oi.id = s.order_item_id
    where oi.order_id = p_order and s.status = 'consumed' order by s.variant_id
  loop
    perform private.apply_stock(private.lock_inventory(r.variant_id), r.quantity, 'cancel', null,
      gen_random_uuid(), null, p_order);
    update public.stock_reservations set status = 'released' where order_item_id = r.order_item_id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ortak yardımcılar
-- ---------------------------------------------------------------------------

create function private.lock_order(p_order uuid)
returns public.orders
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then
    raise exception 'Sipariş bulunamadı.' using errcode = 'P0002';
  end if;
  return o;
end;
$$;

-- Durum geçmişine yazılacak not; yalnızca bu işlem için geçerlidir.
create function private.set_note(p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if char_length(btrim(p_note)) > 500 then
    raise exception 'Not çok uzun.' using errcode = '22023';
  end if;
  perform set_config('app.order_note', coalesce(btrim(p_note), ''), true);
end;
$$;

-- Hafta sonu ve ayardaki tatiller sayılmaz (Türkiye saatiyle).
create function private.add_business_days(p_from timestamptz, p_days integer)
returns timestamptz
language plpgsql stable security definer set search_path = ''
as $$
declare
  v timestamp := p_from at time zone 'Europe/Istanbul';
  v_left integer := p_days;
begin
  while v_left > 0 loop
    v := v + interval '1 day';
    if extract(isodow from v) < 6 and not (private.setting('holidays') ? to_char(v, 'YYYY-MM-DD')) then
      v_left := v_left - 1;
    end if;
  end loop;
  return v at time zone 'Europe/Istanbul';
end;
$$;

create function private.new_order_no()
returns text
language sql volatile security definer set search_path = ''
as $$
  select 'AB' || string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (get_byte(b, i) % 32) + 1, 1), '')
  from (select sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')) as b) x,
    generate_series(0, 9) i
$$;

create function private.new_order_token(p_order uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.order_access_tokens (token_hash, order_id, expires_at)
  values (private.cart_hash(v_token), p_order,
    now() + make_interval(days => private.setting_int('link_days')::integer));
  return v_token;
end;
$$;

-- İl listesi addresses tablosundaki kuralla aynıdır.
create function private.valid_city(p_city text)
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(p_city in (
    'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Aksaray', 'Amasya', 'Ankara', 'Antalya',
    'Ardahan', 'Artvin', 'Aydın', 'Balıkesir', 'Bartın', 'Batman', 'Bayburt', 'Bilecik', 'Bingöl',
    'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır',
    'Düzce', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun',
    'Gümüşhane', 'Hakkâri', 'Hatay', 'Iğdır', 'Isparta', 'İstanbul', 'İzmir', 'Kahramanmaraş',
    'Karabük', 'Karaman', 'Kars', 'Kastamonu', 'Kayseri', 'Kilis', 'Kırıkkale', 'Kırklareli',
    'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Mardin', 'Mersin', 'Muğla',
    'Muş', 'Nevşehir', 'Niğde', 'Ordu', 'Osmaniye', 'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop',
    'Sivas', 'Şanlıurfa', 'Şırnak', 'Tekirdağ', 'Tokat', 'Trabzon', 'Tunceli', 'Uşak', 'Van',
    'Yalova', 'Yozgat', 'Zonguldak'), false)
$$;

create function private.write_order_address(p_order uuid, p_kind text, p jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.valid_city(p ->> 'city') then
    raise exception 'Adres geçersiz.' using errcode = '22023';
  end if;
  insert into public.order_addresses (order_id, kind, recipient, phone, city, district, line,
    postal_code, company, tax_office, tax_no)
  values (p_order, p_kind, btrim(p ->> 'recipient'), p ->> 'phone', p ->> 'city',
    btrim(p ->> 'district'), btrim(p ->> 'line'), nullif(p ->> 'postal_code', ''),
    case when p_kind = 'invoice' then nullif(btrim(p ->> 'company'), '') end,
    case when p_kind = 'invoice' then nullif(btrim(p ->> 'tax_office'), '') end,
    case when p_kind = 'invoice' then nullif(p ->> 'tax_no', '') end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sipariş verme
-- ---------------------------------------------------------------------------

-- Ödeme sayfasının seçenekleri. Ücretler yalnızca gösterim içindir; tutarı place_order hesaplar.
create function public.checkout_options()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'test_mode', private.setting_on('test_mode'),
    'shipping_fee', private.setting_int('shipping_fee'),
    'free_shipping_from', private.setting_int('free_shipping_from'),
    'gift_fee', private.setting_int('gift_fee'),
    'transfer', (private.setting('bank_iban') #>> '{}') <> '',
    'transfer_days', private.setting_int('transfer_days'),
    'cod', private.setting_on('cod_enabled'),
    'cod_fee', private.setting_int('cod_fee'),
    'cod_limit', private.setting_int('cod_limit'),
    'cod_card', private.setting_on('cod_card'),
    'pickup', private.setting_on('pickup_enabled'),
    'pickup_pay', private.setting_on('pickup_pay'),
    'pickup_days', private.setting_int('pickup_days'),
    'pickup_address', private.setting('pickup_address') #>> '{}',
    'documents', (select jsonb_agg(d order by d ->> 'kind') from (
      select distinct on (kind) jsonb_build_object('id', id, 'kind', kind, 'title', title,
        'body', body, 'is_draft', is_draft) as d
      from public.legal_documents order by kind, version desc) x))
$$;

-- p: key, email, phone, name, delivery, payment, gift, expected_total, documents, address?, invoice?
-- Tutarın tamamı burada hesaplanır; expected_total yalnızca müşterinin gördüğüyle karşılaştırılır.
create function public.place_order(p_token text, p jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_key uuid;
  v_email text;
  v_phone text := p ->> 'phone';
  v_delivery text := p ->> 'delivery';
  v_payment text := p ->> 'payment';
  v_gift boolean;
  v_expected bigint;
  v_cart uuid;
  v_order public.orders;
  v_subtotal bigint;
  v_shipping bigint := 0;
  v_gift_fee bigint := 0;
  v_cod_fee bigint := 0;
  v_total bigint;
  v_docs uuid[];
begin
  if v_user is not null then
    perform private.require_session();
    -- Üyenin e-postası hesabından alınır.
    select lower(email) into v_email from auth.users where id = v_user;
  else
    v_email := lower(btrim(p ->> 'email'));
  end if;
  begin
    v_key := (p ->> 'key')::uuid;
    v_gift := coalesce((p ->> 'gift')::boolean, false);
    v_expected := (p ->> 'expected_total')::bigint;
    select array_agg(x::uuid) into v_docs from jsonb_array_elements_text(p -> 'documents') x;
  exception when others then
    raise exception 'Geçersiz istek.' using errcode = '22023';
  end;
  if v_key is null or v_email is null or v_phone is null or v_delivery is null or v_payment is null
     or v_delivery not in ('shipping', 'pickup') or v_payment not in ('transfer', 'cod', 'store') then
    raise exception 'Geçersiz istek.' using errcode = '22023';
  end if;

  -- Aynı istek, aynı telefon ve aynı e-posta sıraya girer.
  perform pg_advisory_xact_lock(hashtextextended(l.x, 8))
  from (select unnest(array['k' || v_key, 'e' || v_email, 'p' || v_phone]) as x order by 1) l;

  select * into v_order from public.orders where idempotency_key = v_key;
  if found then
    if v_order.user_id is distinct from v_user or v_order.email <> v_email then
      raise exception 'Bu istek başka bir işlemde kullanılmış.' using errcode = '22023';
    end if;
    return jsonb_build_object('order_no', v_order.order_no,
      'token', case when v_user is null then private.new_order_token(v_order.id) end);
  end if;

  if v_delivery = 'pickup' and not private.setting_on('pickup_enabled') then
    raise exception 'Mağazadan teslim şu anda kapalı.' using errcode = '22023';
  end if;
  if v_payment = 'transfer' and (private.setting('bank_iban') #>> '{}') = '' then
    raise exception 'Havale/EFT şu anda kapalı.' using errcode = '22023';
  end if;
  if v_payment = 'store' and (v_delivery <> 'pickup' or not private.setting_on('pickup_pay')) then
    raise exception 'Mağazada ödeme yalnızca mağazadan teslimde kullanılır.' using errcode = '22023';
  end if;
  if v_payment = 'cod' and (v_delivery <> 'shipping' or not private.setting_on('cod_enabled')) then
    raise exception 'Kapıda ödeme kullanılamaz.' using errcode = '22023';
  end if;
  if exists (
    select 1 from (select distinct on (kind) id from public.legal_documents order by kind, version desc) d
    where not coalesce(d.id = any (v_docs), false)
  ) then
    raise exception 'Sözleşmeleri okuyup onaylamanız gerekir.' using errcode = '22023';
  end if;

  -- Sepet kilitlenir: aynı sepetten aynı anda iki sipariş çıkmaz.
  select id into v_cart from public.carts where id = private.find_cart(p_token) for update;
  if v_cart is null or not exists (select 1 from public.cart_items where cart_id = v_cart) then
    raise exception 'Sepetiniz boş.' using errcode = '22023';
  end if;
  perform 1 from public.inventory where variant_id in (
    select variant_id from public.cart_items where cart_id = v_cart) order by variant_id for update;
  if exists (
    select 1 from public.cart_items where cart_id = v_cart
      and coalesce(private.sellable(variant_id), 0) < quantity
  ) then
    raise exception 'Sepetinizdeki bazı ürünler artık yeterli değil. Sepetinizi gözden geçirin.' using errcode = '22023';
  end if;

  select sum(v.price * ci.quantity) into v_subtotal
  from public.cart_items ci join public.product_variants v on v.id = ci.variant_id where ci.cart_id = v_cart;
  if v_delivery = 'shipping' and v_subtotal < private.setting_int('free_shipping_from') then
    v_shipping := private.setting_int('shipping_fee');
  end if;
  if v_gift then v_gift_fee := private.setting_int('gift_fee'); end if;
  if v_payment = 'cod' then v_cod_fee := private.setting_int('cod_fee'); end if;
  v_total := v_subtotal + v_shipping + v_gift_fee + v_cod_fee;
  if v_expected is distinct from v_total then
    raise exception 'Sepet tutarı değişti. Yeni tutarı görüp yeniden onaylayın.' using errcode = '22023';
  end if;
  if v_payment = 'cod' and v_total > private.setting_int('cod_limit') then
    raise exception 'Bu tutar kapıda ödeme sınırını aşıyor.' using errcode = '22023';
  end if;
  if (select count(*) from public.orders o
      where (o.phone = v_phone or o.email = v_email or o.user_id = v_user)
        and o.order_status in ('pending_payment', 'awaiting_approval', 'approved', 'preparing', 'ready_for_pickup')
        and o.payment_status in ('pending', 'review', 'cod_due')) >= private.setting_int('max_unpaid') then
    raise exception 'Ödenmemiş siparişleriniz var. Yenisinden önce onları tamamlayın veya iptal edin.'
      using errcode = '22023';
  end if;

  perform private.set_note(null);
  insert into public.orders (order_no, user_id, contact_name, email, phone, delivery_method, payment_method,
    order_status, payment_status, subtotal, shipping_fee, gift_fee, cod_fee, total, gift_wrap,
    payment_due_at, idempotency_key)
  values (private.new_order_no(), v_user, btrim(p ->> 'name'), v_email, v_phone, v_delivery, v_payment,
    case when v_payment = 'transfer' then 'pending_payment' else 'awaiting_approval' end,
    case when v_payment = 'cod' then 'cod_due' else 'pending' end,
    v_subtotal, v_shipping, v_gift_fee, v_cod_fee, v_total, v_gift,
    case when v_payment = 'transfer'
      then private.add_business_days(now(), private.setting_int('transfer_days')::integer) end, v_key)
  returning * into v_order;

  insert into public.order_items (order_id, variant_id, name, sku, color, size, unit_price, vat_bps, quantity)
  select v_order.id, v.id, pr.name, v.sku, c.name, z.name, v.price, pr.vat_bps, ci.quantity
  from public.cart_items ci
  join public.product_variants v on v.id = ci.variant_id
  join public.products pr on pr.id = v.product_id
  left join public.colors c on c.id = v.color_id
  left join public.sizes z on z.id = v.size_id
  where ci.cart_id = v_cart;

  if v_delivery = 'shipping' then
    perform private.write_order_address(v_order.id, 'delivery', p -> 'address');
  end if;
  perform private.write_order_address(v_order.id, 'invoice',
    coalesce(nullif(p -> 'invoice', 'null'::jsonb), p -> 'address'));

  if not private.reserve_order(v_order.id) then
    raise exception 'Sepetinizdeki bazı ürünler artık yeterli değil. Sepetinizi gözden geçirin.' using errcode = '22023';
  end if;
  insert into public.payments (order_id, provider, amount) values (v_order.id, v_payment, v_total);
  insert into public.order_legal_acceptances (order_id, document_id, rendered_body)
  select v_order.id, d.id, d.title || E'\n\n' || d.body from public.legal_documents d where d.id = any (v_docs);
  insert into public.outbox_jobs (kind, payload, dedupe_key)
  values ('order_placed', jsonb_build_object('order_id', v_order.id), v_order.id || ':placed');
  delete from public.cart_items where cart_id = v_cart;

  return jsonb_build_object('order_no', v_order.order_no,
    'token', case when v_user is null then private.new_order_token(v_order.id) end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Müşterinin siparişi
-- ---------------------------------------------------------------------------

-- Üye kendi siparişini, misafir gizli kodunun siparişini bulur.
create function private.find_order(p_no text, p_token text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select o.id from public.orders o
  where o.order_no = p_no and (
    (o.user_id = (select auth.uid()) and private.is_active_session())
    or exists (select 1 from public.order_access_tokens t
      where t.order_id = o.id and t.token_hash = private.cart_hash(p_token) and t.expires_at > now()))
$$;

create function public.get_order(p_no text, p_token text default null)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'order_no', o.order_no, 'created_at', o.created_at, 'delivery_method', o.delivery_method,
    'payment_method', o.payment_method, 'order_status', o.order_status,
    'payment_status', o.payment_status, 'subtotal', o.subtotal, 'shipping_fee', o.shipping_fee,
    'gift_fee', o.gift_fee, 'cod_fee', o.cod_fee, 'total', o.total, 'gift_wrap', o.gift_wrap,
    'payment_due_at', o.payment_due_at,
    'can_cancel', o.order_status in ('pending_payment', 'awaiting_approval'),
    'bank', case when o.payment_method = 'transfer' and o.order_status = 'pending_payment' then
      jsonb_build_object('holder', private.setting('bank_holder') #>> '{}', 'iban', private.setting('bank_iban') #>> '{}') end,
    'pickup', case when o.delivery_method = 'pickup' then
      jsonb_build_object('address', private.setting('pickup_address') #>> '{}',
        'until', o.ready_at + make_interval(days => private.setting_int('pickup_days')::integer)) end,
    'address', (select jsonb_build_object('recipient', a.recipient, 'phone', a.phone, 'city', a.city,
        'district', a.district, 'line', a.line, 'postal_code', a.postal_code)
      from public.order_addresses a where a.order_id = o.id and a.kind = 'delivery'),
    'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'color', i.color, 'size', i.size,
        'unit_price', i.unit_price, 'quantity', i.quantity) order by i.name, i.sku)
      from public.order_items i where i.order_id = o.id))
  from public.orders o where o.id = private.find_order(p_no, p_token)
$$;

create function public.my_orders(p_page integer default 1)
returns table (order_no text, created_at timestamptz, order_status text, payment_status text, total bigint, pieces bigint)
language sql stable security definer set search_path = ''
as $$
  select o.order_no, o.created_at, o.order_status, o.payment_status, o.total,
    (select sum(i.quantity) from public.order_items i where i.order_id = o.id)
  from public.orders o
  where o.user_id = (select auth.uid()) and (select private.is_active_session())
  order by o.created_at desc, o.id
  limit 21 offset (least(greatest(coalesce(p_page, 1), 1), 10000) - 1) * 20
$$;

-- ---------------------------------------------------------------------------
-- İptal ve süre bitimi
-- ---------------------------------------------------------------------------

-- Sipariş satırı önceden kilitlenmiş olmalıdır.
create function private.cancel_locked(p_order public.orders, p_code text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.close_reservations(p_order.id, false);
  perform private.restock_order(p_order.id);
  update public.payments set status = 'cancelled' where order_id = p_order.id and status = 'pending';
  update public.orders set order_status = 'cancelled', cancel_code = p_code,
    payment_status = case
      -- Bankada görülen para (eksik, fazla veya henüz onaysız) iade bekler.
      when payment_status = 'paid' or exists (
        select 1 from public.bank_transfers t join public.payments y on y.id = t.payment_id
        where y.order_id = p_order.id) then 'refund_pending'
      else 'cancelled' end
  where id = p_order.id;
end;
$$;

create function public.cancel_my_order(p_no text, p_token text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  v_id uuid := private.find_order(p_no, p_token);
begin
  if v_id is null then
    raise exception 'Sipariş bulunamadı.' using errcode = 'P0002';
  end if;
  o := private.lock_order(v_id);
  if o.order_status not in ('pending_payment', 'awaiting_approval') then
    raise exception 'Sipariş artık buradan iptal edilemez. Bizimle iletişime geçin.' using errcode = '22023';
  end if;
  perform private.set_note(null);
  perform private.cancel_locked(o, 'customer');
end;
$$;

create function public.cancel_order(p_order uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
begin
  perform private.require_permission('orders.cancel');
  if nullif(btrim(p_reason), '') is null then
    raise exception 'İptal nedeni zorunludur.' using errcode = '22023';
  end if;
  o := private.lock_order(p_order);
  if not private.order_step_allowed(o.order_status, 'cancelled', o.delivery_method) then
    raise exception 'Sipariş bu durumda iptal edilemez.' using errcode = '22023';
  end if;
  perform private.set_note(p_reason);
  perform private.cancel_locked(o, 'staff');
end;
$$;

-- Zamanlayıcı çağırır. Parası görülmüş veya incelemedeki sipariş kendiliğinden iptal olmaz.
create function private.expire_orders()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  v_count integer := 0;
begin
  perform private.set_note('Ödeme süresi doldu');
  for o in
    select * from public.orders x
    where x.order_status = 'pending_payment' and x.payment_status = 'pending' and x.payment_due_at < now()
      and not exists (select 1 from public.bank_transfers t join public.payments y on y.id = t.payment_id
        where y.order_id = x.id)
    order by x.id limit 100 for update skip locked
  loop
    perform private.cancel_locked(o, 'expired');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
select cron.schedule('siparis-suresi', '*/5 * * * *', 'select private.expire_orders()');

-- ---------------------------------------------------------------------------
-- Havale/EFT
-- ---------------------------------------------------------------------------

-- Bankada görülen hareket siparişle eşleştirilir. Dekont kanıt değildir.
create function public.match_transfer(p_order uuid, p_amount bigint, p_reference text, p_key uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  t public.bank_transfers;
  v_payment uuid;
begin
  perform private.require_permission('transfers.match');
  if p_key is null or p_amount is null or p_amount not between 1 and 100000000000
     or nullif(btrim(p_reference), '') is null or char_length(btrim(p_reference)) > 100 then
    raise exception 'Tutar ve banka işlem numarası zorunludur.' using errcode = '22023';
  end if;
  o := private.lock_order(p_order);
  select id into v_payment from public.payments where order_id = o.id;
  select * into t from public.bank_transfers where idempotency_key = p_key;
  if found then
    if t.payment_id = v_payment and t.amount = p_amount and t.reference = btrim(p_reference)
       and t.matched_by = (select auth.uid()) then
      return t.id;
    end if;
    raise exception 'Bu istek başka bir işlemde kullanılmış.' using errcode = '22023';
  end if;
  if o.payment_method <> 'transfer' or not (o.order_status = 'pending_payment'
     or (o.order_status = 'cancelled' and o.cancel_code = 'expired')) then
    raise exception 'Bu siparişe havale yazılamaz.' using errcode = '22023';
  end if;
  if exists (select 1 from public.bank_transfers where reference = btrim(p_reference)) then
    raise exception 'Bu banka işlemi daha önce kullanılmış.' using errcode = '22023';
  end if;
  insert into public.bank_transfers (payment_id, amount, reference, matched_by, idempotency_key)
  values (v_payment, p_amount, btrim(p_reference), (select auth.uid()), p_key) returning * into t;
  return t.id;
end;
$$;

-- p_accept_over: fazla gelen parayı bilerek kabul eder; fazlası Aşama 11'de iade edilir.
create function public.confirm_transfer(p_transfer uuid, p_accept_over boolean default false)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  t public.bank_transfers;
  v_sum bigint;
  v_order uuid;
  v_status text;
begin
  perform private.require_permission('transfers.confirm');
  select y.order_id into v_order from public.bank_transfers x
  join public.payments y on y.id = x.payment_id where x.id = p_transfer;
  if v_order is null then
    raise exception 'Havale bulunamadı.' using errcode = 'P0002';
  end if;
  o := private.lock_order(v_order);
  select * into t from public.bank_transfers where id = p_transfer for update;
  if private.setting_on('transfer_two_person') and t.matched_by = (select auth.uid()) then
    raise exception 'Eşleştiren kişi onaylayamaz.' using errcode = '42501';
  end if;
  if not (o.order_status = 'pending_payment' or (o.order_status = 'cancelled' and o.cancel_code = 'expired')) then
    -- Aynı onay yeniden geldiyse ikinci kez işlenmez.
    if t.confirmed_at is not null then return o.payment_status; end if;
    raise exception 'Bu siparişin havalesi onaylanamaz.' using errcode = '22023';
  end if;
  if t.confirmed_at is null then
    update public.bank_transfers set confirmed_by = (select auth.uid()), confirmed_at = now() where id = t.id;
  end if;
  select sum(x.amount) into v_sum from public.bank_transfers x
  where x.payment_id = t.payment_id and x.confirmed_at is not null;
  perform private.set_note(null);

  if (v_sum = o.total or (v_sum > o.total and p_accept_over is true))
     and (o.order_status = 'pending_payment' or private.reserve_order(o.id)) then
    update public.payments set status = 'paid', paid_at = now() where id = t.payment_id;
    update public.orders set payment_status = 'paid', order_status = 'awaiting_approval', cancel_code = null
    where id = o.id;
    return 'paid';
  end if;
  v_status := case when o.order_status = 'cancelled' then 'refund_pending' else 'review' end;
  update public.orders set payment_status = v_status where id = o.id;
  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Personel işlemleri
-- ---------------------------------------------------------------------------

create function public.verify_order_phone(p_order uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
begin
  perform private.require_permission('orders.note');
  o := private.lock_order(p_order);
  if o.phone_verified_at is not null then return; end if;
  if o.order_status not in ('pending_payment', 'awaiting_approval') then
    raise exception 'Bu durumda telefon doğrulanmaz.' using errcode = '22023';
  end if;
  update public.orders set phone_verified_by = (select auth.uid()), phone_verified_at = now() where id = o.id;
  insert into public.order_status_history (order_id, field, to_value, actor_id)
  values (o.id, 'phone', 'verified', (select auth.uid()));
end;
$$;

create function public.add_order_note(p_order uuid, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_permission('orders.note');
  if nullif(btrim(p_note), '') is null or char_length(btrim(p_note)) > 500 then
    raise exception 'Not 1 ile 500 karakter arasında olmalı.' using errcode = '22023';
  end if;
  perform private.lock_order(p_order);
  insert into public.order_status_history (order_id, field, actor_id, note)
  values (p_order, 'note', (select auth.uid()), btrim(p_note));
end;
$$;

-- Onayı engelleyen veya ayrıca bakılması gereken durumlar.
create function private.order_flags(o public.orders)
returns text[]
language sql stable security definer set search_path = ''
as $$
  select array_remove(array[
    case when o.payment_method = 'cod' and o.phone_verified_at is null
      and private.setting_on('phone_check') then 'phone' end,
    case when o.payment_method = 'cod' and o.total > private.setting_int('cod_limit') then 'cod_limit' end,
    case when o.payment_method = 'transfer' and o.total is distinct from (
      select sum(t.amount) from public.bank_transfers t join public.payments y on y.id = t.payment_id
      where y.order_id = o.id and t.confirmed_at is not null) then 'amount' end,
    case when exists (select 1 from public.order_items i where i.order_id = o.id
      and not exists (select 1 from public.stock_reservations s
        where s.order_item_id = i.id and s.status = 'active')) then 'stock' end
  ], null)
$$;

-- p_bulk: toplu onay; işaretli sipariş reddedilir. Tek tek onayda telefon ve stok yine zorunludur.
create function public.approve_order(p_order uuid, p_bulk boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  v_flags text[];
begin
  perform private.require_permission('orders.approve');
  o := private.lock_order(p_order);
  if o.order_status <> 'awaiting_approval' then
    raise exception 'Sipariş onay beklemiyor.' using errcode = '22023';
  end if;
  v_flags := private.order_flags(o);
  if 'phone' = any (v_flags) then
    raise exception 'Önce telefonu doğrulayın.' using errcode = '22023';
  end if;
  if 'stock' = any (v_flags) then
    raise exception 'Siparişin ayrılmış stoğu yok.' using errcode = '22023';
  end if;
  if p_bulk is not false and cardinality(v_flags) > 0 then
    raise exception 'Bu sipariş tek tek incelenmelidir.' using errcode = '22023';
  end if;
  perform private.set_note(null);
  perform private.close_reservations(o.id, true);
  update public.orders set order_status = 'approved', approved_by = (select auth.uid()), approved_at = now()
  where id = o.id;
end;
$$;

-- Onaydan sonraki adımlar. Kargo takibi Aşama 10'da eklenir.
create function public.advance_order(p_order uuid, p_to text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
begin
  if p_to is null or p_to not in ('preparing', 'ready_for_pickup', 'shipped', 'delivered', 'returned_to_sender') then
    raise exception 'Geçersiz durum.' using errcode = '22023';
  end if;
  perform private.require_permission(case when p_to = 'preparing' then 'orders.approve' else 'shipping.write' end);
  o := private.lock_order(p_order);
  if o.order_status = p_to then return; end if;
  perform private.set_note(null);
  update public.orders set order_status = p_to,
    ready_at = case when p_to = 'ready_for_pickup' then now() else ready_at end
  where id = o.id;
end;
$$;

-- Mağazadaki tahsilat. Kart mağaza POS'undan geçer; sisteme kart bilgisi girilmez.
create function public.collect_store_payment(p_order uuid, p_as text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
begin
  perform private.require_permission('orders.approve');
  if p_as is null or p_as not in ('cash', 'card') then
    raise exception 'Geçersiz tahsilat türü.' using errcode = '22023';
  end if;
  o := private.lock_order(p_order);
  if o.payment_method <> 'store' or o.order_status <> 'ready_for_pickup' or o.payment_status <> 'pending' then
    raise exception 'Bu siparişten tahsilat yapılamaz.' using errcode = '22023';
  end if;
  perform private.set_note(case p_as when 'cash' then 'Mağazada nakit' else 'Mağazada kart (POS)' end);
  update public.payments set status = 'paid', paid_at = now(), collected_as = p_as,
    collected_by = (select auth.uid()) where order_id = o.id;
  update public.orders set payment_status = 'paid' where id = o.id;
end;
$$;

-- Panel listesi. 26. kayıt "sonraki sayfa var" bilgisidir.
create function public.list_orders(p_status text default null, p_query text default null, p_page integer default 1)
returns table (id uuid, order_no text, created_at timestamptz, contact_name text, order_status text,
  payment_status text, payment_method text, delivery_method text, total bigint, flags text[], overdue boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_permission('orders.read');
  return query
  select o.id, o.order_no, o.created_at, o.contact_name, o.order_status, o.payment_status,
    o.payment_method, o.delivery_method, o.total,
    case when o.order_status = 'awaiting_approval' then private.order_flags(o) else '{}'::text[] end,
    coalesce(o.order_status = 'ready_for_pickup'
      and o.ready_at + make_interval(days => private.setting_int('pickup_days')::integer) < now(), false)
  from public.orders o
  where (p_status is null or o.order_status = p_status)
    and (nullif(btrim(p_query), '') is null
      or o.order_no = upper(btrim(p_query)) or o.phone = btrim(p_query) or o.email = lower(btrim(p_query))
      or strpos(private.fold_tr(o.contact_name), private.fold_tr(btrim(p_query))) > 0)
  order by o.created_at desc, o.id
  limit 26 offset (least(greatest(coalesce(p_page, 1), 1), 10000) - 1) * 25;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ayar değiştirme (yalnızca Super Admin)
-- ---------------------------------------------------------------------------

-- TR IBAN: biçim ve sağlama (mod 97).
create function private.valid_iban(p text)
returns boolean
language sql immutable set search_path = ''
as $$
  select case when p ~ '^TR[0-9]{24}$'
    then (substr(p, 5) || '2927' || substr(p, 3, 2))::numeric % 97 = 1 else false end
$$;

create function private.valid_setting(p_key text, p jsonb)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  t text := p #>> '{}';
  k text := jsonb_typeof(p);
  n bigint := case when k = 'number' and t ~ '^[0-9]{1,12}$' then t::bigint end;
begin
  if p_key in ('test_mode', 'transfer_two_person', 'cod_enabled', 'cod_card', 'phone_check', 'pickup_enabled', 'pickup_pay') then
    return coalesce(k = 'boolean', false);
  elsif p_key in ('shipping_fee', 'free_shipping_from', 'gift_fee', 'cod_fee', 'cod_limit') then
    return coalesce(n between 0 and 100000000, false);
  elsif p_key in ('shipping_vat_bps', 'gift_vat_bps', 'cod_vat_bps') then
    return coalesce(k = 'null' or n between 0 and 10000, false);
  elsif p_key in ('transfer_days', 'pickup_days') then
    return coalesce(n between 1 and 30, false);
  elsif p_key = 'max_unpaid' then
    return coalesce(n between 1 and 20, false);
  elsif p_key = 'link_days' then
    return coalesce(n between 1 and 365, false);
  elsif p_key in ('bank_holder', 'pickup_address') then
    return coalesce(k = 'string' and char_length(t) <= 200, false);
  elsif p_key = 'bank_iban' then
    return coalesce(k = 'string' and (t = '' or private.valid_iban(t)), false);
  elsif p_key = 'holidays' then
    if k is distinct from 'array' then return false; end if;
    return jsonb_array_length(p) <= 60 and not exists (
      select 1 from jsonb_array_elements(p) d
      where jsonb_typeof(d) <> 'string' or (d #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or not pg_input_is_valid(d #>> '{}', 'date'));
  end if;
  return false;
end;
$$;

create function public.set_settings(p jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_old jsonb;
begin
  perform private.require_permission('settings.critical');
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Geçersiz ayar.' using errcode = '22023';
  end if;
  perform 1 from public.settings order by key for update;
  for r in select e.key, e.value from jsonb_each(p) e order by e.key loop
    if not private.valid_setting(r.key, r.value) then
      raise exception 'Geçersiz ayar: %', r.key using errcode = '22023';
    end if;
    select s.value into v_old from public.settings s where s.key = r.key;
    if v_old is distinct from r.value then
      update public.settings set value = r.value, updated_by = (select auth.uid()), updated_at = now()
      where key = r.key;
      perform private.write_audit('settings.update', 'settings', null,
        jsonb_build_object(r.key, v_old), jsonb_build_object(r.key, r.value));
    end if;
  end loop;
  if private.setting_on('cod_enabled') and private.setting_int('cod_limit') = 0 then
    raise exception 'Kapıda ödeme için önce sınır girin.' using errcode = '22023';
  end if;
  if (private.setting('bank_iban') #>> '{}') <> '' and btrim(private.setting('bank_holder') #>> '{}') = '' then
    raise exception 'IBAN için hesap sahibini de girin.' using errcode = '22023';
  end if;
  if private.setting_on('pickup_enabled') and btrim(private.setting('pickup_address') #>> '{}') = '' then
    raise exception 'Mağazadan teslim için adres girin.' using errcode = '22023';
  end if;
  if not private.setting_on('test_mode') and (
    exists (select 1 from (select distinct on (kind) is_draft from public.legal_documents
      order by kind, version desc) d where d.is_draft)
    or exists (select 1 from public.settings where key in ('shipping_vat_bps', 'gift_vat_bps', 'cod_vat_bps')
      and value = 'null'::jsonb)
  ) then
    raise exception 'Deneme modu, hukuki metinler ve KDV oranları tamamlanmadan kapatılamaz.' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Erişim izinleri
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['settings', 'orders', 'order_items', 'order_addresses', 'order_status_history',
    'order_access_tokens', 'stock_reservations', 'payments', 'bank_transfers', 'legal_documents',
    'order_legal_acceptances', 'outbox_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;
revoke all on sequence public.order_status_history_seq_seq from public, anon, authenticated, service_role;

-- Personel okur; müşteri yalnızca get_order ve my_orders kullanır. Gizli kodları kimse okuyamaz.
grant select on public.orders, public.order_items, public.order_addresses, public.order_status_history,
  public.stock_reservations, public.payments, public.bank_transfers, public.order_legal_acceptances,
  public.settings to authenticated;
create policy "personel sipariş okur" on public.orders for select to authenticated
using ((select private.has_permission('orders.read')));
create policy "personel satır okur" on public.order_items for select to authenticated
using ((select private.has_permission('orders.read')));
create policy "personel adres okur" on public.order_addresses for select to authenticated
using ((select private.has_permission('orders.read')));
create policy "personel geçmiş okur" on public.order_status_history for select to authenticated
using ((select private.has_permission('orders.read')));
create policy "personel ayırma okur" on public.stock_reservations for select to authenticated
using ((select private.has_permission('orders.read')));
create policy "personel ödeme okur" on public.payments for select to authenticated
using ((select private.has_permission('orders.read')));
create policy "personel havale okur" on public.bank_transfers for select to authenticated
using ((select private.has_permission('orders.read')));
create policy "personel onay okur" on public.order_legal_acceptances for select to authenticated
using ((select private.has_permission('orders.read')));
create policy "yönetici ayar okur" on public.settings for select to authenticated
using ((select private.has_permission('settings.critical')));

revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.is_active_session(), private.has_permission(text),
  private.fold_tr(text) to authenticated;

revoke all on function
  public.checkout_options(), public.place_order(text, jsonb), public.get_order(text, text),
  public.cancel_my_order(text, text), public.my_orders(integer), public.cancel_order(uuid, text),
  public.match_transfer(uuid, bigint, text, uuid), public.confirm_transfer(uuid, boolean),
  public.verify_order_phone(uuid), public.add_order_note(uuid, text), public.approve_order(uuid, boolean),
  public.advance_order(uuid, text), public.collect_store_payment(uuid, text),
  public.list_orders(text, text, integer), public.set_settings(jsonb)
from public, anon, authenticated, service_role;
grant execute on function
  public.checkout_options(), public.place_order(text, jsonb), public.get_order(text, text),
  public.cancel_my_order(text, text)
to anon, authenticated;
grant execute on function
  public.my_orders(integer), public.cancel_order(uuid, text),
  public.match_transfer(uuid, bigint, text, uuid), public.confirm_transfer(uuid, boolean),
  public.verify_order_phone(uuid), public.add_order_note(uuid, text), public.approve_order(uuid, boolean),
  public.advance_order(uuid, text), public.collect_store_payment(uuid, text),
  public.list_orders(text, text, integer), public.set_settings(jsonb)
to authenticated;
