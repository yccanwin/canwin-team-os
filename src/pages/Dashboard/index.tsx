import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Boxes, History } from 'lucide-react'
import { useFinanceStore } from '@/stores/useFinanceStore'
import { useTaskStore } from '@/stores/useTaskStore'
import { useGoalStore } from '@/stores/useGoalStore'
import { useUserStore } from '@/stores/useUserStore'
import { useInventoryStore } from '@/stores/useInventoryStore'
import { useTimelineStore } from '@/stores/useTimelineStore'
import { usePhotoStore } from '@/stores/usePhotoStore'
import { useWarRoomStore } from '@/stores/useWarRoomStore'
import { useYanchengWeather } from '@/hooks/useYanchengWeather'
import { KPISection } from './KPISection'
import GoalProgressSection from './GoalProgressSection'
import GoalRoadmapSection from './GoalRoadmapSection'
import { SurvivalStatusSection } from './SurvivalStatusSection'
import QuickVoteSection from './QuickVoteSection'
import TrendChartSection from './TrendChartSection'
import ActivityFeedSection from './ActivityFeedSection'
import TaskCenterSection from './TaskCenterSection'
import CollaborationSnapshotSection from './CollaborationSnapshotSection'

export default function Dashboard() {
  const records = useFinanceStore((s) => s.records)
  const tasks = useTaskStore((s) => s.tasks)
  const goals = useGoalStore((s) => s.goals)
  const users = useUserStore((s) => s.users)
  const inventoryItems = useInventoryStore((s) => s.items)
  const timelineEvents = useTimelineStore((s) => s.events)
  const photos = usePhotoStore((s) => s.photos)
  const policies = useWarRoomStore((s) => s.policies)
  const { weather } = useYanchengWeather()

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
  const todayWeekday = new Date().getDay()
  const restDayIndex: Record<string, number> = {
    周日: 0,
    周一: 1,
    周二: 2,
    周三: 3,
    周四: 4,
    周五: 5,
    周六: 6,
  }
  const restUsers = users.filter((user) =>
    (user.restDays ?? []).some((day) => restDayIndex[day] === todayWeekday)
  )
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const overdueTasks = tasks.filter(
    (task) => task.status !== 'done' && Boolean(task.deadline) && task.deadline!.slice(0, 10) < todayKey,
  )
  const todayTasks = tasks
    .filter((task) => task.status !== 'done')
    .filter((task) => !task.deadline || task.deadline.slice(0, 10) <= todayKey)
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
    .slice(0, 4)
  const lowStockItems = inventoryItems.filter((item) => item.quantity <= 3).slice(0, 4)
  const latestMemory = [...timelineEvents]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 2)
  const latestPhoto = photos[0]
  const latestPolicy = policies[0]

  return (
    <div className="space-y-5">
      <div className="dashboard-command-panel rounded-2xl border border-amber-100 bg-[#fffaf0] p-4 sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
          <div>
            <p className="command-eyebrow text-sm text-amber-700">{greeting}，今天先看团队状态</p>
            <h2 className="mt-1 font-heading text-2xl font-semibold text-brand-400 sm:text-3xl">
              今日团队状态
            </h2>
            <p className="command-summary mt-2 text-sm leading-6 text-brand-300">
              今日营收 ¥{todayRevenue.toLocaleString()} · 本周目标完成度 {goalCompletionRate}% · {pendingTasks} 项进行中任务
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-xl border border-cyan-100 bg-white/80 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-brand-300">盐城天气</p>
                <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-700">6小时缓存</span>
              </div>
              {weather ? (
                <>
                  <p className="mt-1 text-sm font-medium text-brand-400">
                    {weather.weatherText} · {weather.temperature ?? '--'}°C · {weather.minTemperature ?? '--'}-{weather.maxTemperature ?? '--'}°C
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-brand-300">
                    降雨概率 {weather.rainProbability ?? 0}%{weather.nextRainTime ? ` · ${weather.nextRainTime} 可能下雨` : ''}。{weather.advisory}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-brand-300">天气预报加载中</p>
              )}
            </div>
            <div className="rounded-xl bg-white/80 px-4 py-3">
              <p className="text-xs font-medium text-brand-300">今日休息</p>
              <p className="mt-1 text-sm text-brand-400">{restUsers.length ? restUsers.map((u) => u.name).join('、') : '无人休息'}</p>
            </div>
            <div className="rounded-xl bg-white/80 px-4 py-3">
              <p className="text-xs font-medium text-brand-300">近期公告</p>
              <p className="mt-1 line-clamp-2 text-sm text-brand-400">{latestPolicy?.title || '暂无新公告'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Link to="/tasks" className={`group rounded-card border p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-md ${overdueTasks.length ? 'border-red-200 bg-gradient-to-br from-white to-red-50' : 'border-blue-100 bg-gradient-to-br from-white to-blue-50'}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className={`h-5 w-5 ${overdueTasks.length ? 'text-red-500' : 'text-blue-500'}`} />
              <h3 className="font-heading text-base font-semibold text-brand-400">今天要处理</h3>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${overdueTasks.length ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
              {overdueTasks.length ? `${overdueTasks.length} 项逾期` : `${todayTasks.length} 项待办`}
            </span>
          </div>
          {todayTasks.length ? (
            <div className="space-y-2">
              {todayTasks.map((task) => (
                <div key={task.id} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${task.deadline && task.deadline.slice(0, 10) < todayKey ? 'bg-red-100/80 text-red-900' : 'bg-blue-100/70 text-blue-900'}`}>
                  <span className="truncate">{task.title}</span>
                  {task.deadline && task.deadline.slice(0, 10) < todayKey && <span className="shrink-0 text-[11px] font-semibold">已逾期</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-brand-200">暂无紧急事项</p>
          )}
          <div className="mt-3 flex items-center justify-end gap-1 text-xs font-medium text-blue-700">进入任务中心 <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" /></div>
        </Link>
        <Link to="/asset-center?view=inventory" className={`group rounded-card border p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-md ${lowStockItems.length ? 'border-amber-200 bg-gradient-to-br from-white to-amber-50' : 'border-emerald-100 bg-gradient-to-br from-white to-emerald-50'}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Boxes className={`h-5 w-5 ${lowStockItems.length ? 'text-amber-500' : 'text-emerald-500'}`} />
              <h3 className="font-heading text-base font-semibold text-brand-400">库存提醒</h3>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${lowStockItems.length ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
              {lowStockItems.length ? `${lowStockItems.length} 项偏低` : '库存正常'}
            </span>
          </div>
          {lowStockItems.length ? (
            <div className="space-y-2">
              {lowStockItems.map((item) => (
                <div key={item.id} className="flex justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <span>{item.name}</span>
                  <span>{item.quantity}{item.unit}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-brand-200">暂无低库存提醒</p>
          )}
          <div className="mt-3 flex items-center justify-end gap-1 text-xs font-medium text-amber-700">进入资产中心 <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" /></div>
        </Link>
        <Link to="/culture-center" className="group rounded-card border border-violet-100 bg-gradient-to-br from-white via-violet-50/70 to-pink-50/70 p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-md">
          <div className="mb-3 flex items-center gap-2">
            <History className="h-5 w-5 text-violet-500" />
            <h3 className="font-heading text-base font-semibold text-brand-400">最近团队记忆</h3>
          </div>
          {latestMemory.length ? (
            <div className="space-y-2">
              {latestMemory.map((event) => (
                <div key={event.id} className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
                  {event.title}
                </div>
              ))}
            </div>
          ) : latestPhoto ? (
            <p className="text-sm text-brand-300">{latestPhoto.title || '有新的团队照片'}</p>
          ) : (
            <p className="text-sm text-brand-200">等待记录第一条团队时刻</p>
          )}
          <div className="mt-3 flex items-center justify-end gap-1 text-xs font-medium text-violet-700">进入团队文化 <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" /></div>
        </Link>
      </div>

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

      {/* 底部：活动动态 + 协作快照 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ActivityFeedSection />
        <CollaborationSnapshotSection />
      </div>
    </div>
  )
}
