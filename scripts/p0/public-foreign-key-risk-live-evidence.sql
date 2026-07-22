-- CanWin Team OS 4.0 P0 foreign-key and covering-index catalog evidence.
-- SELECT-only. Reads PostgreSQL catalogs, never business rows or function bodies.

with foreign_keys as (
  select
    con.oid as constraint_oid,
    con.conname as constraint_name,
    con.conrelid as source_relation_oid,
    con.confrelid as target_relation_oid,
    con.conkey as source_attribute_numbers,
    con.confkey as target_attribute_numbers,
    con.confupdtype as update_action_code,
    con.confdeltype as delete_action_code,
    con.confmatchtype as match_type_code,
    con.condeferrable as is_deferrable,
    con.condeferred as is_initially_deferred,
    con.convalidated as validated,
    source_namespace.nspname as source_schema,
    source_relation.relname as source_table,
    greatest(source_relation.reltuples, 0)::bigint as source_estimated_rows,
    target_namespace.nspname as target_schema,
    target_relation.relname as target_table,
    greatest(target_relation.reltuples, 0)::bigint as target_estimated_rows
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class source_relation on source_relation.oid = con.conrelid
  join pg_catalog.pg_namespace source_namespace on source_namespace.oid = source_relation.relnamespace
  join pg_catalog.pg_class target_relation on target_relation.oid = con.confrelid
  join pg_catalog.pg_namespace target_namespace on target_namespace.oid = target_relation.relnamespace
  where con.contype = 'f'
    and source_namespace.nspname = 'public'
),
foreign_key_rows as (
  select
    fk.*,
    (
      select jsonb_agg(attribute.attname order by key_part.ordinality)
      from unnest(fk.source_attribute_numbers) with ordinality key_part(attribute_number, ordinality)
      join pg_catalog.pg_attribute attribute
        on attribute.attrelid = fk.source_relation_oid
       and attribute.attnum = key_part.attribute_number
    ) as source_columns,
    (
      select jsonb_agg(attribute.attname order by key_part.ordinality)
      from unnest(fk.target_attribute_numbers) with ordinality key_part(attribute_number, ordinality)
      join pg_catalog.pg_attribute attribute
        on attribute.attrelid = fk.target_relation_oid
       and attribute.attnum = key_part.attribute_number
    ) as target_columns,
    exists (
      select 1
      from pg_catalog.pg_index index_entry
      where index_entry.indrelid = fk.source_relation_oid
        and index_entry.indisvalid
        and index_entry.indisready
        and (
          select array_agg(index_part.attribute_number order by index_part.ordinality)
          from unnest(index_entry.indkey::smallint[]) with ordinality index_part(attribute_number, ordinality)
          where index_part.ordinality <= cardinality(fk.source_attribute_numbers)
        ) = fk.source_attribute_numbers
    ) as catalog_covering_index
  from foreign_keys fk
)
select jsonb_build_object(
  'schemaVersion', 1,
  'evidenceType', 'production-readonly-public-foreign-key-catalog',
  'projectRef', 'agygfhmkazcbqaqwmljb',
  'capturedAtUtc', to_char(statement_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'serverVersionNum', current_setting('server_version_num')::int,
  'readOnly', true,
  'writePerformed', false,
  'businessRowsRead', false,
  'acceptanceStatus', 'candidate_unaccepted',
  'supervisorAccepted', false,
  'limitations', jsonb_build_array(
    'row counts are planner estimates and are not reconciliation evidence',
    'covering-index detection follows the Advisor leading-column rule and can count partial indexes',
    'partial covering indexes still require predicate and workload review before acceptance',
    'an unindexed advisor finding is a review candidate, not automatic authorization to create an index',
    'query frequency, lock evidence and write amplification still require isolated runtime review'
  ),
  'counts', jsonb_build_object(
    'foreignKeys', (select count(*) from foreign_key_rows),
    'catalogCovered', (select count(*) from foreign_key_rows where catalog_covering_index),
    'catalogUncovered', (select count(*) from foreign_key_rows where not catalog_covering_index),
    'sourceTables', (select count(distinct source_table) from foreign_key_rows)
  ),
  'foreignKeys', (
    select jsonb_agg(
      jsonb_build_object(
        'constraintName', constraint_name,
        'sourceSchema', source_schema,
        'sourceTable', source_table,
        'sourceColumns', source_columns,
        'sourceEstimatedRows', source_estimated_rows,
        'targetSchema', target_schema,
        'targetTable', target_table,
        'targetColumns', target_columns,
        'targetEstimatedRows', target_estimated_rows,
        'updateActionCode', update_action_code,
        'deleteActionCode', delete_action_code,
        'matchTypeCode', match_type_code,
        'deferrable', is_deferrable,
        'initiallyDeferred', is_initially_deferred,
        'validated', validated,
        'catalogCoveringIndex', catalog_covering_index,
        'acceptanceStatus', 'candidate_unaccepted'
      )
      order by source_table, constraint_name
    )
    from foreign_key_rows
  )
) as foreign_key_evidence;
