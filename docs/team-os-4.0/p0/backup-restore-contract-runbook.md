# P0 备份恢复机器合同与 CI 草案

> 状态：本地合同、真实加密备份和正式封闭恢复 1/1 均已验收；G0 已通过。
> 范围：只校验仓库文件，不创建 Supabase 项目，不连接数据库，不运行 SQL 夹具。

## 1. 机器合同

模板位置：

~~~text
docs/team-os-4.0/p0/backup-restore-manifest.template.json
~~~

备份包模板已升级为 schema v2，覆盖：

- 数据库 roles、schema、data、迁移历史 schema/data、Auth/Storage 自定义结构差异、工具版本和各自 SHA256；
- Auth identities、provider 设置名称、profile/岗位映射及数量；
- Storage 桶清单、对象清单、对象文件归档和各自 SHA256；
- Edge Functions 清单与源码归档；
- Cron/工作器清单、数量和 Asia/Shanghai 时区；
- feature flags 清单；
- 仅环境变量名称（含 Functions 使用的 `SITE_URL`），不含任何值；
- Git commit、前端产物及 SHA256；
- 表行数、关键金额和库存对账；
- 独立恢复目标与各组件恢复结果。

数据库 dump 与 Storage 文件归档必须是两个独立制品，不能用 storage.objects 行记录代替文件本体，也不能把数据库 dump 当作 Storage 备份。

## 2. 敏感信息禁令

模板和以后生成的共享 manifest 只记录变量名与受控制品位置，不记录：

- service role、anon/publishable key 的值；
- 数据库密码、访问/刷新 token；
- 企业微信 Webhook 完整地址；
- 带凭证连接串；
- 私钥正文或任何用户密码。

真实备份文件、Auth 映射和 Storage 对象不得提交仓库。共享 manifest 只能引用受控存放位置及 SHA256。

## 3. 本地验证

在仓库根目录执行：

~~~powershell
npm.cmd run test:p0:backup-contract
npm.cmd run test:p0:static
~~~

备份合同门禁会验证必填结构、21 类独立制品槽位、环境变量名称清单、敏感值禁令，以及 restoreEvidence 和全部组件结果均明确为 not-run。

模板通过只表示合同结构安全、当前状态没有伪造恢复成功。它不表示任何备份文件真实存在。

真实备份完成后，必须把模板复制到仓库外的受控备份目录，填成 `template=false` 的运行实例，并执行：

~~~powershell
npm.cmd run verify:p0:backup-package -- --manifest C:\受控备份目录\manifest.json
~~~

运行时校验器会逐个读取 21 类加密制品，核对文件存在、字节数、SHA256、工具版本、冻结时间、Auth/Storage/Functions/Cron 范围以及生产冻结前后金额和库存对账摘要。备份校验发生在恢复之前，因此 `targetAfterSha256` 必须保持 `null`；测试项目恢复后的目标哈希只写入独立恢复运行证据，不能倒填并改写已封存备份。运行实例和备份本体必须在仓库外；仅模板门禁绿色不能代替该证据。

## 4. CI 草案边界

工作流 `.github/workflows/p0-static.yml` 只允许 pull_request 和 workflow_dispatch 触发，权限仅 `contents: read`。步骤固定为：

1. Windows 作业执行 `npm ci` 和 `npm.cmd run test:p0:local`；
2. Linux 作业在临时 Postgres 17 中执行基线、69 个迁移、26 个 SQL 测试和 4 项 catalog 对账；
3. 无论成功失败均销毁临时数据库数据卷。

工作流不读取 Supabase secrets，不连接生产 Supabase；SQL 只在作业临时数据库执行，不 deploy、不发布 Pages、不修改分支、PR 或外部资源。

## 5. G0 证据边界

单独的本地 CI 绿色不等于 G0。G0 已另行取得并联合验收以下证据：

