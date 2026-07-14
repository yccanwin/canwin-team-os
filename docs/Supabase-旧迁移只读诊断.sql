-- 只读诊断：判断5条未登记迁移对应的数据库对象是否已经存在。
-- 可直接整段粘贴到 Supabase SQL Editor 运行；本文件只有 SELECT，不修改任何数据或结构。

with checks(migration_id, check_name, passed, actual) as (
  values
  ('20260710024500', 'skills / user_skills 表',
    to_regclass('public.skills') is not null and to_regclass('public.user_skills') is not null,
    concat('skills=', to_regclass('public.skills'), ', user_skills=', to_regclass('public.user_skills'))),
  ('20260710024500', '技能表关键列',
    (select count(*) = 17 from information_schema.columns
      where table_schema = 'public' and (
        (table_name = 'skills' and column_name = any(array['id','team_id','name','category','level','description','learning_url','prerequisite_ids','created_by','created_at','updated_at']))
        or (table_name = 'user_skills' and column_name = any(array['id','team_id','user_id','skill_id','note','lit_at']))
      )),
    (select concat('matched=', count(*), '/17') from information_schema.columns
      where table_schema = 'public' and (
        (table_name = 'skills' and column_name = any(array['id','team_id','name','category','level','description','learning_url','prerequisite_ids','created_by','created_at','updated_at']))
        or (table_name = 'user_skills' and column_name = any(array['id','team_id','user_id','skill_id','note','lit_at']))
      ))),
  ('20260710024500', '技能表RLS',
    (select count(*) = 2 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in('skills','user_skills') and c.relrowsecurity),
    (select concat('enabled=', count(*), '/2') from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in('skills','user_skills') and c.relrowsecurity)),
  ('20260710024500', '技能表6条策略',
    (select count(*) = 6 from pg_policies where schemaname='public' and policyname in(
      'team members read skills','captains manage skills','team members read user skills',
      'users light own skills','users update own skills','users delete own skills')),
    (select concat('found=', count(*), '/6') from pg_policies where schemaname='public' and policyname in(
      'team members read skills','captains manage skills','team members read user skills',
      'users light own skills','users update own skills','users delete own skills'))),

  ('20260710040500', '成就与相册5条开放策略',
    (select count(*) = 5 from pg_policies where schemaname='public' and policyname in(
      'team members add achievements','team members update achievements','team members delete achievements',
      'team members update photos','team members delete photos')),
    (select concat('found=', count(*), '/5') from pg_policies where schemaname='public' and policyname in(
      'team members add achievements','team members update achievements','team members delete achievements',
      'team members update photos','team members delete photos'))),
  ('20260710040500', '被替换旧策略已移除',
    not exists(select 1 from pg_policies where schemaname='public' and policyname in(
      'captains manage achievements','owners or captains manage photos')),
    (select concat('old_policies_remaining=', count(*)) from pg_policies where schemaname='public' and policyname in(
      'captains manage achievements','owners or captains manage photos'))),

  ('20260710082000', '销售中心3张表',
    to_regclass('public.sales_products') is not null
      and to_regclass('public.sales_score_records') is not null
      and to_regclass('public.sales_assessments') is not null,
    concat('products=',to_regclass('public.sales_products'),', records=',to_regclass('public.sales_score_records'),', assessments=',to_regclass('public.sales_assessments'))),
  ('20260710082000', '销售中心关键列',
    (select count(*) = 31 from information_schema.columns where table_schema='public' and (
      (table_name='sales_products' and column_name=any(array['id','team_id','name','points','category','is_active','created_by','created_at','updated_at']))
      or (table_name='sales_score_records' and column_name=any(array['id','team_id','salesperson_id','product_id','product_name','quantity','points','sold_at','note','created_by','created_at']))
      or (table_name='sales_assessments' and column_name=any(array['id','team_id','period_quarter','salesperson_ids','point_target','new_gmv_target','new_gmv_actual','renewal_gmv_target','renewal_gmv_actual','updated_by','updated_at']))
    )),
    (select concat('matched=',count(*),'/31') from information_schema.columns where table_schema='public' and (
      (table_name='sales_products' and column_name=any(array['id','team_id','name','points','category','is_active','created_by','created_at','updated_at']))
      or (table_name='sales_score_records' and column_name=any(array['id','team_id','salesperson_id','product_id','product_name','quantity','points','sold_at','note','created_by','created_at']))
      or (table_name='sales_assessments' and column_name=any(array['id','team_id','period_quarter','salesperson_ids','point_target','new_gmv_target','new_gmv_actual','renewal_gmv_target','renewal_gmv_actual','updated_by','updated_at']))
    ))),
  ('20260710082000', '销售中心RLS与6条策略',
    (select count(*)=3 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('sales_products','sales_score_records','sales_assessments') and c.relrowsecurity)
      and (select count(*)=6 from pg_policies where schemaname='public' and policyname in('team members read sales products','captains manage sales products','team members read sales records','captains manage sales records','team members read sales assessments','captains manage sales assessments')),
    concat(
      (select concat('rls=',count(*),'/3') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('sales_products','sales_score_records','sales_assessments') and c.relrowsecurity),
      ', ',(select concat('policies=',count(*),'/6') from pg_policies where schemaname='public' and policyname in('team members read sales products','captains manage sales products','team members read sales records','captains manage sales records','team members read sales assessments','captains manage sales assessments')))),
  ('20260710082000', '销售记录索引',
    (select count(*)=2 from pg_indexes where schemaname='public' and indexname in('sales_score_records_team_sold_at_idx','sales_score_records_salesperson_idx')),
    (select concat('found=',count(*),'/2') from pg_indexes where schemaname='public' and indexname in('sales_score_records_team_sold_at_idx','sales_score_records_salesperson_idx'))),
  ('20260710091000', '3个积分字段 numeric(10,1)',
    (select count(*)=3 from information_schema.columns where table_schema='public' and numeric_precision=10 and numeric_scale=1 and (
      (table_name='sales_products' and column_name='points') or
      (table_name='sales_score_records' and column_name='points') or
      (table_name='sales_assessments' and column_name='point_target'))),
    (select concat('matched=',count(*),'/3') from information_schema.columns where table_schema='public' and numeric_precision=10 and numeric_scale=1 and (
      (table_name='sales_products' and column_name='points') or
      (table_name='sales_score_records' and column_name='points') or
      (table_name='sales_assessments' and column_name='point_target')))),

  ('20260710103000', 'salesperson_ids uuid[]列',
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='sales_assessments' and column_name='salesperson_ids' and udt_name='_uuid' and is_nullable='NO'),
    coalesce((select concat('type=',udt_name,', nullable=',is_nullable,', default=',column_default) from information_schema.columns where table_schema='public' and table_name='sales_assessments' and column_name='salesperson_ids'),'missing'))
)
select migration_id,
       bool_and(passed) as migration_objects_complete,
       jsonb_agg(jsonb_build_object('check',check_name,'passed',passed,'actual',actual) order by check_name) as details
from checks
group by migration_id
order by migration_id;
