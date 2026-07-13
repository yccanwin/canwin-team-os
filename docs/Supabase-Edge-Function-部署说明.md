# Supabase Edge Function 部署说明

本项目的团队成员管理不再使用本地 4 位切换密码。新增、编辑和禁用成员会调用 Supabase Edge Function：`admin-members`。

## 部署前提

- 已安装 Supabase CLI
- 已登录目标 Supabase 账号
- 已获取项目的 `service_role` key

## 部署命令

在项目根目录执行：

```bash
supabase link --project-ref agygfhmkazcbqaqwmljb
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"
supabase functions deploy admin-members
```

`SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 通常由 Supabase Functions 运行环境提供；如果运行环境未自动注入，也需要在 secrets 中补齐。

## 验证

部署完成后，用管理员账号登录网站，在「设置 > 团队成员」新增一个真实邮箱成员。成功后该成员会写入 Supabase Auth，并同步写入 `profiles` 表。