- 已获授权且与生产隔离的测试项目；
- 数据库和 Storage 的真实完整备份；
- Auth 身份/岗位关系、Functions、Cron、feature flags 和运行配置备份；
- 在独立测试项目完成的一次真实恢复；
- 数据、金额、积分、收益、库存、对象文件 SHA256 和岗位权限对账；
- 安全顾问目标错误的隔离修复证据。

上述证据已经全部完成，正式恢复运行实例保持 `succeeded`，G0 已签署。G0 仍不授权生产迁移、部署、恢复、发布或合并；这些动作必须进入各自后续门禁。

## 6. 当前恢复运行实例

`restore-run.p0-test.json` 是当前独立测试项目的正式成功运行实例，并与仓库外加密制品和原始日志共同构成证据。它固定：

- 生产 ref 只读、测试 ref 独立且不同；
- 预览、真实用户登录、企业微信/邮件等外发全部关闭；
- 正式恢复最多一次，首错即停，不自动清理、不自动重试；
- 工具链、完整生产快照读取、独立测试项目恢复和全量对账均已完成，状态是 `succeeded`；正式恢复次数 1/1。

本机已安装并冻结 Supabase CLI 2.109.1、`psql` 18.4 和 `pg_dump` 18.4 的绝对路径。由于 C 盘剩余空间不足且 WSL 未启用，本轮不安装 Docker；恢复方法明确选用 `session-pooler-postgresql-client`，由 Supabase CLI 取得短时数据库登录凭据和每个项目实际分配的 Session Pooler 地址，端口固定为 5432，并使用 `pg_dump` 精确导出、`psql --single-transaction --set ON_ERROR_STOP=1` 原子恢复。该方法能单独覆盖 G0 所需的 Auth 身份/密码哈希；Docker 状态如实登记为 `not-required`，不是伪报已安装。

工具状态必须用以下只读命令复核，不能只凭“桌面有图标”或 PATH 猜测：

~~~powershell
npm.cmd run audit:p0:recovery-toolchain
~~~

该命令逐项比对 `restore-run.p0-test.json` 的声明与本机可执行文件、绝对路径和版本输出，并确认所选方法只把 Supabase CLI、`psql`、`pg_dump` 列为必需工具。它不安装软件、不连接 Supabase、不读取备份，也不写数据库。

## 7. 一次性正式恢复顺序

用户已允许内部协调暂停 3.0，因此正式切换不建设双写、CDC 或零停机。不可跳过的顺序是：

1. 通知内部人员暂停 3.0，并冻结页面、API、Auth 变更、Functions、Webhook、Cron 和后台人工写入；
2. 取生产只读基线，导出 roles/schema/data/迁移历史及 Auth/Storage 自定义结构，完成后再次取同口径基线；前后不一致立即停止；
3. 验证测试项目无未知业务数据、预览关闭、外发关闭、生产与测试 ref 不同；
4. 依次恢复数据库、Auth、Storage 对象本体、安全测试配置、禁用态 Functions 和禁用态 Cron；任何一步首次失败立即停止，后续标记 skipped；
5. 只读对账 103 表、Auth/岗位孤儿、金额、积分、收益、库存、Storage 对象数量/字节/SHA256；
6. 保存成功证据，或保留失败后的测试项目和原始日志等待新决定。失败后不得现场修补再重跑。

## 8. 数据处理决定

G0 已采用“加密的完整恢复演练”：真实数据只进入封闭测试项目，不接预览前端，不复制生产 JWT secret、SMTP、OAuth、Webhook、Functions 密钥或启用态 Cron；旧生产 token 在测试项目无效。

因此不再使用“只做脱敏/合成恢复”替代本次灾备证据。日常后续测试仍使用合成或批准脱敏数据，完整真实快照只服务于封闭恢复和最终一次性切换。

## 9. 失败停损

静态合同出现语义或安全失败时立即停止，保存原始输出，不通过删除字段、放宽敏感值规则或伪造 test/restore 状态让 CI 变绿。格式和路径机械错误可在同一工单修正后重新执行本地门禁。
