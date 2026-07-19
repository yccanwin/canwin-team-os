# P1 应用壳层与导航机器合同运行说明

该 JSON 已作为 P0 阶段的 P1 导航冻结合同；执行仍锁定到 G0 通过以后。它不是 P1 UI 成品，也不代表 G0/G1 已通过。

在仓库根目录运行：

```powershell
node scripts/p0/verify-p1-app-navigation-contract.mjs
```

通过时输出：

```text
P1_APP_NAVIGATION_CONTRACT_OK primaryRoles=5 additionalFunctions=2 appContextFields=13 desktop=4+2 mobile=5 legacyRoutes=36
```

脚本会核对：

- 主岗位恰好为销售、实施、运维、财务、管理员五个；
- `warehouse`、`supervisor` 只能是附加职能，不能产生第六个首页；
- 主管体系默认关闭并统一回落管理员，不改历史责任记录；
- AppContext 字段、桌面导航、账户工作视图、消息顶栏和移动五项顺序；
- 36 条旧路由与 `frontend-inventory.json` 完整一致，每条都有兼容状态和解释。

漂移时脚本输出 `P1_APP_NAVIGATION_CONTRACT_DRIFT` 并返回非零退出码。业务语义不一致时应停止并由监理重新冻结，不能仅为通过脚本机械改合同。

提交前运行：

```powershell
git diff --check
```
