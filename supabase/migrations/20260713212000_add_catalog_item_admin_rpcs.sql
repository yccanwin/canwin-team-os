-- B3 product configuration. This manages draft items only; publishing catalog
-- versions remains a separate workflow.

alter table public.deal_catalog_items
  add column if not exists applicable_business_types text[] not null default array[]::text[],
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

drop policy if exists "access managers create catalog items" on public.deal_catalog_items;

-- Do not allow API users to request procurement_cost directly. Quote screens
-- retain access to the explicitly listed non-cost columns and remain RLS scoped.
revoke select on public.deal_catalog_items from authenticated;
grant select (
  id, team_id, catalog_version_id, sku, name, item_type,
  customer_list_price, points, applicable_business_types, is_active,
  created_at, updated_at
) on public.deal_catalog_items to authenticated;

create or replace function public.get_catalog_item_admin_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $get_catalog_item_admin_snapshot$
declare
  actor public.profiles;
  draft public.deal_catalog_versions;
begin
  select * into actor from public.profiles where id = auth.uid() and status = 'active';
  if actor.id is null or not public.has_access_role(actor.team_id, array['owner', 'admin']) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select * into draft from public.deal_catalog_versions
  where team_id = actor.team_id and status = 'draft'
  order by version_no desc limit 1;

  return jsonb_build_object(
    'draftVersionId', draft.id,
    'draftVersionNo', draft.version_no,
    'publishedVersionNo', (
      select max(v.version_no) from public.deal_catalog_versions v
      where v.team_id = actor.team_id and v.status = 'published'
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'sku', i.sku,
        'name', i.name,
        'itemType', i.item_type,
        'procurementCost', i.procurement_cost,
        'customerListPrice', i.customer_list_price,
        'points', i.points,
        'applicableBusinessTypes', to_jsonb(i.applicable_business_types),
        'isActive', i.is_active
      ) order by i.is_active desc, i.item_type, i.name)
      from public.deal_catalog_items i
      where i.team_id = actor.team_id and i.catalog_version_id = draft.id
    ), '[]'::jsonb)
  );
end
$get_catalog_item_admin_snapshot$;

create or replace function public.manage_catalog_draft_item(
  p_item_id uuid,
  p_sku text,
  p_name text,
  p_item_type text,
  p_procurement_cost numeric,
  p_customer_list_price numeric,
  p_points numeric,
  p_applicable_business_types text[],
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $manage_catalog_draft_item$
declare
  actor public.profiles;
  draft public.deal_catalog_versions;
  target public.deal_catalog_items;
  before_state jsonb;
  business_types text[] := coalesce(p_applicable_business_types, array[]::text[]);
begin
  select * into actor from public.profiles where id = auth.uid() and status = 'active';
  if actor.id is null or not public.has_access_role(actor.team_id, array['owner', 'admin']) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if trim(coalesce(p_sku, '')) !~ '^[A-Za-z0-9_-]{2,40}$' then raise exception 'INVALID_SKU' using errcode = '23514'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 or char_length(trim(p_name)) > 80 then raise exception 'INVALID_ITEM_NAME' using errcode = '23514'; end if;
  if p_item_type not in ('software', 'hardware', 'service') then raise exception 'INVALID_ITEM_TYPE' using errcode = '23514'; end if;
  if p_procurement_cost is null or p_procurement_cost < 0 or p_customer_list_price is null or p_customer_list_price < 0 or p_points is null or p_points < 0 then
    raise exception 'INVALID_PRICE_OR_POINTS' using errcode = '23514';
  end if;
  if cardinality(business_types) <> (select count(distinct value) from unnest(business_types) value)
    or exists (select 1 from unnest(business_types) value where value not in ('fast_food','chinese','hotpot','barbecue','beverage','bakery','banquet','international')) then
    raise exception 'INVALID_BUSINESS_TYPE' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.team_id, 0));
  select * into draft from public.deal_catalog_versions
  where team_id = actor.team_id and status = 'draft'
  order by version_no desc limit 1 for update;
  if draft.id is null then
    insert into public.deal_catalog_versions(team_id, version_no, status, created_by)
    select actor.team_id, coalesce(max(v.version_no), 0) + 1, 'draft', actor.id
    from public.deal_catalog_versions v where v.team_id = actor.team_id
    returning * into draft;
  end if;

  if p_item_id is null then
    insert into public.deal_catalog_items(
      team_id, catalog_version_id, sku, name, item_type, procurement_cost,
      customer_list_price, points, applicable_business_types, is_active
    ) values (
      actor.team_id, draft.id, upper(trim(p_sku)), trim(p_name), p_item_type,
      p_procurement_cost, p_customer_list_price, p_points, business_types, coalesce(p_is_active, true)
    ) returning * into target;
  else
    select * into target from public.deal_catalog_items
    where id = p_item_id and team_id = actor.team_id and catalog_version_id = draft.id for update;
    if target.id is null then raise exception 'DRAFT_ITEM_NOT_FOUND' using errcode = 'P0002'; end if;
    before_state := to_jsonb(target);
    update public.deal_catalog_items set
      sku = upper(trim(p_sku)), name = trim(p_name), item_type = p_item_type,
      procurement_cost = p_procurement_cost, customer_list_price = p_customer_list_price,
      points = p_points, applicable_business_types = business_types,
      is_active = coalesce(p_is_active, target.is_active), updated_at = now()
    where id = target.id returning * into target;
  end if;

  insert into public.audit_logs(team_id, actor_id, action, target_type, target_id, before_data, after_data)
  values(actor.team_id, actor.id, case when p_item_id is null then 'catalog.item_created' else 'catalog.item_updated' end,
    'deal_catalog_item', target.id, before_state, to_jsonb(target));
  return target.id;
end
$manage_catalog_draft_item$;

revoke all on function public.get_catalog_item_admin_snapshot() from public;
revoke all on function public.manage_catalog_draft_item(uuid, text, text, text, numeric, numeric, numeric, text[], boolean) from public;
grant execute on function public.get_catalog_item_admin_snapshot() to authenticated;
grant execute on function public.manage_catalog_draft_item(uuid, text, text, text, numeric, numeric, numeric, text[], boolean) to authenticated;

notify pgrst, 'reload schema';
