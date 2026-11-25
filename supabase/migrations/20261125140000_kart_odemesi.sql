-- Aşama 9: kart ödemesi. Kart numarası ve CVV hiçbir yerde tutulmaz; sağlayıcının bildirimi
-- ham hâliyle saklanmaz. Kurallar: docs/kurallar.md bölüm 4.

insert into public.settings (key, value) values
  ('card_enabled', 'false'),
  ('card_minutes', '30'),
  -- Son ikisi panelden değişmez; gerçek sağlayıcı seçilince migration ile değişir.
  ('card_provider', '"fake"'),
  ('card_max_installments', '1');

-- ---------------------------------------------------------------------------
-- Sipariş tablosu: kart yöntemi ve "reddedildi" durumu
-- ---------------------------------------------------------------------------

-- Adı otomatik verilmiş dört kural, yeni değerlerle yeniden kurulur.
do $$
declare
  c record;
  v_count integer := 0;
begin
  for c in
    select conname, conrelid::regclass as t from pg_constraint
    where contype = 'c' and (
      (conrelid = 'public.orders'::regclass and (
        pg_get_constraintdef(oid) like '%payment_method = ANY%'
        or pg_get_constraintdef(oid) like '%payment_status = ANY%'
        or pg_get_constraintdef(oid) like '%payment_due_at%'))
      or (conrelid = 'public.payments'::regclass and pg_get_constraintdef(oid) like '%provider = ANY%'))
  loop
    execute format('alter table %s drop constraint %I', c.t, c.conname);
    v_count := v_count + 1;
  end loop;
  if v_count <> 4 then
    raise exception 'Beklenen 4 kural, bulunan %', v_count;
  end if;
end $$;
alter table public.orders
  add constraint orders_payment_method_check check (payment_method in ('transfer', 'cod', 'store', 'card')),
  add constraint orders_payment_status_check check (payment_status in (
    'pending', 'review', 'failed', 'paid', 'cancelled', 'cod_due', 'cod_collected',
    'refund_pending', 'partially_refunded', 'refunded')),
  add constraint orders_payment_due_check
    check ((payment_method in ('transfer', 'card')) = (payment_due_at is not null));
alter table public.payments
  add constraint payments_provider_check check (provider in ('transfer', 'cod', 'store', 'card'));

-- ---------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------

-- Her kart denemesi. review: tutar farklı geldi. refund_due: para geldi ama sipariş kullanamaz.
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,
  provider text not null check (char_length(provider) between 1 and 20),
  provider_ref text check (char_length(provider_ref) between 1 and 200),
  page_url text check (char_length(page_url) <= 2000),
  amount bigint not null check (amount > 0),
  paid_amount bigint check (paid_amount >= 0),
  installments integer not null default 1 check (installments between 1 and 12),
  status text not null default 'started' check (status in ('started', 'failed', 'paid', 'review', 'refund_due')),
  error_code text check (char_length(error_code) <= 50),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index on public.payment_attempts (payment_id);
create index on public.payment_attempts (created_at) where status = 'started';
create trigger payment_attempts_touch before update on public.payment_attempts
for each row execute function private.touch_updated_at();

-- Sağlayıcının bildirdiği olaylar; yalnızca ekleme. Ham içerik bilerek yoktur.
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null check (char_length(event_id) between 1 and 200),
  attempt_id uuid not null references public.payment_attempts (id) on delete restrict,
  status text not null check (status in ('paid', 'failed')),
  amount bigint,
  currency text check (char_length(currency) <= 10),
  result text not null check (result in ('paid', 'failed', 'review', 'refund_due', 'ignored')),
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);
create index on public.payment_events (attempt_id);
create trigger payment_events_append_only before update or delete on public.payment_events
for each row execute function private.forbid_change();
create trigger payment_events_no_truncate before truncate on public.payment_events
for each statement execute function private.forbid_change();

alter table public.payment_attempts enable row level security;
alter table public.payment_events enable row level security;
-- Kimse doğrudan okuyamaz ve yazamaz; personel order_detail ile görür.
revoke all on public.payment_attempts, public.payment_events from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Yardımcılar
-- ---------------------------------------------------------------------------

