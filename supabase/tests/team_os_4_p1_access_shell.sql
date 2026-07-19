-- CanWin Team OS 4.0 P1 access-shell contract and rollback fixture.
-- Run only after the complete migration chain. All fixture rows are rolled back.

begin;

do $static$
declare
  expected_public_functions text[] := array[
    'public.get_app_context_v1()',
    'public.get_navigation_manifest_v1(text)',
    'public.resolve_responsible_profile_v1(text,uuid,uuid,timestamp with time zone)',
    'public.admin_apply_member_access_v1(uuid,text,text[],uuid[],uuid[],text[],uuid)',
    'public.admin_set_supervisor_system_v1(boolean,uuid)',
    'public.admin_replace_supervisor_scope_v1(uuid,uuid[],uuid[],text[],uuid)'
  ];
  signature text;
  definition text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profile_access_roles'
      and column_name = 'assignment_kind'
      and is_nullable = 'NO'
  ) then
    raise exception 'P1 assignment_kind contract missing';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'profile_access_roles'
      and indexname = 'profile_access_roles_one_primary_idx'
      and indexdef ilike '%unique%'
      and indexdef ilike '%assignment_kind%primary%'
  ) then
    raise exception 'P1 one-primary unique index missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profile_access_roles'::regclass
      and tgname = 'profile_access_roles_one_primary'
      and tgdeferrable
      and tginitdeferred
  ) then
    raise exception 'P1 deferred one-primary trigger missing';
  end if;

  foreach signature in array expected_public_functions loop
    if to_regprocedure(signature) is null then
      raise exception 'P1 RPC missing: %', signature;
    end if;
    if (select p.prosecdef from pg_proc p where p.oid = to_regprocedure(signature)) then
      raise exception 'P1 public wrapper must be security invoker: %', signature;
    end if;
    definition := lower(pg_get_functiondef(to_regprocedure(signature)));
    if position('set search_path to ''''' in definition) = 0 then
      raise exception 'P1 public wrapper search_path unsafe: %', signature;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.get_app_context_v1()', 'EXECUTE')
    or has_function_privilege('anon', 'public.get_navigation_manifest_v1(text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.admin_apply_member_access_v1(uuid,text,text[],uuid[],uuid[],text[],uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.resolve_responsible_profile_v1(text,uuid,uuid,timestamp with time zone)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.get_app_context_v1()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.get_navigation_manifest_v1(text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.admin_apply_member_access_v1(uuid,text,text[],uuid[],uuid[],text[],uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.resolve_responsible_profile_v1(text,uuid,uuid,timestamp with time zone)', 'EXECUTE') then
    raise exception 'P1 RPC grants are unsafe';
  end if;

  if has_function_privilege('authenticated', 'public.manage_profile_access(uuid,text[],uuid[])', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.admin_replace_profile_roles(uuid,text[],uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.admin_replace_supervisor_subordinates(uuid,uuid[],uuid)', 'EXECUTE') then
    raise exception 'A retired 3.0 access writer remains callable';
  end if;

  if has_table_privilege('authenticated', 'public.profile_access_roles', 'INSERT')
    or has_table_privilege('authenticated', 'public.profile_access_roles', 'UPDATE')
    or has_table_privilege('authenticated', 'public.profile_access_roles', 'DELETE')
    or has_table_privilege('authenticated', 'public.profile_sales_regions', 'INSERT')
    or has_table_privilege('authenticated', 'public.user_skills', 'INSERT')
    or has_table_privilege('authenticated', 'public.feature_flags', 'UPDATE')
    or has_table_privilege('authenticated', 'public.performance_supervisor_assignments', 'INSERT') then
    raise exception 'P1 protected access tables retain direct authenticated writes';
  end if;

  foreach signature in array array[
    'private.get_app_context_v1()',
    'private.get_navigation_manifest_v1(text)',
    'private.resolve_responsible_profile_v1(text,uuid,uuid,timestamp with time zone)',
    'private.admin_apply_member_access_v1(uuid,text,text[],uuid[],uuid[],text[],uuid)',
    'private.admin_set_supervisor_system_v1(boolean,uuid)',
    'private.admin_replace_supervisor_scope_v1(uuid,uuid[],uuid[],text[],uuid)'
  ] loop
    if to_regprocedure(signature) is null
      or not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure(signature)) then
      raise exception 'P1 private definer missing: %', signature;
    end if;
    definition := lower(pg_get_functiondef(to_regprocedure(signature)));
    if position('set search_path to ''''' in definition) = 0
      or has_function_privilege('anon', signature, 'EXECUTE') then
      raise exception 'P1 private boundary unsafe: %', signature;
    end if;
  end loop;
