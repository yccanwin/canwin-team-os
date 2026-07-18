# P0-08 本地静态门禁与统一集成入口

> 状态：本地资产已建立；G0 仍未通过。
> 范围：只读取仓库文件并执行本地前端构建，不连接数据库，不访问网络，不运行 SQL 夹具，不部署，不发布。

## 资产

- migration-sha256-manifest.json：冻结当前 69 个历史迁移的版本、文件名和规范化 UTF-8/LF 内容 SHA256。
- scripts/p0/verify-migration-manifest.mjs：验证迁移数量、14 位版本唯一、文件名集合、清单顺序和每个文件 SHA256。
- scripts/p0/project-ref-contract.json：登记已知生产 ref，并明确测试项目尚未配置。
- scripts/p0/verify-project-ref-contract.mjs：验证 supabase/config.toml 与生产合同一致；测试 ref 存在时必须与生产不同。
- backup-restore-manifest.template.json：冻结数据库、Auth、Storage、Functions、Cron、运行配置和恢复证据的机器合同，不含密钥值。
- scripts/p0/verify-backup-manifest-contract.mjs：验证备份恢复合同结构、敏感值禁令和 not-run 恢复状态。
- scripts/p0/run-static-gates.mjs：统一运行以上纯静态检查并输出发现、运行、通过、失败和跳过数量。
- scripts/p0/verify-frontend-inventory.mjs：验证现有路由、总方案 4.8 节页面、文件入口和 Storage 命名空间清单。
- scripts/p0/verify-p1-app-navigation-contract.mjs：验证五主岗位、两个附加职能、桌面/移动导航和旧路由映射合同。
- scripts/p0/validate-catalog-snapshot-readonly.ps1：验证 catalog 快照 SQL 只能执行只读语句。
- scripts/p0/validate-security-invoker-view-candidate.ps1：验证三视图候选的范围、列、ACL、调用方和 LF/CRLF 注释解析，不执行 SQL。
- scripts/p0/verify-table-classification-register.mjs：验证 103 张 public 表分类合同及开放审计缺口。
- scripts/p0/verify-frontend-disposition-crosscheck.mjs：交叉核验前端路由、总方案 4.8、上传入口、Storage 命名空间和处置状态。
- scripts/p0/run-local-integration.mjs：按固定顺序运行八个本地检查点，首个非零即退出并输出发现、运行、通过、失败和跳过数量。
- .github/workflows/p0-static.yml：PR/手动触发的 Windows 本地集成 CI 候选；`npm ci` 后只调用统一入口。

## 命令

~~~powershell
npm.cmd run test:p0:local
~~~

统一入口固定运行：三个 static gates、前端 inventory、P1 导航合同、catalog 只读自检、安全视图候选校验、103 表分类合同、前端处置交叉核验和前端 build。runner 发现八个检查点；其中 static gates 在第一个检查点内部按 3/3 单独计数。任一子命令首次返回非零，runner 立即停止，不运行后续检查点，并如实输出 skipped 数量。

该入口不调用 Supabase CLI、MCP、网络、数据库或会写数据的 SQL，不部署、不发布，也不修改历史迁移。catalog 和安全视图脚本只解析仓库内 SQL；build 只生成本地产物。

## 项目 ref 合同

当前合同如实记录：

- 已知生产 ref：与 supabase/config.toml 一致；
- 测试 ref：null；
- 测试项目状态：not-provisioned；
- 预览构建：在测试项目建立前保持禁止。

因此项目 ref 合同检查可以通过，但会同时输出
readiness=BLOCKED reason=test-project-not-provisioned。这只证明本地声明没有把生产伪装成测试，不证明测试环境已建立，也不解除 G0 阻塞。

## 迁移清单边界

清单以提交 69877841ccac22ce498d2ea6d6b7f0554a98f0cb 中的 69 个迁移为基线。验证器会拒绝：

- 迁移文件缺失或新增但清单未更新；
- 版本重复或文件名不符合 14位版本_名称.sql；
- 清单版本与文件名前缀不一致；
- 任一历史迁移正文变化导致的 SHA256 不一致。哈希前只把 CRLF/CR 规范化为 LF，避免 Windows 与 Linux checkout 产生假差异；其他正文差异均会失败。

以后新增 4.0 兼容迁移时，只能追加新文件和新清单项；现有 69 项的版本、文件名和 SHA256 不得变化。清单更新须独立评审，不能用重新生成整个清单掩盖历史迁移被修改。

## 本地验收口径

成功输出必须同时包含：

- 迁移文件：discovered=69 run=69 passed=69 failed=0；
- 静态门禁：discovered=3 run=3 passed=3 failed=0 skipped=0；
- 统一入口：discovered=8 run=8 passed=8 failed=0 skipped=0；
- 安全候选换行回归：cases=4，覆盖 lf、crlf、mixed、comment-semicolon；
- 安全候选自检：cases=9 positive=4 negative=5；候选结果为 views=3 callers=3 migrations=clean database_calls=0；
- 103 表分类合同与前端处置交叉核验均成功；
- 前端清单、P1 导航合同、catalog 只读校验和前端构建全部成功；
- 测试环境就绪状态仍为 BLOCKED。

本地命令或 CI 绿色只证明仓库静态合同和前端 build 通过。它不包含数据库执行、真实岗位权限、业务流程、页面运行时或远端测试，不证明远端迁移 SQL 正文一致，不证明生产安全顾问已清零，也不证明数据库、Auth 或 Storage 已在独立项目恢复成功，因此不能声称 G0 通过。
