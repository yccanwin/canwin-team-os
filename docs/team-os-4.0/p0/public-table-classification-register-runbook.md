# 103 张 public 表四分类机器清单运行手册

> 机器清单：`public-table-classification-register.json`
> 只读校验器：`scripts/p0/verify-table-classification-register.mjs`、`scripts/p0/verify-public-table-live-evidence.mjs`、`scripts/p0/verify-public-routine-live-evidence.mjs`、`scripts/p0/verify-routine-caller-crosscheck.mjs`、`scripts/p0/verify-advisor-risk-priority-evidence.mjs`
> 当前状态：103/103 表、162/162 函数及相关策略/触发器分类已完成监理冻结；205/205 未覆盖外键优先级已冻结。B01 完成，统一 CI 和其余 P0 产物已联合签署，整体 G0 已通过。

## 1. 清单证明什么

机器清单把 `01-database-object-classification.md` 的四类冻结结论转换为稳定集合：

| 分类 | 数量 |
| --- | ---: |
| 保留 `retain` | 47 |
| 扩展 `extend` | 37 |
| 只读 `read_only` | 17 |
| 淘汰候选 `retirement_candidate` | 2 |
| 合计 | 103 |

校验器只读取本地文件，核验：

1. 机器清单恰好 103 个唯一表名，四类互斥且数量为 47/37/17/2；
2. 表名和分类与 01 人工台账完全一致；
3. 表名集合与 `supabase/schema.sql` 加 69 个本地历史迁移中发现的 103 张表完全一致；
4. catalog、逐表生产只读证据、封闭恢复副本精确行数和运行时源码入口与 103 表集合完全一致；
5. 162 个生产函数定义指纹与隔离副本一致，表/函数正文依赖、调用方、当前执行权和风险分级全部登记，正文未返回仓库；
6. 229 条策略、29 个触发器、309 个外键和 205 个未覆盖外键优先级已逐表回连，三个零策略表明确冻结为 RPC-only；
7. 分类验收为 103/103、函数验收为 162/162，但 `g0.claim` 仍为 `false`。

## 2. 本地机械校验

在仓库根目录运行一次：

```powershell
node .\scripts\p0\verify-table-classification-register.mjs
node .\scripts\p0\verify-public-table-live-evidence.mjs
node .\scripts\p0\verify-public-routine-live-evidence.mjs
node .\scripts\p0\verify-routine-caller-crosscheck.mjs
node .\scripts\p0\verify-advisor-risk-priority-evidence.mjs
```

预期输出：

```text
P0_OBJECT_CLASSIFICATION_FREEZE_SELFTEST_OK cases=10
P0_OBJECT_CLASSIFICATION_FREEZE_OK tables=103 retain=47 extend=37 readOnly=17 retirementCandidate=2 accepted=103 routines=162 routineAccepted=162 policies=229 triggers=29 zeroPolicyRpcOnly=3 unindexedPriority=205 g0=false databaseCalls=0
P0_PUBLIC_TABLE_LIVE_EVIDENCE_SELFTEST_OK cases=8
P0_PUBLIC_TABLE_LIVE_EVIDENCE_OK tables=103 rls=103 policies=229 triggers=29 indexes=248 outgoingFks=309 candidate=103 accepted=0 businessRowsRead=0 writes=0
P0_PUBLIC_ROUTINE_LIVE_EVIDENCE_SELFTEST_OK cases=8
P0_PUBLIC_ROUTINE_LIVE_EVIDENCE_OK routines=162 securityDefiner=148 authenticatedSecurityDefiner=135 triggerFunctions=19 anonExecutable=7 missingSearchPath=1 candidate=162 accepted=0 businessRowsRead=0 writes=0 bodiesReturned=0
P0_ROUTINE_CALLER_CROSSCHECK_SELFTEST_OK cases=4
P0_ROUTINE_CALLER_CROSSCHECK_OK files=215 literalReferences=105 literalNames=99 orphanNames=0 dynamicSites=1 referencedSignatures=102
P0_ADVISOR_RISK_PRIORITY_EVIDENCE_SELFTEST_OK cases=7
P0_ADVISOR_RISK_PRIORITY_EVIDENCE_OK security=143 performance=315 foreignKeys=309 covered=104 unindexed=205 priority=P1A:137,P1B:31,P2:37 businessRowsRead=0 writes=0 accepted=0
```

任何非零退出、来源哈希或集合差异都立即停止；不要修改历史迁移来迎合清单，也不要把分类验收误写成整个 G0 或生产放行。

## 3. 已完成和仍待后续工单的边界

本次已经完成逐表 17 项字段、真实源码入口、封闭副本精确行数、函数正文依赖、4.0 映射、兼容动作、负责人和交叉验收。仓库仍只保存标准化元数据、计数、指纹、路径和风险标记，不保存业务行、函数正文、策略表达式、凭据或密钥。

以下属于后续实现/运行时验收，不再阻断 B01 分类冻结：

- 205 个未覆盖外键按 137/31/37 三档进入索引工单；创建前必须补查询计划、锁和写放大证据；
- 7 个 P0 权限收紧函数和 38 个 P1A 提权入口按风险清单进入新增安全迁移，禁止批量撤权；
- 六身份直接 API 越权测试属于 G1，不能用本次静态/隔离依赖分类代替；
- 本结论不执行生产 DDL/DML，不授权部署、发布、push、PR 或合并。

## 4. 验收结论

`classificationAcceptance` 已由监理冻结为 103/103，函数分类为 162/162。该单项制品的 `g0.claim` 继续保持 `false`，避免一个分类文件独自冒充整体门禁；统一 CI 和其余 P0 产物已经联合签署，整体 G0 结论记录在 `09-g0-signoff.md`。
