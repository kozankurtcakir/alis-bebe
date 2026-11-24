-- Aşama 4: stok. Kurallar: docs/kurallar.md (3. Stok) ve docs/veritabani.md.
-- Stok yalnızca aşağıdaki fonksiyonlarla değişir. Sipariş rezervasyonları Aşama 8'de eklenir.

create table public.inventory (
  variant_id uuid primary key references public.product_variants (id) on delete restrict,
  on_hand integer not null default 0 check (on_hand <= 1000000),
  reserved integer not null default 0,
  critical_level integer not null default 3 check (critical_level between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (0 <= reserved and reserved <= on_hand)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  -- Satır kilidi altında verilir; bir varyantın hareketlerini kesin sıraya koyar.
  seq bigint generated always as identity unique,
  variant_id uuid not null references public.inventory (variant_id) on delete restrict,
  delta integer not null check (delta <> 0),
  on_hand_after integer not null check (on_hand_after >= 0),
  reason text not null check (reason in (
    'initial', 'purchase', 'adjustment', 'sale', 'cancel', 'return', 'damage', 'import', 'reversal')),
  note text check (char_length(note) <= 500),
  actor_id uuid references public.profiles (id) on delete restrict,
  idempotency_key uuid not null unique,
  -- Her hareket en fazla bir kez ters çevrilir.
  reverses_id uuid unique references public.stock_movements (id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((reason = 'reversal') = (reverses_id is not null))
);
create index on public.stock_movements (variant_id, seq desc);
create index on public.stock_movements (actor_id);
-- İlk stok yalnızca bir kez girilir.
create unique index stock_movements_one_initial on public.stock_movements (variant_id)
where reason = 'initial';

create trigger inventory_touch before update on public.inventory
for each row execute function private.touch_updated_at();
create trigger stock_movements_append_only before update or delete on public.stock_movements
for each row execute function private.forbid_change();
create trigger stock_movements_no_truncate before truncate on public.stock_movements
for each statement execute function private.forbid_change();

-- Her varyant 0 stokla başlar.
create function private.create_inventory()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.inventory (variant_id) values (new.id);
  return null;
end;
$$;
create trigger variants_inventory after insert on public.product_variants
for each row execute function private.create_inventory();
insert into public.inventory (variant_id) select id from public.product_variants;

-- ---------------------------------------------------------------------------
-- Stok değiştirme
-- ---------------------------------------------------------------------------

create function private.lock_inventory(p_variant uuid)
returns public.inventory
language plpgsql security definer set search_path = ''
as $$
declare
  v public.inventory;
begin
  select * into v from public.inventory where variant_id = p_variant for update;
  if not found then
    raise exception 'Varyant bulunamadı.' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

-- Stoğu ve hareketi birlikte yazan tek yer. Satır önceden kilitlenmiş olmalıdır.
create function private.apply_stock(
  p_stock public.inventory, p_delta integer, p_reason text, p_note text, p_key uuid,
  p_reverses uuid default null
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
    variant_id, delta, on_hand_after, reason, note, actor_id, idempotency_key, reverses_id)
  values (p_stock.variant_id, p_delta, v_after, p_reason, p_note, (select auth.uid()), p_key, p_reverses);
  return v_after;
end;
$$;

-- p_quantity: giriş ve hasarda adet, sayımda (adjustment) rafta bulunan toplam.
-- p_expected: sayım başlarken görülen stok; arada değiştiyse kayıt reddedilir.
create function public.adjust_stock(
  p_variant uuid, p_reason text, p_quantity integer, p_note text, p_key uuid,
  p_expected integer default null
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v public.inventory;
  m public.stock_movements;
  v_note text := nullif(btrim(p_note), '');
begin
  perform private.require_permission('stock.adjust');
  if p_reason is null or p_reason not in ('initial', 'purchase', 'damage', 'adjustment') then
    raise exception 'Geçersiz stok işlemi.' using errcode = '22023';
  end if;
  if p_key is null or p_quantity is null or p_quantity > 100000
     or p_quantity < (case when p_reason = 'adjustment' then 0 else 1 end)
     or (p_reason = 'adjustment' and p_expected is null) then
    raise exception 'Geçersiz miktar.' using errcode = '22023';
  end if;
  if p_reason in ('damage', 'adjustment') and v_note is null then
    raise exception 'Bu işlem için not zorunludur.' using errcode = '22023';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'Not çok uzun.' using errcode = '22023';
  end if;

  v := private.lock_inventory(p_variant);

  -- Aynı istek yeniden geldiyse ikinci kez işlenmez.
  select * into m from public.stock_movements where idempotency_key = p_key;
  if found then
    if m.variant_id = p_variant and m.reason = p_reason
       and m.actor_id = (select auth.uid())
       and (case p_reason
         when 'adjustment' then m.on_hand_after = p_quantity
         when 'damage' then m.delta = -p_quantity
         else m.delta = p_quantity
       end) then
      return m.on_hand_after;
    end if;
    raise exception 'Bu istek başka bir işlemde kullanılmış.' using errcode = '22023';
  end if;

  if p_reason = 'initial' and exists (
    select 1 from public.stock_movements where variant_id = p_variant
  ) then
    raise exception 'İlk stok zaten girilmiş; mal girişi veya sayım kullanın.' using errcode = '22023';
  end if;
  if p_reason = 'adjustment' then
    if v.on_hand <> p_expected then
      raise exception 'Stok bu sırada değişti (şimdi %). Rafı yeniden sayın.', v.on_hand
        using errcode = '22023';
    end if;
    if v.on_hand = p_quantity then
      return v.on_hand;
    end if;
    return private.apply_stock(v, p_quantity - v.on_hand, p_reason, v_note, p_key);
  end if;
  return private.apply_stock(
    v, case when p_reason = 'damage' then -p_quantity else p_quantity end, p_reason, v_note, p_key);
end;
$$;

-- Hatalı kayıt silinmez; karşı hareketle düzeltilir. Sipariş hareketleri buradan çevrilmez.
create function public.reverse_stock_movement(p_movement uuid, p_note text, p_key uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  m public.stock_movements;
  v public.inventory;
  r public.stock_movements;
  v_note text := nullif(btrim(p_note), '');
begin
  perform private.require_permission('stock.adjust');
  if p_key is null then
    raise exception 'Geçersiz istek.' using errcode = '22023';
  end if;
  if v_note is null or char_length(v_note) > 500 then
    raise exception 'Ters kayıt için en fazla 500 karakterlik not zorunludur.' using errcode = '22023';
  end if;
  select * into m from public.stock_movements where id = p_movement;
  if not found then
    raise exception 'Hareket bulunamadı.' using errcode = 'P0002';
  end if;
  if m.reason not in ('initial', 'purchase', 'damage', 'adjustment') then
    raise exception 'Bu hareket ters çevrilemez.' using errcode = '22023';
  end if;

  v := private.lock_inventory(m.variant_id);
  select * into r from public.stock_movements where reverses_id = p_movement;
  if found then
    if r.idempotency_key = p_key and r.actor_id = (select auth.uid()) then
      return r.on_hand_after;
    end if;
    raise exception 'Bu hareket zaten ters çevrilmiş.' using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_movements where idempotency_key = p_key) then
    raise exception 'Bu istek başka bir işlemde kullanılmış.' using errcode = '22023';
  end if;
  return private.apply_stock(v, -m.delta, 'reversal', v_note, p_key, m.id);
end;
$$;

create function public.set_critical_level(p_variant uuid, p_level integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.inventory;
begin
  perform private.require_permission('stock.adjust');
  if p_level is null or p_level not between 0 and 10000 then
    raise exception 'Kritik seviye 0 ile 10.000 arasında olmalıdır.' using errcode = '22023';
  end if;
  v := private.lock_inventory(p_variant);
  if v.critical_level = p_level then
    return;
  end if;
  update public.inventory set critical_level = p_level where variant_id = p_variant;
  -- Varyant kaydı olarak yazılır; işlem geçmişi SKU'yu gösterir.
  perform private.write_audit('stock.critical_level', 'product_variants', p_variant,
    jsonb_build_object('critical_level', v.critical_level),
    jsonb_build_object('critical_level', p_level));
end;
$$;

-- ---------------------------------------------------------------------------
-- Okuma
-- ---------------------------------------------------------------------------

-- Uyarılar yalnızca satılabilecek varyantlar içindir (aktif ve arşivde değil).
-- Çağıranın yetkisiyle çalışır; RLS geçerlidir. 51. kayıt "sonraki sayfa var" bilgisidir.
create function public.list_stock(p_query text, p_state text, p_page integer)
returns table (
  variant_id uuid, product_name text, color text, size text, sku text,
  on_hand integer, reserved integer, available integer, critical_level integer,
  is_sellable boolean
)
language sql stable security invoker set search_path = ''
as $$
  with q as (
    select replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') as text
  )
  select i.variant_id, p.name, c.name, s.name, v.sku,
    i.on_hand, i.reserved, i.on_hand - i.reserved, i.critical_level,
    v.is_active and p.status <> 'archived'
  from q
  cross join public.inventory i
  join public.product_variants v on v.id = i.variant_id
  join public.products p on p.id = v.product_id
  left join public.colors c on c.id = v.color_id
  left join public.sizes s on s.id = v.size_id
  where (q.text = '' or p.name ilike '%' || q.text || '%' or v.sku ilike q.text || '%'
      or v.barcode = btrim(p_query))
    and case p_state
      when 'out' then v.is_active and p.status <> 'archived' and i.on_hand = i.reserved
      when 'critical' then v.is_active and p.status <> 'archived'
        and i.on_hand > i.reserved and i.on_hand - i.reserved <= i.critical_level
      else true
    end
  order by p.name, p.id, c.name, s.sort_order, v.sku
  limit 51
  offset (least(greatest(coalesce(p_page, 1), 1), 10000) - 1) * 50;
$$;

create function public.stock_summary()
returns table (critical bigint, out_of_stock bigint)
language sql stable security invoker set search_path = ''
as $$
  select
    count(*) filter (where i.on_hand > i.reserved and i.on_hand - i.reserved <= i.critical_level),
    count(*) filter (where i.on_hand = i.reserved)
  from public.inventory i
  join public.product_variants v on v.id = i.variant_id
  join public.products p on p.id = v.product_id
  where v.is_active and p.status <> 'archived';
$$;

-- Hareketi yapan kişinin yalnızca adını gösterir.
create function public.list_stock_movements(p_variant uuid, p_page integer default 1)
returns table (
  id uuid, created_at timestamptz, delta integer, on_hand_after integer, reason text,
  note text, actor_name text, is_reversed boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_permission('stock.read');
  return query
    select m.id, m.created_at, m.delta, m.on_hand_after, m.reason, m.note, a.full_name,
      exists (select 1 from public.stock_movements r where r.reverses_id = m.id)
    from public.stock_movements m
    left join public.profiles a on a.id = m.actor_id
    where m.variant_id = p_variant
    order by m.seq desc
    limit 51
    offset (least(greatest(coalesce(p_page, 1), 1), 10000) - 1) * 50;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS ve erişim izinleri
-- ---------------------------------------------------------------------------

alter table public.inventory enable row level security;
alter table public.stock_movements enable row level security;
revoke all on public.inventory, public.stock_movements from public, anon, authenticated, service_role;
grant select on public.inventory, public.stock_movements to authenticated;
create policy "stok okur" on public.inventory for select to authenticated
using ((select private.has_permission('stock.read')));
create policy "stok hareketi okur" on public.stock_movements for select to authenticated
using ((select private.has_permission('stock.read')));

revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.is_active_session(), private.has_permission(text) to authenticated;

revoke all on function
  public.adjust_stock(uuid, text, integer, text, uuid, integer),
  public.reverse_stock_movement(uuid, text, uuid),
  public.set_critical_level(uuid, integer),
  public.list_stock(text, text, integer),
  public.stock_summary(),
  public.list_stock_movements(uuid, integer)
from public, anon, authenticated, service_role;
grant execute on function
  public.adjust_stock(uuid, text, integer, text, uuid, integer),
  public.reverse_stock_movement(uuid, text, uuid),
  public.set_critical_level(uuid, integer),
  public.list_stock(text, text, integer),
  public.stock_summary(),
  public.list_stock_movements(uuid, integer)
to authenticated;
