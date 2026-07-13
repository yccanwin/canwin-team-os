# CanWin Team OS 整改方案 v1

> 用途：这是给后续开发窗口使用的标准整改说明。请以本文档为准，不要只依赖聊天上下文。

## 0. 新窗口交接摘要

如果重新开启一个 AI / Codex 窗口，先给对方这句话：

```text
请先阅读 docs/CanWin-Team-OS-整改方案-v1.md，并严格按文档里的产品定位、权限边界、数据迁移和实施阶段推进。不要继续把项目改成 SaaS KPI 后台；先做阶段 1：Supabase Auth、profiles、正式业务表、RLS、只保留 admin。
```

当前代码里最需要优先回正的入口：

- `src/lib/authAccounts.ts`：临时账号体系，长期方案中应删除。
- `src/components/AuthGate.tsx`：登录入口，需要改为 Supabase Auth。
- `src/components/SupabaseSyncProvider.tsx`：当前整包同步入口，后续应废弃。
- `src/hooks/useSupabaseSync.ts`：当前 `team_data` 同步逻辑，后续应拆到正式表服务层。
- `src/stores/useTeamStore.ts`：当前业务数据主模型，后续只保留本地 UI / 缓存职责。
- `src/pages/Settings/index.tsx`：当前账号和团队设置入口，后续应改为 admin 管理成员。
- `supabase/schema.sql`：需要替换为正式表结构和 RLS 策略。

第一阶段不要急着改 UI。先把账号、数据表、权限和迁移路径打稳，否则页面越改越容易再次变形。

## 1. 背景与当前问题

CanWin Team OS 最初是一个小团队内部使用的 OS，不是对外 SaaS，也不是绩效考核系统。它的核心价值应该是：

- 记录团队文化和团队记忆。
- 透明地记录经营大盘。
- 支持最基本的仓储、财务、资产和协作。
- 让同事之间在合适边界内更了解彼此，减少协作摩擦。

目前项目经过多轮补丁式修改后出现方向偏移：

- UI 变得过于 AI SaaS 后台，缺少温馨和团队感。
- 首页偏 KPI 驾驶舱，弱化了团队记忆、日常记录和协作状态。
- 数据同步是把 Zustand store 整包写进 Supabase `team_data`，长期不稳定。
- 账号密码目前是临时 hash 存在 `team_data`，不是长期正规账号体系。
- 团队等级、个人等级、XP 有游戏化想法，但现在容易像考核，意义不清。
- 文化模块、日历、个人主页还没有发挥应有价值。

## 2. 产品定位

新的产品定位：

> CanWin Team OS：小团队经营透明化 + 团队文化记忆库 + 日常协作工具。

产品原则：

- 经营大盘透明，敏感明细受控。
- 团队共识公开，个人隐私克制。
- 记录真实行为，不鼓励刷积分。
- 桌面端适合管理和复盘，移动端适合快速记录和查看。
- 长期使用优先，数据结构必须正规。
- 不做复杂企业管理系统，不做绩效排名。

## 3. 目标状态

整改完成后应满足：

1. 只保留 `admin` 初始账号，其他账号由 admin 后续添加。
2. 使用正规 Supabase Auth 登录，不再自建密码存储。
3. 所有业务数据使用正式 Supabase 表，不再整包同步 Zustand store。
4. 所有人进入同一个团队空间，但保留 `team_id` 字段，为未来扩展留余地。
5. 普通成员可以看到真实经营大盘，但不能看到敏感成本和明细。
6. 个人主页丰富但不过界，重点是协作说明、近期状态、真实贡献痕迹和个人目标。
7. 日历成为团队协作核心，展示休息日、在岗、外出、巡店、任务截止、目标截止等。
8. 目标分为团队目标和个人目标，个人目标可锁定，不能随意改。
9. UI 变温馨，减少 AI SaaS 味，移动端一起重做。

## 4. 技术方向

### 4.1 前端

当前技术栈可保留：

- React
- Vite
- TypeScript
- Tailwind CSS
- Zustand
- Supabase JS

前端整改方向：

- Zustand 只用于本地 UI 状态和短期缓存，不再作为云端数据主模型。
- 业务数据从 Supabase 表读取和写入。
- 需要逐步为每个模块建立 `service` 层，例如：
  - `src/services/tasks.ts`
  - `src/services/inventory.ts`
  - `src/services/finance.ts`
  - `src/services/calendar.ts`
  - `src/services/profile.ts`
