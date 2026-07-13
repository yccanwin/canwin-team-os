-- B4 catalog version lifecycle. Item/package editing remains in separate
-- configuration workflows; historical versions are immutable.

alter table public.deal_catalog_versions
  add column if not exists published_by uuid references auth.users(id) on delete set null;

create table if not exists public.deal_catalog_version_requests (
  team_id text not null references public.teams(id) on delete cascade,
  idempotency_key uuid not null,
  action text not null check (action in ('create_draft', 'publish')),
  version_id uuid not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (team_id, idempotency_key),
  foreign key (team_id, version_id) references public.deal_catalog_versions(team_id, id)
);
alter table public.deal_catalog_version_requests enable row level security;

drop policy if exists "access managers create catalog versions" on public.deal_catalog_versions;
drop policy if exists "access managers create packages" on public.deal_packages;
drop policy if exists "access managers create package items" on public.deal_package_items;

-- Existing data is expected to have at most one published version. The unique
-- index makes that invariant concurrency-safe for all future writes.
create unique index if not exists deal_catalog_versions_one_published_idx
on public.deal_catalog_versions(team_id) where status = 'published';

create or replace function public.get_catalog_version_admin_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $get_catalog_version_admin_snapshot$
declare actor public.profiles;
begin
  select * into actor from public.profiles where id = auth.uid() and status = 'active';
  if actor.id is null or not public.has_access_role(actor.team_id, array['owner', 'admin']) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  return jsonb_build_object('versions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'versionNo', v.version_no, 'status', v.status,
      'creatorName', coalesce(nullif(trim(p.name), ''), '未命名成员'),
      'createdAt', v.created_at, 'publishedAt', v.published_at,
      'itemCount', (select count(*) from public.deal_catalog_items i where i.team_id = v.team_id and i.catalog_version_id = v.id),
      'activeItemCount', (select count(*) from public.deal_catalog_items i where i.team_id = v.team_id and i.catalog_version_id = v.id and i.is_active),
      'packageCount', (select count(*) from public.deal_packages pkg where pkg.team_id = v.team_id and pkg.catalog_version_id = v.id)
    ) order by v.version_no desc)
    from public.deal_catalog_versions v
    left join public.profiles p on p.id = v.created_by and p.team_id = v.team_id
    where v.team_id = actor.team_id
  ), '[]'::jsonb));
end
$get_catalog_version_admin_snapshot$;

create or replace function public.create_catalog_draft_from_latest(p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $create_catalog_draft_from_latest$
declare
  actor public.profiles;
  prior_request public.deal_catalog_version_requests;
  draft public.deal_catalog_versions;
  source public.deal_catalog_versions;
begin
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023'; end if;
  select * into actor from public.profiles where id = auth.uid() and status = 'active';
  if actor.id is null or not public.has_access_role(actor.team_id, array['owner', 'admin']) then raise exception 'ADMIN_REQUIRED' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.team_id, 1));
  select * into prior_request from public.deal_catalog_version_requests where team_id = actor.team_id and idempotency_key = p_idempotency_key;
  if prior_request.version_id is not null then
    if prior_request.action <> 'create_draft' then raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = '23505'; end if;
    return prior_request.version_id;
  end if;
  select * into draft from public.deal_catalog_versions where team_id = actor.team_id and status = 'draft' order by version_no desc limit 1 for update;
  if draft.id is null then
    select * into source from public.deal_catalog_versions where team_id = actor.team_id and status = 'published' order by version_no desc limit 1;
    insert into public.deal_catalog_versions(team_id, version_no, status, created_by)
    select actor.team_id, coalesce(max(v.version_no), 0) + 1, 'draft', actor.id from public.deal_catalog_versions v where v.team_id = actor.team_id
    returning * into draft;
    if source.id is not null then
      insert into public.deal_catalog_items(team_id, catalog_version_id, sku, name, item_type, customer_list_price, procurement_cost, points, applicable_business_types, is_active)
      select actor.team_id, draft.id, i.sku, i.name, i.item_type, i.customer_list_price, i.procurement_cost, i.points, i.applicable_business_types, i.is_active
      from public.deal_catalog_items i where i.team_id = actor.team_id and i.catalog_version_id = source.id;
      insert into public.deal_packages(team_id, catalog_version_id, code, name, business_type, is_active)
      select actor.team_id, draft.id, pkg.code, pkg.name, pkg.business_type, pkg.is_active from public.deal_packages pkg
      where pkg.team_id = actor.team_id and pkg.catalog_version_id = source.id;
      insert into public.deal_package_items(team_id, package_id, catalog_item_id, quantity)
      select actor.team_id, new_pkg.id, new_item.id, old_pi.quantity
      from public.deal_package_items old_pi
      join public.deal_packages old_pkg on old_pkg.id = old_pi.package_id and old_pkg.team_id = old_pi.team_id
      join public.deal_catalog_items old_item on old_item.id = old_pi.catalog_item_id and old_item.team_id = old_pi.team_id
      join public.deal_packages new_pkg on new_pkg.team_id = actor.team_id and new_pkg.catalog_version_id = draft.id and new_pkg.code = old_pkg.code
      join public.deal_catalog_items new_item on new_item.team_id = actor.team_id and new_item.catalog_version_id = draft.id and new_item.sku = old_item.sku
      where old_pi.team_id = actor.team_id and old_pkg.catalog_version_id = source.id;
    end if;
    insert into public.audit_logs(team_id, actor_id, action, target_type, target_id, after_data)
    values(actor.team_id, actor.id, 'catalog.draft_created', 'deal_catalog_version', draft.id,
      jsonb_build_object('versionNo', draft.version_no, 'sourceVersionId', source.id));
  end if;
  insert into public.deal_catalog_version_requests(team_id, idempotency_key, action, version_id, actor_id)
  values(actor.team_id, p_idempotency_key, 'create_draft', draft.id, actor.id);
  return draft.id;
