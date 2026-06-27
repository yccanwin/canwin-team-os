# CanWin Team OS

> 8 人小团队业务可视化系统 · 纯前端 SPA

## 🚀 快速启动

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器（局域网可访问）
bash start.sh

# 或直接
npm run dev
```

- **本地访问**：http://localhost:5173
- **局域网访问**：启动后终端会显示局域网 IP 地址

## 🧱 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 18 + TypeScript |
| 构建 | Vite 8 |
| 样式 | Tailwind CSS 3 |
| 状态管理 | Zustand 5（localStorage 持久化） |
| 路由 | React Router 6 |
| 图表 | Chart.js 4 + react-chartjs-2 |
| 图标 | Lucide React |

## 📊 核心功能

### 仪表盘
- KPI 卡片（收入/支出/利润/现金余额）
- 目标进度追踪
- 团队生存状态
- 趋势分析图
- 快速投票入口
- 勋章墙
- 团队动态

### 任务管理
- 任务 CRUD + 状态流转（待办 → 进行中 → 已完成）
- 类型筛选（销售/运营/采购/其他）
- 关键字搜索
- XP 奖励（普通 +10 / 重要 +30）
- 完成自动触发勋章检查

### 个人主页
- 贡献统计面板
- XP 增长柱状图
- 勋章展示墙

### 目标管理
- 4 阶段营收目标路线图
- 进度条 + ETA 预估
- 阶段解锁/禁用

### 投票系统
- 发起/参与投票
- 截止倒计时
- 投票统计 + 自动到期关闭

### 仓库管理
- 库存表格（名称/SKU/数量/单价/总值）
- 入/出库操作
- 操作日志（保留最近 30 条）
- 自动同步财务记录

### 设置中心（仅队长）
- 勋章配置（新增/编辑/删除）
- 财务录入（收入/支出）
- 目标管理
- 团队成员管理

### 游戏化系统
- **XP/等级**：10 级非线性升级体系
- **勋章**：6 种勋章，支持 4 种触发类型
  - `task_count`：累计完成任务数
  - `login_streak`：连续登录天数
  - `metric`：业务指标（销售额/成本/协作）
  - `custom`：自定义条件
- **连续登录**：登录补发 + 断签重置
- **3D 庆祝弹窗**：勋章解锁动画

## 🏛️ 系统架构

```
src/
├── App.tsx                 # 路由入口 + 登录补发逻辑
├── components/
│   ├── Layout/             # 侧边栏 + 顶部栏 + 用户切换
│   ├── KPICard/            # KPI 卡片
│   ├── StatusBadge/        # 状态徽标
│   ├── ProgressBar/        # 进度条
│   ├── Modal/              # 通用弹窗
│   ├── EmptyState/         # 空状态占位
│   ├── ConfirmDialog/      # 确认对话框
│   └── BadgeUnlockModal/   # 勋章庆祝弹窗
├── pages/
│   ├── Dashboard/          # 仪表盘（9 个 Section）
│   ├── Tasks/              # 任务中心
│   ├── Profile/            # 个人主页
│   ├── Goals/              # 目标管理
│   ├── Votes/              # 投票系统
│   ├── Inventory/          # 仓库管理
│   └── Settings/           # 设置中心
├── stores/                 # 7 个 Zustand Store
├── utils/                  # xpCalculator / badgeChecker / dateUtils
├── data/                   # mockData
└── types/                  # TypeScript 类型定义
```

## 🔐 权限模型

| 角色 | Dashboard | 任务 | 仓库 | 投票 | 设置 |
|------|-----------|------|------|------|------|
| 队长 | ✅ 全部 | ✅ CRUD | ✅ 出入库 | ✅ 发起 | ✅ 全部 |
| 成员 | ✅ 只读 | ✅ 只操作 | ✅ 只读 | ✅ 投票 | ❌ 重定向 |

## 📝 数据持久化

所有数据存储在 `localStorage`，key 前缀 `canwin-`：

- `canwin-users` — 用户数据
- `canwin-tasks` — 任务列表
- `canwin-finance` — 财务记录
- `canwin-goals` — 目标数据
- `canwin-votes` — 投票数据
- `canwin-badges` — 勋章配置
- `canwin-inventory` — 库存与日志
- `canwin-activity` — 团队动态
- `canwin-login` — 登录连续天数

## 🔧 构建部署

```bash
# 生产构建
npm run build

# 预览构建产物
npm run preview
```
