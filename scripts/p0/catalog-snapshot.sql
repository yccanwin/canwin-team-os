-- CanWin Team OS 4.0 P0 catalog snapshot.
-- Every statement reads metadata only. Row totals are planner estimates from pg_class.
-- Function bodies, policy expressions, trigger statements, and business rows are excluded.

select
  'snapshot_metadata' as section,
  statement_timestamp() at time zone 'UTC' as captured_at_utc,
  current_setting('server_version_num') as server_version_num;

select
  'summary_counts' as section,
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  ) as public_tables,
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v', 'm')
  ) as public_views,
  (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
  ) as public_routines,
  (
    select count(*)
    from pg_catalog.pg_policy pol
    join pg_catalog.pg_class c on c.oid = pol.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  ) as public_policies,
  (
    select count(*)
    from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  ) as public_indexes,
  (
    select count(*)
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and not t.tgisinternal
  ) as public_trigger_objects,
  (
    select count(*)
    from information_schema.triggers t
    where t.event_object_schema = 'public'
  ) as public_trigger_event_rows,
  (
    select count(*)
    from supabase_migrations.schema_migrations sm
  ) as applied_migrations;

select
  'relations' as section,
  n.nspname as schema_name,
  c.relname as object_name,
  case c.relkind
    when 'r' then 'table'
    when 'p' then 'partitioned_table'
    when 'v' then 'view'
    when 'm' then 'materialized_view'
  end as object_type,
  pg_catalog.pg_get_userbyid(c.relowner) as owner_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls,
  case
    when c.relkind in ('v', 'm') then
      coalesce('security_invoker=true' = any(c.reloptions), false)
  end as view_security_invoker,
  case
    when c.relkind in ('r', 'p') then greatest(c.reltuples::bigint, 0)
  end as estimated_rows,
  s.last_analyze,
  s.last_autoanalyze
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
left join pg_catalog.pg_stat_all_tables s on s.relid = c.oid
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm')
order by object_type, object_name;

select
  'relation_acl' as section,
  n.nspname as schema_name,
  c.relname as object_name,
  case when acl.grantee = 0 then 'PUBLIC'
       else pg_catalog.pg_get_userbyid(acl.grantee)
  end as grantee_name,
  pg_catalog.pg_get_userbyid(acl.grantor) as grantor_name,
  acl.privilege_type,
  acl.is_grantable
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
cross join lateral pg_catalog.aclexplode(
  coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
) acl
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm')
order by object_name, grantee_name, privilege_type;

select
  'routines' as section,
  n.nspname as schema_name,
  p.proname as routine_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_catalog.pg_get_function_result(p.oid) as result_type,
  case p.prokind when 'p' then 'procedure' else 'function' end as routine_type,
  pg_catalog.pg_get_userbyid(p.proowner) as owner_name,
  p.prosecdef as security_definer,
  p.proleakproof as leakproof,
  p.provolatile as volatility_code,
  p.proparallel as parallel_code,
  (
    select string_agg(setting, ',' order by setting)
    from unnest(coalesce(p.proconfig, array[]::text[])) setting
    where setting like 'search_path=%'
  ) as search_path_setting
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind in ('f', 'p')
order by routine_name, identity_arguments;

select
  'routine_acl' as section,
  n.nspname as schema_name,
  p.proname as routine_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  case when acl.grantee = 0 then 'PUBLIC'
       else pg_catalog.pg_get_userbyid(acl.grantee)
  end as grantee_name,
  pg_catalog.pg_get_userbyid(acl.grantor) as grantor_name,
  acl.privilege_type,
  acl.is_grantable
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
cross join lateral pg_catalog.aclexplode(
  coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
) acl
where n.nspname = 'public'
  and p.prokind in ('f', 'p')
order by routine_name, identity_arguments, grantee_name;

select
  'policies' as section,
  n.nspname as schema_name,
  c.relname as table_name,
  pol.polname as policy_name,
  case when pol.polpermissive then 'permissive' else 'restrictive' end as policy_mode,
  pol.polcmd as command_code,
  array_to_string(
    array(
      select case when role_oid = 0 then 'PUBLIC'
                  else pg_catalog.pg_get_userbyid(role_oid)
             end
      from unnest(pol.polroles) role_oid
      order by role_oid
    ),
    ','
  ) as role_names,
  pol.polqual is not null as has_using_expression,
  pol.polwithcheck is not null as has_check_expression