- 页面组件不要直接处理复杂 Supabase 查询。
- 移动端按卡片流和快速操作重新设计，不只是桌面缩放。

### 4.2 后端 / 数据库

使用 Supabase：

- Supabase Auth：账号密码登录。
- Supabase Postgres：正式业务表。
- Row Level Security：权限控制。
- Supabase Storage：图片、照片、资产图片、案例图片。
- Realtime 可保留，用于团队动态、任务、日历等轻实时场景。

不要继续使用 `team_data` 作为长期主数据表。

## 5. 账号与权限方案

### 5.1 初始账号

只保留一个初始账号：

```text
username/email: admin
role: admin
```

实际 Supabase Auth 通常使用 email 登录。建议设定：

```text
admin@canwin.local
```

或者使用真实邮箱。具体账号由项目所有者决定。

### 5.2 删除当前临时账号体系

需要删除或废弃：

- `src/lib/authAccounts.ts`
- `team_data` 中的 `canwin-auth-users`
- 前端自建密码 hash 登录逻辑

改为：

- Supabase Auth 登录。
- 登录后根据 `auth.users.id` 查询 `profiles`。

### 5.3 角色

建议角色：

```text
admin        超级管理员
captain      队长
finance      财务
warehouse    仓库负责人
member       普通成员
```

角色说明：

- `admin`：添加成员、分配角色、重置密码、查看所有数据。
- `captain`：团队运营管理，可看大多数数据和决定。
- `finance`：可看财务明细、成本明细。
- `warehouse`：可看库存成本、出入库明细。
- `member`：可看大盘和公开内容，不能看敏感成本明细。

### 5.4 权限原则

普通成员可见：

- 本月收入总额。
- 本月支出总额。
- 本月利润/亏损。
- 现金余额。
- 支出大类占比。
- 团队资产总览。
- 库存数量和低库存提醒。
- 公开目标、公开动态、公开文化内容。

普通成员不可见：

- 单个物品采购成本。
- 供应商报价。
- 单笔采购明细。
- 工资/分红明细。
- 毛利、利润敏感备注。
- 财务和库存的敏感内部备注。

## 6. 数据库表设计

所有业务表建议保留：

```sql
id uuid primary key
team_id uuid or text not null
created_by uuid references auth.users(id)
created_at timestamptz default now()
updated_at timestamptz default now()
```

### 6.1 teams

团队表。当前只有一个团队，但仍建议保留。

字段建议：

- `id`
- `name`
- `slug`
- `created_at`

### 6.2 profiles

成员资料表。

字段建议：

- `id`：对应 `auth.users.id`
- `team_id`
- `name`
- `role`
- `position`
- `avatar_url`
- `join_date`
- `status`
- `created_at`
- `updated_at`

### 6.3 member_preferences

个人协作说明。

字段建议：

- `id`
- `team_id`
- `user_id`
- `rest_days`：例如 `["周三"]`
- `communication_preference`
- `mood`
- `taboos`
- `notes`
- `updated_at`

用途：

- 展示个人主页中的协作说明。
- 日历自动显示每周休息日。
- 帮团队了解彼此工作边界，但不涉及私人生活。

### 6.4 tasks

任务表。

字段建议：

- `id`
- `team_id`
- `title`
- `type`
- `assignee_id`
- `status`
- `deadline`
- `description`
- `is_important`
- `created_by`
- `completed_at`

### 6.5 calendar_events

日历事件表。

字段建议：

- `id`
- `team_id`
- `title`
- `event_type`
- `start_at`
- `end_at`
- `all_day`
- `user_id`
- `related_type`
- `related_id`
- `visibility`

事件类型建议：

```text
rest_day
task_deadline
personal_goal_deadline
team_goal_deadline
visit
store_check
inventory_check
team_activity
finance_day
meeting
other
```

### 6.6 finance_records

财务记录表。

字段建议：

- `id`
- `team_id`
- `record_type`：income / expense
- `amount`
- `category`
- `date`
- `note`
- `sensitive_note`
- `created_by`
- `visibility_level`

说明：

- 普通成员看汇总。
- admin / captain / finance 看明细。
- 敏感字段按角色隐藏。

### 6.7 inventory_items

库存物品表。

字段建议：

- `id`
- `team_id`
- `name`
- `sku`
- `quantity`
- `unit`
- `public_status`
- `low_stock_threshold`
- `unit_cost`
- `supplier`
- `sensitive_note`
- `updated_at`

