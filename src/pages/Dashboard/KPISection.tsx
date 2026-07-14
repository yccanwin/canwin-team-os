import { useMemo } from 'react'
import { KPICard } from '@/components/KPICard'
import { DollarSign, CheckSquare, Target, Wallet, AlertTriangle } from 'lucide-react'
import { useTaskStore } from '@/stores/useTaskStore'
import { useFinanceStore } from '@/stores/useFinanceStore'
import { useInventoryStore } from '@/stores/useInventoryStore'
import { useCountUp } from '@/hooks/useCountUp'

function shanghaiDateKey(date: Date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

function recordDateKey(value?: string) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return shanghaiDateKey(new Date(value))
}

export function KPISection() {
  // ================================================================
  // 动态数据：从各 Store 实时计算，不硬编码
  // ================================================================

  // —— 财务 ——
  const netProfit = useFinanceStore((s) => s.getNetProfit())
  const thisMonthIncome = useFinanceStore((s) => {
    const now = new Date()
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return s.records
      .filter((r) => r.date.startsWith(ym) && r.type === 'income')
      .reduce((sum, r) => sum + r.amount, 0)
  })
  const lastMonthIncome = useFinanceStore((s) => {
    const now = new Date()
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const ym = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
    return s.records
      .filter((r) => r.date.startsWith(ym) && r.type === 'income')
      .reduce((sum, r) => sum + r.amount, 0)
  })

  // —— 任务 ——
  const allTasks = useTaskStore((s) => s.tasks)
  const inventoryItems = useInventoryStore((s) => s.items)
  const inProgressCount = useMemo(
    () => allTasks.filter((t) => t.status === 'in_progress').length,
    [allTasks]
  )
  const completedCount = useMemo(
    () => allTasks.filter((t) => t.status === 'done').length,
    [allTasks]
  )
  const goalRate = useMemo(() => {
    const total = allTasks.length
    if (total === 0) return 0
    return Math.round((completedCount / total) * 100)
  }, [allTasks, completedCount])

  // —— 总资产 = 实时现金（净利） ——
  const totalAssets = netProfit

  // —— 本月营收环比 ——
  const momChange = useMemo(() => {
    if (lastMonthIncome === 0) return null
    return Math.round(((thisMonthIncome - lastMonthIncome) / lastMonthIncome) * 100)
  }, [thisMonthIncome, lastMonthIncome])
  const revenueTrend: 'up' | 'down' | 'flat' =
    momChange === null ? 'flat' : momChange > 0 ? 'up' : momChange < 0 ? 'down' : 'flat'

  // —— 7 日迷你趋势数据 ——
  const last7Days = useMemo(() => {
    const days: string[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      days.push(shanghaiDateKey(d))
    }
    return days
  }, [])

  const allRecords = useFinanceStore((s) => s.records)

  const last7DaysIncome = useMemo(
    () =>
      last7Days.map((date) =>
        allRecords
          .filter((r) => r.date === date && r.type === 'income')
          .reduce((sum, r) => sum + r.amount, 0)
      ),
    [allRecords, last7Days]
  )

  const last7DaysNet = useMemo(
    () =>
      last7Days.map((date) => {
        const dayRecords = allRecords.filter((r) => r.date === date)
        const income = dayRecords.filter((r) => r.type === 'income').reduce((sum, r) => sum + r.amount, 0)
        const expense = dayRecords.filter((r) => r.type === 'expense').reduce((sum, r) => sum + r.amount, 0)
        return income - expense
      }),
    [allRecords, last7Days]
  )

  const today = last7Days[last7Days.length - 1]
  const yesterday = last7Days[last7Days.length - 2]
  const todayIncome = last7DaysIncome[last7DaysIncome.length - 1] ?? 0
  const yesterdayIncome = last7DaysIncome[last7DaysIncome.length - 2] ?? 0
  const todayNet = last7DaysNet[last7DaysNet.length - 1] ?? 0
  const yesterdayNet = last7DaysNet[last7DaysNet.length - 2] ?? 0

  const last7DaysCreatedTasks = useMemo(
    () => last7Days.map((date) => allTasks.filter((task) => recordDateKey(task.createdAt) === date).length),
    [allTasks, last7Days],
  )
  const last7DaysCompletedTasks = useMemo(
    () => last7Days.map((date) => allTasks.filter((task) => recordDateKey(task.completedAt) === date).length),
    [allTasks, last7Days],
  )
  const todayCreated = last7DaysCreatedTasks[last7DaysCreatedTasks.length - 1] ?? 0
  const yesterdayCreated = last7DaysCreatedTasks[last7DaysCreatedTasks.length - 2] ?? 0
  const todayCompleted = last7DaysCompletedTasks[last7DaysCompletedTasks.length - 1] ?? 0
  const yesterdayCompleted = last7DaysCompletedTasks[last7DaysCompletedTasks.length - 2] ?? 0
  const overdueCount = useMemo(
    () => allTasks.filter((task) => task.status !== 'done' && Boolean(task.deadline) && recordDateKey(task.deadline) < today).length,
    [allTasks, today],
  )
  const lowStockCount = useMemo(
    () => inventoryItems.filter((item) => item.quantity <= 3).length,
    [inventoryItems],
  )

  // —— 动画数值（数字滚动） ——
  const animatedIncome = useCountUp(thisMonthIncome)
  const animatedInProgress = useCountUp(inProgressCount)
  const animatedGoalRate = useCountUp(goalRate)
  const animatedAssets = useCountUp(totalAssets)

  // ================================================================
  // 渲染
  // ================================================================
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      {/* 本月收入 */}
      <KPICard
        title="本月收入"
        value={`¥${animatedIncome.toLocaleString()}`}
        trend={revenueTrend}
        trendLabel={momChange === null ? '上月无收入，暂不计算环比' : `环比 ${momChange >= 0 ? '+' : ''}${momChange}%`}
        comparisonLabel={`今日 ¥${todayIncome.toLocaleString()} · 昨日 ¥${yesterdayIncome.toLocaleString()}`}
        sparklineData={last7DaysIncome}
        tone="growth"
        href="/finance"
        icon={<DollarSign className="w-6 h-6 text-income" />}
      />

      {/* 进行中协作 */}
      <KPICard
        title="进行中协作"
        value={animatedInProgress}
        comparisonLabel={`今日新建 ${todayCreated} · 昨日 ${yesterdayCreated}`}
        sparklineData={last7DaysCreatedTasks}
        tone="progress"
        href="/tasks"
        icon={<CheckSquare className="w-6 h-6 text-profit" />}
      />

      {/* 任务完成 */}
      <KPICard
        title="任务完成"
        value={animatedGoalRate}
        suffix="%"
        comparisonLabel={`今日完成 ${todayCompleted} · 昨日 ${yesterdayCompleted}`}
        sparklineData={last7DaysCompletedTasks}
        tone="growth"
        href="/tasks"
        icon={<Target className="w-6 h-6 text-primary" />}
      />

      {/* 现金余额 */}
      <KPICard
        title="现金余额"
        value={`¥${animatedAssets.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        trend={(() => {
          if (last7DaysNet.length < 2) return undefined
          const first = last7DaysNet[0]
          const last = last7DaysNet[last7DaysNet.length - 1]
          if (last > first) return 'up' as const
          if (last < first) return 'down' as const
          return 'flat' as const
        })()}
        sparklineData={last7DaysNet}
        comparisonLabel={`今日净流 ${todayNet >= 0 ? '+' : ''}¥${todayNet.toLocaleString()} · 昨日 ${yesterdayNet >= 0 ? '+' : ''}¥${yesterdayNet.toLocaleString()}`}
        tone={todayNet < 0 ? 'risk' : 'pending'}
        href="/finance"
        icon={<Wallet className="w-6 h-6 text-amber-500" />}
      />

      <KPICard
        title="当前风险"
        value={overdueCount + lowStockCount}
        comparisonLabel={`逾期 ${overdueCount} · 低库存 ${lowStockCount}`}
        tone={overdueCount + lowStockCount > 0 ? 'risk' : 'growth'}
        href={overdueCount > 0 ? '/tasks' : '/asset-center?view=inventory'}
        icon={<AlertTriangle className="w-6 h-6 text-expense" />}
      />
    </div>
  )
}