end
$static$;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('d4000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p1-admin@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('d4000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p1-sales@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('d4000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p1-implementation@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('d4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p1-operations@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('d4000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p1-finance@example.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles(id, team_id, name, role, status)
values
  ('d4000000-0000-4000-8000-000000000001', 'CANWIN_TEAM', 'P1 Admin', 'admin', 'active'),
  ('d4000000-0000-4000-8000-000000000002', 'CANWIN_TEAM', 'P1 Sales', 'member', 'active'),
  ('d4000000-0000-4000-8000-000000000003', 'CANWIN_TEAM', 'P1 Implementation', 'member', 'active'),
  ('d4000000-0000-4000-8000-000000000004', 'CANWIN_TEAM', 'P1 Operations', 'member', 'active'),
  ('d4000000-0000-4000-8000-000000000005', 'CANWIN_TEAM', 'P1 Finance', 'finance', 'active');

insert into public.profile_access_roles(team_id, profile_id, role_id, assignment_kind)
select 'CANWIN_TEAM', 'd4000000-0000-4000-8000-000000000001', ar.id, 'primary'
from public.access_roles ar
where ar.team_id = 'CANWIN_TEAM' and ar.code = 'admin';

insert into public.sales_regions(id, team_id, code, name, is_active)
values('d4100000-0000-4000-8000-000000000001', 'CANWIN_TEAM', 'p1_fixture', 'P1 Fixture Region', true);

select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000001', true);

do $fixture$
declare
  admin_id constant uuid := 'd4000000-0000-4000-8000-000000000001';
  sales_id constant uuid := 'd4000000-0000-4000-8000-000000000002';
  implementation_id constant uuid := 'd4000000-0000-4000-8000-000000000003';
  operations_id constant uuid := 'd4000000-0000-4000-8000-000000000004';
  finance_id constant uuid := 'd4000000-0000-4000-8000-000000000005';
  region_id constant uuid := 'd4100000-0000-4000-8000-000000000001';
  first_result jsonb;
  repeated_result jsonb;
begin
  perform public.admin_apply_member_access_v1(
    sales_id, 'sales', array['supervisor'], '{}'::uuid[], array[region_id], '{}'::text[],
    'd4200000-0000-4000-8000-000000000001'
  );
  first_result := public.admin_apply_member_access_v1(
    implementation_id, 'implementation', array['warehouse'], '{}'::uuid[], array[region_id], array['CANWIN_TEAM'],
    'd4200000-0000-4000-8000-000000000002'
  );
  repeated_result := public.admin_apply_member_access_v1(
    implementation_id, 'implementation', array['warehouse'], '{}'::uuid[], array[region_id], array['CANWIN_TEAM'],
    'd4200000-0000-4000-8000-000000000002'
  );
  if first_result <> repeated_result then
    raise exception 'P1 idempotent member access changed its result';
  end if;
  perform public.admin_apply_member_access_v1(
    operations_id, 'operations', '{}'::text[], '{}'::uuid[], '{}'::uuid[], '{}'::text[],
    'd4200000-0000-4000-8000-000000000003'
  );
  perform public.admin_apply_member_access_v1(
    finance_id, 'finance', '{}'::text[], '{}'::uuid[], '{}'::uuid[], '{}'::text[],
    'd4200000-0000-4000-8000-000000000004'
  );

  begin
    perform public.admin_apply_member_access_v1(
      sales_id, 'sales', array['warehouse'], '{}'::uuid[], '{}'::uuid[], array['CANWIN_TEAM'],
      'd4200000-0000-4000-8000-000000000005'
    );
    raise exception 'Sales incorrectly received warehouse function';
  exception when check_violation then
    if sqlerrm <> 'WAREHOUSE_FUNCTION_NOT_ASSIGNABLE' then raise; end if;
  end;

  begin
    perform public.admin_apply_member_access_v1(
      operations_id, 'sales', '{}'::text[], '{}'::uuid[], '{}'::uuid[], '{}'::text[],
      'd4200000-0000-4000-8000-000000000003'
    );
    raise exception 'Idempotency conflict was accepted';
  exception when unique_violation then
    if sqlerrm <> 'IDEMPOTENCY_KEY_CONFLICT' then raise; end if;
  end;
end
$fixture$;

set constraints profile_access_roles_one_primary immediate;
set constraints profile_access_roles_one_primary deferred;

do $roles$
declare
  identity_row record;
  context_value jsonb;
  navigation_value jsonb;
  actual_keys text[];
  expected_keys constant text[] := array[
    'additionalFunctions', 'availableWorkViews', 'company', 'currentWorkView',
    'navigationRevision', 'permissions', 'primaryRole', 'regionScopeIds', 'skills',
    'supervisorEnabled', 'supervisorScope', 'user', 'warehouseScopeIds'
  ];
begin
  if (select count(*) from public.profile_access_roles
      where profile_id between 'd4000000-0000-4000-8000-000000000001'::uuid
                           and 'd4000000-0000-4000-8000-000000000005'::uuid
        and assignment_kind = 'primary') <> 5 then
    raise exception 'Five P1 identities do not each have one primary role';
  end if;

  for identity_row in
    select * from (values
      ('d4000000-0000-4000-8000-000000000001', 'admin'),
      ('d4000000-0000-4000-8000-000000000002', 'sales'),
      ('d4000000-0000-4000-8000-000000000003', 'implementation'),
      ('d4000000-0000-4000-8000-000000000004', 'operations'),
      ('d4000000-0000-4000-8000-000000000005', 'finance')
    ) identities(user_id, primary_role)
  loop
    perform set_config('request.jwt.claim.sub', identity_row.user_id, true);
    context_value := public.get_app_context_v1();
    select array_agg(key order by key) into actual_keys from jsonb_object_keys(context_value) key;
    if actual_keys <> expected_keys
      or context_value->>'primaryRole' <> identity_row.primary_role
      or context_value->>'currentWorkView' <> identity_row.primary_role
      or context_value->'company'->>'id' <> 'CANWIN_TEAM' then
      raise exception 'P1 AppContext mismatch for %: %', identity_row.primary_role, context_value;
    end if;

    navigation_value := public.get_navigation_manifest_v1(identity_row.primary_role);
    if not exists (
      select 1 from jsonb_array_elements(navigation_value) item
      where item->>'routeId' = 'my-workbench'
    ) or not exists (
      select 1 from jsonb_array_elements(navigation_value) item
      where item->>'routeId' = 'progress'
    ) or not exists (
      select 1 from jsonb_array_elements(navigation_value) item
      where item->>'routeId' = 'calendar'
    ) or not exists (
      select 1 from jsonb_array_elements(navigation_value) item
      where item->>'routeId' = 'role-business'
    ) then
      raise exception 'P1 base navigation missing for %', identity_row.primary_role;
    end if;
    if exists (
      select 1 from jsonb_array_elements(navigation_value) item
      where item->>'routeId' = 'team-approval'
    ) then
      raise exception 'Supervisor entry visible while global switch is off';
    end if;
  end loop;

  perform set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000003', true);
  navigation_value := public.get_navigation_manifest_v1('implementation');
  if not exists (
    select 1 from jsonb_array_elements(navigation_value) item
    where item->>'routeId' = 'warehouse-processing'
  ) then
    raise exception 'Warehouse overlay is missing for implementation';
  end if;

  begin
    perform public.get_navigation_manifest_v1('finance');
    raise exception 'Forbidden work-view switch was accepted';
  exception when insufficient_privilege then
    if sqlerrm <> 'WORK_VIEW_FORBIDDEN' then raise; end if;
  end;
end
$roles$;

select set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000001', true);
select public.admin_set_supervisor_system_v1(true, 'd4300000-0000-4000-8000-000000000001');
select public.admin_replace_supervisor_scope_v1(
  'd4000000-0000-4000-8000-000000000002',
  array['d4100000-0000-4000-8000-000000000001'::uuid],
  array['d4000000-0000-4000-8000-000000000003'::uuid],
  array['implementation.approval'],
  'd4300000-0000-4000-8000-000000000002'
);

do $supervisor$
declare
  resolution jsonb;
  navigation_value jsonb;
  audit_count integer;
begin
  perform set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000003', true);
  resolution := public.resolve_responsible_profile_v1(
    'implementation.approval',
    'd4100000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000002',
    now()
  );
  if resolution <> jsonb_build_object(
    'profileId', 'd4000000-0000-4000-8000-000000000002'::uuid,
    'reason', 'matching_supervisor_scope',
    'fallbackApplied', false
  ) then
    raise exception 'Enabled supervisor did not receive matching responsibility: %', resolution;
  end if;

  perform set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000002', true);
  navigation_value := public.get_navigation_manifest_v1('sales');
  if not exists (
    select 1 from jsonb_array_elements(navigation_value) item
    where item->>'routeId' = 'team-approval'
  ) then
    raise exception 'Enabled supervisor entry is missing';
  end if;

  update public.profiles set status = 'disabled'
  where id = 'd4000000-0000-4000-8000-000000000002';
  perform set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000003', true);
  resolution := public.resolve_responsible_profile_v1(
    'implementation.approval',
    'd4100000-0000-4000-8000-000000000001',
    'd4000000-0000-4000-8000-000000000002',
    now()
  );
  if resolution->>'profileId' <> 'd4000000-0000-4000-8000-000000000001'
    or resolution->>'reason' <> 'supervisor_disabled'
    or (resolution->>'fallbackApplied')::boolean is not true then
    raise exception 'Disabled supervisor did not fall back to admin: %', resolution;
  end if;

  begin
    perform set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000002', true);
    perform public.get_app_context_v1();
    raise exception 'Disabled member received AppContext';
  exception when insufficient_privilege then
    if sqlerrm <> 'ACTIVE_MEMBER_REQUIRED' then raise; end if;
  end;
  update public.profiles set status = 'active'
  where id = 'd4000000-0000-4000-8000-000000000002';

  begin
    perform set_config('request.jwt.claim.sub', 'd4000000-0000-4000-8000-000000000005', true);
    perform public.admin_set_supervisor_system_v1(false, 'd4300000-0000-4000-8000-000000000003');
    raise exception 'Finance changed the supervisor system';
  exception when insufficient_privilege then
    if sqlerrm <> 'ACCESS_ADMIN_REQUIRED' then raise; end if;
  end;

  select count(*) into audit_count
  from public.audit_logs
  where actor_id = 'd4000000-0000-4000-8000-000000000001'
    and action in (
      'team_os_4.member_access_applied',
      'team_os_4.supervisor_system_set',
      'team_os_4.supervisor_scope_replaced'
    );
  if audit_count <> 6 then
    raise exception 'P1 access mutations did not create exact audit evidence: %', audit_count;
  end if;
end
$supervisor$;

select 'team_os_4_p1_access_shell_ok' as result;
rollback;
