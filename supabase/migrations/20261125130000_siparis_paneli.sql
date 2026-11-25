-- Aşama 8: panelin sipariş ayrıntısı, özet sayıları ve e-posta kuyruğu.

-- Personelin sipariş sayfası. Geçmişi yapanların adı burada birleştirilir.
create function public.order_detail(p_order uuid)
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
    'history', (select jsonb_agg(jsonb_build_object('seq', h.seq, 'field', h.field, 'from', h.from_value,
        'to', h.to_value, 'note', h.note, 'actor', p.full_name, 'at', h.created_at) order by h.seq)
      from public.order_status_history h left join public.profiles p on p.id = h.actor_id
      where h.order_id = o.id));
end;
$$;

create function public.order_summary()
returns table (awaiting bigint, review bigint, refund bigint, overdue bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_permission('orders.read');
  return query
  select count(*) filter (where o.order_status = 'awaiting_approval'),
    count(*) filter (where o.payment_status = 'review'),
    count(*) filter (where o.payment_status = 'refund_pending'),
    count(*) filter (where o.order_status = 'ready_for_pickup'
      and o.ready_at + make_interval(days => private.setting_int('pickup_days')::integer) < now())
  from public.orders o;
end;
$$;

-- İki çalışan aynı iletiyi almaz; yarım kalan ileti 5 dakika sonra yeniden alınır.
-- Misafirin bağlantı kodu burada üretilir, kuyrukta durmaz.
create function public.claim_emails()
returns setof jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  j public.outbox_jobs;
  o public.orders;
begin
  for j in
    select * from public.outbox_jobs
    where status = 'pending' and run_after <= now()
    order by run_after, id limit 10 for update skip locked
  loop
    update public.outbox_jobs set attempts = attempts + 1, run_after = now() + interval '5 minutes'
    where id = j.id;
    select * into o from public.orders where id = (j.payload ->> 'order_id')::uuid;
    return next jsonb_build_object('id', j.id, 'kind', j.kind, 'status', j.payload ->> 'status',
      'email', o.email, 'name', o.contact_name, 'order_no', o.order_no, 'total', o.total,
      'payment_method', o.payment_method, 'delivery_method', o.delivery_method,
      'token', case when o.user_id is null then private.new_order_token(o.id) end);
  end loop;
end;
$$;

create function public.finish_email(p_id uuid, p_sent boolean)
returns void
language sql security definer set search_path = ''
as $$
  update public.outbox_jobs
  set status = case when p_sent then 'sent' when attempts >= 5 then 'failed' else 'pending' end
  where id = p_id and status = 'pending'
$$;

revoke all on function public.order_detail(uuid), public.order_summary(), public.claim_emails(),
  public.finish_email(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.order_detail(uuid), public.order_summary() to authenticated;
-- Yalnızca sunucudaki gizli anahtar.
grant execute on function public.claim_emails(), public.finish_email(uuid, boolean) to service_role;
