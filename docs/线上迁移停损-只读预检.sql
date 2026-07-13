-- CanWin Team OS 3.0 线上迁移停损脚本（只读、人工执行）
-- 用法：迁移前在 Supabase SQL Editor 按段执行并导出每段结果；任何 status 以 STOP 开头时立即停止。
-- 本文件只有 SELECT，不修改开关、不备份数据、不执行迁移，也不包含任何密钥。
-- PRE-2/PRE-3 只是核对证据，不是可恢复备份。Supabase 没有平台备份时，必须先按 Runbook
-- 导出三个受保护表的结构和完整数据，并另行下载 canwin-media 文件本体；否则不得迁移。

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
