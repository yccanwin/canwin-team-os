-- CanWin Team OS 3.0 线上迁移停损脚本（只读、人工执行）
-- 用法：迁移前在 Supabase SQL Editor 按段执行并导出每段结果；任何 status 以 STOP 开头时立即停止。
-- 本文件只有 SELECT，不修改开关、不备份数据、不执行迁移，也不包含任何密钥。
-- PRE-2/PRE-3 只是核对证据，不是可恢复备份。Supabase 没有平台备份时，必须先按 Runbook
-- 导出三个受保护表的结构和完整数据，并另行下载 canwin-media 文件本体；否则不得迁移。

-- ============================================================================
-- [FAST-PRE-0] 主查询关系存在性门禁（必须先单独运行）
-- 本段只读取系统目录，不直接引用任何待检查关系；缺表时仍会返回明确 STOP。
-- 只有 PASS_FAST_PRE_0_REQUIRED_RELATIONS_PRESENT 才能运行 FAST-PRE-BOOTSTRAP。
-- ============================================================================
with required_relations(relation_name,relation_oid)as(values
 ('public.teams',to_regclass('public.teams')),
 ('public.profiles',to_regclass('public.profiles')),
 ('public.finance_records',to_regclass('public.finance_records')),
 ('public.achievements',to_regclass('public.achievements')),
 ('public.photos',to_regclass('public.photos')),
 ('storage.objects',to_regclass('storage.objects')),
 ('supabase_migrations.schema_migrations',to_regclass('supabase_migrations.schema_migrations'))
),relation_summary as(
 select
  bool_and(relation_oid is not null)as all_present,
  jsonb_agg(jsonb_build_object('relation',relation_name,'exists',relation_oid is not null)
   order by relation_name)as relations,
  coalesce(jsonb_agg(relation_name order by relation_name)
   filter(where relation_oid is null),'[]'::jsonb)as missing
 from required_relations
)
select jsonb_build_object(
 'project_ref','agygfhmkazcbqaqwmljb',
 'final_status',case
  when to_regclass('public.feature_flags')is not null
   then'STOP_FEATURE_FLAGS_ALREADY_PRESENT_USE_REGULAR_PRECHECK'
  when not all_present then'STOP_FAST_PRE_0_REQUIRED_RELATIONS_MISSING'
  else'PASS_FAST_PRE_0_REQUIRED_RELATIONS_PRESENT'end,
 'feature_flags_table_exists',to_regclass('public.feature_flags')is not null,
 'required_relations',relations,
 'missing_relations',missing
)as fast_pre_0
from relation_summary;

