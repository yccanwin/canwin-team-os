# CanWin Team OS

> 小团队经营透明化 + 团队文化记忆库 + 日常协作工具。

CanWin Team OS 是翻身小队内部使用的团队 OS，不是对外 SaaS，也不是绩效考核后台。当前版本以 Supabase Auth、正式业务表、RLS 权限和 GitHub Pages 部署为主线，前端 Zustand 只承担本地 UI 状态和短期缓存。

线上地址：

- https://yccanwin.github.io/canwin-team-os/

## 快速启动

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 生产构建
pnpm build

# 预览构建产物
pnpm preview
```

本地默认入口：

- `http://localhost:5173/canwin-team-os/`
- 路由使用 `HashRouter`，例如 `/#/inventory`

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 框架 | React + TypeScript |
| 构建 | Vite |
| 样式 | Tailwind CSS |
| 状态管理 | Zustand |
| 后端 | Supabase Auth / Postgres / Storage |
| 权限 | Supabase RLS + 前端角色边界 |
| 图表 | Chart.js + react-chartjs-2 |
| 图标 | Lucide React |

## 当前定位

产品核心：

- 今日团队状态：休息、任务、库存提醒、经营大盘、近期动态。
- 经营记录：仓库、财务、资产馆。
- 团队文化：编年史、案例馆、相册。
- 共同决策：一起决定、军机处。
- 资源与成员：工具箱、团队成员、个人主页。

设计原则：

- 经营大盘透明，敏感明细受控。
- 团队共识公开，个人隐私克制。
- 记录真实行为，不做积分排行和绩效 PK。
- 桌面端适合管理和复盘，移动端适合快速查看和快速记录。

## 核心功能

### 登录与成员

- 使用 Supabase Auth 登录。
- 初始只保留 `admin`，其他成员由管理员添加。
- 角色包括 `admin`、`captain`、`finance`、`warehouse`、`member`。
- 成员资料来自 `profiles`，包含休息日、沟通偏好、最近状态、注意事项和协作备注。

### 首页

- 今日团队状态。
- 今日休息、近期公告、今天要处理。
- 库存提醒、财务大盘、团队目标、近期团队记忆。
- 团队健康度和成长阶段，用状态描述替代游戏化成长表达。

### 日历

- 展示休息日、任务截止、团队目标截止、公开个人目标截止。
- 支持日历事件记录。
- 创建任务时会提示分配到成员休息日的风险。

### 任务

- 任务创建、状态流转、详情维护。
- 支持负责人、截止日期、重要标记和任务类型。
- 移动端使用卡片流，便于快速查看和处理。

### 目标

- 团队目标和个人目标分离。
- 个人目标支持公开或私密。
- 个人目标有冷静期、锁定、复盘和管理员解锁审计。

### 仓库

- 入库、出库、库存数量和低库存提醒。
- 授权角色可查看成本和操作日志。
- 普通成员只看公开库存状态，不暴露成本。
- 移动端提供库存卡片和操作日志卡片。

### 财务

- 授权角色可录入、查看和删除明细。
- 普通成员查看公开汇总，不暴露敏感明细。
- 财务操作写入正式表，并保留审计路径。

### 资产馆

- 记录团队买下的资产、用途、状态、归属和图片。
- 普通成员可看资产概览。
- 授权角色可看金额等敏感字段。

### 团队文化

- 编年史：团队重要事件和时间线。
- 案例馆：沉淀做成过的事。
- 相册：记录团队现场，图片走 Supabase Storage。

### 一起决定与军机处

- 投票用于团队共同决策。
- 军机处用于团队共识、公告和制度变更记录。

### 个人主页

- 基本身份和协作说明。
- 每周休息日、最近状态、忌讳 / 注意事项。
- 系统基于真实记录生成贡献画像。
- 展示公开个人目标和复盘痕迹。

## 数据与权限

正式业务数据使用 Supabase 表，包括：

- `teams`
- `profiles`
- `tasks`
- `calendar_events`
- `finance_records`
- `inventory_items`
- `inventory_logs`
- `assets`
- `timeline_events`
- `achievements`
- `photos`
- `votes`
- `vote_options`
- `vote_records`
- `announcements`
- `tools`
- `team_goals`
- `personal_goals`
- `goal_updates`
- `audit_logs`

`team_data` 只保留为迁移期只读备份，不再作为长期主数据入口。

普通成员可见：

- 经营大盘汇总。
- 库存数量和公开状态。
- 团队资产概览。
- 公开目标、公开动态、团队文化内容。

普通成员不可见：

- 单个物品采购成本。
- 单笔财务明细。
- 供应商、敏感备注、工资 / 分红等内部细节。

## 目录结构

```text
src/
├── App.tsx
├── components/
├── config/
├── lib/
├── pages/
├── services/
├── stores/
├── types/
└── utils/

supabase/
├── schema.sql
└── functions/
```

## Supabase

数据库结构和 RLS 策略在：

- `supabase/schema.sql`

管理员成员管理 Edge Function 在：

- `supabase/functions/admin-members/index.ts`

配置说明：

- `docs/Supabase-Edge-Function-部署说明.md`
- `docs/CanWin-Team-OS-整改方案-v1.md`

## 构建部署

```bash
pnpm build
```

当前生产部署走 GitHub Pages，构建产物发布到 `gh-pages` 分支。部署后需要确认线上 HTML 指向最新 `assets/index-*.js`。
