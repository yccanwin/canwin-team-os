# P0 后端 catalog 只读快照运行手册

> 状态：完整 catalog 原始快照尚未冻结；103 表标准化逐表元数据已于 2026-07-19 只读取证
> SQL：`scripts/p0/catalog-snapshot.sql`、`scripts/p0/public-table-live-evidence.sql`
> 静态门禁：`scripts/p0/validate-catalog-snapshot-readonly.ps1`

## 1. 用途和边界

该快照只读取 PostgreSQL/Supabase catalog 元数据，用于冻结 P0 数据库现状。输出覆盖：

- `public` 表、视图、函数/过程、策略、触发器和索引；
- 对象 owner、ACL、RLS、视图调用者权限标记和函数提权标记；
- 外键、视图—关系、函数—关系和触发器—函数依赖；
- `pg_class.reltuples` 行数估计与最近统计时间；
- `supabase_migrations.schema_migrations` 的版本和名称。

SQL 不读取业务表正文，不输出函数正文、策略表达式或触发器执行语句，也不包含任何 DDL、DML、DCL 或维护动作。`reltuples` 是规划器估计值，不能作为财务、库存或迁移对账数量。

当前 `public-table-live-evidence.sql` 已通过 Supabase 只读查询执行一次，标准化结果保存在 `public-table-live-evidence.json`。它证明 103/103 表的 owner、行数估计、RLS、有效 GRANT、229 条策略、29 个触发器、248 个索引、309 个外键和 catalog 可见依赖；业务行读取=0、写入=0。完整函数正文依赖、策略表达式和原始连接输出仍不进入仓库。

## 2. 执行前门禁

生产执行需要单独授权。本地提交、静态校验通过或 SQL 看起来安全，都不等于允许连接生产。

执行人必须逐项确认：

1. 使用专用数据库只读角色；不要使用前端 anon key、service role key 或个人高权限连接。
2. 密码只放在密码管理器或受控 `.pgpass` 中，不写入命令、日志、仓库或输出文件。
3. 连接配置启用 TLS，并确认目标项目、区域和维护窗口；输出中不记录连接串。
4. 会话强制 `default_transaction_read_only=on`，并设置 60 秒语句超时。
5. 先运行静态门禁；任何失败立即停止，不执行 SQL，不自行放宽规则。
6. 只运行仓库中已审查的文件，不复制粘贴临时 SQL，不在 SQL Editor 追加语句。

Supabase 2026 年变更不改变本快照的 catalog-only 边界。当前托管项目使用 PostgreSQL 17；新项目的数据 API 暴露方式可能不同，但本快照不通过 Data API 读取业务表。

## 3. 本地静态预检

在仓库根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\p0\validate-catalog-snapshot-readonly.ps1 -SelfTest
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\p0\validate-catalog-snapshot-readonly.ps1 -SqlPath .\scripts\p0\public-table-live-evidence.sql -LiveTableEvidence
```

唯一通过标记应同时出现：

```text
P0_CATALOG_SNAPSHOT_STATIC_SELFTEST_OK cases=9
P0_CATALOG_SNAPSHOT_READONLY_OK statements=15
P0_CATALOG_SNAPSHOT_READONLY_OK statements=1
```

门禁会拒绝：

- 数据、结构、权限和维护类动作；
- `SELECT INTO`、psql 元命令和常见可变更状态的函数；
- 对 `public`、`auth`、`storage` 业务关系的直接访问；
- `pg_catalog`、`information_schema`、迁移版本表之外的限定 schema 来源；
- 缺失任一必需快照区段的 SQL。

## 4. 生产只读执行

推荐使用已配置好的 `pg_service.conf` 服务名，例如 `canwin_prod_readonly`。服务配置不得进入仓库。下列命令只展示执行形态，不得在未授权时运行：

```powershell
$env:PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=60000'
psql.exe 'service=canwin_prod_readonly' -X --set ON_ERROR_STOP=1 --file .\scripts\p0\catalog-snapshot.sql --output .\p0-catalog-snapshot.raw.txt
Remove-Item Env:PGOPTIONS
```

执行后立即检查：

- psql 退出码为 `0`；
- 输出只有 `SELECT` 结果集，没有权限提升、对象变更或业务数据；
- 数据库审计日志中只出现 catalog 查询；
- 未触发迁移历史变化、部署、Storage 操作或函数调用。

如果只读角色不能读取 `supabase_migrations.schema_migrations`，停止本次执行并记录权限缺口。不要临时提升角色；迁移数量可由 Supabase 只读迁移列表另行核对。

## 5. 输出脱敏与证据保存

原始输出只保存在受控证据目录，不发送到聊天、工单或公开仓库。制作共享副本时：

1. 删除数据库 host、project ref、连接用户名、客户端 IP、连接串和本机绝对路径。
2. 保留对象名、函数签名、策略名和索引名；它们是 B01 分类和依赖核验所需证据。
3. 保留标准角色名：`PUBLIC`、`anon`、`authenticated`、`service_role`、`postgres` 和 `supabase_*`。
4. 非标准数据库角色若含人员、邮箱、客户或环境标识，使用稳定代号（如 `CUSTOM_ROLE_01`）替换，并单独保存受控映射。
5. 不补充业务行、函数正文、策略表达式、触发器执行语句、访问密钥或认证用户资料。
6. 分别计算原始文件和脱敏副本 SHA-256；工单只记录脱敏副本哈希及受控原件位置。

## 6. 数量校验

本轮冻结目标如下。数量变化不自动判错，但必须停止“基线一致”结论，先解释差异：

| 项目 | 冻结目标 | 快照区段 |
| --- | ---: | --- |
| `public` 表 | 103 | `summary_counts.public_tables` / `relations` |
| `public` 视图 | 11 | `summary_counts.public_views` / `relations` |
| `public` 函数/过程 | 162 | `summary_counts.public_routines` / `routines` |
| `public` 策略 | 229 | `summary_counts.public_policies` / `policies` |
| `public` 索引 | 248 | `summary_counts.public_indexes` / `indexes` |
| `public` 触发器对象 | 29 | `summary_counts.public_trigger_objects` / `trigger_objects` |
| `public` 触发器事件行 | 46 | `summary_counts.public_trigger_event_rows` / `trigger_event_rows` |
| 已应用迁移 | 69 | `summary_counts.applied_migrations` / `migration_versions` |

触发器的 `29` 和 `46` 不是冲突：`pg_trigger` 按触发器对象计数；`information_schema.triggers` 会把同一触发器监听的多个事件展开成多行。

本地迁移数量另行只读核验：

```powershell
(Get-ChildItem -LiteralPath .\supabase\migrations -File -Filter '*.sql').Count
```

远端 69 个版本/名称必须与本地 69 个文件逐项对应。名称一致仍不能证明远端历史 SQL 正文与本地文件逐字相同；正文哈希属于后续独立工单。

## 7. 结果判定

快照通过只证明“P0 catalog 基线已取证”，不证明：

- 103 张表四分类已由监理冻结；
- 三个安全定义者视图已修复；
- 162 个函数已完成身份/岗位/EXECUTE 审计；
- RLS 策略、索引和外键风险已关闭；
- 生产迁移、发布、恢复或合并获得授权。

依赖区段也有边界：动态 SQL、PL/pgSQL 运行时关系、前端 PostgREST 调用和 Edge Function 调用不一定记录在 `pg_depend` 中，必须继续与本地源码和调用日志交叉核对。

任何数量不符、权限错误、超时或输出异常，都应保存只读证据并停止；不得在同一授权内追加修复 SQL 或重试生产执行。
