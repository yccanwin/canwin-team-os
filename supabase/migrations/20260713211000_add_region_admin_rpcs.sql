-- Region administration for Team OS 3.0.
-- Additive RPC surface. Browser writes to region tables are removed so every
-- mutation is authorized, validated and audited on the server.

drop policy if exists "access managers manage regions" on public.sales_regions;
drop policy if exists "access managers manage region assignments" on public.profile_sales_regions;

create or replace function public.get_region_admin_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $get_region_admin_snapshot$
declare
  actor public.profiles;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and status = 'active';

  if actor.id is null or not public.has_access_role(actor.team_id, array['owner', 'admin']) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'regions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'code', r.code,
        'name', r.name,
        'regionLevel', r.region_level,
        'parentId', r.parent_id,
        'isActive', r.is_active,
        'assignedCount', (select count(*) from public.profile_sales_regions psr where psr.region_id = r.id)
      ) order by r.is_active desc, r.name)
      from public.sales_regions r
      where r.team_id = actor.team_id
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', coalesce(nullif(trim(p.name), ''), '未命名成员'),
        'status', p.status,
        'regions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'regionId', psr.region_id,
            'isPrimary', psr.is_primary
          ) order by psr.is_primary desc, psr.assigned_at)
          from public.profile_sales_regions psr
          where psr.team_id = actor.team_id and psr.profile_id = p.id
        ), '[]'::jsonb)
      ) order by p.status = 'active' desc, p.name)
      from public.profiles p
      where p.team_id = actor.team_id
    ), '[]'::jsonb)
  );
end
$get_region_admin_snapshot$;

create or replace function public.manage_sales_region(
  p_region_id uuid,
  p_code text,
  p_name text,
  p_region_level text,
  p_parent_id uuid,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $manage_sales_region$
declare
  actor public.profiles;
  target public.sales_regions;
  before_state jsonb;
begin
  select * into actor from public.profiles where id = auth.uid() and status = 'active';
  if actor.id is null or not public.has_access_role(actor.team_id, array['owner', 'admin']) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if trim(coalesce(p_code, '')) !~ '^[A-Za-z0-9_-]{2,32}$' then
    raise exception 'INVALID_REGION_CODE' using errcode = '23514';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 or char_length(trim(p_name)) > 48 then
    raise exception 'INVALID_REGION_NAME' using errcode = '23514';
  end if;
  if p_region_level not in ('province', 'city', 'district', 'custom') then
    raise exception 'INVALID_REGION_LEVEL' using errcode = '23514';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.sales_regions r
    where r.id = p_parent_id and r.team_id = actor.team_id and r.is_active
  ) then
    raise exception 'INVALID_PARENT_REGION' using errcode = '23514';
  end if;

  if p_region_id is null then
    insert into public.sales_regions(team_id, parent_id, code, name, region_level, is_active)
    values(actor.team_id, p_parent_id, upper(trim(p_code)), trim(p_name), p_region_level, coalesce(p_is_active, true))
    returning * into target;
  else
    select * into target from public.sales_regions where id = p_region_id and team_id = actor.team_id for update;
    if target.id is null then raise exception 'REGION_NOT_FOUND' using errcode = 'P0002'; end if;
    if p_parent_id = target.id then raise exception 'REGION_CANNOT_PARENT_ITSELF' using errcode = '23514'; end if;
    if p_parent_id is not null and exists (
      with recursive ancestors as (
        select r.id, r.parent_id from public.sales_regions r where r.id = p_parent_id and r.team_id = actor.team_id
        union all
        select r.id, r.parent_id from public.sales_regions r join ancestors a on r.id = a.parent_id where r.team_id = actor.team_id
      )
      select 1 from ancestors where id = target.id
    ) then
      raise exception 'REGION_PARENT_CYCLE' using errcode = '23514';
    end if;
    before_state := to_jsonb(target);
    update public.sales_regions
    set parent_id = p_parent_id,
        code = upper(trim(p_code)),
        name = trim(p_name),
        region_level = p_region_level,
        is_active = coalesce(p_is_active, target.is_active),
        updated_at = now()
    where id = target.id
    returning * into target;
  end if;

  insert into public.audit_logs(team_id, actor_id, action, target_type, target_id, before_data, after_data)
  values(target.team_id, actor.id, case when p_region_id is null then 'region.created' else 'region.updated' end,
    'sales_region', target.id, before_state, to_jsonb(target));
  return target.id;
end
$manage_sales_region$;

create or replace function public.manage_profile_regions(
  p_profile_id uuid,
  p_region_ids uuid[],
  p_primary_region_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $manage_profile_regions$
declare
  actor public.profiles;
  target public.profiles;
  regions uuid[] := coalesce(p_region_ids, array[]::uuid[]);
  before_state jsonb;
  after_state jsonb;
begin
  select * into actor from public.profiles where id = auth.uid() and status = 'active';
  select * into target from public.profiles where id = p_profile_id;
  if actor.id is null or target.id is null or actor.team_id <> target.team_id then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.has_access_role(actor.team_id, array['owner', 'admin']) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if cardinality(regions) <> (select count(distinct value) from unnest(regions) value) then
    raise exception 'DUPLICATE_REGION' using errcode = '23514';
  end if;
  if cardinality(regions) > 0 and (p_primary_region_id is null or not p_primary_region_id = any(regions)) then
    raise exception 'PRIMARY_REGION_REQUIRED' using errcode = '23514';
  end if;
  if cardinality(regions) = 0 and p_primary_region_id is not null then
    raise exception 'PRIMARY_REGION_NOT_ASSIGNED' using errcode = '23514';
  end if;
  if (select count(*) from public.sales_regions r where r.team_id = actor.team_id and r.is_active and r.id = any(regions)) <> cardinality(regions) then
    raise exception 'INVALID_REGION_FOR_TEAM' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('regionId', psr.region_id, 'isPrimary', psr.is_primary)), '[]'::jsonb)
  into before_state from public.profile_sales_regions psr
  where psr.team_id = actor.team_id and psr.profile_id = target.id;

  delete from public.profile_sales_regions where team_id = actor.team_id and profile_id = target.id;
  insert into public.profile_sales_regions(team_id, profile_id, region_id, is_primary, assigned_by)
  select actor.team_id, target.id, value, value = p_primary_region_id, actor.id
  from unnest(regions) value;

  select coalesce(jsonb_agg(jsonb_build_object('regionId', psr.region_id, 'isPrimary', psr.is_primary)), '[]'::jsonb)
  into after_state from public.profile_sales_regions psr
  where psr.team_id = actor.team_id and psr.profile_id = target.id;

  insert into public.audit_logs(team_id, actor_id, action, target_type, target_id, before_data, after_data)
  values(actor.team_id, actor.id, 'profile.regions_replaced', 'profile', target.id, before_state, after_state);
  return after_state;
end
$manage_profile_regions$;

revoke all on function public.get_region_admin_snapshot() from public;
revoke all on function public.manage_sales_region(uuid, text, text, text, uuid, boolean) from public;
revoke all on function public.manage_profile_regions(uuid, uuid[], uuid) from public;
grant execute on function public.get_region_admin_snapshot() to authenticated;
grant execute on function public.manage_sales_region(uuid, text, text, text, uuid, boolean) to authenticated;
grant execute on function public.manage_profile_regions(uuid, uuid[], uuid) to authenticated;

notify pgrst, 'reload schema';
