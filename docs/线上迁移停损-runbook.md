# 线上迁移停损 Runbook

适用范围：人工执行 CanWin Team OS 3.0 数据库迁移前后的停损核对。本文不授权发布，不包含密钥，也不执行迁移、删除或数据修复。

## 执行前

1. 在 Supabase 控制台确认当前项目名称和环境是目标生产项目；不确定则 `STOP_WRONG_OR_UNKNOWN_PROJECT`。
2. 打开 [线上迁移停损-只读预检.sql](./线上迁移停损-只读预检.sql)，按段执行 PRE-1A。若结果为 `PASS_FIRST_MIGRATION_BOOTSTRAP_REQUIRED`，不要执行 PRE-1B，改为执行 PRE-1C、PRE-2 至 PRE-5B；这是首次引导迁移的唯一入口。若结果为 `PASS_FEATURE_FLAGS_TABLE_PRESENT`，再执行 PRE-1B、PRE-1C、PRE-2 至 PRE-5。
   - 使用加速预检时，必须先单独运行 `FAST-PRE-0`；只有 `PASS_FAST_PRE_0_REQUIRED_RELATIONS_PRESENT` 才运行 `FAST-PRE-BOOTSTRAP`。PRE-0 缺关系会返回 STOP；跳过 PRE-0 或两段之间关系被删除导致主查询报错，也按 STOP 处理。
3. 保存每段结果；PRE-2 的 `baseline_snapshot` 原样保存，PRE-3 的对象清单导出 CSV。它们只用于迁移前后核对，不是备份。
4. 任一结果以 `STOP` 开头，立即停止，不执行迁移；把完整结果交回总监判断。
5. PRE-5 只是列出仓库版本状态，不能复制成迁移命令。首次引导只允许执行 PRE-5A 列出的 `20260713080000_add_access_control_foundation.sql`，不得同时执行任何其他迁移。

## 免费套餐无平台备份时的硬门槛

Supabase 显示“没有备份”时，必须在迁移前完成手工可恢复备份；未达到以下全部条件即 `STOP_RECOVERABLE_BACKUP_MISSING`：

- 数据库逻辑备份至少包含 `finance_records`、`achievements`、`photos` 的表结构、完整数据、主键和约束；三个表的导出文件均可打开，行数与 PRE-2 一致。
- `canwin-media` 的文件本体必须完整下载并保留原对象路径；仅导出 `storage.objects`、URL、CSV 或 MD5 不能恢复照片，均不算备份。
- 保存媒体文件清单（对象路径、大小以及可取得的 ETag 或哈希），文件数量和路径与 PRE-3 一致；备份目录不得位于随后会被覆盖的构建目录。
- 保存备份时间、操作者、项目名、导出文件位置和恢复说明。未实际做本地恢复演练时，必须至少确认数据库备份可读取、媒体归档可展开且文件数量一致。

## 允许继续的最低条件

- 常规路径：PRE-1A 为 `PASS_FEATURE_FLAGS_TABLE_PRESENT`，且 PRE-1B 为 `PASS_FLAG_FALSE`。
- 首次引导路径：PRE-1A 为 `PASS_FIRST_MIGRATION_BOOTSTRAP_REQUIRED`，PRE-1C 证明先决表存在，且可恢复备份硬门槛已满足。缺少 `feature_flags` 只授权执行 `20260713080000`，不授权任何后续迁移。
- PRE-2 已保存 finance_records 行数、收入/支出/总金额、按 `team_id / record_type / date / id` 固定顺序生成的完整明细 MD5，achievements/photos 行数，以及 canwin-media 数量和摘要。
- PRE-3 的 canwin-media 完整对象清单已导出并可打开。
- PRE-4 为 `PASS_MIGRATION_HISTORY_PRECHECK`，本地和远端无重复版本，本工作区起始日期后的远端历史无分叉。
- 首次引导时 PRE-5A 必须为 `PASS_BOOTSTRAP_MIGRATION_PENDING`，PRE-5B 必须证明迁移历史表可由 SQL Editor 可靠记账。旧 `20260710040500_open_cases_photos_to_team.sql` 会重写案例和照片权限，绝不得混入首次引导执行集；它在 PRE-5 中出现只代表历史盘点，不代表批准执行。

