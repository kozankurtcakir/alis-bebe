-- Aşama 3: katalog panelinin ihtiyaç duyduğu fonksiyonlar ve başlangıç kategorileri.

-- Kategoriler tek işlemde değişir; yayındaki ürün bir an bile ana kategorisiz kalmaz.
-- Çağıranın yetkisiyle çalışır; RLS geçerlidir.
create function public.set_product_categories(p_product uuid, p_primary uuid, p_others uuid[])
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_all uuid[] := array_remove(coalesce(p_others, '{}') || p_primary, null);
begin
  if not private.has_permission('catalog.write') then
    raise exception 'Bu işlem için yetkiniz yok.' using errcode = '42501';
  end if;
  perform 1 from public.products where id = p_product for update;
  if not found then
    raise exception 'Ürün bulunamadı.' using errcode = 'P0002';
  end if;
  if p_primary is null and cardinality(v_all) > 0 then
    raise exception 'Önce ana kategoriyi seçin.' using errcode = '22023';
  end if;

  delete from public.product_categories
  where product_id = p_product and category_id <> all (v_all);
  update public.product_categories set is_primary = false
  where product_id = p_product and is_primary and category_id <> p_primary;
  update public.product_categories set is_primary = true
  where product_id = p_product and not is_primary and category_id = p_primary;
  insert into public.product_categories (product_id, category_id, is_primary)
  select distinct p_product, c, c = p_primary from unnest(v_all) c
  on conflict do nothing;
end;
$$;

revoke all on function public.set_product_categories(uuid, uuid, uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.set_product_categories(uuid, uuid, uuid[]) to authenticated;

-- İşlem geçmişi, katalog kayıtlarının adını da gösterir. Silinen kaydın adı geçmişten okunur.
drop function public.list_audit_logs(integer);
create function public.list_audit_logs(p_page integer default 1)
returns table (
  id uuid, created_at timestamptz, actor_email text, action text, target text,
  before jsonb, after jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_permission('audit.read');
  return query
    select l.id, l.created_at, a.email::text, l.action,
      case
        when l.entity = 'user' then
          (select u.email::text from auth.users u where u.id = l.entity_id)
        when l.entity in ('products', 'product_categories') then
          (select p.name from public.products p where p.id = l.entity_id)
        when l.entity in ('product_variants', 'variant_costs') then
          (select v.sku from public.product_variants v where v.id = l.entity_id)
        when l.entity = 'product_images' then coalesce(
          (select p.name from public.product_images i
           join public.products p on p.id = i.product_id where i.id = l.entity_id),
          (select p.name from public.products p
           where p.id = (coalesce(l.after, l.before) ->> 'product_id')::uuid))
        else coalesce(
          (select c.name from public.categories c where l.entity = 'categories' and c.id = l.entity_id),
          (select b.name from public.brands b where l.entity = 'brands' and b.id = l.entity_id),
          (select c.name from public.colors c where l.entity = 'colors' and c.id = l.entity_id),
          (select s.name from public.sizes s where l.entity = 'sizes' and s.id = l.entity_id),
          (select s.name from public.size_charts s where l.entity = 'size_charts' and s.id = l.entity_id),
          coalesce(l.before, l.after) ->> 'name')
      end,
      l.before, l.after
    from public.audit_logs l
    left join auth.users a on a.id = l.actor_id
    order by l.created_at desc, l.id
    limit 51
    offset (least(greatest(coalesce(p_page, 1), 1), 10000) - 1) * 50;
end;
$$;

revoke all on function public.list_audit_logs(integer) from public, anon, authenticated, service_role;
grant execute on function public.list_audit_logs(integer) to authenticated;

-- Başlangıç kategorileri; panelden değiştirilebilir. Kişisel bakım, mevzuat kontrolüne
-- kadar kapalı başlar.
insert into public.categories (name, slug, sort_order, is_active) values
  ('Bebek', 'bebek', 10, true),
  ('Çocuk', 'cocuk', 20, true),
  ('Yetişkin', 'yetiskin', 30, true),
  ('Kişisel Bakım', 'kisisel-bakim', 40, false);
insert into public.categories (parent_id, name, slug, sort_order)
select p.id, x.name, x.slug, x.o * 10
from public.categories p, (values
  ('Tişört', 'yetiskin-tisort', 1), ('Eşofman', 'yetiskin-esofman', 2),
  ('Şort', 'yetiskin-sort', 3), ('Hırka', 'yetiskin-hirka', 4),
  ('Kadın Takım', 'kadin-takim', 5)) x (name, slug, o)
where p.slug = 'yetiskin';
