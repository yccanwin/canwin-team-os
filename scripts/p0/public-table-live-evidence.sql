-- CanWin Team OS 4.0 P0 per-table live catalog evidence.
-- SELECT-only. Reads metadata and planner row estimates; never reads business rows,
-- function bodies, policy expressions, secrets, or user profile values.

with base_tables as (
  select
    c.oid as table_oid,
    c.relname as table_name,
    pg_catalog.pg_get_userbyid(c.relowner) as owner_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as force_rls,
    greatest(c.reltuples::bigint, 0) as estimated_rows,
    s.last_analyze,
    s.last_autoanalyze
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  left join pg_catalog.pg_stat_all_tables s on s.relid = c.oid
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
),
explicit_acl as (
  select
    t.table_oid,
    jsonb_agg(
      jsonb_build_object(
        'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end,
        'grantor', pg_catalog.pg_get_userbyid(acl.grantor),
        'privilege', acl.privilege_type,
        'grantable', acl.is_grantable
      )
      order by
        case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end,
        acl.privilege_type
    ) as entries
  from base_tables t
  join pg_catalog.pg_class c on c.oid = t.table_oid
  cross join lateral pg_catalog.aclexplode(
    coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
  ) acl
  group by t.table_oid
),
effective_grants as (
  select
    t.table_oid,
    jsonb_agg(
      jsonb_build_object('role', role_name, 'privilege', privilege_name)
      order by role_name, privilege_name
    ) filter (
      where pg_catalog.has_table_privilege(role_name, t.table_oid, privilege_name)
    ) as entries
  from base_tables t
  cross join (values ('anon'), ('authenticated'), ('service_role')) role_names(role_name)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) privileges(privilege_name)
  group by t.table_oid
),
policy_evidence as (
  select
    pol.polrelid as table_oid,
    jsonb_agg(
      jsonb_build_object(
        'name', pol.polname,
        'mode', case when pol.polpermissive then 'permissive' else 'restrictive' end,
        'command', case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end,
        'roles', (
          select coalesce(jsonb_agg(
            case when role_oid = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(role_oid) end
            order by role_oid
          ), '[]'::jsonb)
          from unnest(pol.polroles) role_oid
        ),
        'hasUsing', pol.polqual is not null,
        'hasCheck', pol.polwithcheck is not null
      )
      order by pol.polname
    ) as entries
  from pg_catalog.pg_policy pol
  group by pol.polrelid
),
trigger_evidence as (
  select
    t.tgrelid as table_oid,
    jsonb_agg(
      jsonb_build_object(
        'name', t.tgname,
        'enabledCode', t.tgenabled,
        'eventMask', t.tgtype,
        'functionSchema', pn.nspname,
        'functionName', p.proname,
        'functionArguments', pg_catalog.pg_get_function_identity_arguments(p.oid)
      )
      order by t.tgname
    ) as entries
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
  where not t.tgisinternal
  group by t.tgrelid
),
index_evidence as (
  select
    i.indrelid as table_oid,
    jsonb_agg(
      jsonb_build_object(
        'name', ic.relname,
        'primary', i.indisprimary,
        'unique', i.indisunique,
        'valid', i.indisvalid,
        'ready', i.indisready,
        'live', i.indislive,
        'keyAttributes', i.indnkeyatts,
        'totalAttributes', i.indnatts,
        'partial', i.indpred is not null,
        'expression', i.indexprs is not null
      )
      order by ic.relname
    ) as entries
  from pg_catalog.pg_index i
  join pg_catalog.pg_class ic on ic.oid = i.indexrelid
  group by i.indrelid
),
outgoing_fk_evidence as (
  select
    con.conrelid as table_oid,
    jsonb_agg(
      jsonb_build_object(
        'name', con.conname,
        'targetSchema', tn.nspname,
        'targetTable', tc.relname,
        'definition', pg_catalog.pg_get_constraintdef(con.oid, true)
      )
      order by con.conname
    ) as entries
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class tc on tc.oid = con.confrelid
  join pg_catalog.pg_namespace tn on tn.oid = tc.relnamespace
  where con.contype = 'f'
  group by con.conrelid
),
incoming_fk_evidence as (
  select
    con.confrelid as table_oid,
    jsonb_agg(
      jsonb_build_object(
        'name', con.conname,
        'sourceSchema', sn.nspname,
        'sourceTable', sc.relname
      )
      order by sn.nspname, sc.relname, con.conname
    ) as entries
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class sc on sc.oid = con.conrelid
  join pg_catalog.pg_namespace sn on sn.oid = sc.relnamespace
  where con.contype = 'f'
  group by con.confrelid
),
dependent_view_evidence as (
  select
    d.refobjid as table_oid,
    jsonb_agg(distinct jsonb_build_object('schema', vn.nspname, 'name', v.relname)) as entries
  from pg_catalog.pg_rewrite rw
  join pg_catalog.pg_class v on v.oid = rw.ev_class
  join pg_catalog.pg_namespace vn on vn.oid = v.relnamespace
  join pg_catalog.pg_depend d
    on d.classid = 'pg_catalog.pg_rewrite'::pg_catalog.regclass
   and d.objid = rw.oid
   and d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
  where v.relkind in ('v', 'm')
    and d.refobjid <> v.oid
  group by d.refobjid
),
catalog_routine_dependency_evidence as (
  select
    d.refobjid as table_oid,
    jsonb_agg(distinct jsonb_build_object(
      'schema', pn.nspname,
      'name', p.proname,
      'arguments', pg_catalog.pg_get_function_identity_arguments(p.oid)
    )) as entries
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
  join pg_catalog.pg_depend d
    on d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
   and d.objid = p.oid
   and d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
  where pn.nspname = 'public'
    and p.prokind in ('f', 'p')
  group by d.refobjid
)
select jsonb_build_object(
  'schemaVersion', 1,
  'evidenceType', 'production-readonly-public-table-catalog',
  'projectRef', 'agygfhmkazcbqaqwmljb',
  'capturedAtUtc', to_char(statement_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'serverVersionNum', current_setting('server_version_num')::int,
  'readOnly', true,
  'writePerformed', false,
  'businessRowsRead', false,
  'acceptanceStatus', 'candidate_unaccepted',
  'supervisorAccepted', false,
  'omissions', jsonb_build_array(
    'business row values',
    'exact count(*) scans',
    'function bodies',
    'policy expressions',
    'secrets and runtime configuration'
  ),
  'counts', jsonb_build_object(
    'tables', (select count(*) from base_tables),
    'rlsEnabled', (select count(*) from base_tables where rls_enabled),
    'explicitAclEntries', (select count(*) from base_tables t join lateral jsonb_array_elements(coalesce((select entries from explicit_acl a where a.table_oid = t.table_oid), '[]'::jsonb)) x on true),
    'effectiveClientGrantEntries', (select count(*) from base_tables t join lateral jsonb_array_elements(coalesce((select entries from effective_grants g where g.table_oid = t.table_oid), '[]'::jsonb)) x on true),
    'policies', (select count(*) from pg_catalog.pg_policy pol join base_tables t on t.table_oid = pol.polrelid),
    'triggerObjects', (select count(*) from pg_catalog.pg_trigger tr join base_tables t on t.table_oid = tr.tgrelid where not tr.tgisinternal),
    'indexes', (select count(*) from pg_catalog.pg_index i join base_tables t on t.table_oid = i.indrelid),
    'outgoingForeignKeys', (select count(*) from pg_catalog.pg_constraint con join base_tables t on t.table_oid = con.conrelid where con.contype = 'f')
  ),
  'tables', (
    select jsonb_agg(
      jsonb_build_object(
        'tableName', t.table_name,
        'owner', t.owner_name,
        'estimatedRows', t.estimated_rows,
        'lastAnalyze', case when t.last_analyze is null then null else to_char(t.last_analyze at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        'lastAutoAnalyze', case when t.last_autoanalyze is null then null else to_char(t.last_autoanalyze at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        'rls', jsonb_build_object('enabled', t.rls_enabled, 'forced', t.force_rls),
        'explicitAcl', coalesce(a.entries, '[]'::jsonb),
        'effectiveClientGrants', coalesce(g.entries, '[]'::jsonb),
        'policies', coalesce(pol.entries, '[]'::jsonb),
        'triggers', coalesce(tr.entries, '[]'::jsonb),
        'indexes', coalesce(ix.entries, '[]'::jsonb),
        'outgoingForeignKeys', coalesce(ofk.entries, '[]'::jsonb),
        'incomingForeignKeys', coalesce(ifk.entries, '[]'::jsonb),
        'dependentViews', coalesce(vd.entries, '[]'::jsonb),
        'catalogRoutineDependencies', coalesce(rd.entries, '[]'::jsonb)
      )
      order by t.table_name
    )
    from base_tables t
    left join explicit_acl a on a.table_oid = t.table_oid
    left join effective_grants g on g.table_oid = t.table_oid
    left join policy_evidence pol on pol.table_oid = t.table_oid
    left join trigger_evidence tr on tr.table_oid = t.table_oid
    left join index_evidence ix on ix.table_oid = t.table_oid
    left join outgoing_fk_evidence ofk on ofk.table_oid = t.table_oid
    left join incoming_fk_evidence ifk on ifk.table_oid = t.table_oid
    left join dependent_view_evidence vd on vd.table_oid = t.table_oid
    left join catalog_routine_dependency_evidence rd on rd.table_oid = t.table_oid
  )
) as catalog_evidence;
