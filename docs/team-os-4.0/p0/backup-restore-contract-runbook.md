# P0 备份恢复机器合同与 CI 草案

> 状态：本地合同已建立；真实备份与恢复均未执行，G0 仍未通过。
> 范围：只校验仓库文件，不创建 Supabase 项目，不连接数据库，不运行 SQL 夹具。

## 1. 机器合同

模板位置：

~~~text
docs/team-os-4.0/p0/backup-restore-manifest.template.json
~~~

模板覆盖：

- 数据库 dump、格式、工具版本和独立 SHA256；
- Auth 用户标识与 profile/岗位映射及数量；
- Storage 桶清单、对象清单、对象文件归档和各自 SHA256；
- Edge Functions 清单与源码归档；
- Cron/工作器清单、数量和 Asia/Shanghai 时区；
- feature flags 清单；
- 仅环境变量名称，不含任何值；
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

备份合同门禁会验证必填结构、14 类独立制品槽位、环境变量名称清单、敏感值禁令，以及 restoreEvidence 和全部组件结果均明确为 not-run。

模板通过只表示合同结构安全、当前状态没有伪造恢复成功。它不表示任何备份文件真实存在。

## 4. CI 草案边界

工作流 .github/workflows/p0-static.yml 只允许 pull_request 和 workflow_dispatch 触发，权限仅 contents: read。步骤固定为：

1. npm ci；
2. 本地 P0 静态门禁；
3. 前端 inventory 静态核验；
4. 后端 catalog SQL 只读验证器自检；
5. 前端 build。

工作流不读取 Supabase secrets，不连接 Supabase，不执行 SQL，不 deploy，不发布 Pages，不修改分支、PR 或外部资源。

## 5. 绿灯不等于 G0

CI 绿色只证明当前提交的本地静态合同、前后端 inventory 和构建通过。G0 仍必须另行取得并验收：

- 已获授权且与生产隔离的测试项目；
- 数据库和 Storage 的真实完整备份；
- Auth 身份/岗位关系、Functions、Cron、feature flags 和运行配置备份；
- 在独立测试项目完成的一次真实恢复；
- 数据、金额、库存、对象文件 SHA256 和岗位权限对账；
- 安全顾问目标错误的隔离修复证据。

在这些证据全部完成前，restoreEvidence 必须保持 not-run，P0 台账继续标记 G0 未通过。任何 CI 绿色状态都不能授权生产迁移、部署、恢复、发布、push、PR 或合并。

## 6. 失败停损

静态合同出现语义或安全失败时立即停止，保存原始输出，不通过删除字段、放宽敏感值规则或伪造 test/restore 状态让 CI 变绿。格式和路径机械错误可在同一工单修正后重新执行本地门禁。
