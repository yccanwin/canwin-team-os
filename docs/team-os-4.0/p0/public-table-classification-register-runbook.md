# 103 张 public 表四分类机器清单运行手册

> 机器清单：`public-table-classification-register.json`
> 只读校验器：`scripts/p0/verify-table-classification-register.mjs`、`scripts/p0/verify-public-table-live-evidence.mjs`、`scripts/p0/verify-public-routine-live-evidence.mjs`、`scripts/p0/verify-routine-caller-crosscheck.mjs`
> 当前状态：103/103 候选分类和逐表现网元数据、162/162 函数签名及本地调用方候选已取证，监理冻结验收 0/103、0/162，G0 未通过。

## 1. 清单证明什么

机器清单把 `01-database-object-classification.md` 的四类候选转换为稳定集合：

| 候选分类 | 数量 |
| --- | ---: |
| 保留 `retain` | 47 |
| 扩展 `extend` | 37 |
| 只读 `read_only` | 17 |
| 淘汰候选 `retirement_candidate` | 2 |
| 合计 | 103 |

校验器只读取本地文件，核验：

1. 机器清单恰好 103 个唯一表名，四类互斥且数量为 47/37/17/2；
2. 表名和候选分类与 01 人工台账完全一致；
3. 表名集合与 `supabase/schema.sql` 加 69 个本地历史迁移中发现的 103 张表完全一致；
4. catalog 快照查询仍覆盖数量、关系、函数、策略和触发器区段；生产逐表证据与清单表集合完全一致；162 个生产函数签名与本地运行时调用方候选完全对齐；
5. 所有分类仍是 `candidate_unaccepted`，已验收表为 0，不能标记 G0；
6. 229 条策略和 29 个触发器已经逐表回连但未验收；函数正文依赖、身份/岗位授权和真实表级读写入口缺口仍明确开放。

## 2. 本地机械校验

在仓库根目录运行一次：

```powershell
node .\scripts\p0\verify-table-classification-register.mjs
node .\scripts\p0\verify-public-table-live-evidence.mjs
node .\scripts\p0\verify-public-routine-live-evidence.mjs
node .\scripts\p0\verify-routine-caller-crosscheck.mjs
```

预期输出：

```text
P0_TABLE_CLASSIFICATION_REGISTER_SELFTEST_OK cases=9
P0_TABLE_CLASSIFICATION_REGISTER_OK tables=103 retain=47 extend=37 readOnly=17 retirementCandidate=2 candidate=103 accepted=0
P0_TABLE_CLASSIFICATION_GAPS_OPEN requiredAudit=103 routinesAuthorization=162 routinesBodyDependency=162 policies=0 triggers=0 zeroPolicyDecisions=3 g0=false databaseCalls=0
P0_PUBLIC_TABLE_LIVE_EVIDENCE_SELFTEST_OK cases=8
P0_PUBLIC_TABLE_LIVE_EVIDENCE_OK tables=103 rls=103 policies=229 triggers=29 indexes=248 outgoingFks=309 candidate=103 accepted=0 businessRowsRead=0 writes=0
P0_PUBLIC_ROUTINE_LIVE_EVIDENCE_SELFTEST_OK cases=8
P0_PUBLIC_ROUTINE_LIVE_EVIDENCE_OK routines=162 securityDefiner=148 authenticatedSecurityDefiner=135 triggerFunctions=19 anonExecutable=7 missingSearchPath=1 candidate=162 accepted=0 businessRowsRead=0 writes=0 bodiesReturned=0
P0_ROUTINE_CALLER_CROSSCHECK_SELFTEST_OK cases=4
P0_ROUTINE_CALLER_CROSSCHECK_OK files=215 literalReferences=105 literalNames=99 orphanNames=0 dynamicSites=1 referencedSignatures=102
```

任何非零退出或集合差异都立即停止；不要修改历史迁移来迎合清单，也不要把候选分类改写成已验收。

## 3. 明确未完成的证据

清单绿灯不等于 103 张表四分类完成。现网逐表 owner、行数估计、RLS、GRANT、策略、触发器、索引、外键、依赖视图和 catalog 可见函数依赖已经取证。以下缺口仍是 103/103 待办：

- 前端/函数真实读写入口、必要表精确行数、函数正文运行时依赖和索引风险结论；
- 4.0 映射、兼容动作、逐表验收证据和负责人；
- 162 个函数/过程的签名、owner、ACL、定义指纹和本地调用方候选已登记；仍需函数正文依赖、49 个 authenticated 可执行但无本地调用方签名、7 个 anon 可执行签名、1 个动态包装点，以及全部身份/岗位/EXECUTE 语义审计；
- 229 条策略已逐表列出，其中 `crm_lead_conversions`、`deal_catalog_version_requests`、`deal_package_admin_requests` 仍需判定 RPC-only 或缺失策略；
- 29 个触发器对象已逐表列出，仍需与46条事件展开行和函数正文交叉审查；
- 仓库仅保存不含业务行/表达式/函数正文的标准化元数据；原始连接输出不进入仓库，也不能据此宣称冻结验收。

## 4. 从候选升级为已验收

只有逐表 17 项字段补齐、函数/策略/触发器映射完成、六身份直接 API 和依赖证据通过，并获得监理明确冻结结论后，才可另立工单修改 `classificationAcceptance`。不得仅因校验器通过而增加 `acceptedTableCount`、填入 `acceptedTableNames` 或把 `g0.claim` 改为 `true`。

该升级属于新的业务/安全验收动作，不在本清单生成工单授权内。
