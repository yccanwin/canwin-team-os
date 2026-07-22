-- Aggregate-only G1 state. This query intentionally returns no email, user id,
-- credential, token, or row-level business payload.
with acceptance_identity_state as (
  select
    u.raw_app_meta_data ->> 'identity_key' as identity_key,
    r.role_key as primary_role,
    p.is_active as profile_active,
    u.raw_app_meta_data ->> 'acceptance_state' as acceptance_state_raw,
    case u.raw_app_meta_data ->> 'acceptance_state'
      when 'retained' then 'accepted'
      when 'provisioning' then 'pending'
      when 'quarantined' then 'failed-isolated'
      else 'unknown'
    end as acceptance_result
  from auth.users as u
  left join public.profiles as p on p.id = u.id
  left join public.primary_roles as r
    on r.id = p.primary_role_id and r.company_id = p.company_id
  where u.raw_app_meta_data ->> 'system' = 'team-os-4-acceptance'
),
g1_run_state as (
  select
    run_id,
    status,
    target_project_ref,
    application_commit,
    retained_at is not null as retained_at_exists,
    runtime_evidence ->> 'status' as runtime_evidence_status,
    runtime_evidence -> 'current_run_counts' as runtime_current_run_counts,
    case
      when pg_catalog.jsonb_typeof(runtime_evidence #> '{current_run_counts,total}') = 'number'
        then (runtime_evidence #>> '{current_run_counts,total}')::integer
      else null
    end as runtime_total,
    case
      when pg_catalog.jsonb_typeof(runtime_evidence -> 'records') = 'array'
        then pg_catalog.jsonb_array_length(runtime_evidence -> 'records')
      else null
    end as runtime_records_array_length,
    case
      when pg_catalog.jsonb_typeof(runtime_evidence -> 'first_failure_stopped') = 'boolean'
        then (runtime_evidence ->> 'first_failure_stopped')::boolean
      else null
    end as first_failure_stopped,
    runtime_evidence ->> 'totals_source' as totals_source,
    runtime_evidence_sha256 is not null
      and runtime_evidence_sha256 = runtime_evidence ->> 'evidence_sha256' as runtime_sha256_matches
  from private.g1_acceptance_runs
)
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
  'acceptance_identities', (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'identity_key', identity_key,
          'primary_role', primary_role,
          'profile_active', profile_active,
          'acceptance_state_raw', acceptance_state_raw,
          'acceptance_result', acceptance_result
        )
        order by identity_key
      ),
      '[]'::jsonb
    )
    from acceptance_identity_state
  ),
  'acceptance_identity_matrix_valid', (
    select
      count(*) = 5
      and count(distinct identity_key) = 5
      and coalesce(
        pg_catalog.bool_and(
          (identity_key = 'sales' and primary_role = 'sales')
          or (identity_key = 'implementation' and primary_role = 'implementation')
          or (identity_key = 'operations' and primary_role = 'operations')
          or (identity_key = 'finance' and primary_role = 'finance')
          or (identity_key = 'admin_supervisor' and primary_role = 'admin')
        ),
        false
      )
    from acceptance_identity_state
  ),
  'active_profiles_by_role', (
    select coalesce(
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
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('key', role_key, 'active', is_active)
        order by role_key
      ),
      '[]'::jsonb
    )
    from public.primary_roles
  ),
  'capabilities', (
    select coalesce(
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
    select coalesce(
      pg_catalog.jsonb_object_agg(role_key, capability_keys order by role_key),
      '{}'::jsonb
    )
    from (
      select
        r.role_key,
        coalesce(
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
  'g1_runs', (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'run_id', run_id,
          'status', status,
          'target_project_ref', target_project_ref,
          'application_commit', application_commit,
          'retained_at_exists', retained_at_exists,
          'runtime_evidence_status', runtime_evidence_status,
          'runtime_current_run_counts', runtime_current_run_counts,
          'runtime_records_array_length', runtime_records_array_length,
          'first_failure_stopped', first_failure_stopped,
          'totals_source', totals_source,
          'runtime_sha256_matches', runtime_sha256_matches
        )
        order by run_id
      ),
      '[]'::jsonb
    )
    from g1_run_state
  ),
  'official_seal_present', (
    select exists (
      select 1
      from g1_run_state
      where status = 'retained'
        and retained_at_exists
        and runtime_evidence_status = 'passed'
        and runtime_total = 82
        and runtime_records_array_length = 82
        and runtime_sha256_matches
    )
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
