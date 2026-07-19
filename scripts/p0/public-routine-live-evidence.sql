-- CanWin Team OS 4.0 P0 per-routine live catalog evidence.
-- SELECT-only. Function definitions are inspected only inside PostgreSQL to emit
-- fingerprints and boolean risk markers; function bodies and business rows are never returned.

with routines as (
  select
    p.oid as routine_oid,
    p.proname as routine_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    case p.prokind when 'p' then 'procedure' else 'function' end as routine_type,
    pg_catalog.pg_get_userbyid(p.proowner) as owner_name,
    l.lanname as language_name,
    p.prosecdef as security_definer,
    p.proleakproof as leakproof,
    p.provolatile as volatility_code,
    p.proparallel as parallel_code,
    coalesce(p.proconfig, array[]::text[]) as configuration,
    pg_catalog.pg_get_functiondef(p.oid) as definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
),
explicit_acl as (
  select
    r.routine_oid,
    jsonb_agg(
      jsonb_build_object(
        'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end,
        'grantor', pg_catalog.pg_get_userbyid(acl.grantor),
        'privilege', acl.privilege_type,
        'grantable', acl.is_grantable
      )
      order by case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end
    ) as entries
  from routines r
  join pg_catalog.pg_proc p on p.oid = r.routine_oid
  cross join lateral pg_catalog.aclexplode(
    coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
  ) acl
  group by r.routine_oid
),
effective_execute as (
  select
    r.routine_oid,
    jsonb_agg(role_name order by role_name) filter (
      where pg_catalog.has_function_privilege(role_name, r.routine_oid, 'EXECUTE')
    ) as roles
  from routines r
  cross join (values ('anon'), ('authenticated'), ('service_role')) role_names(role_name)
  group by r.routine_oid
),
trigger_usage as (
  select
    t.tgfoid as routine_oid,
    jsonb_agg(
      jsonb_build_object(
        'tableSchema', n.nspname,
        'tableName', c.relname,
        'triggerName', t.tgname,
        'enabledCode', t.tgenabled,
        'eventMask', t.tgtype
      )
      order by n.nspname, c.relname, t.tgname
    ) as entries
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
  group by t.tgfoid
),
catalog_relation_dependencies as (
  select
    d.objid as routine_oid,
    jsonb_agg(distinct jsonb_build_object('schema', n.nspname, 'relation', c.relname)) as entries
  from pg_catalog.pg_depend d
  join pg_catalog.pg_class c on c.oid = d.refobjid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
    and d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
  group by d.objid
),
routine_rows as (
  select
    r.*,
    coalesce(a.entries, '[]'::jsonb) as explicit_acl_entries,
    coalesce(e.roles, '[]'::jsonb) as effective_execute_roles,
    coalesce(t.entries, '[]'::jsonb) as trigger_uses,
    coalesce(d.entries, '[]'::jsonb) as relation_dependencies,
    coalesce((
      select jsonb_agg(setting order by setting)
      from unnest(r.configuration) setting
      where setting like 'search_path=%'
    ), '[]'::jsonb) as search_path_settings,
    md5(r.definition) as definition_md5,
    length(r.definition) as definition_length,
    position('auth.uid' in lower(r.definition)) > 0 as uses_auth_uid,
    position('auth.jwt' in lower(r.definition)) > 0 as uses_auth_jwt,
    position('request.jwt' in lower(r.definition)) > 0 as uses_request_jwt,
    position('team_id' in lower(r.definition)) > 0 as uses_team_scope_marker,
    lower(r.definition) ~ '(has_access_role|has_role|is_admin|role_code|access_role)' as uses_role_guard_marker,
    lower(r.definition) ~ '\mexecute\M' as uses_dynamic_sql_marker,
    lower(r.definition) ~ '\m(insert|update|delete|merge)\M' as writes_data_marker,
    lower(r.definition) ~ '\mraise\M' as raises_exception_marker
  from routines r
  left join explicit_acl a on a.routine_oid = r.routine_oid
  left join effective_execute e on e.routine_oid = r.routine_oid
  left join trigger_usage t on t.routine_oid = r.routine_oid
  left join catalog_relation_dependencies d on d.routine_oid = r.routine_oid
)
select jsonb_build_object(
  'schemaVersion', 1,
  'evidenceType', 'production-readonly-public-routine-catalog',
  'projectRef', 'agygfhmkazcbqaqwmljb',
  'capturedAtUtc', to_char(statement_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'serverVersionNum', current_setting('server_version_num')::int,
  'readOnly', true,
  'writePerformed', false,
  'businessRowsRead', false,
  'functionBodiesReturned', false,
  'acceptanceStatus', 'candidate_unaccepted',
  'supervisorAccepted', false,
  'limitations', jsonb_build_array(
    'boolean markers are candidate evidence, not proof of authorization correctness',
    'pg_depend does not reveal every PL/pgSQL or dynamic SQL dependency',
    'frontend and Edge Function callers require local source cross-check',
    'function bodies, policy expressions, secrets and business rows are omitted'
  ),
  'counts', jsonb_build_object(
    'routines', (select count(*) from routine_rows),
    'securityDefiner', (select count(*) from routine_rows where security_definer),
    'authenticatedSecurityDefiner', (select count(*) from routine_rows where security_definer and effective_execute_roles ? 'authenticated'),
    'missingSearchPath', (select count(*) from routine_rows where jsonb_array_length(search_path_settings) = 0),
    'triggerFunctions', (select count(*) from routine_rows where jsonb_array_length(trigger_uses) > 0),
    'triggerObjectsUsingPublicRoutines', (select coalesce(sum(jsonb_array_length(trigger_uses)), 0) from routine_rows),
    'publicRoutineTriggerUsesOnPublicTables', (
      select count(*)
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace tn on tn.oid = c.relnamespace
      join routines r on r.routine_oid = t.tgfoid
      where not t.tgisinternal and tn.nspname = 'public'
    ),
    'publicRoutineTriggerUsesOnNonPublicTables', (
      select count(*)
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace tn on tn.oid = c.relnamespace
      join routines r on r.routine_oid = t.tgfoid
      where not t.tgisinternal and tn.nspname <> 'public'
    ),
    'publicTableTriggerObjects', (
      select count(*)
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace tn on tn.oid = c.relnamespace
      where not t.tgisinternal and tn.nspname = 'public'
    ),
    'publicTableTriggerObjectsUsingNonPublicRoutines', (
      select count(*)
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace tn on tn.oid = c.relnamespace
      join pg_catalog.pg_proc p on p.oid = t.tgfoid
      join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
      where not t.tgisinternal and tn.nspname = 'public' and pn.nspname <> 'public'
    ),
    'triggerFunctionsAuthenticatedExecutable', (select count(*) from routine_rows where jsonb_array_length(trigger_uses) > 0 and effective_execute_roles ? 'authenticated'),
    'anonExecutable', (select count(*) from routine_rows where effective_execute_roles ? 'anon'),
    'authenticatedExecutable', (select count(*) from routine_rows where effective_execute_roles ? 'authenticated'),
    'serviceRoleExecutable', (select count(*) from routine_rows where effective_execute_roles ? 'service_role'),
    'sqlLanguage', (select count(*) from routine_rows where language_name = 'sql'),
    'plpgsqlLanguage', (select count(*) from routine_rows where language_name = 'plpgsql'),
    'explicitAclEntries', (select coalesce(sum(jsonb_array_length(explicit_acl_entries)), 0) from routine_rows),
    'catalogRelationDependencyEntries', (select coalesce(sum(jsonb_array_length(relation_dependencies)), 0) from routine_rows)
  ),
  'candidateClassifications', jsonb_build_object(
    'triggerFunction', (select count(*) from routine_rows where jsonb_array_length(trigger_uses) > 0),
    'anonymousRpc', (select count(*) from routine_rows where jsonb_array_length(trigger_uses) = 0 and effective_execute_roles ? 'anon'),
    'authenticatedRpc', (select count(*) from routine_rows where jsonb_array_length(trigger_uses) = 0 and not (effective_execute_roles ? 'anon') and effective_execute_roles ? 'authenticated'),
    'internalHelper', (select count(*) from routine_rows where jsonb_array_length(trigger_uses) = 0 and not (effective_execute_roles ? 'anon') and not (effective_execute_roles ? 'authenticated'))
  ),
  'routines', (
    select jsonb_agg(
      jsonb_build_object(
        'signature', routine_name || '(' || identity_arguments || ')',
        'name', routine_name,
        'identityArguments', identity_arguments,
        'resultType', result_type,
        'routineType', routine_type,
        'owner', owner_name,
        'language', language_name,
        'securityDefiner', security_definer,
        'leakproof', leakproof,
        'volatilityCode', volatility_code,
        'parallelCode', parallel_code,
        'searchPathSettings', search_path_settings,
        'explicitAcl', explicit_acl_entries,
        'effectiveExecuteRoles', effective_execute_roles,
        'triggerUses', trigger_uses,
        'catalogRelationDependencies', relation_dependencies,
        'definitionEvidence', jsonb_build_object(
          'md5', definition_md5,
          'length', definition_length,
          'usesAuthUid', uses_auth_uid,
          'usesAuthJwt', uses_auth_jwt,
          'usesRequestJwt', uses_request_jwt,
          'usesTeamScopeMarker', uses_team_scope_marker,
          'usesRoleGuardMarker', uses_role_guard_marker,
          'usesDynamicSqlMarker', uses_dynamic_sql_marker,
          'writesDataMarker', writes_data_marker,
          'raisesExceptionMarker', raises_exception_marker,
          'bodyReturned', false
        ),
        'candidateClassification', case
          when jsonb_array_length(trigger_uses) > 0 then 'trigger_function_candidate'
          when effective_execute_roles ? 'anon' then 'anonymous_rpc_candidate'
          when effective_execute_roles ? 'authenticated' then 'authenticated_rpc_candidate'
          else 'internal_helper_candidate'
        end,
        'acceptanceStatus', 'candidate_unaccepted'
      )
      order by routine_name, identity_arguments
    )
    from routine_rows
  )
) as routine_evidence;
