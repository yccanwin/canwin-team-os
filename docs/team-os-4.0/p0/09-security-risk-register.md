# P0-09 安全与性能风险登记册

> 快照日期：2026-07-19
> 状态：生产只读顾问结果已登记；SEC-01 已在隔离项目正式验证并完成回滚；G0 已通过，生产修复仍未执行。
> 约束：本登记册不授权生产 DDL，不把隔离验证或顾问数量直接等同于生产放行。
> 本轮复核：2026-07-19 通过 Supabase Advisor 只读刷新，Security 143、Performance 315 与登记值一致；数据库写入为 0。

## 当前只读基线

| 顾问 | 总计 | 严重度 | 分类 |
| --- | ---: | --- | --- |
| Security Advisor | 143 | ERROR 3 / WARN 137 / INFO 3 | `security_definer_view` 3；`authenticated_security_definer_function_executable` 135；`rls_enabled_no_policy` 3；`function_search_path_mutable` 1；`auth_leaked_password_protection` 1 |
| Performance Advisor | 315 | WARN 100 / INFO 215 | `unindexed_foreign_keys` 205；`auth_rls_initplan` 54；`multiple_permissive_policies` 46；`unused_index` 10 |

## 分级口径

- **P0 阻断**：可能绕过行级权限、扩大高权限函数入口，或无法证明关键身份边界；G0 前必须完成分类、候选和隔离证据。
- **P1 高优先**：不应与三视图修复混在同一变更中；在独立项目按业务热度、权限语义逐批验证。
- **P2 观察/优化**：需要足够运行窗口和查询证据，不能在 P0 机械删除或重写。

## 风险清单

