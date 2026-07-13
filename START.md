# CanWin Team OS 启动指南

## 1. 准备环境

安装 Node.js 22。项目统一使用 npm，不使用 pnpm 或 yarn。

```bash
cp .env.example .env
npm ci
```

在本地 `.env` 中配置：

```text
VITE_SUPABASE_URL=本地或测试项目地址
VITE_SUPABASE_ANON_KEY=对应的公开匿名密钥
```

`.env` 已被 Git 忽略。不要把真实值写入源码、文档、截图或提交记录。前端不得使用 `service_role` 或企业微信密钥。

## 2. 启动开发服务

```bash
npm run dev
```

终端会显示本机和局域网访问地址。3.0 页面使用 HashRouter，例如 `http://localhost:5173/canwin-team-os/#/sales-v3`。本地开发服务器的实际 base 以终端输出为准。

## 3. 3.0 路由与开关

五个隐藏路由为：

- `/#/sales-v3`
- `/#/quotes-v3`
- `/#/orders-v3`
- `/#/management-v3`
- `/#/access-v3`

它们全部受 `sales_os_v3` 控制。线上迁移和 2.0 回归完成前，开关必须保持关闭。禁止为了查看页面而直接对全团队开启。

## 4. 本地检查

```bash
npm run lint
npm run build
npm run preview
```

构建产物位于 `dist/`，该目录不提交。生产构建缺少 Supabase 环境变量时，页面初始化会 fail-fast。

## 5. GitHub Pages

仓库工作流在 `master` 推送或手动触发时构建 Pages，base 为 `/canwin-team-os/`。运行前需在 GitHub 配置：

- Variable：`VITE_SUPABASE_URL`
- Secret：`VITE_SUPABASE_ANON_KEY`

配置值不得出现在日志。数据库迁移、功能开关和 Pages 发布是三个独立停点；任一步失败立即停止，不自动继续。

## 6. 当前限制

截至 2026-07-13，仅完成本地静态检查与生产构建。尚未执行线上数据库迁移、远端 RLS/RPC 测试、2.0 线上回归和 Pages 发布。首次线上数据库验证必须使用隔离测试环境或经过备份保护的灰度流程，不能直接把生产库作为首次试跑目标。
