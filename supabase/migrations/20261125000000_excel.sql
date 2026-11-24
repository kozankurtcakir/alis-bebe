-- Aşama 5: Excel ile toplu ürün ve stok yükleme. Dosya sunucuda okunur ve planlanır;
-- plan burada saklanır, önizlenir ve tek işlemde uygulanır. Dosyanın kendisi saklanmaz.

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('products', 'stock')),
  -- Stok dosyasındaki sayının anlamı: mal girişi (ekle) veya sayım (toplam).
  stock_mode text check (stock_mode in ('purchase', 'adjustment')),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('invalid', 'validated', 'applied')),
  total integer not null check (total between 1 and 1000),
  invalid integer not null check (invalid between 0 and total),
  created_by uuid not null references public.profiles (id) on delete restrict,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'stock') = (stock_mode is not null)),
  check ((status = 'applied') = (applied_at is not null)),
  check ((status = 'invalid') = (invalid > 0))
);
create index on public.import_jobs (created_by);
create index on public.import_jobs (created_at desc);
create index on public.import_jobs (file_hash) where status = 'applied';

create table public.import_rows (
  -- Stok hareketinin tek kullanımlık anahtarı olarak da kullanılır.
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.import_jobs (id) on delete restrict,
  row_no integer not null check (row_no between 2 and 1048576),
  action text not null check (action in ('create', 'update', 'skip', 'error')),
  raw jsonb not null check (jsonb_typeof(raw) = 'object'),
  parsed jsonb not null check (jsonb_typeof(parsed) = 'object'),
  before jsonb not null check (jsonb_typeof(before) = 'object'),
  summary jsonb not null check (jsonb_typeof(summary) = 'array'),
  errors jsonb not null check (jsonb_typeof(errors) = 'array'),
  -- Fiyatı %10 veya daha fazla değişen satır, uygularken ayrıca onay ister.
  big_price_change boolean not null generated always as (
    coalesce(
      abs((parsed #>> '{variant,price}')::bigint - (before #>> '{variant,price}')::bigint) * 100
        >= (before #>> '{variant,price}')::bigint * 10
      and (parsed #>> '{variant,price}')::bigint <> (before #>> '{variant,price}')::bigint,
      false)
  ) stored,
  unique (job_id, row_no),
  check ((action = 'error') = (jsonb_array_length(errors) > 0))
);

create trigger import_jobs_touch before update on public.import_jobs
for each row execute function private.touch_updated_at();
create trigger import_rows_append_only before update or delete on public.import_rows
for each row execute function private.forbid_change();
create trigger import_rows_no_truncate before truncate on public.import_rows
for each statement execute function private.forbid_change();

create function private.import_permission(p_kind text)
returns text
language sql immutable set search_path = ''
as $$
  select case p_kind when 'products' then 'import.products' when 'stock' then 'import.stock' end;
$$;

-- ---------------------------------------------------------------------------
-- Plan için gerekli mevcut kayıtlar. Çağıranın yetkisiyle çalışır; RLS geçerlidir.
-- ---------------------------------------------------------------------------

create function public.import_lookup(
  p_skus text[], p_barcodes text[], p_product_nos bigint[], p_slugs text[]
)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with v as (
    select v.*, i.on_hand, i.reserved
    from public.product_variants v
    left join public.inventory i on i.variant_id = v.id
    where v.sku = any (p_skus)
  ),
  p as (
    select * from public.products
    where product_no = any (p_product_nos) or id in (select product_id from v)
  )
  select jsonb_build_object(
    'variants', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'product_id', v.product_id, 'color_id', v.color_id, 'size_id', v.size_id,
      'sku', v.sku, 'barcode', v.barcode, 'price', v.price, 'compare_at_price', v.compare_at_price,
      'desi', v.desi, 'is_active', v.is_active, 'on_hand', v.on_hand, 'reserved', v.reserved)) from v), '[]'),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'product_no', p.product_no, 'name', p.name, 'product_type', p.product_type,
      'audience', p.audience, 'gender', p.gender, 'brand_id', p.brand_id, 'vat_bps', p.vat_bps,
      'description', p.description, 'material', p.material, 'care', p.care,
      'primary_category', (select c.category_id from public.product_categories c
        where c.product_id = p.id and c.is_primary),
      'combos', (select coalesce(jsonb_agg(
          coalesce(x.color_id::text, '') || '|' || coalesce(x.size_id::text, '')), '[]')
        from public.product_variants x where x.product_id = p.id))) from p), '[]'),
    'barcodes', coalesce((select jsonb_object_agg(b.barcode, b.id)
      from public.product_variants b where b.barcode = any (p_barcodes)), '{}'),
    'slugs', coalesce((select jsonb_agg(s.slug) from public.products s
      where exists (select 1 from unnest(p_slugs) b where s.slug = b or s.slug like b || '-%')), '[]'));
