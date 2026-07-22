-- Aggregate-only G1 state. This query intentionally returns no email, user id,
-- credential, token, or row-level business payload.
select pg_catalog.jsonb_build_object(
  'project_ref_from_init', (
    select details ->> 'target_project_ref'
    from public.initialization_audit
    where event_type = 'started' and succeeded
    order by occurred_at asc
    limit 1
  ),
  'companies', (select count(*) from public.companies),
  'auth_users_total', (select count(*) from auth.users),
  'acceptance_auth_users', (
    select count(*)
    from auth.users
    where raw_app_meta_data ->> 'system' = 'team-os-4-acceptance'
  ),
  'profiles_total', (select count(*) from public.profiles),
  'acceptance_profiles', (
    select count(*)
    from public.profiles
    where display_name like 'G1 ACCEPTANCE %'
  ),
  'active_profiles_by_role', (
    select pg_catalog.coalesce(
      pg_catalog.jsonb_object_agg(role_key, profile_count order by role_key),
      '{}'::jsonb
    )
    from (
      select r.role_key, count(p.id) as profile_count
      from public.primary_roles as r
      left join public.profiles as p
        on p.primary_role_id = r.id
       and p.company_id = r.company_id
       and p.is_active
      group by r.role_key
    ) as role_counts
  ),
  'primary_roles', (
    select pg_catalog.coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('key', role_key, 'active', is_active)
        order by role_key
      ),
      '[]'::jsonb
    )
    from public.primary_roles
  ),
  'capabilities', (
    select pg_catalog.coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('key', capability_key, 'active', is_active)
        order by capability_key
      ),
      '[]'::jsonb
    )
    from public.capabilities
  ),
  'profile_capabilities_total', (select count(*) from public.profile_capabilities),
  'acceptance_capabilities_by_role', (
    select pg_catalog.coalesce(
      pg_catalog.jsonb_object_agg(role_key, capability_keys order by role_key),
      '{}'::jsonb
    )
    from (
      select
        r.role_key,
        pg_catalog.coalesce(
          pg_catalog.jsonb_agg(c.capability_key order by c.capability_key)
            filter (where c.capability_key is not null),
          '[]'::jsonb
        ) as capability_keys
      from public.profiles as p
      join public.primary_roles as r
        on r.id = p.primary_role_id and r.company_id = p.company_id
      left join public.profile_capabilities as pc
        on pc.profile_id = p.id and pc.company_id = p.company_id and pc.revoked_at is null
      left join public.capabilities as c
        on c.id = pc.capability_id and c.company_id = pc.company_id and c.is_active
      where p.display_name like 'G1 ACCEPTANCE %'
      group by r.role_key
    ) as capability_counts
  ),
  'g1_runs_prepared', (
    select count(*) from private.g1_acceptance_runs where status = 'prepared'
  ),
  'g1_runs_retained', (
    select count(*) from private.g1_acceptance_runs where status = 'retained'
  ),
  'g1_baselines', (select count(*) from private.g1_acceptance_baselines),
  'g1_functions', (
    select count(*)
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'preflight_g1_acceptance_v1',
        'create_g1_acceptance_run_v1',
        'cleanup_g1_acceptance_run_v1',
        'retain_g1_acceptance_run_v1'
      )
  ),
  'g1_run_work_items', (
    select count(*) from public.work_items where source_business = 'g1_acceptance'
  )
) as g1_acceptance_state;