-- ============================================================================
-- [FAST-PRE-BOOTSTRAP] 首次引导单行 JSONB 主预检（一次运行、一次导出）
-- 硬前置：FAST-PRE-0 必须先得到 PASS。主查询会直接读取受保护表和迁移历史表；
-- 若跳过 PRE-0 或两段之间关系被删除，SQL 可能报关系不存在，此时同样必须停止，不能声称已返回业务 STOP。
-- 本段仍只用 to_regclass 判断 feature_flags，绝不直接引用该关系，因此 feature_flags 缺表可解析运行。
-- 固定已验收备份行数：finance=29、achievements=29、photos=1、canwin-media=30。
-- ============================================================================
with required_tables(required_name,relation_oid)as(values
 ('teams',to_regclass('public.teams')),
 ('profiles',to_regclass('public.profiles')),
 ('finance_records',to_regclass('public.finance_records')),
 ('achievements',to_regclass('public.achievements')),
 ('photos',to_regclass('public.photos'))
),required_summary as(
 select
  bool_and(relation_oid is not null)as all_present,
  jsonb_agg(jsonb_build_object('table',required_name,'exists',relation_oid is not null)
    order by required_name)as tables,
  coalesce(jsonb_agg(required_name order by required_name)
    filter(where relation_oid is null),'[]'::jsonb)as missing
 from required_tables
),protected_baseline as(
 select
  (select count(*)from public.finance_records)as finance_rows,
  (select coalesce(sum(amount),0)from public.finance_records where record_type='income')as finance_income,
  (select coalesce(sum(amount),0)from public.finance_records where record_type='expense')as finance_expense,
  (select coalesce(sum(amount),0)from public.finance_records)as finance_amount_total,
  (select md5(coalesce(string_agg(to_jsonb(f)::text,E'\n'
    order by team_id,record_type,date,id),''))from public.finance_records f)as finance_detail_md5,
  (select count(*)from public.achievements)as achievements_rows,
  (select count(*)from public.photos)as photos_rows,
  (select count(*)from storage.objects where bucket_id='canwin-media')as media_objects,
  (select md5(coalesce(string_agg(concat_ws('|',id::text,name,coalesce(metadata::text,'')),E'\n'
    order by name,id::text),''))from storage.objects where bucket_id='canwin-media')as media_manifest_md5
),local_manifest(version)as(values
 ('20260710024500'),('20260710040500'),('20260710082000'),('20260710091000'),('20260710103000'),
 ('20260713080000'),('20260713090000'),('20260713100000'),('20260713110000'),('20260713120000'),
 ('20260713130000'),('20260713140000'),('20260713150000'),('20260713161000'),('20260713162000'),
 ('20260713163000'),('20260713170000'),('20260713180000'),('20260713181000'),('20260713181100'),
 ('20260713181200'),('20260713181250'),('20260713182000'),('20260713182100'),('20260713182200'),
 ('20260713183000'),('20260713184000'),('20260713184100'),('20260713184200'),('20260713184300')
),migration_versions as(
 select version,count(*)as occurrences
 from supabase_migrations.schema_migrations
 group by version
),migration_summary as(
 select
  coalesce(jsonb_agg(jsonb_build_object('version',version,'occurrences',occurrences)
    order by version),'[]'::jsonb)as remote_versions,
  coalesce(jsonb_agg(version order by version)filter(where occurrences>1),'[]'::jsonb)as duplicate_versions,
  coalesce(sum(occurrences)filter(where version='20260713080000'),0)as bootstrap_occurrences
 from migration_versions
),unexpected_remote as(
 select mv.version
 from migration_versions mv
 left join local_manifest lm using(version)
 where lm.version is null and mv.version>='20260710024500'
),unexpected_summary as(
 select coalesce(jsonb_agg(version order by version),'[]'::jsonb)as versions
 from unexpected_remote
),history_columns as(
 select column_name,data_type,udt_name,is_nullable,column_default,is_identity,ordinal_position
 from information_schema.columns
 where table_schema='supabase_migrations'and table_name='schema_migrations'
),history_column_summary as(
 select
  count(*)as column_count,
  coalesce(jsonb_agg(to_jsonb(c)order by ordinal_position),'[]'::jsonb)as columns,
  count(*)=1 and bool_and(column_name='version'and data_type='text'
    and udt_name='text'and is_nullable='NO')as version_only_shape
 from history_columns c
),history_primary_key as(
 select exists(
  select 1
  from pg_constraint c
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
  where c.conrelid=to_regclass('supabase_migrations.schema_migrations')
   and c.contype='p'and array_length(c.conkey,1)=1 and a.attname='version'
 )as version_is_single_primary_key
),facts as(
 select
  to_regclass('public.feature_flags')is not null as feature_flags_exists,
  to_regclass('supabase_migrations.schema_migrations')is not null as history_table_exists,
  rs.all_present,rs.tables,rs.missing,pb.*,
  ms.remote_versions,ms.duplicate_versions,ms.bootstrap_occurrences,
  us.versions as unexpected_remote_versions,
  hcs.column_count,hcs.columns as history_columns,hcs.version_only_shape,
  hpk.version_is_single_primary_key,
  pb.finance_rows=29 and pb.achievements_rows=29 and pb.photos_rows=1
   and pb.media_objects=30 as accepted_backup_counts_unchanged
 from required_summary rs
 cross join protected_baseline pb
 cross join migration_summary ms
 cross join unexpected_summary us
 cross join history_column_summary hcs
 cross join history_primary_key hpk
)
select jsonb_build_object(
 'project_ref','agygfhmkazcbqaqwmljb',
 'generated_at_utc',to_char(statement_timestamp()at time zone'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'precondition','PASS_FAST_PRE_0_REQUIRED_RELATIONS_PRESENT',
 'final_status',case
  when feature_flags_exists then'STOP_FEATURE_FLAGS_ALREADY_PRESENT_USE_REGULAR_PRECHECK'
  when not accepted_backup_counts_unchanged then'STOP_ACCEPTED_BACKUP_COUNT_DRIFT'
  when jsonb_array_length(duplicate_versions)>0 then'STOP_REMOTE_VERSION_DUPLICATE'
  when jsonb_array_length(unexpected_remote_versions)>0 then'STOP_REMOTE_HISTORY_DIVERGED'
  when bootstrap_occurrences>0 then'STOP_BOOTSTRAP_ALREADY_APPLIED_DO_NOT_RERUN'
  when not(version_only_shape and version_is_single_primary_key)
   then'STOP_HISTORY_SCHEMA_OR_RECORDER_UNSUPPORTED'
  else'PASS_FIRST_BOOTSTRAP_READY'end,
 'feature_flags',jsonb_build_object('table_exists',feature_flags_exists,'direct_relation_reference',false),
 'required_tables',jsonb_build_object('all_present',all_present,'tables',tables,'missing',missing),
 'protected_baseline',jsonb_build_object(
  'accepted_backup_counts_unchanged',accepted_backup_counts_unchanged,
  'finance_rows',finance_rows,'finance_income',finance_income,'finance_expense',finance_expense,
  'finance_amount_total',finance_amount_total,'finance_detail_md5',finance_detail_md5,
  'achievements_rows',achievements_rows,'photos_rows',photos_rows,
  'media_objects',media_objects,'media_manifest_md5',media_manifest_md5
 ),
 'migration_history',jsonb_build_object(
  'table_exists',history_table_exists,'remote_versions',remote_versions,
  'duplicate_versions',duplicate_versions,'unexpected_remote_versions',unexpected_remote_versions,
  'history_status',case when jsonb_array_length(duplicate_versions)>0 then'STOP_REMOTE_VERSION_DUPLICATE'
   when jsonb_array_length(unexpected_remote_versions)>0 then'STOP_REMOTE_HISTORY_DIVERGED'
   else'PASS_REMOTE_HISTORY_NO_DUPLICATE_OR_DIVERGENCE'end,
  'bootstrap_20260713080000',case when bootstrap_occurrences=0 then'PENDING'else'ALREADY_APPLIED'end,
  'bootstrap_occurrences',bootstrap_occurrences
 ),
 'schema_migrations_structure',jsonb_build_object(
  'columns',history_columns,'column_count',column_count,
  'version_only_shape',version_only_shape,
  'version_is_single_primary_key',version_is_single_primary_key,
  'dashboard_manual_recorder_supported',version_only_shape and version_is_single_primary_key
 )
)as fast_pre_bootstrap
from facts;

-- [PRE-1A] 判断常规路径或首次引导路径。缺表是 20260713080000 创建前的预期状态，
-- 只授权执行该一个基础迁移，不授权执行 PRE-1B 或任何其他迁移。
select case
  when to_regclass('public.feature_flags') is null then 'PASS_FIRST_MIGRATION_BOOTSTRAP_REQUIRED'
  else 'PASS_FEATURE_FLAGS_TABLE_PRESENT'
end as status;

-- [PRE-1B] 仅当 PRE-1A 为 PASS 时单独执行。缺失、重复或 enabled=true 都必须 STOP。
select case
  when count(*)<>1 then 'STOP_FLAG_MISSING_OR_DUPLICATED'
  when bool_or(enabled) then 'STOP_SALES_OS_V3_IS_ENABLED'
  else 'PASS_FLAG_FALSE'
end as status,count(*) as flag_rows,coalesce(bool_or(enabled),false)as enabled
from public.feature_flags where team_id='CANWIN_TEAM'and key='sales_os_v3';

-- [PRE-1C] 首次引导和常规迁移都依赖这些既有表。任一缺失即 STOP。
select case when count(*)=0 then 'PASS_REQUIRED_TABLES_PRESENT'
 else 'STOP_REQUIRED_TABLES_MISSING'end as status,
 coalesce(jsonb_agg(required_name order by required_name)filter(where relation_name is null),'[]'::jsonb)as missing_tables
from(values
 ('teams',to_regclass('public.teams')),
 ('profiles',to_regclass('public.profiles')),
 ('finance_records',to_regclass('public.finance_records')),
 ('achievements',to_regclass('public.achievements')),
 ('photos',to_regclass('public.photos'))
)as required(required_name,relation_name)
where relation_name is null;

-- [PRE-2] 关键业务基线。完整复制 baseline_snapshot JSON，迁移后粘贴到 POST-1。
select jsonb_build_object(
 'finance_rows',(select count(*)from public.finance_records),
 'finance_income',(select coalesce(sum(amount),0)from public.finance_records where record_type='income'),
 'finance_expense',(select coalesce(sum(amount),0)from public.finance_records where record_type='expense'),
 'finance_amount_total',(select coalesce(sum(amount),0)from public.finance_records),
 'finance_detail_md5',(select md5(coalesce(string_agg(to_jsonb(f)::text,E'\n'order by team_id,record_type,date,id),''))from public.finance_records f),
 'achievements_rows',(select count(*)from public.achievements),
 'photos_rows',(select count(*)from public.photos),
 'media_objects',(select count(*)from storage.objects where bucket_id='canwin-media'),
 'media_manifest_md5',(select md5(coalesce(string_agg(concat_ws('|',id::text,name,coalesce(metadata::text,'')),E'\n'order by name,id::text),''))from storage.objects where bucket_id='canwin-media')
)as baseline_snapshot;

-- [PRE-3] canwin-media 完整对象清单；导出 CSV。迁移前后都应逐行一致。
select id,bucket_id,name,owner_id,created_at,updated_at,last_accessed_at,metadata
from storage.objects where bucket_id='canwin-media'order by name,id;

-- [PRE-4] 本次工作区迁移清单与远端历史。unexpected_remote / duplicate 任一非空都 STOP。
with local_manifest(version,file_name)as(values
 ('20260710024500','20260710024500_add_skill_tree.sql'),
 ('20260710040500','20260710040500_open_cases_photos_to_team.sql'),
 ('20260710082000','20260710082000_add_sales_center.sql'),
 ('20260710091000','20260710091000_sales_points_decimal.sql'),
 ('20260710103000','20260710103000_add_salespeople_selection.sql'),
 ('20260713080000','20260713080000_add_access_control_foundation.sql'),
 ('20260713090000','20260713090000_add_crm_core.sql'),
 ('20260713100000','20260713100000_add_deal_core.sql'),
 ('20260713110000','20260713110000_add_fulfillment_core.sql'),
 ('20260713120000','20260713120000_add_sales_automation.sql'),
 ('20260713130000','20260713130000_add_notification_core.sql'),
 ('20260713140000','20260713140000_add_performance_core.sql'),
 ('20260713150000','20260713150000_add_customer_import.sql'),
 ('20260713161000','20260713161000_upgrade_dual_ledger_owner_access.sql'),
 ('20260713162000','20260713162000_secure_dual_ledger_upgrade.sql'),
 ('20260713163000','20260713163000_finalize_summary_only_owner_finance.sql'),
 ('20260713170000','20260713170000_harden_customer_import_rollback.sql'),
 ('20260713180000','20260713180000_add_crm_workbench_mutation_rpcs.sql'),
 ('20260713181000','20260713181000_harden_crm_qualification_evidence.sql'),
 ('20260713181100','20260713181100_make_crm_evidence_append_only.sql'),
 ('20260713181200','20260713181200_audit_crm_qualification_promotion.sql'),
 ('20260713181250','20260713181250_expose_active_opportunity_stage.sql'),
 ('20260713182000','20260713182000_add_safe_quote_draft_rpcs.sql'),
 ('20260713182100','20260713182100_harden_quote_draft_rpcs.sql'),
 ('20260713182200','20260713182200_add_real_a_grade_demo_completion.sql'),
 ('20260713183000','20260713183000_add_internal_payment_workbench.sql'),
 ('20260713184000','20260713184000_harden_hardware_inventory_fulfillment.sql'),
 ('20260713184100','20260713184100_enforce_order_hardware_quantities.sql'),
 ('20260713184200','20260713184200_enforce_final_hardware_shipping_chain.sql'),
 ('20260713184300','20260713184300_bind_inventory_to_order_quote_snapshot.sql')
),local_duplicate as(
 select version,count(*)n from local_manifest group by version having count(*)>1
),remote_duplicate as(
 select version,count(*)n from supabase_migrations.schema_migrations group by version having count(*)>1
),unexpected_remote as(
 select r.version from supabase_migrations.schema_migrations r left join local_manifest l on l.version=r.version
 where l.version is null and r.version>='20260710024500'
)
select case
 when exists(select 1 from local_duplicate)then'STOP_LOCAL_VERSION_DUPLICATE'
 when exists(select 1 from remote_duplicate)then'STOP_REMOTE_VERSION_DUPLICATE'
 when exists(select 1 from unexpected_remote)then'STOP_REMOTE_HISTORY_DIVERGED'
 else'PASS_MIGRATION_HISTORY_PRECHECK'end as status,
 coalesce((select jsonb_agg(to_jsonb(x))from local_duplicate x),'[]'::jsonb)as local_duplicates,
 coalesce((select jsonb_agg(to_jsonb(x))from remote_duplicate x),'[]'::jsonb)as remote_duplicates,
 coalesce((select jsonb_agg(version order by version)from unexpected_remote),'[]'::jsonb)as unexpected_remote_versions;

-- [PRE-5] 明确列出待执行版本，保存结果；这里只读历史，不会执行它们。
-- 此清单用于盘点，不代表批准执行。尤其不得把 20260710040500 混入首次引导。
with local_manifest(version)as(values
 ('20260710024500'),('20260710040500'),('20260710082000'),('20260710091000'),('20260710103000'),
 ('20260713080000'),('20260713090000'),('20260713100000'),('20260713110000'),('20260713120000'),
 ('20260713130000'),('20260713140000'),('20260713150000'),('20260713161000'),('20260713162000'),
 ('20260713163000'),('20260713170000'),('20260713180000'),('20260713181000'),('20260713181100'),
 ('20260713181200'),('20260713181250'),('20260713182000'),('20260713182100'),('20260713182200'),
 ('20260713183000'),('20260713184000'),('20260713184100'),('20260713184200'),('20260713184300')
)
select l.version,case when r.version is null then'PENDING'else'ALREADY_APPLIED'end as state
from local_manifest l left join supabase_migrations.schema_migrations r using(version)order by l.version;

-- [PRE-5A] 首次引导的唯一允许版本。只有 PENDING 才允许单独执行 20260713080000；
-- 若已执行则无需再次执行，若计划中包含任何其他文件则人工 STOP。
select case
 when exists(select 1 from supabase_migrations.schema_migrations where version='20260713080000')
   then 'ALREADY_APPLIED_BOOTSTRAP_DO_NOT_RERUN'
 else 'PASS_BOOTSTRAP_MIGRATION_PENDING'
end as status,
'20260713080000_add_access_control_foundation.sql' as only_allowed_migration;

-- [PRE-5B] Dashboard SQL Editor 手工记账能力检查（只读）。先查看真实列与约束，不假设结构。
-- 仅支持“只有 version text NOT NULL PRIMARY KEY”这一种可无歧义手工写入的历史表。
-- 若还有 name/statements 等列，SQL Editor 没有 Supabase CLI 的迁移语句解析/记账语义，必须 STOP。
with actual_columns as(
 select column_name,data_type,udt_name,is_nullable,column_default,is_identity,ordinal_position
 from information_schema.columns
 where table_schema='supabase_migrations'and table_name='schema_migrations'
),version_primary_key as(
 select exists(
  select 1 from pg_constraint c
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
  where c.conrelid=to_regclass('supabase_migrations.schema_migrations')
    and c.contype='p'and array_length(c.conkey,1)=1 and a.attname='version'
 )as present
)
select case
 when to_regclass('supabase_migrations.schema_migrations')is null then'STOP_MIGRATION_HISTORY_TABLE_MISSING'
 when (select count(*)from actual_columns)=1
  and exists(select 1 from actual_columns where column_name='version'and data_type='text'
   and udt_name='text'and is_nullable='NO')
  and (select present from version_primary_key)
 then'PASS_HISTORY_VERSION_ONLY_SUPPORTED'
 else'STOP_HISTORY_SCHEMA_OR_RECORDER_UNSUPPORTED'end as status,
 coalesce((select jsonb_agg(to_jsonb(c)order by ordinal_position)from actual_columns c),'[]'::jsonb)as actual_columns,
 (select present from version_primary_key)as version_primary_key;

-- [POST-1] 迁移后复核：把 PRE-2 复制出的整个 JSON 替换下方 {}。未粘贴或任一值变化都 STOP。
with baseline(snapshot)as(values('{}'::jsonb)),current_snapshot as(
 select jsonb_build_object(
  'finance_rows',(select count(*)from public.finance_records),
  'finance_income',(select coalesce(sum(amount),0)from public.finance_records where record_type='income'),
  'finance_expense',(select coalesce(sum(amount),0)from public.finance_records where record_type='expense'),
  'finance_amount_total',(select coalesce(sum(amount),0)from public.finance_records),
  'finance_detail_md5',(select md5(coalesce(string_agg(to_jsonb(f)::text,E'\n'order by team_id,record_type,date,id),''))from public.finance_records f),
  'achievements_rows',(select count(*)from public.achievements),
  'photos_rows',(select count(*)from public.photos),
  'media_objects',(select count(*)from storage.objects where bucket_id='canwin-media'),
  'media_manifest_md5',(select md5(coalesce(string_agg(concat_ws('|',id::text,name,coalesce(metadata::text,'')),E'\n'order by name,id::text),''))from storage.objects where bucket_id='canwin-media')
 )snapshot
)
select case when b.snapshot='{}'::jsonb then'STOP_BASELINE_NOT_PASTED'
 when b.snapshot<>c.snapshot then'STOP_BASELINE_CHANGED'
 else'PASS_BASELINE_UNCHANGED'end as status,b.snapshot as before,c.snapshot as after
from baseline b cross join current_snapshot c;

-- [POST-2] 再执行 PRE-1、PRE-3、PRE-4、PRE-5：flag 仍须 false，对象清单须同值，
-- 历史不得重复/分叉，且计划执行的迁移版本必须从 PENDING 变为 ALREADY_APPLIED；否则 STOP。
-- 首次引导另须确认 PRE-5A 由迁移前 PASS_BOOTSTRAP_MIGRATION_PENDING 变为
-- ALREADY_APPLIED_BOOTSTRAP_DO_NOT_RERUN；此时它表示版本已记录且不应重跑。
-- 若 PRE-5B 未得到 PASS_HISTORY_VERSION_ONLY_SUPPORTED，不得用 Dashboard SQL Editor 手工执行迁移。