from pg_catalog.pg_policy pol
join pg_catalog.pg_class c on c.oid = pol.polrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
order by table_name, policy_name;

select
  'trigger_objects' as section,
  n.nspname as table_schema,
  c.relname as table_name,
  t.tgname as trigger_name,
  t.tgenabled as enabled_code,
  t.tgtype as event_mask,
  pn.nspname as function_schema,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as function_arguments
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_proc p on p.oid = t.tgfoid
join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
where n.nspname = 'public'
  and not t.tgisinternal
order by table_name, trigger_name;

select
  'trigger_event_rows' as section,
  t.event_object_schema as table_schema,
  t.event_object_table as table_name,
  t.trigger_name,
  t.event_manipulation,
  t.action_timing,
  t.action_orientation,
  t.action_condition
from information_schema.triggers t
where t.event_object_schema = 'public'
order by table_name, trigger_name, event_manipulation;

select
  'indexes' as section,
  n.nspname as table_schema,
  c.relname as table_name,
  ic.relname as index_name,
  pg_catalog.pg_get_userbyid(ic.relowner) as owner_name,
  i.indisprimary as is_primary,
  i.indisunique as is_unique,
  i.indisvalid as is_valid,
  i.indisready as is_ready,
  i.indislive as is_live,
  i.indnkeyatts as key_attribute_count,
  i.indnatts as total_attribute_count,
  i.indpred is not null as has_predicate,
  i.indexprs is not null as has_expressions
from pg_catalog.pg_index i
join pg_catalog.pg_class c on c.oid = i.indrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_class ic on ic.oid = i.indexrelid
where n.nspname = 'public'
order by table_name, index_name;

select
  'foreign_key_dependencies' as section,
  sn.nspname as source_schema,
  sc.relname as source_table,
  con.conname as constraint_name,
  tn.nspname as target_schema,
  tc.relname as target_table,
  pg_catalog.pg_get_constraintdef(con.oid, true) as constraint_definition
from pg_catalog.pg_constraint con
join pg_catalog.pg_class sc on sc.oid = con.conrelid
join pg_catalog.pg_namespace sn on sn.oid = sc.relnamespace
join pg_catalog.pg_class tc on tc.oid = con.confrelid
join pg_catalog.pg_namespace tn on tn.oid = tc.relnamespace
where con.contype = 'f'
  and sn.nspname = 'public'
order by source_table, constraint_name;

select distinct
  'view_dependencies' as section,
  vn.nspname as view_schema,
  v.relname as view_name,
  bn.nspname as referenced_schema,
  b.relname as referenced_relation
from pg_catalog.pg_rewrite rw
join pg_catalog.pg_class v on v.oid = rw.ev_class
join pg_catalog.pg_namespace vn on vn.oid = v.relnamespace
join pg_catalog.pg_depend d
  on d.classid = 'pg_catalog.pg_rewrite'::pg_catalog.regclass
 and d.objid = rw.oid
 and d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
join pg_catalog.pg_class b on b.oid = d.refobjid
join pg_catalog.pg_namespace bn on bn.oid = b.relnamespace
where vn.nspname = 'public'
  and v.relkind in ('v', 'm')
  and b.oid <> v.oid
order by view_name, referenced_schema, referenced_relation;

select distinct
  'routine_relation_dependencies' as section,
  pn.nspname as routine_schema,
  p.proname as routine_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  rn.nspname as referenced_schema,
  c.relname as referenced_relation
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
join pg_catalog.pg_depend d
  on d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
 and d.objid = p.oid
 and d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
join pg_catalog.pg_class c on c.oid = d.refobjid
join pg_catalog.pg_namespace rn on rn.oid = c.relnamespace
where pn.nspname = 'public'
  and p.prokind in ('f', 'p')
order by routine_name, identity_arguments, referenced_schema, referenced_relation;

select
  'trigger_function_dependencies' as section,
  tn.nspname as table_schema,
  c.relname as table_name,
  t.tgname as trigger_name,
  pn.nspname as function_schema,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as function_arguments
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace tn on tn.oid = c.relnamespace
join pg_catalog.pg_proc p on p.oid = t.tgfoid
join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
where tn.nspname = 'public'
  and not t.tgisinternal
order by table_name, trigger_name;

select
  'migration_versions' as section,
  sm.version,
  sm.name
from supabase_migrations.schema_migrations sm
order by sm.version;