$$;

-- ---------------------------------------------------------------------------
-- Planı saklama
-- ---------------------------------------------------------------------------

create function public.create_import(
  p_kind text, p_stock_mode text, p_file_name text, p_file_hash text, p_rows jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_job uuid;
  v_total integer;
  v_invalid integer;
begin
  if private.import_permission(p_kind) is null then
    raise exception 'Geçersiz dosya türü.' using errcode = '22023';
  end if;
  perform private.require_permission(private.import_permission(p_kind));
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) not between 1 and 1000 then
    raise exception 'Dosyada 1 ile 1.000 arasında satır olmalıdır.' using errcode = '22023';
  end if;

  select count(*), count(*) filter (where x ->> 'action' = 'error') into v_total, v_invalid
  from jsonb_array_elements(p_rows) x;
  insert into public.import_jobs (kind, stock_mode, file_name, file_hash, status, total, invalid, created_by)
  values (p_kind, p_stock_mode, p_file_name, p_file_hash,
    case when v_invalid > 0 then 'invalid' else 'validated' end, v_total, v_invalid, (select auth.uid()))
  returning id into v_job;
  insert into public.import_rows (job_id, row_no, action, raw, parsed, before, summary, errors)
  select v_job, r.row_no, r.action, r.raw, r.parsed, r.before, r.summary, r.errors
  from jsonb_to_recordset(p_rows) as r (
    row_no integer, action text, raw jsonb, parsed jsonb, before jsonb, summary jsonb, errors jsonb);
  return v_job;
end;
$$;

-- ---------------------------------------------------------------------------
-- Uygulama: ya hepsi ya hiçbiri
-- ---------------------------------------------------------------------------

