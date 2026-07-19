# P0-08 本地静态门禁与统一集成入口

> 状态：本地资产已建立；独立恢复证据已完成，G0 尚需其他 P0 条件。
> 范围：统一校验入口只读取仓库文件并执行本地前端构建，不连接数据库或业务网络，不运行 SQL 夹具，不部署，不发布。GitHub Actions 的 checkout、Node 设置和 `npm ci` 依赖安装仍会访问 GitHub/npm 包源。

## 资产

- migration-sha256-manifest.json：冻结当前 69 个历史迁移的版本、文件名和规范化 UTF-8/LF 内容 SHA256。
- scripts/p0/verify-migration-manifest.mjs：验证迁移数量、14 位版本唯一、文件名集合、清单顺序和每个文件 SHA256。
- scripts/p0/project-ref-contract.json：分别登记生产 ref 与独立测试项目 ref；预览构建仍保持禁止，直至恢复和隔离验证完成。
- scripts/p0/verify-project-ref-contract.mjs：验证 supabase/config.toml 与生产合同一致；测试 ref 存在时必须与生产不同。
- core-business-contract.json 与 scripts/p0/verify-core-business-contract.mjs：冻结客户层级、三价、混合收款、订单/库存/履约、工作项、案例授权和数据保护语义；现有103表映射已由对象分类证据冻结，新增表/字段/枚举名继续如实标记为 P0 待冻结。
- role-migration-contract.json 与 scripts/p0/verify-role-migration-contract.mjs：冻结五主岗位、两个附加职能和旧角色转换；现网只读统计的 2 个主岗位人工决定继续保持阻塞。
- public-table-live-evidence.json 与 scripts/p0/verify-public-table-live-evidence.mjs：校验生产只读、零业务行取证的 103 表逐表 RLS/GRANT/策略/触发器/索引/外键证据，并保持 0/103 监理验收。
- public-routine-live-evidence.json 与 scripts/p0/verify-public-routine-live-evidence.mjs：校验 162 个生产函数签名的 owner、ACL、`search_path`、提权标志、触发器引用和定义指纹，并保持 0/162 监理验收；不保存函数正文。
- object-classification-isolated-evidence.json 与 scripts/p0/capture-object-classification-evidence.mjs：在已恢复的封闭项目用显式只读事务补齐 103 表精确行数、162 函数表/函数依赖和 216 个运行时源码文件入口；不返回业务行、函数正文或凭据。
- public-object-classification-freeze.json、scripts/p0/build-object-classification-freeze.mjs 与 scripts/p0/verify-object-classification-freeze.mjs：把生产只读元数据、隔离依赖证据和源码入口合并为 103/103 表、162/162 函数监理冻结结论，并保留 P0/P1A 权限风险和 205 个外键优先级；不宣称 G0 整体通过。
- public-routine-caller-crosscheck.json 与 scripts/p0/verify-routine-caller-crosscheck.mjs：扫描 `src` 和 `supabase/functions` 的运行时源码，核验明确 RPC 名称均在线上存在，并单列动态包装调用和无本地调用方的可执行签名。
- public-foreign-key-risk-live-evidence.json、advisor-risk-priority-evidence.json 与 scripts/p0/verify-advisor-risk-priority-evidence.mjs：交叉核验 309 个外键、Advisor 205 个未覆盖外键和 143/315 安全/性能提示，并保持风险决定验收为 0；不执行数据库变更。
- backup-restore-manifest.template.json：冻结数据库、Auth、Storage、Functions、Cron、运行配置和恢复证据的机器合同，不含密钥值。
- scripts/p0/verify-backup-manifest-contract.mjs：验证备份恢复合同结构、敏感值禁令和 not-run 恢复状态。
- scripts/p0/verify-backup-package-runtime.mjs：在真实备份完成后校验仓库外运行实例、21 类制品文件、字节数、SHA256、冻结时间和对账摘要；不纳入没有真实备份的静态门禁。
- restore-run.p0-test.json 与 scripts/p0/verify-restore-run-contract.mjs：记录当前独立测试项目的一次性恢复运行状态、缺失工具、授权边界、首错停和禁止重试/清理。
- scripts/p0/ci-database-test-contract.json、scripts/p0/ci-runtime/supabase/config.toml 与 scripts/p0/verify-ci-database-contract.mjs：冻结临时本地数据库、1 份基线、69 个迁移、26 个 SQL 测试、4 项 catalog 对账、Supabase CLI 2.109.1、Postgres 17 和零仓库密钥边界；按函数参数签名分别冻结测试引用的 54 个函数/视图定义和其中 28 个重复定义对象，要求直接正向源码断言存在于对象最后一条完整 `CREATE` 语句或明确重命名来源，不能由同名重载、同文件其他对象或变量别名代偿；定义来源解析覆盖声明初始化、后置赋值和 `SELECT ... INTO`，SQL 分句器识别单/双引号、行/块注释、嵌套块注释和 dollar-quoted 正文中的分号，interval 输入文本与数据库规范化输出按等价值统一比较；另冻结 2 个直接写入正式订单的回滚夹具，强制包含最终必填 `order_number`。29 个负向自检拒绝清单、连接、版本、全栈误启动、`DO` 美元引用词法粘连、把限制策略误当写授权、函数/视图正文格式敏感、包装视图/计算函数错位、函数重载/重命名错位、interval 等价写法误判、正式订单夹具缺必填编号、错指早期迁移、导入历史直接写权限、过期迁移链预期、失败证据删除或 G0 状态漂移。
- scripts/p0/run-ci-database-gates.mjs：自检模式只验证 127.0.0.1:54322 连接边界并执行 6 个负例；GitHub 模式首错即停地安装基线、历史迁移和测试，使用合成夹具且不连接生产。
- scripts/p0/run-static-gates.mjs：统一运行以上纯静态检查并输出发现、运行、通过、失败和跳过数量。
- scripts/p0/verify-frontend-inventory.mjs：验证现有路由、总方案 4.8 节页面、文件入口和 Storage 命名空间清单。
- scripts/p0/verify-p1-app-navigation-contract.mjs：验证五主岗位、两个附加职能、桌面/移动导航和旧路由映射合同。
- scripts/p0/validate-catalog-snapshot-readonly.ps1：验证 catalog 快照 SQL 只能执行只读语句。
- scripts/p0/validate-security-invoker-view-candidate.ps1：验证三视图候选的范围、列、ACL、调用方和 LF/CRLF 注释解析，不执行 SQL。
- scripts/p0/verify-table-classification-register.mjs：兼容入口，调用最终对象分类冻结校验器，验证来源哈希、集合、逐项字段、风险边界和负向自检。
- scripts/p0/verify-frontend-disposition-crosscheck.mjs：交叉核验前端路由、总方案 4.8、上传入口、Storage 命名空间和处置状态。
- scripts/p0/verify-build-target.mjs：把 production/test-preview 目标与精确项目 ref、URL、前端 key 类型和版本化指纹绑定；拒绝 service role/secret、ref 错配、交叉环境产物和未解锁预览，并内置 20 个正负用例。
- scripts/p0/run-local-integration.mjs：按固定顺序运行十一个本地检查点，首个非零即退出并输出发现、运行、通过、失败和跳过数量。
- .github/workflows/p0-static.yml：PR/手动触发两个作业；Windows 作业在 `npm ci` 后调用本地统一入口，Linux 作业只启动独立临时 Supabase/Postgres，执行数据库门禁并始终删除本地数据卷。

