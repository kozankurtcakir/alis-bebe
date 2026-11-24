-- İşlem geçmişini e-posta adresleriyle, 50'şer kayıtlık sayfalar halinde döndürür.
-- 51. kayıt "sonraki sayfa var" bilgisidir.
create function public.list_audit_logs(p_page integer default 1)
returns table (
  id uuid, created_at timestamptz, actor_email text, action text, target_email text,
  before jsonb, after jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_permission('audit.read');
  return query
    select l.id, l.created_at, a.email::text, l.action, t.email::text, l.before, l.after
    from public.audit_logs l
    left join auth.users a on a.id = l.actor_id
    left join auth.users t on l.entity = 'user' and t.id = l.entity_id
    order by l.created_at desc, l.id
    limit 51
    offset (least(greatest(coalesce(p_page, 1), 1), 10000) - 1) * 50;
end;
$$;

revoke all on function public.list_audit_logs(integer) from public, anon, authenticated, service_role;
grant execute on function public.list_audit_logs(integer) to authenticated;
