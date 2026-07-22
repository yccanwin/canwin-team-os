-- Controlled one-time bootstrap for a clean Team OS 4.0 deployment.
-- The deployer creates exactly one Auth user first, then invokes this function
-- with a short-lived service-role credential. No credential value is accepted.

create or replace function private.bootstrap_team_os_4(
  p_company_name text,
  p_company_stable_key text,
  p_admin_user_id uuid,
  p_admin_email text,
  p_admin_display_name text,
  p_target_project_ref text,
  p_access_url text,
  p_actor_label text,
  p_bootstrap_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_admin_role_id uuid;
  v_role_count integer;
  v_capability_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('canwin-team-os-4:bootstrap')
  );

  if p_company_name is null or pg_catalog.btrim(p_company_name) = '' then
    raise exception 'company name is required' using errcode = '22023';
  end if;
  if p_company_stable_key is null
     or p_company_stable_key !~ '^[a-z][a-z0-9_-]{2,62}$' then
    raise exception 'company stable key is invalid' using errcode = '22023';
  end if;
  if p_admin_display_name is null or pg_catalog.btrim(p_admin_display_name) = '' then
    raise exception 'admin display name is required' using errcode = '22023';
  end if;
  if p_admin_email is null or pg_catalog.btrim(p_admin_email) = '' then
    raise exception 'admin email is required' using errcode = '22023';
  end if;
  if p_target_project_ref is null
     or p_target_project_ref !~ '^[a-z0-9]{20}$' then
    raise exception 'target project ref is invalid' using errcode = '22023';
  end if;
  if p_access_url is null
     or p_access_url !~ '^https://[a-z0-9.-]+(:[0-9]+)?(/.*)?$' then
    raise exception 'access URL is invalid' using errcode = '22023';
  end if;
  if p_actor_label is null or pg_catalog.btrim(p_actor_label) = '' then
    raise exception 'actor label is required' using errcode = '22023';
  end if;
  if p_bootstrap_version is null or pg_catalog.btrim(p_bootstrap_version) = '' then
    raise exception 'bootstrap version is required' using errcode = '22023';
  end if;

  if exists (select 1 from public.companies)
     or exists (select 1 from public.primary_roles)
     or exists (select 1 from public.capabilities)
     or exists (select 1 from public.profiles)
     or exists (select 1 from public.profile_capabilities)
     or exists (select 1 from public.system_runtime_state)
     or exists (select 1 from public.initialization_audit) then
    raise exception 'Team OS 4.0 is already initialized or the target is not clean'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from auth.users as u
    where u.id = p_admin_user_id
      and pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(p_admin_email))
  ) then
    raise exception 'the first administrator Auth user does not match'
      using errcode = '22023';
  end if;

  if exists (select 1 from auth.users as u where u.id <> p_admin_user_id) then
    raise exception 'target Auth is not clean' using errcode = '55000';
  end if;

  insert into public.companies (stable_key, name)
  values (p_company_stable_key, pg_catalog.btrim(p_company_name))
  returning id into v_company_id;

  insert into public.initialization_audit (
    company_id, event_type, actor_user_id, actor_label, succeeded, details
  ) values (
    v_company_id,
    'started',
    p_admin_user_id,
    pg_catalog.btrim(p_actor_label),
    true,
    pg_catalog.jsonb_build_object(
      'bootstrap_version', pg_catalog.btrim(p_bootstrap_version),
      'target_project_ref', p_target_project_ref,
      'access_url', p_access_url
    )
  );

  insert into public.primary_roles (company_id, role_key, label)
  values
    (v_company_id, 'sales', '销售'),
    (v_company_id, 'implementation', '实施'),
    (v_company_id, 'operations', '运维'),
    (v_company_id, 'finance', '财务'),
    (v_company_id, 'admin', '管理员');

  insert into public.capabilities (company_id, capability_key, label)
  values
    (v_company_id, 'warehouse', '仓库'),
    (v_company_id, 'supervisor', '主管');

  select r.id into strict v_admin_role_id
  from public.primary_roles as r
  where r.company_id = v_company_id and r.role_key = 'admin';

  insert into public.profiles (
    id, company_id, primary_role_id, display_name
  ) values (
    p_admin_user_id,
    v_company_id,
    v_admin_role_id,
    pg_catalog.btrim(p_admin_display_name)
  );

  insert into public.profile_capabilities (
    profile_id, capability_id, company_id, granted_by
  )
  select p_admin_user_id, c.id, v_company_id, p_admin_user_id
  from public.capabilities as c
  where c.company_id = v_company_id;

  select count(*) into v_role_count
  from public.primary_roles where company_id = v_company_id;
  select count(*) into v_capability_count
  from public.capabilities where company_id = v_company_id;

  if v_role_count <> 5 or v_capability_count <> 2 then
    raise exception 'bootstrap dictionary cardinality mismatch' using errcode = '55000';
  end if;

  insert into public.initialization_audit (
    company_id, event_type, actor_user_id, actor_label, succeeded, details
  ) values
    (
      v_company_id, 'company_created', p_admin_user_id,
      pg_catalog.btrim(p_actor_label), true, '{}'::jsonb
    ),
    (
      v_company_id, 'admin_created', p_admin_user_id,
      pg_catalog.btrim(p_actor_label), true, '{}'::jsonb
    );

  insert into public.system_runtime_state (
    company_id,
    initialization_sealed,
    migration_mode,
    business_writes_enabled,
    background_jobs_enabled,
    outbound_effects_enabled,
    changed_by
  ) values (
    v_company_id, true, true, false, false, false, p_admin_user_id
  );

  insert into public.initialization_audit (
    company_id, event_type, actor_user_id, actor_label, succeeded, details
  ) values (
    v_company_id,
    'sealed',
    p_admin_user_id,
    pg_catalog.btrim(p_actor_label),
    true,
    pg_catalog.jsonb_build_object(
      'bootstrap_version', pg_catalog.btrim(p_bootstrap_version),
      'target_project_ref', p_target_project_ref,
      'roles', v_role_count,
      'capabilities', v_capability_count,
      'migration_mode', true,
      'business_writes_enabled', false,
      'background_jobs_enabled', false,
      'outbound_effects_enabled', false
    )
  );

  -- The successful transaction permanently removes its own deployment entry.
  -- A second call is explicitly denied before any statement can run.
  revoke execute on function private.bootstrap_team_os_4(
    text, text, uuid, text, text, text, text, text, text
  ) from service_role;
  revoke execute on function public.bootstrap_team_os_4_deployment(
    text, text, uuid, text, text, text, text, text, text
  ) from service_role;

  return pg_catalog.jsonb_build_object(
    'status', 'sealed',
    'company_id', v_company_id,
    'admin_user_id', p_admin_user_id,
    'roles', v_role_count,
    'capabilities', v_capability_count
  );