| ID | 级别 | 当前事实 | 主要风险 | 本阶段处理决定 | 放行所需证据 |
| --- | --- | --- | --- | --- | --- |
| SEC-01 | P0 | 生产仍有 3 个 `security_definer_view` ERROR：`finance_public_summary`、`inventory_public_items`、`assets_public`；隔离候选与回滚证据已通过 | 视图按 owner 权限解析时可能绕过底表 RLS | 隔离项目正式候选 1/1：保持视图名/列顺序，`authenticated` 只读且 `anon` 拒绝；五岗位跨团队行 0、写入拒绝 15/15，Advisor 归零且 WARN 未增加；原子回滚 1/1 并清除全部模拟数据 | 隔离证据已齐并纳入 G0；生产仍禁止执行，后续须单独形成生产变更、验收和回退证据 |
| SEC-02 | P0 | 162 个签名已逐项登记：148 个 `SECURITY DEFINER`，135 个可由 `authenticated` 执行；本地找到 99 个明确 RPC 名称并对应 102 个签名，线上缺失名称 0；仍有 49 个 authenticated 可执行签名无本地直接调用方 | 高权限函数若缺少调用者身份、岗位/团队范围或安全 `search_path`，可形成越权入口；无本地调用方也不能证明可删除，可能由策略、触发器、外部客户端或动态 SQL 使用 | 逐签名分为正式业务 RPC、内部触发器/助手、废弃候选；禁止批量撤销 EXECUTE、批量改 invoker 或批量删除 | 每个签名的 owner、ACL、调用方、身份检查、团队/岗位范围、`search_path`、依赖和六身份允许/拒绝结果；变更按函数小批次独立审查 |
| SEC-03 | P0 | 3 张表启用 RLS 但无策略：`crm_lead_conversions`、`deal_catalog_version_requests`、`deal_package_admin_requests` | Data API 默认拒绝不等于业务安全已证明；也可能隐藏前端故障，或依赖未审计的高权限 RPC | 先判定每表是“明确 RPC-only”还是“缺失策略”；不得为消除告警添加宽泛通用策略 | 表的公开入口、函数依赖和预期角色矩阵；anon/五主岗位直接 API 读写拒绝；合法 RPC 的正向及跨团队负向证据 |
| SEC-04 | P0 | `touch_updated_at()` 未固定 `search_path`，且当前可由 `anon`、`authenticated`、`service_role` 执行 | SECURITY DEFINER 或高权限调用链可能被对象名解析劫持；多余的公开 EXECUTE 也扩大入口 | 先冻结准确函数签名、owner、函数体、触发器/调用者和依赖；单独候选设置受控 `search_path` 并审查是否撤销公开 EXECUTE，不与三视图候选合并 | 函数签名级 diff；合法调用回归；恶意同名对象/跨 schema 负向测试；anon/authenticated 直接调用拒绝；Advisor 告警消失 |
| SEC-05 | P0 | Auth 泄露密码保护未开启 1 项 | 已泄露密码仍可能用于注册/改密 | 作为项目级 Auth 配置独立处理；需管理员确认可用性影响与回退，不写 SQL | 独立项目开启前后注册/改密验证、审计截图和回退步骤；生产变更另行授权 |
| PERF-01 | P1（其中热链候选可升 P0） | 309 个外键中104个按Advisor口径已覆盖、205个未覆盖；未覆盖候选已分为 P1A 热链137、P1B 其他活动表31、P2 历史观察37，逐项验收仍为0 | 热表删除/更新可能锁等待或慢查询；盲目建 205 个索引会增加写放大和存储；局部索引虽被Advisor视为覆盖，也不等于覆盖全部业务状态 | 先从137个订单、付款、库存、CRM、身份责任与绩效热链候选中再按查询计划、表规模和写频率选小批；31个活动表随后；37个历史项只观察 | 每个候选的 FK 列、父/子表规模、查询/锁证据、现有局部索引谓词、建索引前后计划及写入影响；一次只验证一批 |
| PERF-02 | P1 | 54 个 `auth_rls_initplan` | RLS 对每行重复计算身份函数，放大查询成本 | 按高频公开表优先，验证可安全改为 `(select auth.uid())` 等一次求值形式；不得只做字符串替换 | 策略语义 diff；六身份结果完全一致；典型查询 `EXPLAIN` 改善；无跨团队扩大 |
| PERF-03 | P1 | 46 组重复宽松策略 | 多个 permissive policy 叠加造成成本及难以审计的 OR 语义 | 先画出同角色/同动作策略并集；只有等价证明后才合并 | 策略真值表、六身份允许/拒绝对照、合并前后结果一致、性能计划证据 |
| PERF-04 | P2 | 10 个未使用索引 | 短观察窗口可能把恢复、月末或低频关键索引误判为无用 | P0/P1 不删除；累计一个完整业务周期并核验约束/查询依赖 | 足够长的使用统计、查询日志、索引是否承载约束、删除候选的回退与负载验证 |

## 三视图候选的授权策略

1. 视图只授予 `authenticated` 的 `SELECT`，显式撤销 `PUBLIC` 与 `anon`。
2. `security_invoker = true` 后，最终可见行由登录用户对底表的权限和 RLS 决定；“页面能打开”不能替代直接 API 越权测试。
3. 不在本候选中新增底表策略、函数、索引或数据修补。若合法岗位因底表策略缺失而失败，该失败是权限语义阻断，立即停止，不追加宽松策略。
4. 前端字段契约保持不变：三视图的名称、列名、列顺序、聚合含义和调用标记必须仍在。

## G0 安全放行条件

- 三个 Security Advisor ERROR 在独立项目已归零，且没有新增 ERROR/WARN；该项已通过隔离验证并完成回滚。
- 未登录、销售、实施、运维、财务、管理员六身份的允许/拒绝结果已与角色矩阵一致；仓库/主管附加职能仍作为后续扩展用例，不替代六身份基线。
- 135 个可执行 SECURITY DEFINER 函数、3 张 RLS 无策略表和 1 个可变 `search_path` 函数均已精确到签名/对象完成分类；“已登记数量”不等于“已修复”。
- 三个前端读取链路通过，财务成本/利润、库存内部字段、资产敏感字段未被扩大。
- 所有数据库动作只发生在可恢复的独立项目；第一次失败立即保存 SQLSTATE、日志、Advisor 和页面/API 证据并停止，生产执行必须另行明确授权。
