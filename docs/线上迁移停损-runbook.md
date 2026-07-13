# 线上迁移停损 Runbook

适用范围：人工执行 CanWin Team OS 3.0 数据库迁移前后的停损核对。本文不授权发布，不包含密钥，也不执行迁移、删除或数据修复。

## 执行前

1. 在 Supabase 控制台确认当前项目名称和环境是目标生产项目；不确定则 `STOP_WRONG_OR_UNKNOWN_PROJECT`。
2. 打开 [线上迁移停损-只读预检.sql](./线上迁移停损-只读预检.sql)，先单独执行 PRE-1A；只有得到 `PASS_FEATURE_FLAGS_TABLE_PRESENT` 才执行 PRE-1B，再逐段执行 PRE-2 至 PRE-5。
3. 保存每段结果；PRE-2 的 `baseline_snapshot` 原样保存，PRE-3 的对象清单导出 CSV。
4. 任一结果以 `STOP` 开头，立即停止，不执行迁移；把完整结果交回总监判断。
5. PRE-5 只是列出 `PENDING`/`ALREADY_APPLIED`，不能复制成迁移命令。先确认待执行版本连续且与本次批准范围一致。

## 允许继续的最低条件

- PRE-1A 为 `PASS_FEATURE_FLAGS_TABLE_PRESENT`，且 PRE-1B 为 `PASS_FLAG_FALSE`；缺表返回 `STOP_FEATURE_FLAGS_TABLE_MISSING_SAFE_CLOSED`，表示无法证明开关关闭，必须停止。
- PRE-2 已保存 finance_records 行数、收入/支出/总金额、按 `team_id / record_type / date / id` 固定顺序生成的完整明细 MD5，achievements/photos 行数，以及 canwin-media 数量和摘要。
- PRE-3 的 canwin-media 完整对象清单已导出并可打开。
- PRE-4 为 `PASS_MIGRATION_HISTORY_PRECHECK`，本地和远端无重复版本，本工作区起始日期后的远端历史无分叉。
- PRE-5 的待执行版本已由总监确认；任何缺口、意外已执行版本或未知版本都停止。

## 迁移后

1. 不开启功能开关。
2. 将迁移前保存的 PRE-2 JSON（含 `finance_detail_md5`）原样粘贴进 POST-1 的 `{}`，只执行 POST-1；POST 会按同一排序和字段重新计算并比较，必须得到 `PASS_BASELINE_UNCHANGED`。
3. 重新执行 PRE-1A、PRE-1B、PRE-3、PRE-4、PRE-5：开关表存在且开关仍为 false，对象清单逐行一致，历史无重复/分叉，批准版本均为 `ALREADY_APPLIED`。
4. 任一金额、行数、对象或历史不一致，标记 `STOP_POSTCHECK_MISMATCH`；停止后续发布和开关启用，不自动回滚、不自动修复。

## 留存证据

保存项目名、执行时间（北京时间）、操作者、PRE/POST 查询结果、迁移前后对象 CSV 和实际执行的迁移版本。证据齐全且全部 PASS 后，才把“数据库迁移完成、功能仍关闭”交回总监复核。