## 首次引导迁移

1. 只执行 `20260713080000_add_access_control_foundation.sql`，并在同一个数据库事务中记录版本 `20260713080000`；不得在同一批次执行旧 2.0 迁移或 `20260713090000` 及后续迁移。
2. 当前机器只有 Dashboard SQL Editor 时，必须先单独执行只读 PRE-5B。只有 `PASS_HISTORY_VERSION_ONLY_SUPPORTED` 才可使用下方手工事务；任何 `STOP` 都表示无法可靠模拟迁移记录器，禁止先执行 DDL、事后补历史。
3. SQL Editor 中一次性提交以下事务，两个占位注释必须分别替换为迁移文件全文和 PRE-2 的同一基线比较；不要分两次点击 Run：

```sql
begin;
-- 在此原样粘贴且只粘贴 20260713080000_add_access_control_foundation.sql 全文。
do $guard$begin
  if (select count(*) from public.feature_flags where team_id='CANWIN_TEAM' and key='sales_os_v3')<>1
     or (select enabled from public.feature_flags where team_id='CANWIN_TEAM' and key='sales_os_v3') then
    raise exception 'STOP_BOOTSTRAP_FLAG_NOT_FALSE';
  end if;
end$guard$;
do $baseline$
declare
  before_snapshot jsonb := '<在此粘贴迁移前 PRE-2 的完整 JSON>'::jsonb;
  after_snapshot jsonb;
begin
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
  ) into after_snapshot;
  if before_snapshot<>after_snapshot then
    raise exception 'STOP_BASELINE_CHANGED';
  end if;
end$baseline$;
insert into supabase_migrations.schema_migrations(version) values('20260713080000');
commit;
```

4. 上述插入方法只适用于 PRE-5B 证明历史表**仅有** `version text not null primary key` 的形态。若表还有 `name`、`statements` 或任何其他列，Dashboard 无 Supabase CLI 的语句解析/记账器，不能臆造这些值，必须 `STOP_HISTORY_SCHEMA_OR_RECORDER_UNSUPPORTED`，改用受支持的 Supabase CLI 迁移路径。
5. 事务完成后立即执行 PRE-1A、PRE-1B、POST-1、PRE-3、PRE-4 和 PRE-5A；必须证明 `sales_os_v3` 唯一且为 false、受保护数据未变化、基础版本已记录。
6. 任一复核不通过则停止，不自动重试、不自动回滚、不追加执行后续迁移。全部通过后，首次引导才算完成；后续 3.0 迁移必须由总监另行批准。

## 迁移后

1. 不开启功能开关。
2. 将迁移前保存的 PRE-2 JSON（含 `finance_detail_md5`）原样粘贴进 POST-1 的 `{}`，只执行 POST-1；POST 会按同一排序和字段重新计算并比较，必须得到 `PASS_BASELINE_UNCHANGED`。
3. 重新执行 PRE-1A、PRE-1B、PRE-3、PRE-4、PRE-5：开关表存在且开关仍为 false，对象清单逐行一致，历史无重复/分叉，批准版本均为 `ALREADY_APPLIED`。
4. 任一金额、行数、对象或历史不一致，标记 `STOP_POSTCHECK_MISMATCH`；停止后续发布和开关启用，不自动回滚、不自动修复。

## 留存证据

保存项目名、执行时间（北京时间）、操作者、PRE/POST 查询结果、迁移前后对象 CSV 和实际执行的迁移版本。证据齐全且全部 PASS 后，才把“数据库迁移完成、功能仍关闭”交回总监复核。
