-- Keep the 4.0 role assignments and the legacy profiles.role compatibility
-- value in one database transaction. This is a function-only replacement:
-- applying the migration does not rewrite existing profile rows.
create or replace function private.admin_apply_member_access_v1(
  p_profile_id uuid,
  p_primary_role text,
  p_additional_functions text[],
  p_skill_ids uuid[],
  p_region_scope_ids uuid[],
  p_warehouse_scope_ids text[],
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  target public.profiles;
  functions text[];
  skills uuid[];
  regions uuid[];
  warehouse_scopes text[];
  legacy_role text;
  payload jsonb;
  before_state jsonb;
  result_value jsonb;
  prior public.access_admin_requests;
  flag public.feature_flags;
  audit_id uuid;
begin
  select p.* into actor from public.profiles p where p.id = auth.uid() and p.status = 'active';
  select p.* into target from public.profiles p where p.id = p_profile_id;
  if actor.id is null or target.id is null or actor.team_id <> target.team_id
     or private.member_primary_role_v1(actor.team_id, actor.id) <> 'admin' then
    raise exception 'ACCESS_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct item order by item), '{}'::text[])
  into functions from unnest(coalesce(p_additional_functions, '{}'::text[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[])
  into skills from unnest(coalesce(p_skill_ids, '{}'::uuid[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[])
  into regions from unnest(coalesce(p_region_scope_ids, '{}'::uuid[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::text[])
  into warehouse_scopes from unnest(coalesce(p_warehouse_scope_ids, '{}'::text[])) item;

  if p_primary_role not in ('sales', 'implementation', 'operations', 'finance', 'admin') then
    raise exception 'INVALID_PRIMARY_ROLE' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(functions) item where item not in ('warehouse', 'supervisor')) then
    raise exception 'INVALID_ADDITIONAL_FUNCTION' using errcode = '23514';
  end if;
  if 'warehouse' = any(functions) and p_primary_role not in ('implementation', 'admin') then
    raise exception 'WAREHOUSE_FUNCTION_NOT_ASSIGNABLE' using errcode = '23514';
  end if;
  if (not ('warehouse' = any(functions)) and cardinality(warehouse_scopes) > 0)
     or exists (select 1 from unnest(warehouse_scopes) item where item <> actor.team_id) then
    raise exception 'INVALID_WAREHOUSE_SCOPE' using errcode = '23514';
  end if;
  if (select count(*) from public.skills s where s.team_id = actor.team_id and s.id = any(skills)) <> cardinality(skills) then
    raise exception 'INVALID_SKILL_SCOPE' using errcode = '23514';
  end if;
  if (select count(*) from public.sales_regions r where r.team_id = actor.team_id and r.is_active and r.id = any(regions)) <> cardinality(regions) then
    raise exception 'INVALID_REGION_SCOPE' using errcode = '23514';
  end if;

  legacy_role := case
    when p_primary_role = 'admin' then 'admin'
    when 'supervisor' = any(functions) then 'captain'
    when p_primary_role = 'finance' then 'finance'
    when 'warehouse' = any(functions) then 'warehouse'
    else 'member'
  end;

  payload := jsonb_build_object(
    'profileId', target.id,
    'primaryRole', p_primary_role,
    'legacyRole', legacy_role,
    'additionalFunctions', to_jsonb(functions),
    'skillIds', to_jsonb(skills),
    'regionScopeIds', to_jsonb(regions),
    'warehouseScopeIds', to_jsonb(warehouse_scopes)
  );
  select req.* into prior
  from public.access_admin_requests req
  where req.team_id = actor.team_id and req.idempotency_key = p_idempotency_key;
  if prior.idempotency_key is not null then
    if prior.action <> 'team_os_4.member_access.apply' or prior.payload <> payload then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = '23505';
    end if;
    return prior.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.team_id || target.id::text, 401));
  before_state := jsonb_build_object(
    'primaryRole', private.member_primary_role_v1(target.team_id, target.id),
    'legacyRole', target.role,
    'additionalFunctions', to_jsonb(private.member_additional_functions_v1(target.team_id, target.id))
  );

  delete from public.profile_access_roles par
  where par.team_id = target.team_id and par.profile_id = target.id;
  insert into public.profile_access_roles(team_id, profile_id, role_id, assigned_by, assignment_kind)
  select target.team_id, target.id, ar.id, actor.id, 'primary'
  from public.access_roles ar
  where ar.team_id = target.team_id and ar.code = p_primary_role;
  insert into public.profile_access_roles(team_id, profile_id, role_id, assigned_by, assignment_kind)
  select target.team_id, target.id, ar.id, actor.id, 'additional_function'
  from public.access_roles ar
  where ar.team_id = target.team_id and ar.code = any(functions);

  update public.profiles p
  set role = legacy_role,
      updated_at = now()
  where p.id = target.id and p.team_id = target.team_id;

  delete from public.user_skills us where us.team_id = target.team_id and us.user_id = target.id;
  insert into public.user_skills(team_id, user_id, skill_id)
  select target.team_id, target.id, item from unnest(skills) item;

  delete from public.profile_sales_regions psr where psr.team_id = target.team_id and psr.profile_id = target.id;
  insert into public.profile_sales_regions(team_id, profile_id, region_id, assigned_by, is_primary)
  select target.team_id, target.id, item, actor.id, row_number() over(order by item) = 1
  from unnest(regions) item;

  select ff.* into flag
  from public.feature_flags ff
  where ff.team_id = target.team_id and ff.key = 'team_os_4_supervisor'
  for update;
  update public.feature_flags ff
  set config = coalesce(flag.config, '{}'::jsonb) || jsonb_build_object(
        'warehouseScopesByProfile',
        coalesce(flag.config->'warehouseScopesByProfile', '{}'::jsonb)
          || jsonb_build_object(target.id::text, to_jsonb(warehouse_scopes))
      ),
      updated_by = actor.id,
      updated_at = now()
  where ff.id = flag.id;

  insert into public.audit_logs(team_id, actor_id, action, target_type, target_id, before_data, after_data)
  values(target.team_id, actor.id, 'team_os_4.member_access_applied', 'profile', target.id, before_state, payload)
  returning id into audit_id;
  result_value := jsonb_build_object('subjectId', target.id, 'revision', audit_id, 'auditId', audit_id);
  insert into public.access_admin_requests(team_id, idempotency_key, action, payload, result, actor_id)
  values(actor.team_id, p_idempotency_key, 'team_os_4.member_access.apply', payload, result_value, actor.id);
  return result_value;
end $$;

revoke all on function
  public.enqueue_wecom_notification_jobs(text, timestamp with time zone),
  public.claim_wecom_notification_jobs(integer, timestamp with time zone),
  public.complete_wecom_notification_job(uuid, boolean, text, text, timestamp with time zone),
  public.manage_profile_access(uuid, text[], uuid[]),
  public.admin_replace_profile_roles(uuid, text[], uuid),
  public.admin_replace_supervisor_subordinates(uuid, uuid[], uuid)
from public, anon, authenticated;

grant execute on function
  public.enqueue_wecom_notification_jobs(text, timestamp with time zone),
  public.claim_wecom_notification_jobs(integer, timestamp with time zone),
  public.complete_wecom_notification_job(uuid, boolean, text, text, timestamp with time zone)
to service_role;

notify pgrst, 'reload schema';