权限：

- 普通成员可看名称、数量、状态。
- 成本、供应商、敏感备注仅授权角色可见。

### 6.8 inventory_logs

出入库记录。

字段建议：

- `id`
- `team_id`
- `item_id`
- `operation`：in / out / adjust
- `quantity_change`
- `operator_id`
- `finance_record_id`
- `note`
- `created_at`

### 6.9 assets

团队资产表。

字段建议：

- `id`
- `team_id`
- `name`
- `category`
- `description`
- `purchase_date`
- `amount`
- `amount_visibility`
- `status`
- `owner_id`
- `image_url`
- `finance_record_id`
- `sensitive_note`

普通成员可见：

- 买了什么。
- 用来干什么。
- 当前状态。
- 购买时间。

敏感字段：

- 具体价格可按权限隐藏。
- 供应商和付款备注隐藏。

### 6.10 timeline_events

编年史 / 团队记忆。

字段建议：

- `id`
- `team_id`
- `title`
- `event_date`
- `category`
- `description`
- `created_by`
- `visibility`

### 6.11 achievements

案例馆。

字段建议：

- `id`
- `team_id`
- `name`
- `category`
- `description`
- `achieved_date`
- `created_by`
- `timeline_event_id`

### 6.12 photos

相册。

字段建议：

- `id`
- `team_id`
- `title`
- `image_url`
- `album`
- `uploaded_by`
- `taken_at`
- `description`

图片放 Supabase Storage，不要长期用 base64 存数据库。

### 6.13 votes

投票。

字段建议：

- `id`
- `team_id`
- `title`
- `description`
- `deadline`
- `created_by`
- `status`

### 6.14 vote_options

投票选项。

- `id`
- `vote_id`
- `label`

### 6.15 vote_records

投票记录。

- `id`
- `vote_id`
- `option_id`
- `user_id`
- `voted_at`

### 6.16 announcements

军机处，团队共识、公示、制度变更。

字段建议：

- `id`
- `team_id`
- `title`
- `content`
- `status`
- `effective_date`
- `created_by`
- `related_vote_id`
- `created_at`

### 6.17 tools

工具箱。

字段建议：

- `id`
- `team_id`
- `title`
- `url`
- `description`
- `category`
- `created_by`
- `created_at`

### 6.18 team_goals

团队目标。

字段建议：

- `id`
- `team_id`
- `title`
- `description`
- `target_amount`
- `current_amount`
- `deadline`
- `status`
- `created_by`

### 6.19 personal_goals

个人目标。

字段建议：

- `id`
- `team_id`
- `user_id`
- `title`
- `description`
- `goal_type`
- `target_amount`
- `deadline`
- `visibility`
- `lock_status`
- `locked_at`
- `unlock_at`
- `created_at`

锁定规则：

- 创建后可以有 24 小时冷静期。
- 冷静期后锁定标题、金额、截止日期。
- 锁定后只能追加进展，不能随意修改目标。
- 到期后进入复盘状态。
- admin 可以特殊解锁，但必须写入 `audit_logs`。

### 6.20 goal_updates

目标进展记录。

字段建议：

- `id`
- `goal_type`：team / personal
- `goal_id`
- `content`
- `amount_delta`
- `image_url`
- `created_by`
- `created_at`

### 6.21 badges

勋章 / 里程碑定义。

字段建议：

- `id`
- `team_id`
- `name`
- `description`
- `icon`
- `badge_type`：team / personal
- `category`
- `trigger_rule`

### 6.22 badge_awards

勋章授予记录。

字段建议：

- `id`
- `team_id`
- `badge_id`
- `user_id`
- `awarded_at`
- `source_type`
- `source_id`

### 6.23 audit_logs

关键操作记录。

字段建议：

- `id`
- `team_id`
- `actor_id`
- `action`
- `target_type`
- `target_id`
- `before_data`
- `after_data`
- `created_at`

## 7. 页面与信息架构

建议导航结构：

```text
首页
日历
任务
目标
仓库
财务
资产馆
编年史
案例馆
相册
一起决定
军机处
工具箱
团队成员
个人主页
设置
```

分组建议：

```text
今日协作：首页、日历、任务、目标
经营记录：仓库、财务、资产馆
团队文化：编年史、案例馆、相册、勋章
共同决策：一起决定、军机处
资源与成员：工具箱、团队成员、个人主页
```