create function private.import_set_primary(p_product uuid, p_category uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.product_categories set is_primary = false
  where product_id = p_product and is_primary and category_id <> p_category;
  insert into public.product_categories (product_id, category_id, is_primary)
  values (p_product, p_category, true)
  on conflict (product_id, category_id) do update set is_primary = true;
$$;

create function private.apply_product_import(p_job uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.import_rows;
  pr jsonb;
  va jsonb;
  v_product uuid;
  v_new jsonb := jsonb_build_object();
begin
  -- Kilitler her zaman aynı sırayla alınır; iki yükleme birbirini kilitlemez.
  perform 1 from public.products where id in (
    select (parsed ->> 'product_id')::uuid from public.import_rows where job_id = p_job
  ) order by id for update;
  perform 1 from public.product_variants where id in (
    select (parsed ->> 'variant_id')::uuid from public.import_rows where job_id = p_job
  ) order by id for update;

  -- Önizlemede gösterilen eski değerler hâlâ geçerli mi?
  if exists (
    select 1 from public.import_rows i
    where i.job_id = p_job and i.action in ('create', 'update') and (
      -- Eski fiyatı önizlemede olmayan satır fiyat değiştiremez; %10 uyarısı atlatılamaz.
      (i.action = 'update' and coalesce(i.parsed -> 'variant', '{}') ? 'price'
        and not coalesce(i.before -> 'variant', '{}') ? 'price')
      or (i.action = 'update' and (
        (select to_jsonb(v) from public.product_variants v where v.id = (i.parsed ->> 'variant_id')::uuid)
        @> coalesce(i.before -> 'variant', '{}')) is not true)
      or (i.parsed ? 'product_id' and (
        (select to_jsonb(p) from public.products p where p.id = (i.parsed ->> 'product_id')::uuid)
        @> coalesce(i.before -> 'product', '{}')) is not true)
      or (i.parsed ? 'product_id' and i.parsed ? 'primary_category' and (
        select c.category_id::text from public.product_categories c
        where c.product_id = (i.parsed ->> 'product_id')::uuid and c.is_primary
      ) is distinct from i.before ->> 'primary_category'))
  ) then
    raise exception 'Kayıtlar önizlemeden sonra değişmiş. Dosyayı yeniden yükleyin.'
      using errcode = '22023';
  end if;

  for r in
    select * from public.import_rows
    where job_id = p_job and action in ('create', 'update') order by row_no
  loop
    pr := coalesce(r.parsed -> 'product', '{}');
    va := coalesce(r.parsed -> 'variant', '{}');
    v_product := (r.parsed ->> 'product_id')::uuid;

    if v_product is null then
      v_product := (v_new ->> (r.parsed ->> 'product_key'))::uuid;
    end if;
    if v_product is null then
      insert into public.products (
        name, slug, product_type, audience, gender, brand_id, vat_bps, description, material, care)
      values (pr ->> 'name', pr ->> 'slug', coalesce(pr ->> 'product_type', 'clothing'),
        pr ->> 'audience', pr ->> 'gender', (pr ->> 'brand_id')::uuid, (pr ->> 'vat_bps')::integer,
        coalesce(pr ->> 'description', ''), coalesce(pr ->> 'material', ''), pr ->> 'care')
      returning id into v_product;
      v_new := v_new || jsonb_build_object(r.parsed ->> 'product_key', v_product);
    elsif pr <> '{}' and r.parsed ? 'product_id' then
      update public.products set
        name = coalesce(pr ->> 'name', name),
        product_type = coalesce(pr ->> 'product_type', product_type),
        audience = coalesce(pr ->> 'audience', audience),
        gender = coalesce(pr ->> 'gender', gender),
        brand_id = coalesce((pr ->> 'brand_id')::uuid, brand_id),
        vat_bps = coalesce((pr ->> 'vat_bps')::integer, vat_bps),
        description = coalesce(pr ->> 'description', description),
        material = coalesce(pr ->> 'material', material),
        care = coalesce(pr ->> 'care', care)
      where id = v_product;
    end if;
    if r.parsed ? 'primary_category' then
      perform private.import_set_primary(v_product, (r.parsed ->> 'primary_category')::uuid);
    end if;

    if r.action = 'create' then
      insert into public.product_variants (
        product_id, color_id, size_id, sku, barcode, price, compare_at_price, desi, is_active)
      values (v_product, (va ->> 'color_id')::uuid, (va ->> 'size_id')::uuid, va ->> 'sku',
        va ->> 'barcode', (va ->> 'price')::bigint, (va ->> 'compare_at_price')::bigint,
        (va ->> 'desi')::numeric, coalesce((va ->> 'is_active')::boolean, true));
    elsif va <> '{}' then
      update public.product_variants set
        barcode = coalesce(va ->> 'barcode', barcode),
        price = coalesce((va ->> 'price')::bigint, price),
        compare_at_price = coalesce((va ->> 'compare_at_price')::bigint, compare_at_price),
        desi = coalesce((va ->> 'desi')::numeric, desi),
        is_active = coalesce((va ->> 'is_active')::boolean, is_active)
      where id = (r.parsed ->> 'variant_id')::uuid;
    end if;
  end loop;
end;
$$;

create function private.apply_stock_import(p_job public.import_jobs)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.import_rows;
  v public.inventory;
  q integer;
  v_delta integer;
begin
  for r in
    select * from public.import_rows
    where job_id = p_job.id and action = 'update'
    order by (parsed ->> 'variant_id')::uuid, row_no
  loop
    v := private.lock_inventory((r.parsed ->> 'variant_id')::uuid);
    q := (r.parsed ->> 'quantity')::integer;
    if q is null or q not between 0 and 100000 then
      raise exception 'Geçersiz miktar.' using errcode = '22023';
    end if;
    if p_job.stock_mode = 'adjustment' then
      if v.on_hand is distinct from (r.before ->> 'on_hand')::integer then
        raise exception 'Stok önizlemeden sonra değişmiş. Dosyayı yeniden yükleyin.'
          using errcode = '22023';
      end if;
      v_delta := q - v.on_hand;
    else
      v_delta := q;
    end if;
    if v_delta <> 0 then
      perform private.apply_stock(v, v_delta, 'import',
        left(concat_ws(' · ', case p_job.stock_mode when 'adjustment' then 'Excel sayımı' else 'Excel girişi' end,
          p_job.file_name, nullif(btrim(r.parsed ->> 'note'), '')), 500), r.id);
    end if;
  end loop;
end;
$$;

-- Yalnızca dosyayı yükleyen kişi uygular: onayladığı önizleme kendisininkidir.
create function public.apply_import(
  p_job uuid, p_confirm_prices boolean default false, p_confirm_repeat boolean default false
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  j public.import_jobs;
  v_count integer;
begin
  select * into j from public.import_jobs where id = p_job for update;
  if not found or j.created_by is distinct from (select auth.uid()) then
    raise exception 'Yükleme bulunamadı.' using errcode = 'P0002';
  end if;
  perform private.require_permission(private.import_permission(j.kind));
  if j.kind = 'products' then
    perform private.require_permission('catalog.write');
    perform private.require_permission('prices.write');
  else
    perform private.require_permission('stock.adjust');
  end if;
  if j.status = 'applied' then
    raise exception 'Bu yükleme zaten uygulanmış.' using errcode = '22023';
  end if;
  if j.status <> 'validated' then
    raise exception 'Hatalı satır içeren dosya uygulanamaz.' using errcode = '22023';
  end if;
  if p_confirm_prices is not true and exists (
    select 1 from public.import_rows where job_id = p_job and big_price_change
  ) then
    raise exception 'Fiyatı %%10 veya daha fazla değişen satırları onaylayın.' using errcode = '22023';
  end if;
  -- Aynı dosyanın iki uygulaması sıraya girer; ikincisi birincisini görür.
  perform pg_advisory_xact_lock(hashtextextended(j.file_hash, 0));
  if p_confirm_repeat is not true and exists (
    select 1 from public.import_jobs o
    where o.file_hash = j.file_hash and o.status = 'applied' and o.kind = j.kind
      and o.stock_mode is not distinct from j.stock_mode
  ) then
    raise exception 'Bu dosya daha önce uygulanmış. Yeniden uygulamak için onaylayın.' using errcode = '22023';
  end if;

  select count(*) into v_count from public.import_rows
  where job_id = p_job and action in ('create', 'update');
  if j.kind = 'products' then
    perform private.apply_product_import(p_job);
  else
    perform private.apply_stock_import(j);
  end if;
  update public.import_jobs set status = 'applied', applied_at = now() where id = p_job;
  perform private.write_audit('import.apply', 'import_jobs', p_job, null,
    jsonb_build_object('name', j.file_name, 'kind', j.kind, 'rows', v_count));
  -- Yayın şartları burada denetlenir; hata bütün dosyayı geri alır.
  set constraints all immediate;
  return v_count;
end;
$$;

-- Yükleme listesi; yükleyenin yalnızca adını gösterir. 26. kayıt "sonraki sayfa var" bilgisidir.
create function public.list_imports(p_page integer default 1, p_job uuid default null)
returns table (
  id uuid, kind text, stock_mode text, file_name text, status text, total integer, invalid integer,
  created_at timestamptz, applied_at timestamptz, creator_name text, is_own boolean,
  price_warnings bigint, applied_before boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.has_permission('import.products') and not private.has_permission('import.stock') then
    raise exception 'Bu işlem için yetkiniz yok.' using errcode = '42501';
  end if;
  return query
    select j.id, j.kind, j.stock_mode, j.file_name, j.status, j.total, j.invalid,
      j.created_at, j.applied_at, a.full_name, j.created_by = (select auth.uid()),
      (select count(*) from public.import_rows r where r.job_id = j.id and r.big_price_change),
      exists (select 1 from public.import_jobs o
        where o.id <> j.id and o.file_hash = j.file_hash and o.status = 'applied' and o.kind = j.kind
          and o.stock_mode is not distinct from j.stock_mode)
    from public.import_jobs j
    left join public.profiles a on a.id = j.created_by
    where private.has_permission(private.import_permission(j.kind))
      and (p_job is null or j.id = p_job)
    order by j.created_at desc, j.id
    limit 26
    offset (least(greatest(coalesce(p_page, 1), 1), 10000) - 1) * 25;
end;
$$;

-- Excel ile gelen stok hareketi de ters çevrilebilir. Öncekinden tek farkı 'import' nedenidir.
create or replace function public.reverse_stock_movement(p_movement uuid, p_note text, p_key uuid)
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
  if m.reason not in ('initial', 'purchase', 'damage', 'adjustment', 'import') then
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

-- ---------------------------------------------------------------------------
-- RLS ve erişim izinleri
-- ---------------------------------------------------------------------------

alter table public.import_jobs enable row level security;
alter table public.import_rows enable row level security;
revoke all on public.import_jobs, public.import_rows from public, anon, authenticated, service_role;
grant select on public.import_jobs, public.import_rows to authenticated;
create policy "yükleme okur" on public.import_jobs for select to authenticated
using (
  (kind = 'products' and (select private.has_permission('import.products')))
  or (kind = 'stock' and (select private.has_permission('import.stock')))
);
create policy "yükleme satırı okur" on public.import_rows for select to authenticated
using (exists (select 1 from public.import_jobs j where j.id = job_id));

revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant execute on function private.is_active_session(), private.has_permission(text) to authenticated;

revoke all on function
  public.import_lookup(text[], text[], bigint[], text[]),
  public.create_import(text, text, text, text, jsonb),
  public.apply_import(uuid, boolean, boolean),
  public.list_imports(integer, uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.import_lookup(text[], text[], bigint[], text[]),
  public.create_import(text, text, text, text, jsonb),
  public.apply_import(uuid, boolean, boolean),
  public.list_imports(integer, uuid)
to authenticated;