end
$create_catalog_draft_from_latest$;

create or replace function public.publish_catalog_draft(p_version_id uuid, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $publish_catalog_draft$
declare
  actor public.profiles;
  prior_request public.deal_catalog_version_requests;
  draft public.deal_catalog_versions;
  before_state jsonb;
begin
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023'; end if;
  select * into actor from public.profiles where id = auth.uid() and status = 'active';
  if actor.id is null or not public.has_access_role(actor.team_id, array['owner', 'admin']) then raise exception 'ADMIN_REQUIRED' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.team_id, 1));
  select * into prior_request from public.deal_catalog_version_requests where team_id = actor.team_id and idempotency_key = p_idempotency_key;
  if prior_request.version_id is not null then
    if prior_request.action <> 'publish' or prior_request.version_id <> p_version_id then raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = '23505'; end if;
    return prior_request.version_id;
  end if;
  select * into draft from public.deal_catalog_versions where id = p_version_id and team_id = actor.team_id for update;
  if draft.id is null then raise exception 'CATALOG_VERSION_NOT_FOUND' using errcode = 'P0002'; end if;
  if draft.status <> 'draft' then raise exception 'CATALOG_VERSION_NOT_DRAFT' using errcode = '55000'; end if;
  if not exists (select 1 from public.deal_catalog_items i where i.team_id = actor.team_id and i.catalog_version_id = draft.id and i.is_active) then
    raise exception 'ACTIVE_CATALOG_ITEM_REQUIRED' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.deal_packages pkg
    where pkg.team_id = actor.team_id and pkg.catalog_version_id = draft.id
      and not exists (select 1 from public.deal_package_items pi where pi.team_id = actor.team_id and pi.package_id = pkg.id)
  ) then raise exception 'EMPTY_PACKAGE_NOT_ALLOWED' using errcode = '23514'; end if;
  if exists (
    select 1 from public.deal_package_items pi
    join public.deal_packages pkg on pkg.id = pi.package_id and pkg.team_id = pi.team_id
    join public.deal_catalog_items i on i.id = pi.catalog_item_id and i.team_id = pi.team_id
    where pi.team_id = actor.team_id and pkg.catalog_version_id = draft.id
      and (i.catalog_version_id <> draft.id or not i.is_active)
  ) then raise exception 'PACKAGE_ITEM_INVALID' using errcode = '23514'; end if;
  before_state := to_jsonb(draft);
  update public.deal_catalog_versions set status = 'retired'
  where team_id = actor.team_id and status = 'published' and id <> draft.id;
  update public.deal_catalog_versions set status = 'published', published_at = now(), published_by = actor.id
  where id = draft.id returning * into draft;
  insert into public.deal_catalog_version_requests(team_id, idempotency_key, action, version_id, actor_id)
  values(actor.team_id, p_idempotency_key, 'publish', draft.id, actor.id);
  insert into public.audit_logs(team_id, actor_id, action, target_type, target_id, before_data, after_data)
  values(actor.team_id, actor.id, 'catalog.version_published', 'deal_catalog_version', draft.id, before_state, to_jsonb(draft));
  return draft.id;
end
$publish_catalog_draft$;

revoke all on function public.get_catalog_version_admin_snapshot() from public;
revoke all on function public.create_catalog_draft_from_latest(uuid) from public;
revoke all on function public.publish_catalog_draft(uuid, uuid) from public;
grant execute on function public.get_catalog_version_admin_snapshot() to authenticated;
grant execute on function public.create_catalog_draft_from_latest(uuid) to authenticated;
grant execute on function public.publish_catalog_draft(uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
