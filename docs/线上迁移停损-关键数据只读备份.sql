-- CanWin Team OS 关键数据只读备份查询包
-- 使用方法：在 Supabase SQL Editor 中一次只运行一个“段落”，然后把结果导出为 CSV。
-- 本文件只读取数据，不会修改数据库。CSV 第一行为表头，不计入数据行数。
-- 注意：MEDIA-1 只备份对象清单；canwin-media 文件本体仍须按 Runbook 另行完整下载。

-- ============================================================
-- [COUNT-1] 导出前行数基线
-- 保存本段 CSV。随后 FINANCE-1 / ACHIEVEMENTS-1 / PHOTOS-1 / MEDIA-1
-- 各自导出的数据行数必须与本段对应 expected_rows 完全一致。
-- ============================================================
select 'public.finance_records' as dataset, count(*) as expected_rows
from public.finance_records
union all
select 'public.achievements' as dataset, count(*) as expected_rows
from public.achievements
union all
select 'public.photos' as dataset, count(*) as expected_rows
from public.photos
union all
select 'storage.objects:canwin-media' as dataset, count(*) as expected_rows
from storage.objects
where bucket_id='canwin-media'
order by dataset;

-- ============================================================
-- [SCHEMA-1] 三张关键表的完整列定义
-- 导出 CSV；包括顺序、类型、可空性、默认值、identity 和 generated 属性。
-- ============================================================
select
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_schema,
  udt_name,
  character_maximum_length,
  numeric_precision,
  numeric_scale,
  datetime_precision,
  is_nullable,
  column_default,
  is_identity,
  identity_generation,
  is_generated,
  generation_expression
from information_schema.columns
where table_schema='public'
  and table_name in('finance_records','achievements','photos')
order by table_name,ordinal_position;

-- ============================================================
-- [SCHEMA-2] 三张关键表的主键、唯一、外键和检查约束
-- 导出 CSV；constraint_type=P 表示主键，constraint_columns 给出涉及列。
-- ============================================================
with target_tables(table_name)as(
  values('finance_records'),('achievements'),('photos')
),table_constraints as(
  select
    n.nspname as table_schema,
    cls.relname as table_name,
    c.oid as constraint_oid,
    c.conname as constraint_name,
    c.contype as constraint_type,
    c.conrelid,
    c.conkey,
    pg_get_constraintdef(c.oid,true)as constraint_definition
  from pg_constraint c
  join pg_class cls on cls.oid=c.conrelid
  join pg_namespace n on n.oid=cls.relnamespace
  join target_tables t on t.table_name=cls.relname
  where n.nspname='public'
)
select
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  coalesce(cols.constraint_columns,'')as constraint_columns,
  tc.constraint_definition
from table_constraints tc
left join lateral(
  select string_agg(a.attname,', 'order by k.ordinality)as constraint_columns
  from unnest(tc.conkey)with ordinality as k(attnum,ordinality)
  join pg_attribute a on a.attrelid=tc.conrelid and a.attnum=k.attnum
)cols on true
order by tc.table_name,tc.constraint_type,tc.constraint_name;

-- ============================================================
-- [FINANCE-1] finance_records 完整数据
-- 不筛选、不脱敏；导出后数据行数必须等于 COUNT-1 的 public.finance_records。
-- 该 CSV 含财务敏感数据，只能保存到受控备份目录。
-- ============================================================
select *
from public.finance_records
order by id;

-- ============================================================
-- [ACHIEVEMENTS-1] achievements 完整数据
-- 不筛选；导出后数据行数必须等于 COUNT-1 的 public.achievements。
-- ============================================================
select *
from public.achievements
order by id;

-- ============================================================
-- [PHOTOS-1] photos 完整数据
-- 不筛选；导出后数据行数必须等于 COUNT-1 的 public.photos。
-- image_url 只是引用，照片文件本体仍须另行下载。
-- ============================================================
select *
from public.photos
order by id;

-- ============================================================
-- [MEDIA-1] canwin-media 完整对象清单
-- 导出后数据行数必须等于 COUNT-1 的 storage.objects:canwin-media。
-- 本段保存元数据与原对象路径，不包含文件二进制本体。
-- ============================================================
select *
from storage.objects
where bucket_id='canwin-media'
order by name,id;

-- ============================================================
-- [COUNT-2] 导出完成后的行数复核
-- 再次导出本段 CSV，并与 COUNT-1 比较；任一行数变化都停止迁移并重新备份。
-- ============================================================
select 'public.finance_records' as dataset, count(*) as actual_rows
from public.finance_records
union all
select 'public.achievements' as dataset, count(*) as actual_rows
from public.achievements
union all
select 'public.photos' as dataset, count(*) as actual_rows
from public.photos
union all
select 'storage.objects:canwin-media' as dataset, count(*) as actual_rows
from storage.objects
where bucket_id='canwin-media'
order by dataset;
