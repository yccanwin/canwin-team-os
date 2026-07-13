# ESLint 2.0 / 共享旧路径技术债基线

- 基线日期：2026-07-13（北京时间）
- ESLint：v10.5.0
- 范围：除 `src/features/**` 外的 2.0 / 共享旧路径
- 当前基线：51 errors，0 warnings，涉及 24 个文件
- 状态：仅记录遗留债务；本文不表示这些问题已经修复

## 复现命令

```powershell
.\node_modules\.bin\eslint.cmd . --ignore-pattern "src/features/**" --max-warnings 0
```

命令预期当前以非零状态退出，并报告 51 个 errors。`src/features/**` 属于 3.0 定向门禁，不计入本基线；3.0 应独立执行并达到 0 error / 0 warning。

## 按规则统计

| 规则 | Errors |
|---|---:|
| `@typescript-eslint/no-unused-vars` | 26 |
| `@typescript-eslint/no-explicit-any` | 10 |
| `react-hooks/set-state-in-effect` | 7 |
| `react-hooks/static-components` | 6 |
| `prefer-const` | 1 |
| `react-hooks/immutability` | 1 |
| 合计 | 51 |

## 按文件统计

| 文件 | Errors |
|---|---:|
| `src/components/charts/RevenueTrendChart.tsx` | 6 |
| `src/components/charts/TaskStatusChart.tsx` | 4 |
| `src/components/Timeline/TimelineAxis.tsx` | 1 |
| `src/pages/Achievements/AchievementDetailModal.tsx` | 1 |
| `src/pages/Achievements/AchievementFormModal.tsx` | 3 |
| `src/pages/Assets/AssetFormModal.tsx` | 1 |
| `src/pages/Calendar/index.tsx` | 3 |
| `src/pages/Dashboard/GoalProgressSection.tsx` | 1 |
| `src/pages/Dashboard/GoalRoadmapSection.tsx` | 1 |
| `src/pages/Finance/index.tsx` | 1 |
| `src/pages/Goals/GoalEditModal.tsx` | 2 |
| `src/pages/Goals/index.tsx` | 1 |
| `src/pages/Inventory/index.tsx` | 7 |
| `src/pages/Inventory/StockOutModal.tsx` | 1 |
| `src/pages/Photos/PhotoDetailModal.tsx` | 1 |
| `src/pages/Photos/PhotoUploadModal.tsx` | 1 |
| `src/pages/SalesCenter/index.tsx` | 2 |
| `src/pages/Settings/index.tsx` | 1 |
| `src/pages/Settings/MemberFormModal.tsx` | 1 |
| `src/pages/Tasks/index.tsx` | 4 |
| `src/pages/Tasks/TaskDetailPanel.tsx` | 4 |
| `src/pages/Timeline/EventModal.tsx` | 2 |
| `src/types/index.ts` | 1 |
| `src/utils/imageCompressor.ts` | 1 |
| 合计 | 51 |

## 管理原则

1. 51 errors 是旧债上限，不得新增错误、警告、受影响文件或扩大规则豁免。
2. 不通过关闭规则、全局 disable、降低严重级别或扩大 ignore 范围来维持基线。
3. 修改旧路径时，应至少不增加该文件错误数；能安全修复时单独降低基线并保留复跑证据。
4. 3.0 定向门禁失败不能用本旧债基线豁免；两者分别统计、分别验收。
