# P0 备份恢复机器合同与 CI 草案

> 状态：本地合同已建立；真实备份与恢复均未执行，G0 仍未通过。
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

运行时校验器会逐个读取 21 类加密制品，核对文件存在、字节数、SHA256、工具版本、冻结时间、Auth/Storage/Functions/Cron 范围以及金额和库存对账摘要。运行实例和备份本体必须在仓库外；仅模板门禁绿色不能代替该证据。

## 4. CI 草案边界

工作流 .github/workflows/p0-static.yml 只允许 pull_request 和 workflow_dispatch 触发，权限仅 contents: read。步骤固定为：

1. npm ci；
2. `npm.cmd run test:p0:local` 统一运行 static gates、前端 inventory、P1 导航合同、catalog 只读自检、安全视图候选校验、103 表分类、前端处置交叉核验、构建目标负测和前端编译。

工作流不读取 Supabase secrets，不连接 Supabase，不执行 SQL，不 deploy，不发布 Pages，不修改分支、PR 或外部资源。

## 5. 绿灯不等于 G0

CI 绿色只证明当前提交的本地静态合同和前端构建通过；它没有运行数据库、真实岗位权限、业务流程、页面运行时或任何远端测试。G0 仍必须另行取得并验收：

- 已获授权且与生产隔离的测试项目；
- 数据库和 Storage 的真实完整备份；
- Auth 身份/岗位关系、Functions、Cron、feature flags 和运行配置备份；
- 在独立测试项目完成的一次真实恢复；
- 数据、金额、积分、收益、库存、对象文件 SHA256 和岗位权限对账；
- 安全顾问目标错误的隔离修复证据。

在这些证据全部完成前，restoreEvidence 必须保持 not-run，P0 台账继续标记 G0 未通过。任何 CI 绿色状态都不能授权生产迁移、部署、恢复、发布、push、PR 或合并。

## 6. 当前恢复运行实例

`restore-run.p0-test.json` 是当前独立测试项目的运行实例，不是成功证明。它固定：

- 生产 ref 只读、测试 ref 独立且不同；
- 预览、真实用户登录、企业微信/邮件等外发全部关闭；
- 正式恢复最多一次，首错即停，不自动清理、不自动重试；
- 当前工具链、数据处理方式、生产备份读取、测试恢复写入和备份制品均未就绪，因此状态是 `preflight-blocked`。

本机只读预检确认 `supabase`、Docker、`psql`、`pg_dump` 均缺失。安装并冻结绝对路径、版本和当前 `--help` 之前，不得拼接正式导出或恢复命令。

工具状态必须用以下只读命令复核，不能只凭“桌面有图标”或 PATH 猜测：

~~~powershell
npm.cmd run audit:p0:recovery-toolchain
~~~

该命令逐项比对 `restore-run.p0-test.json` 的声明与本机可执行文件、绝对路径和版本输出；Docker 还必须同时返回客户端和服务端版本。它不安装软件、不连接 Supabase、不读取备份，也不写数据库。

## 7. 一次性正式恢复顺序

用户已允许内部协调暂停 3.0，因此正式切换不建设双写、CDC 或零停机。不可跳过的顺序是：

1. 通知内部人员暂停 3.0，并冻结页面、API、Auth 变更、Functions、Webhook、Cron 和后台人工写入；
2. 取生产只读基线，导出 roles/schema/data/迁移历史及 Auth/Storage 自定义结构，完成后再次取同口径基线；前后不一致立即停止；
3. 验证测试项目无未知业务数据、预览关闭、外发关闭、生产与测试 ref 不同；
4. 依次恢复数据库、Auth、Storage 对象本体、安全测试配置、禁用态 Functions 和禁用态 Cron；任何一步首次失败立即停止，后续标记 skipped；
5. 只读对账 103 表、Auth/岗位孤儿、金额、积分、收益、库存、Storage 对象数量/字节/SHA256；
6. 保存成功证据，或保留失败后的测试项目和原始日志等待新决定。失败后不得现场修补再重跑。

## 8. 数据处理待决项

G0 要证明真实灾备能力，推荐使用“加密的完整恢复演练”：真实数据只短期进入封闭测试项目，不接预览前端，不复制生产 JWT secret、SMTP、OAuth、Webhook、Functions 密钥或 Cron；旧生产 token 在测试项目无效。演练完成后再决定销毁或脱敏。

若只使用脱敏/合成数据，隐私风险更低，但不能证明真实 Auth 用户和密码哈希可恢复，G0 的 Auth 灾备条款必须另做临时封闭项目才能通过。正式恢复前由项目所有者在这两个选项中确认一个。

## 9. 失败停损

静态合同出现语义或安全失败时立即停止，保存原始输出，不通过删除字段、放宽敏感值规则或伪造 test/restore 状态让 CI 变绿。格式和路径机械错误可在同一工单修正后重新执行本地门禁。
