# CanWin Team OS

CanWin Team OS 是团队内部经营与协作系统。现有 2.0 团队文化、任务、财务、案例馆、相册等功能继续保留；3.0 采用增量方式建设销售工作台，不重写 2.0 数据与页面。

## 3.0 销售优先范围

当前版本聚焦一笔真实销售主链：今日行动队列 → 客户/门店/联系人/线索建档 → 公海领取 → 有效跟进 → 资格判定与商机 → A 类演示 → 报价 → 定金与订单 → 内部采购款 → 精确库存预留/出库 → 安装培训 → 售后交接。

所有关键状态由 Supabase RLS 与安全 RPC 控制。报价阶段不占库存；定金确认后冻结报价和硬件行并生成订单；内部采购款结清后才允许建立交付、预留和出库。

## 3.0 隐藏路由

以下路由均受 `sales_os_v3` 功能开关保护，默认关闭：

- `/#/sales-v3`：销售今日、客户、线索、跟进、资格与商机
- `/#/quotes-v3`：报价、A 类演示、定金、订单与内部采购款
- `/#/orders-v3`：订单、库存、实施、培训和售后交接
- `/#/management-v3`：主管异常与临门商机看板
- `/#/access-v3`：角色、权限、代理与功能开关管理

功能开关关闭时不得使用演示数据回退。正式灰度前必须保持 `sales_os_v3=false`，完成备份、迁移和 2.0 回归后，再对小范围人员开启。

## 本地环境

需要 Node.js 22 和 npm。复制环境变量示例并填写本地安全值；不要提交真实 `.env`。

```bash
cp .env.example .env
npm ci
npm run dev
```

必需变量：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

任一变量缺失时应用会立即停止初始化。`service_role`、企业微信 Webhook 等服务端密钥不得进入前端变量或公开仓库。

## 验证与构建

```bash
npm run lint
npm run build
npm run preview
```

Vite 的 GitHub Pages base 为 `/canwin-team-os/`，应用使用 HashRouter。Pages 工作流从 GitHub Variable `VITE_SUPABASE_URL` 和 GitHub Secret `VITE_SUPABASE_ANON_KEY` 注入构建配置，不输出变量值。

## 当前验证边界

截至 2026-07-13，本地 TypeScript 与 Vite 生产构建通过，销售主链已完成静态审查。尚未连接线上 Supabase，未执行远端迁移、远端 RLS/RPC 行为测试、真实数据回归、GitHub 推送或 Pages 发布。因此当前结论是“本地静态 80% 基线”，不是“已上线”。

线上操作顺序固定为：2.0 数据与媒体备份 → 保持 Flag 关闭并执行迁移 → 核对行数/金额/文件数 → 回归 2.0 → 小范围开启 Flag → 验证一笔真实订单 → 再决定扩大范围。
