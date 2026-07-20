# P0-07 P1 工单与冻结接口

> 状态：P1 工单和接口已冻结；run [`29726897764`](https://github.com/yccanwin/canwin-team-os/actions/runs/29726897764)、[`29733854344`](https://github.com/yccanwin/canwin-team-os/actions/runs/29733854344)、[`29738966326`](https://github.com/yccanwin/canwin-team-os/actions/runs/29738966326) 及两次正式 dry-run 失败现场均原样保留。最新正式命令 `p1-acl-repair-20260720T122757275Z-8fa1498850` 在独立测试项目直连入口超时，正式/db push尝试0、持久写0、生产读写0。当前迁移通道已强制切换 Session Pooler，runner 71/71；旧资格关闭，`remote/dbPush=false`，等待全新双平台CI。生产禁止，G1=false，整体验收仍为25%。
> 机器合同：`scripts/p0/p1-interface-freeze.json`；校验器：`scripts/p0/verify-p1-interface-freeze.mjs`。

## P1 目标

建立五个主岗位、附加角色/技能、仓库职能、主管总开关、统一责任回落、岗位侧边栏和工作台壳层。P1 不开发 CRM、订单、库存、财务和案例的新业务状态机。

## 团队一：后端业务与数据

- P1-B1：单公司初始化和当前用户公司解析；移除业务接口中的写死团队值。
- P1-B2：主岗位、附加角色、技能、区域和成员启停模型。
- P1-B3：主管体系总开关、授权范围和回落管理员责任路由。
- P1-B4：会话权限上下文和最小字段投影。
- 禁止：改写 69 个历史迁移、复制现有角色表含义、在前端依赖字段里塞授权结论。

## 团队二：前端产品与交互

- P1-F1：一个“我的工作台”壳层，按当前工作视图展示内容。
- P1-F2：按主岗位生成侧边栏；账户菜单切换附加业务视图。
- P1-F3：仓库职能追加“仓库处理”；主管开启且具备职能时追加“团队审批”。
- P1-F4：旧路由按清单重定向或关闭；关闭页面不得删除底层历史数据，未完成业务先映射进 4.0。
- 禁止：在前端复制主管路由、区域权限和敏感字段判断。

## 团队三：测试、迁移与发布

- P1-Q1：五主岗位无附加职能权限测试。
- P1-Q2：仓库附加职能与主管附加职能开/关组合测试。
- P1-Q3：直接 API 越权读取/写入测试。
- P1-Q4：主管失效回落管理员、成员停用和批量转移审计测试。
- P1-Q5：统一测试入口和 CI 实际测试数量证明。
- 禁止：改变业务规则、以浏览器按钮隐藏代替 API 权限证据。

## 冻结接口语义

### 会话权限上下文

后端一次返回：部署公司、成员状态、主岗位、附加业务角色、技能、区域范围、仓库职能、主管职能、主管体系是否开启、允许的工作视图。前端不得自行从多个旧表拼装另一套授权结论。

### 责任路由

输入是业务类型、区域/团队范围、候选负责人和当前时间；输出是责任人、路由原因和回落状态。主管体系关闭、无匹配主管、主管离职或停用时统一回落管理员。开关变化不改写历史责任记录。

### 导航清单

输入是会话权限上下文和当前工作视图；输出桌面/移动端可见导航项、兼容路由和只读标记。导航清单只控制展示，敏感操作仍由数据库权限决定。

### 错误语义

- 未认证：明确返回需要登录。
- 已认证但越权：明确返回拒绝，不能返回空列表伪装成功。
- 主管关闭/无有效主管：返回管理员回落原因。
- 账号停用：拒绝新会话和敏感操作；历史记录仍保留原负责人。

## 已冻结的物理接口

- 只读：`get_app_context_v1`、`get_navigation_manifest_v1`、`resolve_responsible_profile_v1`。
- 幂等管理写入：`admin_apply_member_access_v1`、`admin_set_supervisor_system_v1`、`admin_replace_supervisor_scope_v1`。
- 六类基础身份编号：`P1-IDN-000` 至 `P1-IDN-005`，对应匿名和五个主岗位；仓库/主管组合另有 `P1-OVL-001` 至 `P1-OVL-016`。
- 仓库职能按最终方案第55行校正：管理员默认携带，实施可被授予，销售、运营和财务不得获得；`P1-OVL-001` 为管理员默认、`P1-OVL-002` 为实施获授、`P1-OVL-003` 为运营申请被拒绝。
- 直接 API 攻击测试编号：`P1-API-001` 至 `P1-API-013`；新增销售不得获得仓库职能的负控。
- 会话上下文、导航项、责任路由和角色写入结果使用四组精确字段白名单；主管汇总明确排除电话、微信、邮箱、客户收款金额、公司成本/利润和任何他人个人收入。
- 旧 `owner/captain/member` 只保留读取兼容或人工迁移规则，不再授权 4.0 新写入。

## G0 通过证据

- 15 个失败候选均原样保留。候选 16（run `29686358159`，提交 `f90fb2ee9dff365a6388049cbe9820e4ac0a771f`）的 Windows 本地门禁和 Linux 临时数据库作业均通过：基线 1/1、迁移 69/69、SQL 26/26（数据库7、权限10、业务9）、catalog 4/4，清理成功，生产读写均为 0。
- P1 候选已实施：新增 1 条加法式迁移、6 个版本化 RPC、服务器授权的 AppContext/导航及岗位工作台；生产读写仍为 0。独立 CI 通过不替代测试项目正式应用、全量对账和页面可见验收，完成这些门禁前仍不等于 G1 完成。
- 首个 P1 远端候选 run `29690060130`（提交 `0a8fc72e17ee018638f96c6062cdd9a29362e334`；Windows job `88201083600`，Linux job `88201083572`）已通过 Windows 门禁、70/70 迁移、7/7 数据库测试和前 10 个权限测试；第 18 个 SQL `team_os_4_p1_access_shell.sql` 因回滚夹具忽略 Auth 自动建档规则、重复插入员工档案而触发 `profiles_pkey` 首错停止。该运行未重跑，隔离数据库已清理，catalog 0/4 未开始，生产读写 0；修复候选改为沿用自动档案并幂等补齐测试资料，G1 仍为 false。
- 新独立候选 run `29691027458`（提交 `ed853ebbab250f562d03f433f4d2df4ada87de4e`；Linux job `88203660504`，Windows job `88203660515`）已全绿。Linux：基线、70/70 迁移、27/27 SQL（数据库7、权限11、业务9）、catalog 4/4 和销毁清理全部通过；Windows：static 15/15、local 12/12、P1 壳层 71/71、1975 模块构建和 66 文件制品通过。仓库密钥、生产读取和生产写入均为 0。该证据完成独立 CI 验收，但真实岗位账号登录、页面可见/隐藏、工作视图切换、移动端导航和关闭路由体验尚未验收，因此 `runtimeAccepted=false`、`g1OverallClaim=false`。
- 独立测试项目 `zdmuaqokndhhbarudhtw` 的唯一正式应用尝试 1/1 已首错停止。dry-run 为本地70、远端69，仅 P1 `20260719130910` 待应用；正式执行第5条 `ALTER profile_access_roles.assignment_kind SET NOT NULL` 时触发 pending trigger events、SQLSTATE `55006`。后续 SQL、catalog、对账均未执行，生产读写0；测试项目写入尝试1，目标现场保留且未重试。失败证据 SHA256 为 `773bf49d6fa8eb3abbe564969cbec83b22755282153fd11e5d5d0fc161cfc996`。随后只读复核确认失败前后 13 项快照完全一致、69 条迁移记录不变、P1 列/索引/触发器/函数/夹具/开关残留均为0、idle transaction为0，事务完整回滚；复核证据 `p1-isolated-rollback-readonly-evidence.json` SHA256 为 `9e77cd23a712b5f908e56af8daf355c81cb36d52f468a10afdb131bea6b74ec3`。这只把新候选准入恢复为 ready/pending，不等于正式持久化应用成功；`runtimeAccepted=false`、`g1OverallClaim=false`。
- 修复候选使用 `utf8-lf` 哈希口径锁定迁移、SQL 测试、运行合同和三份执行/校验脚本；本机独立 PostgreSQL 18 实证目录为 `D:\CanWinP1LocalPgRuns\p1-pending-trigger-iWUhfO`，负控 1/1 精确复现 SQLSTATE `55006`，修复顺序 4/4 通过，夹具回滚干净，数据库已停止，尝试 1 次、远端连接 0。该证据只签收 `localPostgresAccepted=true`；隔离测试项目重新应用、全量对账和页面/账号验收仍待执行，G1 仍为 false。
- 新独立 CI run `29693556452`（提交 `b9bcca61b826c641e550c6c070f09c4adc407cbe`）已首错停止且不重跑。Linux job `88210359113` 全绿：迁移70/70、SQL27/27（7/11/9）、catalog4/4、清理成功、生产读写0；Windows job `88210359107` 在 local 第1项 static 的第17门失败，前16门通过，原因是 PG selftest 错把本机固定 `D:\CanWinP1Postgres18` 三工具当成 GitHub runner 必备条件，local 其余11项未执行。当前边界为 `ciRepairCandidateLinuxAccepted=true`、`windowsStatic=16/17`、`portableSelftestRepairPending=true`、`g1OverallClaim=false`。
- 第二个 repair CI run `29694104452`（提交 `92bbac9c265834d0d4f4c550137f519afe366a03`）同样首错停止、保留且不重跑。Linux job `88211774885` 全绿：迁移70/70、SQL27/27（7/11/9）、catalog4/4、清理成功、生产读写0；Windows job `88211774922` 在 local 第1项 static 的 gate16 `p1-isolated-runtime-runner` 失败，前15门通过，gate17 和 local 其余11项均未执行。PG selftest 的可移植分层本身已修；新首错是 validator 对 execute-only 工具门使用原始 CRLF 精确字符串匹配。当前为 `portableSelftestRepairImplemented=true`、`secondRepairWindowsStatic=15/17`、`validatorLineEndingRepairPending=true`、`g1OverallClaim=false`。
- 新独立 CI run [`29694757727`](https://github.com/yccanwin/canwin-team-os/actions/runs/29694757727)（HEAD `8273f5c69e09de24c9afbf27b010d60f7b7caddf`）已全绿，前两次失败运行继续保留且未重跑。Linux job `88213478676` 用时142秒，迁移70/70、SQL27/27（数据库7、权限11、业务9）、catalog4/4和清理全部通过；Windows job `88213478682` 用时111秒，static17/17、local12/12、P1壳层71/71、1975模块构建全部通过，66文件静态制品 SHA256 为 `33505fcddc4b814379906406287b1fa715677b1e218497e1fe5a1693f50fc21b`。GitHub上传制品0；两项 job 各有1条 Node.js 20 Actions运行时弃用警告，另有依赖弃用提示，均未阻断门禁。仓库密钥、生产读取和生产写入均为0。该证据只签收新独立CI；正式持久化应用、全量对账和六类真实/合成账号页面验收未完成，因此 G1/30% 仍未通过。
- Fresh-checkout CI run [`29695919974`](https://github.com/yccanwin/canwin-team-os/actions/runs/29695919974)（HEAD `02f7377071783f2f3213218c6c3c3ace961768bc`）已失败保留且不重跑。Windows job `88216547016` 用时57秒，在 local 第1项 static 的第6门 `p1-interface-freeze` 失败：前5门通过，static 为5/19、其余13门跳过，local其余11项未执行；根因是校验器直接哈希 fresh checkout 的 CRLF 原始字节，未按合同的 UTF-8 LF 口径归一化。Linux job `88216547033` 用时137秒，迁移70/70、SQL27/27（7/11/9）、catalog4/4和清理全绿。测试项目远端读写0、生产读写0；这属于平台换行静态自测误判，不是数据库或业务失败。机械修复统一 CRLF/CR 为 LF，并以 LF/CRLF/CR/mixed 四种夹具等价回归；该失败运行原样保留，由下述新候选独立验证。
- 换行修复后的独立 CI run [`29696529290`](https://github.com/yccanwin/canwin-team-os/actions/runs/29696529290)（HEAD `e04dfa3ee8a9f569b97c905c87f760d7b76a6e00`）已双平台全绿。Linux job `88218121933` 用时132秒，迁移70/70、SQL27/27（数据库7、权限11、业务9）、catalog4/4和清理通过；Windows job `88218121940` 用时76秒，static19/19、local12/12、P1壳层71/71及1975模块构建通过，66文件静态制品 SHA256 为 `33505fcddc4b814379906406287b1fa715677b1e218497e1fe5a1693f50fc21b`，上传制品0。真实账号安全夹具仅完成7项守卫、1项负控、6账号的无网络自测；真实页面 runner 也只是无网络自测，实际页面验收仍为 pending。仓库密钥、测试项目远端读写、生产读写均为0；`postRepairIndependentCi=passed`，但不等于G1。
- 新候选正式隔离尝试 1/1（run `p1-isolated-20260719T172151689Z-8273f5c69e`）在首个 SQL `supabase/tests/access_control_foundation.sql` 抛出 `Legacy member received implicit customers.manage permission` 后首错停止，现判定为校验误报。运行器只有在内存快照证明 P1 已应用且远端迁移条数为70后才会进入首个 SQL，因此可记录“迁移阶段的70条控制流门已通过”；但 `failure.json` 未序列化迁移后快照，失败后也未重新远端读取，不能据此宣称当前远端状态。`preflight.json` SHA256 为 `e44d53b72c85a71eff2d7a5359220f86c20af56af02a9bf6c0a81716c6d65b97`，`failure.json` SHA256 为 `3a8077ad58b1a7ee1fc4a75340ab3db9b8f1c3d5ea772e019ff1282136029774`，均位于 `D:\CanWin-Team-OS-4.0-P1-Validation\p1-isolated-20260719T172151689Z-8273f5c69e`。SQL通过0/27，后26项未执行，catalog执行0/4，全量对账和最终后快照均未执行；目录仅保留 preflight/failure，未生成 success 证据，未重试、未清理、未外发，生产读写0。当前状态是 `post-apply verification candidate pending`，`g1OverallClaim=false`，整体验收25%。
- 续验资格已由独立 CI run [`29699951990`](https://github.com/yccanwin/canwin-team-os/actions/runs/29699951990) 正式签署：HEAD `a620bb541f4c5eb613413e8b40455b3988ee0cf3`，Linux job `88227205377` 通过迁移70/70、SQL27/27（数据库7、权限11、业务9）和catalog4/4；Windows job `88227205362` 通过static19/19、local12/12。最终 LF SHA 为 access-control `31fa286b318ad2b24e2d956005c4a5fcc9b0fddfd0269be029330d5c1c3e43f8`、resume-only runner `f9d9d6abed29a482757682d25002f2c414a1271e0f7fa2e9360fc62f009ed648`、isolated runtime contract `f99e605341b36e2de18779b6dd52a624b1ef421a9b60c4517f59845a7ba22013`、runner validator `60a90fc8bf75d44a02c2d824e29b912d14fbbe844af79b0e5a705c77fe59c2af`，静态断言100/100、fixture pattern4/4。对账合同仍为 exact70、27项逐项、29份完整快照、Storage初末2次内容归档、6份签名制品、key5/raw9/inventory3、Auth/Session隔离和内容指纹；合法持久差异仅两项，未知差异0。旧 migration apply 入口 `candidate.remoteExecutionAllowed=false`；仅 `--resume-post-apply` 为 `resume.remoteExecutionAllowed=true`，禁止db push、预期持久化写入0，并要求当前提交是签名HEAD之后的干净tracked提交：签名HEAD本身拒绝、tracked dirty拒绝、未跟踪 `.codex-audit` 允许。续验远端执行仍为0，当前 exact70、27/27、4/4 catalog、全量对账和页面验收仍未取得，G1=false、进度25%。
- 正式续验 run `p1-resume-20260719T193911279Z-ea6ed9385d` 的原现场继续保留。第71迁移 LF SHA256 为 `1bb13f29fc0f5512bd00115dc1c953a2c3aaa0ec21522b1cc8cbb45a18a5cdc0`；notification/P1 access测试SHA分别为 `a3d87069899b986b191bc21826f5e23c65fe4734066e52adc4e14753c9e6e5a3`、`c598b4e4ed3c7e26d9411cb4084685bea1233f47ae969c2685e048f480dac09e`，runtime contract/runner/validator SHA分别为 `4b7db4155637bc349c50948eaa35f2d241e823b3e65c0578e3be083e93344659`、`acae6010b6e4efca94d8411b16aa2cf8e1e04118ecf9055a9711ebb55eb3d2bc`、`1aa9341425465a42ae7cd82d434281595723b00733fafc17be3176f73ee5d5f4`。失败 CI run `29726897764` 原样保留；新 CI run `29733854344`（Linux job `88324427055`、Windows job `88324427244`）双平台成功并签署一次独立测试项目正式资格，G1=false、25%。
- 正式 ACL repair 命令 `p1-acl-repair-20260720T104323349Z-4fa8de78a8` 的解析器失败现场继续保留；run `29738966326` 现仅作为其历史修复CI，不得复活旧资格。
- 新正式命令 `p1-acl-repair-20260720T122757275Z-8fa1498850` 在 `db-push-dry-run` 连接独立测试项目直连主机时超时并首错停止。证据目录 `D:\CanWin-Team-OS-4.0-P1-Validation\p1-acl-repair-20260720T122757275Z-8fa1498850` 仅有 `failure.json`，SHA256 `19e4cd30c3d024a452b74f94380a17175364326dc59d41b837bc338c398579ba`；初始light/full迁移均70、完整对账1、私有定义1、Storage归档1，正式尝试0、db push尝试0、持久写0、密钥打印/落盘0、生产读写0，目标保留、未重试、未清理。runner 已让 dry/apply 共用 passwordless Session Pooler 通道，禁止 `--linked`、`--password`、直连、带密URL和继承连接秘密；验证器71/71。当前 `remote/dbPush=false`，需新CI后方可重新取得一次资格。不得签G1或计为30%；尚缺正式应用、29份全量对账及六类账号页面验收。
