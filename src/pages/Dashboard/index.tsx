import { useMemo } from 'react'
import { useFinanceStore } from '@/stores/useFinanceStore'
import { useTaskStore } from '@/stores/useTaskStore'
import { useGoalStore } from '@/stores/useGoalStore'
import { KPISection } from './KPISection'
import GoalProgressSection from './GoalProgressSection'
import GoalRoadmapSection from './GoalRoadmapSection'
import { SurvivalStatusSection } from './SurvivalStatusSection'
import QuickVoteSection from './QuickVoteSection'
import TrendChartSection from './TrendChartSection'
import ActivityFeedSection from './ActivityFeedSection'
import TaskCenterSection from './TaskCenterSection'
import BadgeWallSection from './BadgeWallSection'

export default function Dashboard() {
  const records = useFinanceStore((s) => s.records)
  const tasks = useTaskStore((s) => s.tasks)
  const goals = useGoalStore((s) => s.goals)

  const todayRevenue = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return records
      .filter((r) => r.date === today && r.type === 'income')
      .reduce((sum, r) => sum + r.amount, 0)
  }, [records])

  const pendingTasks = useMemo(
    () => tasks.filter((t) => t.status === 'in_progress').length,
    [tasks],
  )

  const goalCompletionRate = useMemo(() => {
    const totalTarget = goals.reduce((s, g) => s + g.targetAmount, 0)
    const totalCurrent = goals.reduce((s, g) => s + g.currentAmount, 0)
    return totalTarget > 0 ? Math.round((totalCurrent / totalTarget) * 100) : 0
  }, [goals])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'

  return (
    <div className="space-y-5">
      {/* Hero 欢迎区 */}
      <div className="bg-gradient-to-br from-primary/10 via-white to-primary/5 rounded-2xl p-6 border border-primary/10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-primary-800 font-heading">
              👋 {greeting}，队长！
            </h2>
            <p className="text-neutral-tertiary mt-1">
              今日营收 ¥{todayRevenue.toLocaleString()} · 本周目标完成度 {goalCompletionRate}% · {pendingTasks}项待审任务
            </p>
          </div>
        </div>
      </div>

      {/* KPI 卡片行 */}
      <KPISection />

      {/* 上半部分：趋势图 + 目标进度 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <TrendChartSection />
        </div>
        <div className="space-y-5 lg:col-span-1">
          <GoalProgressSection />
        </div>
      </div>

      {/* 下半部分：路线图 + 生存状态 + 任务中心 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          <GoalRoadmapSection />
          <SurvivalStatusSection />
        </div>
        <div className="space-y-5">
          <TaskCenterSection />
          <QuickVoteSection />
        </div>
      </div>

      {/* 底部：活动动态 + 勋章墙 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ActivityFeedSection />
        <BadgeWallSection />
      </div>
    </div>
  )
}