-- Sahte sağlayıcı yalnızca deneme modunda kullanılabilir.
create function private.card_open()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.setting_on('card_enabled')
    and ((private.setting('card_provider') #>> '{}') <> 'fake' or private.setting_on('test_mode'))
$$;

-- İade edilmesi gereken para var mı? Sipariş iptal olmadan da olabilir (iki kez ödeme).
create function private.needs_refund(o public.orders)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select o.payment_status = 'refund_pending' or exists (
    select 1 from public.payment_attempts a join public.payments y on y.id = a.payment_id
    where y.order_id = o.id
      and (a.status = 'refund_due' or (a.status = 'review' and o.order_status <> 'pending_payment')))
$$;

-- ---------------------------------------------------------------------------
-- Ödeme başlatma (müşteri)
-- ---------------------------------------------------------------------------

-- Açık deneme varsa o döner: çift tıklama ikinci ödeme üretmez.
create function public.begin_card_payment(p_no text, p_token text default null, p_installments integer default 1)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  a public.payment_attempts;
  v_payment uuid;
  v_provider text := private.setting('card_provider') #>> '{}';
  v_id uuid := private.find_order(p_no, p_token);
begin
  if v_id is null then
    raise exception 'Sipariş bulunamadı.' using errcode = 'P0002';
  end if;
  if not private.card_open() then
    raise exception 'Kart ödemesi şu anda kapalı.' using errcode = '22023';
  end if;
  if p_installments is null or p_installments not between 1 and private.setting_int('card_max_installments') then
    raise exception 'Bu taksit seçeneği kullanılamaz.' using errcode = '22023';
  end if;
  o := private.lock_order(v_id);
  if o.payment_method <> 'card' or o.order_status <> 'pending_payment'
     or o.payment_status not in ('pending', 'failed') or o.payment_due_at <= now() then
    raise exception 'Bu sipariş için kart ödemesi başlatılamaz.' using errcode = '22023';
  end if;
  select id into v_payment from public.payments where order_id = o.id;
  select * into a from public.payment_attempts x
  where x.payment_id = v_payment and x.status = 'started' and x.installments = p_installments
    and x.provider = v_provider
  order by x.created_at desc, x.id limit 1;
  if not found then
    if (select count(*) from public.payment_attempts where payment_id = v_payment) >= 10 then
      raise exception 'Çok fazla deneme yapıldı. Bizimle iletişime geçin.' using errcode = '22023';
    end if;
    insert into public.payment_attempts (payment_id, provider, amount, installments)
    values (v_payment, v_provider, o.total, p_installments) returning * into a;
    if o.payment_status = 'failed' then
      perform private.set_note(null);
      update public.orders set payment_status = 'pending' where id = o.id;
    end if;
  end if;
  return jsonb_build_object('attempt', a.id, 'provider', a.provider, 'amount', a.amount,
    'installments', a.installments, 'url', a.page_url, 'order_no', o.order_no);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sunucu (service_role): sağlayıcının numarası, bildirimi ve sorgu sırası
-- ---------------------------------------------------------------------------

-- İlk yazan geçerlidir; geçerli sayfa adresi döner.
create function public.attach_card_attempt(p_attempt uuid, p_ref text, p_url text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
begin
  update public.payment_attempts set provider_ref = p_ref, page_url = p_url
  where id = p_attempt and page_url is null and (provider_ref is null or provider_ref = p_ref);
  select page_url into v_url from public.payment_attempts where id = p_attempt;
  return v_url;
end;
$$;

-- Paranın geldiğine yalnızca burada karar verilir. İmzayı sunucu önceden doğrulamış olmalıdır.
-- Aynı olay yeniden gelirse "duplicate" döner ve hiçbir şey değişmez.
create function public.record_card_event(
  p_provider text, p_event text, p_attempt uuid, p_ref text, p_status text,
  p_amount bigint, p_currency text, p_code text default null
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
  a public.payment_attempts;
  e public.payment_events;
  v_order uuid;
  v_result text;
begin
  if p_event is null or p_ref is null or p_status is null or p_status not in ('paid', 'failed') then
    raise exception 'Geçersiz bildirim.' using errcode = '22023';
  end if;
  select y.order_id into v_order from public.payment_attempts x
  join public.payments y on y.id = x.payment_id where x.id = p_attempt and x.provider = p_provider;
  if v_order is null then
    raise exception 'Ödeme denemesi bulunamadı.' using errcode = 'P0002';
  end if;
  o := private.lock_order(v_order);
  select * into a from public.payment_attempts where id = p_attempt for update;
  if a.provider_ref <> p_ref then
    raise exception 'Bildirim bu denemeye ait değil.' using errcode = '22023';
  end if;
  select * into e from public.payment_events where provider = p_provider and event_id = p_event;
  if found then
    if e.attempt_id <> p_attempt or e.status <> p_status then
      raise exception 'Olay numarası başka bir bildirimde kullanılmış.' using errcode = '22023';
    end if;
    return 'duplicate';
  end if;
  perform private.set_note(null);
  if a.provider_ref is null then
    update public.payment_attempts set provider_ref = p_ref where id = a.id;
  end if;

  if p_status = 'failed' then
    if a.status = 'started' then
      v_result := 'failed';
      update public.payment_attempts set status = 'failed', error_code = left(p_code, 50) where id = a.id;
      if o.order_status = 'pending_payment' and o.payment_status = 'pending' and not exists (
        select 1 from public.payment_attempts x where x.payment_id = a.payment_id and x.status = 'started'
      ) then
        update public.orders set payment_status = 'failed' where id = o.id;
      end if;
    else
      v_result := 'ignored';
    end if;
  elsif a.status in ('paid', 'review', 'refund_due') then
    v_result := 'ignored';
  elsif p_amount is distinct from a.amount or p_currency is distinct from 'TRY' then
    v_result := 'review';
    update public.payment_attempts set status = 'review', paid_amount = p_amount where id = a.id;
    if o.order_status = 'pending_payment' then
      update public.orders set payment_status = 'review' where id = o.id;
    elsif o.order_status = 'cancelled' then
      update public.orders set payment_status = 'refund_pending' where id = o.id;
    end if;
  elsif o.order_status = 'pending_payment'
     or (o.order_status = 'cancelled' and o.cancel_code = 'expired' and private.reserve_order(o.id)) then
    v_result := 'paid';
    update public.payment_attempts set status = 'paid', paid_amount = p_amount where id = a.id;
    update public.payments set status = 'paid', paid_at = now() where id = a.payment_id;
    update public.orders set payment_status = 'paid', order_status = 'awaiting_approval', cancel_code = null
    where id = o.id;
  else
    v_result := 'refund_due';
    update public.payment_attempts set status = 'refund_due', paid_amount = p_amount where id = a.id;
    if o.order_status = 'cancelled' then
      update public.orders set payment_status = 'refund_pending' where id = o.id;
    end if;
  end if;

  insert into public.payment_events (provider, event_id, attempt_id, status, amount, currency, result)
  values (p_provider, p_event, p_attempt, p_status, p_amount, left(p_currency, 10), v_result);
  return v_result;
end;
$$;

-- Sonucu bilinmeyen denemeler. p_no verilirse yalnızca o sipariş, yoksa 5 dakikadan eski olanlar.
create function public.claim_card_checks(p_no text default null)
returns table (attempt uuid, provider text, ref text)
language sql security definer set search_path = ''
as $$
  update public.payment_attempts a set checked_at = now()
  where a.id in (
    select x.id from public.payment_attempts x
    join public.payments y on y.id = x.payment_id join public.orders o on o.id = y.order_id
    where x.status = 'started' and x.provider_ref is not null
      and case when p_no is null then
        x.created_at between now() - interval '1 day' and now() - interval '5 minutes'
        and (x.checked_at is null or x.checked_at < now() - interval '5 minutes')
      else o.order_no = p_no and (x.checked_at is null or x.checked_at < now() - interval '5 seconds') end
    order by x.created_at limit 5 for update of x skip locked)
  returning a.id, a.provider, a.provider_ref
$$;

revoke all on function private.card_open(), private.needs_refund(public.orders)
from public, anon, authenticated, service_role;
revoke all on function public.begin_card_payment(text, text, integer),
  public.attach_card_attempt(uuid, text, text), public.claim_card_checks(text),
  public.record_card_event(text, text, uuid, text, text, bigint, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.begin_card_payment(text, text, integer) to anon, authenticated;
grant execute on function public.attach_card_attempt(uuid, text, text), public.claim_card_checks(text),
  public.record_card_event(text, text, uuid, text, text, bigint, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Önceki fonksiyonlarda kart için değişen satırlar
-- ---------------------------------------------------------------------------

-- Kart seçeneği.
create or replace function public.checkout_options()
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
    'card', private.card_open(),
    'card_minutes', private.setting_int('card_minutes'),
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

-- Kart siparişi EFT gibi ödeme bekler, süresi dakikayladır. Reddedilen kart ödenmemiş sayılır.
create or replace function public.place_order(p_token text, p jsonb)
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
     or v_delivery not in ('shipping', 'pickup') or v_payment not in ('transfer', 'cod', 'store', 'card') then
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
  if v_payment = 'card' and not private.card_open() then
    raise exception 'Kart ödemesi şu anda kapalı.' using errcode = '22023';
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
        and o.payment_status in ('pending', 'review', 'failed', 'cod_due')) >= private.setting_int('max_unpaid') then
    raise exception 'Ödenmemiş siparişleriniz var. Yenisinden önce onları tamamlayın veya iptal edin.'
      using errcode = '22023';
  end if;

  perform private.set_note(null);
  insert into public.orders (order_no, user_id, contact_name, email, phone, delivery_method, payment_method,
    order_status, payment_status, subtotal, shipping_fee, gift_fee, cod_fee, total, gift_wrap,
    payment_due_at, idempotency_key)
  values (private.new_order_no(), v_user, btrim(p ->> 'name'), v_email, v_phone, v_delivery, v_payment,
    case when v_payment in ('transfer', 'card') then 'pending_payment' else 'awaiting_approval' end,
    case when v_payment = 'cod' then 'cod_due' else 'pending' end,
    v_subtotal, v_shipping, v_gift_fee, v_cod_fee, v_total, v_gift,
    case v_payment
      when 'transfer' then private.add_business_days(now(), private.setting_int('transfer_days')::integer)
      when 'card' then now() + make_interval(mins => private.setting_int('card_minutes')::integer) end, v_key)
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

-- Müşteri kartla yeniden deneyebilir mi?
create or replace function public.get_order(p_no text, p_token text default null)
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
    'can_pay', o.payment_method = 'card' and o.order_status = 'pending_payment'
      and o.payment_status in ('pending', 'failed') and o.payment_due_at > now() and private.card_open(),
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

-- Karttan gelen para da iade bekler.
create or replace function private.cancel_locked(p_order public.orders, p_code text)
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
        where y.order_id = p_order.id) or exists (
        select 1 from public.payment_attempts a join public.payments y on y.id = a.payment_id
        where y.order_id = p_order.id and a.status in ('paid', 'review', 'refund_due')) then 'refund_pending'
      else 'cancelled' end
  where id = p_order.id;
end;
$$;

-- Reddedilen kart siparişi de süre dolunca iptal olur.
create or replace function private.expire_orders()
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
    where x.order_status = 'pending_payment' and x.payment_status in ('pending', 'failed') and x.payment_due_at < now()
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

-- double: siparişe kullanılamayan fazladan para geldi.
create or replace function private.order_flags(o public.orders)
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
    case when private.needs_refund(o) then 'double' end,
    case when exists (select 1 from public.order_items i where i.order_id = o.id
      and not exists (select 1 from public.stock_reservations s
        where s.order_item_id = i.id and s.status = 'active')) then 'stock' end
  ], null)
$$;

-- p_status = refund: iade edilmesi gereken para.
create or replace function public.list_orders(p_status text default null, p_query text default null, p_page integer default 1)
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
  where (p_status is null or o.order_status = p_status or (p_status = 'refund' and private.needs_refund(o)))
    and (nullif(btrim(p_query), '') is null
      or o.order_no = upper(btrim(p_query)) or o.phone = btrim(p_query) or o.email = lower(btrim(p_query))
      or strpos(private.fold_tr(o.contact_name), private.fold_tr(btrim(p_query))) > 0)
  order by o.created_at desc, o.id
  limit 26 offset (least(greatest(coalesce(p_page, 1), 1), 10000) - 1) * 25;
end;
$$;

-- Kart ayarları.
create or replace function private.valid_setting(p_key text, p jsonb)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  t text := p #>> '{}';
  k text := jsonb_typeof(p);
  n bigint := case when k = 'number' and t ~ '^[0-9]{1,12}$' then t::bigint end;
begin
  if p_key in ('test_mode', 'transfer_two_person', 'card_enabled', 'cod_enabled', 'cod_card', 'phone_check', 'pickup_enabled', 'pickup_pay') then
    return coalesce(k = 'boolean', false);
  elsif p_key in ('shipping_fee', 'free_shipping_from', 'gift_fee', 'cod_fee', 'cod_limit') then
    return coalesce(n between 0 and 100000000, false);
  elsif p_key in ('shipping_vat_bps', 'gift_vat_bps', 'cod_vat_bps') then
    return coalesce(k = 'null' or n between 0 and 10000, false);
  elsif p_key in ('transfer_days', 'pickup_days') then
    return coalesce(n between 1 and 30, false);
  elsif p_key = 'card_minutes' then
    return coalesce(n between 5 and 120, false);
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

-- Sahte sağlayıcı açıkken deneme modu kapanmaz.
create or replace function public.set_settings(p jsonb)
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
  if not private.setting_on('test_mode') and private.setting_on('card_enabled')
     and (private.setting('card_provider') #>> '{}') = 'fake' then
    raise exception 'Sahte kart ödemesi açıkken deneme modu kapatılamaz.' using errcode = '22023';
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

-- Panelde kart denemeleri.
create or replace function public.order_detail(p_order uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  o public.orders;
begin
  perform private.require_permission('orders.read');
  select * into o from public.orders where id = p_order;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', o.id, 'order_no', o.order_no, 'created_at', o.created_at, 'is_member', o.user_id is not null,
    'contact_name', o.contact_name, 'email', o.email, 'phone', o.phone,
    'delivery_method', o.delivery_method, 'payment_method', o.payment_method,
    'order_status', o.order_status, 'payment_status', o.payment_status,
    'subtotal', o.subtotal, 'shipping_fee', o.shipping_fee, 'gift_fee', o.gift_fee,
    'cod_fee', o.cod_fee, 'total', o.total, 'gift_wrap', o.gift_wrap,
    'phone_verified', o.phone_verified_at is not null, 'payment_due_at', o.payment_due_at,
    'cancel_code', o.cancel_code,
    'pickup_until', o.ready_at + make_interval(days => private.setting_int('pickup_days')::integer),
    'flags', to_jsonb(case when o.order_status = 'awaiting_approval' then private.order_flags(o) else '{}'::text[] end),
    'items', (select jsonb_agg(jsonb_build_object('variant_id', i.variant_id, 'name', i.name, 'sku', i.sku,
        'color', i.color, 'size', i.size, 'unit_price', i.unit_price, 'quantity', i.quantity) order by i.name, i.sku)
      from public.order_items i where i.order_id = o.id),
    'addresses', (select jsonb_object_agg(a.kind, to_jsonb(a) - 'order_id' - 'kind')
      from public.order_addresses a where a.order_id = o.id),
    'collected_as', (select y.collected_as from public.payments y where y.order_id = o.id),
    'transfers', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'amount', t.amount,
        'reference', t.reference, 'matched_at', t.matched_at, 'matched_by', m.full_name,
        'confirmed_at', t.confirmed_at, 'confirmed_by', c.full_name) order by t.matched_at, t.id)
      from public.bank_transfers t join public.payments y on y.id = t.payment_id
      join public.profiles m on m.id = t.matched_by
      left join public.profiles c on c.id = t.confirmed_by
      where y.order_id = o.id), '[]'::jsonb),
    'needs_refund', private.needs_refund(o),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'amount', a.amount,
        'paid_amount', a.paid_amount, 'installments', a.installments, 'status', a.status,
        'ref', a.provider_ref, 'error_code', a.error_code, 'created_at', a.created_at)
        order by a.created_at, a.id)
      from public.payment_attempts a join public.payments y on y.id = a.payment_id
      where y.order_id = o.id), '[]'::jsonb),
    'history', (select jsonb_agg(jsonb_build_object('seq', h.seq, 'field', h.field, 'from', h.from_value,
        'to', h.to_value, 'note', h.note, 'actor', p.full_name, 'at', h.created_at) order by h.seq)
      from public.order_status_history h left join public.profiles p on p.id = h.actor_id
      where h.order_id = o.id));
end;
$$;

-- İptal olmamış ama iki kez ödenmiş sipariş de sayılır.
create or replace function public.order_summary()
returns table (awaiting bigint, review bigint, refund bigint, overdue bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_permission('orders.read');
  return query
  select count(*) filter (where o.order_status = 'awaiting_approval'),
    count(*) filter (where o.payment_status = 'review'),
    count(*) filter (where private.needs_refund(o)),
    count(*) filter (where o.order_status = 'ready_for_pickup'
      and o.ready_at + make_interval(days => private.setting_int('pickup_days')::integer) < now())
  from public.orders o;
end;
$$;