## 命令

~~~powershell
npm.cmd run test:p0:local
~~~

统一入口固定运行：十五个 static gates、CI 数据库 runner 自检、前端 inventory、P1 导航合同、catalog 只读自检、安全视图候选校验、103 表分类合同、前端处置交叉核验、构建目标负测、隔离目标前端编译和静态产物扫描。runner 发现十一个检查点；其中 static gates 在第一个检查点内部按 15/15 单独计数。任一子命令首次返回非零，runner 立即停止，不运行后续检查点，并如实输出 skipped 数量。

本地统一入口不调用 Supabase CLI、MCP、业务网络、数据库或会写数据的 SQL，不部署、不发布，也不修改历史迁移。catalog 和安全视图脚本只解析仓库内 SQL；build 只生成本地产物。Linux CI 数据库作业是单独边界：只访问 GitHub 包源、容器源和 runner 的 127.0.0.1 临时数据库，不读取仓库密钥或 Supabase 项目 ref，不访问生产；结束时使用 `supabase stop --no-backup` 删除本地数据卷。

## 项目 ref 合同

当前合同如实记录：

- 已知生产 ref：与 supabase/config.toml 一致；
- 测试 ref：`zdmuaqokndhhbarudhtw`；
- 测试项目状态：`restore-validated`，Supabase 复核状态为 `ACTIVE_HEALTHY`；当前项目已完成正式封闭恢复 1/1 和全量对账；
- 生产与测试 ref：不同；
- 预览构建：恢复、密钥隔离和运行时校验完成前保持禁止。

项目 ref 合同对当前项目输出 `readiness=READY restore=validated preview=disabled`。数据库/Auth/Storage 正式恢复和全量对账证据由当前成功包保留；预览继续关闭。

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
- 静态门禁：discovered=15 run=15 passed=15 failed=0 skipped=0；
- 统一入口：discovered=11 run=11 passed=11 failed=0 skipped=0；
- CI 数据库边界自检：合同 definitions=54、redefined=28、directOrderFixtures=2、negative=29/29，runner negative=6/6、databaseCalls=0；
- 安全候选换行回归：cases=4，覆盖 lf、crlf、mixed、comment-semicolon；
- 安全候选自检：cases=10 positive=4 negative=6；候选结果为 views=3 policies=4 callers=3 migrations=clean database_calls=0；
- 103 表分类合同与前端处置交叉核验均成功；
- 前端清单、P1 导航合同、catalog 只读校验和前端构建全部成功；
- 构建目标负测：20/20，覆盖 URL/ref/key/指纹错配、secret key、交叉环境产物和预览未解锁；
- 核心业务合同：76/76；角色转换合同：77/77，并如实输出 2 项人工主岗位决定未完成；
- 逐表现网元数据：103/103 表、RLS 103、策略 229、触发器 29、索引 248、外键 309；业务行读取和生产写入均为 0；
- 逐函数现网元数据：162/162 签名、148 个 `SECURITY DEFINER`、135 个 authenticated 可执行提权函数、7 个 anon 可执行签名、1 个缺固定 `search_path`；函数正文返回、业务行读取和生产写入均为 0；
- 本地调用方交叉核验：215 个运行时源码文件、99 个明确 RPC 名称、0 个线上缺失名称、1 个动态包装点、102 个有本地调用方的签名；49 个 authenticated 可执行但无本地调用方的签名继续待审；
- Advisor/外键风险：Security 143、Performance 315；外键 309、覆盖 104、未覆盖 205，优先级候选 P1A/P1B/P2=137/31/37；业务行读取和数据库写入均为 0，验收决定为 0；
- 测试环境就绪状态仍为 BLOCKED。

本地命令或 CI 绿色本身仍只证明仓库静态合同和前端 build 通过，不能替代远端证据。本次恢复子门禁通过依据是独立测试项目的正式恢复 1/1、基础快照一致、两项授权岗位覆盖和最终全量对账；它仍不等于 G0 整体、页面运行时、六身份业务流程、生产迁移或最终发布验收。