说明：

- 投票不隐藏，建议命名为“一起决定”。
- 军机处保留，定位为“团队共识与公告”。
- 工具箱保留，定位为“团队资源库”。
- 资产馆保留，定位为“团队花钱买下的资产记录”。

## 8. 首页重做方向

首页不要是冷冰冰 KPI 大屏。

首页应改为“今日团队状态”：

- 今天谁在岗 / 谁休息。
- 今日任务。
- 最近团队动态。
- 库存提醒。
- 财务大盘。
- 当前团队目标。
- 最新照片 / 案例 / 编年史。
- 近期军机处公告。

首页信息优先级：

1. 今天团队要知道什么。
2. 今天团队要处理什么。
3. 最近团队发生了什么。
4. 团队经营是否健康。

## 9. UI 视觉方向

目标气质：

> 温暖团队工作室 / 团队手账 / 轻经营记录本。

不要继续 AI SaaS 味。

建议：

- 减少大面积紫蓝渐变。
- 使用暖白、浅米、柔绿、柔蓝、浅橙。
- 卡片像记录卡、便签、公告板，而不是纯后台卡片。
- 动效轻柔，不炫。
- 多用照片、时间线、状态条、手账式记录。
- 图标可以生活化，但不要幼稚。

移动端：

- 移动端必须一起设计。
- 移动端不是桌面压缩版。
- 移动端优先“快速记录”和“快速查看”。

移动端核心场景：

- 拍照上传。
- 出入库记录。
- 巡店拜访记录。
- 看今天谁休息。
- 发起投票。
- 查看公告。
- 记录团队瞬间。

## 10. 个人主页整改

个人主页不做可作假的游戏属性。

定位：

> 这个人在团队里的协作说明和真实痕迹。

页面模块：

1. 基本身份
2. 协作说明
3. 每周休息日
4. 最近状态
5. 忌讳 / 注意事项
6. 最近参与记录
7. 个人贡献画像
8. 公开个人目标
9. 已完成目标 / 复盘

个人贡献画像不由用户自己填，而是由系统根据真实记录生成：

- 任务推进者
- 文化记录官
- 工具分享者
- 仓库守护者
- 客户行动派
- 决策参与者
- 资产维护者

不要做：

- 积分排行榜。
- 成员 PK。
- 每日签到积分。
- 任务刷分。

## 11. 团队等级、个人等级和勋章

不建议继续使用传统 `Lv.x` 和 XP。

建议替换为：

### 11.1 团队健康度

团队健康度反映团队是否越来越良性发展。

维度：

- 现金流是否健康。
- 仓库是否稳定。
- 任务是否推进。
- 团队记录是否活跃。
- 决策是否透明。

展示示例：

```text
团队状态：稳定运转
本月亮点：完成 2 次团队决策 / 新增 3 条案例 / 库存记录完整
当前风险：现金流略紧 / 有 1 项低库存
成长阶段：透明期 → 增长期
```

### 11.2 团队成长阶段

建议阶段：

1. 起步期
2. 稳定期
3. 透明期
4. 增长期
5. 成熟期

这是团队状态，不是考核分。

### 11.3 勋章

勋章保留，但改成“团队记忆标签”。

团队勋章例子：

- 第一次入库记录
- 第一次团队投票
- 第一次案例沉淀
- 完成一次团建
- 买下第一辆小车
- 连续一个月财务透明
- 本月团队无遗漏记录

个人标签例子：

- 仓库守护者
- 工具猎人
- 文化记录官
- 团建发动机
- 客户行动派

## 12. 日历整改

日历是核心交互工具。

必须支持：

- 每个人每周休息日。
- 今日谁在岗。
- 谁外出拜访。
- 巡店。
- 仓库盘点。
- 团队活动。
- 任务截止日。
- 目标截止日。
- 财务结算日。

联动要求：

- 个人主页设置“每周三休息”，日历自动体现。
- 创建任务时，如果分配到成员休息日，应提示。
- 个人目标截止日自动出现在日历。
- 团队目标截止日自动出现在日历。

日历视图建议：

1. 团队视图：看今天 / 本周谁休息、谁在岗、谁外出。
2. 事项视图：任务、巡店、拜访、团建、盘点、会议。
3. 个人视图：点某个人看 TA 的休息日、任务、拜访、动态。

