# 103 张 public 表四分类机器清单运行手册

> 机器清单：`public-table-classification-register.json`
> 只读校验器：`scripts/p0/verify-table-classification-register.mjs`
> 当前状态：103/103 仅为候选分类，监理冻结验收 0/103，G0 未通过。

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
4. catalog 快照查询仍覆盖数量、关系、函数、策略和触发器区段；
5. 所有分类仍是 `candidate_unaccepted`，已验收表为 0，不能标记 G0；
6. 函数、策略、触发器的逐表映射缺口仍明确开放。

## 2. 本地机械校验

在仓库根目录运行一次：

```powershell
node .\scripts\p0\verify-table-classification-register.mjs
```

预期输出：

```text
P0_TABLE_CLASSIFICATION_REGISTER_SELFTEST_OK cases=7
P0_TABLE_CLASSIFICATION_REGISTER_OK tables=103 retain=47 extend=37 readOnly=17 retirementCandidate=2 candidate=103 accepted=0
P0_TABLE_CLASSIFICATION_GAPS_OPEN requiredAudit=103 functions=103 policies=103 triggers=103 zeroPolicyDecisions=3 g0=false databaseCalls=0
```

任何非零退出或集合差异都立即停止；不要修改历史迁移来迎合清单，也不要把候选分类改写成已验收。

## 3. 明确未完成的证据

清单绿灯不等于 103 张表四分类完成。以下缺口仍是 103/103 待办：

- 当前用途、前端/函数读写入口、关键依赖、行数、RLS、GRANT、策略、触发器、索引风险；
- 4.0 映射、兼容动作、逐表验收证据和负责人；
- 162 个函数/过程到表的精确映射和身份、岗位、EXECUTE 审计；
- 229 条策略到表/角色/动作的交叉审查；其中 `crm_lead_conversions`、`deal_catalog_version_requests`、`deal_package_admin_requests` 仍需判定 RPC-only 或缺失策略；
- 29 个触发器对象/46 条事件行到表、函数和启用状态的逐项核验；
- catalog 原始快照仍在受控证据位置，仓库没有可据此宣称冻结验收的原始产物。

## 4. 从候选升级为已验收

只有逐表 17 项字段补齐、函数/策略/触发器映射完成、六身份直接 API 和依赖证据通过，并获得监理明确冻结结论后，才可另立工单修改 `classificationAcceptance`。不得仅因校验器通过而增加 `acceptedTableCount`、填入 `acceptedTableNames` 或把 `g0.claim` 改为 `true`。

该升级属于新的业务/安全验收动作，不在本清单生成工单授权内。
