# Team OS 4.0 前端切换边界

本目录只构建全新 Team OS 4.0。当前阶段只允许连接独立绿色测试项目，不允许连接 3.0 生产项目，也不承担旧页面和旧 URL 的兼容运行。

部署平台必须单独配置以下六项，仓库不保存真实密钥：

- `CANWIN_TEAM_OS_4_SUPABASE_URL`：4.0 绿色项目 URL。
- `CANWIN_TEAM_OS_4_SUPABASE_PUBLISHABLE_KEY`：对应项目的公开客户端密钥。
- `CANWIN_TEAM_OS_4_SUPABASE_PROJECT_REF`：必须与 URL 主机名中的项目 ref 完全一致。
- `CANWIN_TEAM_OS_4_DEPLOYMENT_STAGE`：当前固定为 `greenfield-test`；其他值会拒绝启动。
- `CANWIN_TEAM_OS_4_PUBLIC_APP_URL`：4.0 独立 HTTPS 访问地址，不含 `#` 路由片段。
- `CANWIN_TEAM_OS_4_RELEASE_VERSION`：可追溯的 `4.0.x` 版本标识，例如 `4.0.0-preview.1`。

启动边界会拒绝以下情况：缺少任一配置、项目 ref 与 Supabase URL 不一致、使用 3.0 生产 ref、访问地址与配置不一致、旧系统地址标记、非 HTTPS 地址、非 4.0 版本以及任何生产阶段标记。

切换前必须另建 4.0 独立部署入口。现有根目录 GitHub Pages 工作流属于 3.0，不能用于构建或发布本应用。正式生产项目和正式访问地址只有在 G7 前置验收完成后，另行建立受控配置，不在本阶段预埋。
