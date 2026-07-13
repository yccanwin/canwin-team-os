-- 首次 20260713080000 db push 失败后的只读线上状态核验
-- 必须按段执行；本文件只有 SELECT/CTE，不修复、不删除、不再次迁移。

-- [STATUS-0] 永远先执行：只查系统目录，不直接引用可能缺失的业务表或历史表。
-- 本次执行前这些 3.0 对象和 schema_migrations 均不存在；全部仍不存在才证明未见残留。
with expected_objects(object_kind,object_name,object_oid)as(values
 ('table','public.access_roles',to_regclass('public.access_roles')),
 ('table','public.access_permissions',to_regclass('public.access_permissions')),
 ('table','public.access_role_permissions',to_regclass('public.access_role_permissions')),
 ('table','public.profile_access_roles',to_regclass('public.profile_access_roles')),
 ('table','public.sales_regions',to_regclass('public.sales_regions')),
 ('table','public.profile_sales_regions',to_regclass('public.profile_sales_regions')),
 ('table','public.access_delegations',to_regclass('public.access_delegations')),
 ('table','public.feature_flags',to_regclass('public.feature_flags')),
 ('function','public.has_access_role(text,text[])',to_regprocedure('public.has_access_role(text,text[])')),
 ('function','public.has_permission(text,text)',to_regprocedure('public.has_permission(text,text)')),
 ('function','public.can_act_for(text,uuid)',to_regprocedure('public.can_act_for(text,uuid)')),
 ('function','public.is_feature_enabled(text,text)',to_regprocedure('public.is_feature_enabled(text,text)')),
 ('function','public.protect_last_team_admin()',to_regprocedure('public.protect_last_team_admin()')),
 ('function','public.manage_profile_access(uuid,text[],uuid[])',to_regprocedure('public.manage_profile_access(uuid,text[],uuid[])')),
 ('migration_history','supabase_migrations.schema_migrations',to_regclass('supabase_migrations.schema_migrations'))
),summary as(
 select
  count(*)filter(where object_oid is not null)as present_count,
  coalesce(jsonb_agg(jsonb_build_object('kind',object_kind,'name',object_name)
   order by object_kind,object_name)filter(where object_oid is not null),'[]'::jsonb)as present_objects,
  jsonb_agg(jsonb_build_object('kind',object_kind,'name',object_name,'exists',object_oid is not null)
   order by object_kind,object_name)as all_objects
 from expected_objects
)
select jsonb_build_object(
 'project_ref','agygfhmkazcbqaqwmljb',
 'status',case when present_count=0 then'PASS_FAILED_PUSH_NO_BOOTSTRAP_OBJECTS_OR_HISTORY_FOUND'
  else'STOP_FAILED_PUSH_LEFT_OR_CREATED_OBJECTS_REVIEW_REQUIRED'end,
 'present_count',present_count,
 'present_objects',present_objects,
 'all_objects',all_objects
)as failed_push_status
from summary;

-- [STATUS-1] 仅当 STATUS-0 显示 schema_migrations 存在时单独执行；否则跳过。
select version,count(*)as occurrences
from supabase_migrations.schema_migrations
group by version
order by version;

-- [STATUS-2] 仅当 STATUS-0 显示 public.feature_flags 存在时单独执行；否则跳过。
select team_id,key,enabled,created_at,updated_at
from public.feature_flags
where key='sales_os_v3'
order by team_id;