## 13. 目标模块整改

目标分两类：

- 团队目标
- 个人目标

### 13.1 团队目标

例如：

- 买小车。
- 月经营目标。
- 团队建设目标。
- 资产目标。

### 13.2 个人目标

例如：

- 年底买一套苹果电脑。
- 学会某项技能。
- 完成固定次数巡店。
- 健身目标。
- 存钱目标。

个人目标原则：

- 不是考核。
- 是个人承诺、记录和复盘。
- 可以公开给团队，也可以私密。
- 公开目标可以让团队见证。

锁定机制：

- 创建后有 24 小时冷静期。
- 冷静期后锁定。
- 锁定后不能改标题、金额、截止日期。
- 可以追加进展记录。
- 到期后自动进入复盘状态。
- admin 特殊解锁必须留日志。

## 14. 数据迁移方案

当前线上数据主要在：

- localStorage
- Supabase `team_data`

迁移策略：

1. 冻结当前线上写入窗口。
2. 导出 `team_data` 中现有数据。
3. 清理演示数据。
4. 将有效数据迁移到正式表。
5. 前端切换到正式表读写。
6. 保留旧 `team_data` 只读备份一段时间。
7. 验证多人、多设备、移动端数据一致。
8. 删除旧同步逻辑。

迁移时必须特别处理：

- 当前团队空间。
- 任务数据。
- 财务数据。
- 库存数据。
- 成员资料。
- 图片数据。

图片数据如果目前是 base64，应迁移到 Supabase Storage。

## 15. 实施阶段

### 阶段 1：账号与数据库回正

目标：

- 接入 Supabase Auth。
- 只保留 admin。
- 建立 `profiles`。
- 建立正式表结构。
- 建立 RLS 权限。
- 删除临时 authAccounts 逻辑。

完成标准：

- 只能用 Supabase Auth 登录。
- admin 能进入系统。
- 非登录用户不能进入系统。
- profiles 能正确读取当前用户角色。

### 阶段 2：数据层迁移

目标：

- 从 `team_data` 迁出数据。
- 每个模块读写正式表。
- Zustand 不再整包同步云端。

完成标准：

- 新浏览器、新手机登录后看到同一份正式表数据。
- 修改任务、库存、财务后其他设备能看到。
- 演示数据不会覆盖正式数据。

### 阶段 3：首页与导航回正

目标：

- 首页改成“今日团队状态”。
- 导航按新信息架构重组。
- 减少 KPI 大屏感。

完成标准：

- 首页一眼能看到今日事项、休息人员、最近动态、库存/财务提醒。
- 文化和经营记录入口清晰。

### 阶段 4：核心经营模块重构

模块：

- 仓库
- 财务
- 资产馆
- 任务
- 日历

完成标准：

- 普通成员只能看大盘和非敏感字段。
- 队长 / 财务 / 仓库负责人可以看对应明细。
- 操作有日志。

### 阶段 5：文化和个人模块增强

模块：

- 编年史
- 案例馆
- 相册
- 个人主页
- 勋章 / 团队健康度
- 个人目标

完成标准：

- 个人主页能体现协作说明、休息日、真实贡献、个人目标。
- 团队文化内容在首页有露出。
- 勋章不再像考核积分，而像团队记忆。

### 阶段 6：UI 温馨化与移动端重做

目标：

- 桌面端重做视觉风格。
- 移动端单独优化。

完成标准：

- 登录页、首页、日历、个人主页、仓库、财务移动端均可用。
- 移动端录入流程不依赖复杂表格。

## 16. 不建议做的事

不要做：

- 继续扩大 `team_data` 整包同步。
- 继续加 XP 和排行榜。
- 继续把系统做成 SaaS 后台。
- 继续用自建密码 hash 替代 Supabase Auth。
- 继续把移动端当桌面缩小版。
- 普通成员可见全部成本明细。
- 文化模块被放在边缘。

## 17. 下一步建议

建议下一步只做一件事：

> 阶段 1：账号与数据库回正。

具体任务：

1. 写 Supabase SQL migration。
2. 建 Supabase Auth + profiles。
3. 初始化唯一 admin。
4. 删除临时 `authAccounts.ts`。
5. 改前端登录为 Supabase Auth。
6. 登录后根据 `profiles.role` 控制权限。
7. 验证登录、退出、刷新、移动端登录。

不要先大改 UI。
先把数据和账号地基打稳，再做页面。