end;
$function$;

revoke all on function private.bootstrap_team_os_4(
  text, text, uuid, text, text, text, text, text, text
) from public;
revoke all on function private.bootstrap_team_os_4(
  text, text, uuid, text, text, text, text, text, text
) from anon;
revoke all on function private.bootstrap_team_os_4(
  text, text, uuid, text, text, text, text, text, text
) from authenticated;
grant execute on function private.bootstrap_team_os_4(
  text, text, uuid, text, text, text, text, text, text
) to service_role;

comment on function private.bootstrap_team_os_4(
  text, text, uuid, text, text, text, text, text, text
) is 'One-time deployment bootstrap. Accepts no password, token, key, or credential value and revokes its own service_role execution privilege on success.';

-- PostgREST exposes public by default but not private. This invoker bridge has
-- no privilege of its own, is executable only by service_role, and is sealed by
-- the private function in the same successful transaction.
create or replace function public.bootstrap_team_os_4_deployment(
  p_company_name text,
  p_company_stable_key text,
  p_admin_user_id uuid,
  p_admin_email text,
  p_admin_display_name text,
  p_target_project_ref text,
  p_access_url text,
  p_actor_label text,
  p_bootstrap_version text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.bootstrap_team_os_4(
    p_company_name,
    p_company_stable_key,
    p_admin_user_id,
    p_admin_email,
    p_admin_display_name,
    p_target_project_ref,
    p_access_url,
    p_actor_label,
    p_bootstrap_version
  );
$function$;

revoke all on function public.bootstrap_team_os_4_deployment(
  text, text, uuid, text, text, text, text, text, text
) from public;
revoke all on function public.bootstrap_team_os_4_deployment(
  text, text, uuid, text, text, text, text, text, text
) from anon;
revoke all on function public.bootstrap_team_os_4_deployment(
  text, text, uuid, text, text, text, text, text, text
) from authenticated;
grant execute on function public.bootstrap_team_os_4_deployment(
  text, text, uuid, text, text, text, text, text, text
) to service_role;
