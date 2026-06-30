import { useMemo } from 'react'
import { KPICard } from '@/components/KPICard'
import { DollarSign, CheckSquare, Target, Wallet, HeartPulse } from 'lucide-react'
import { useTaskStore } from '@/stores/useTaskStore'
import { useFinanceStore } from '@/stores/useFinanceStore'
import { useCountUp } from '@/hooks/useCountUp'


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
    if (lastMonthIncome === 0) return 0
    return Math.round(((thisMonthIncome - lastMonthIncome) / lastMonthIncome) * 100)
  }, [thisMonthIncome, lastMonthIncome])
  const revenueTrend: 'up' | 'down' | 'flat' =
    momChange > 0 ? 'up' : momChange < 0 ? 'down' : 'flat'

  const teamState = inProgressCount > 8 ? '偏忙' : goalRate >= 70 ? '稳定' : '推进中'

  // —— 7 日迷你趋势数据 ——
  const last7Days = useMemo(() => {
    const days: string[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      days.push(d.toISOString().slice(0, 10))
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
      {/* 本月营收 */}
      <KPICard
        title="本月营收"
        value={`¥${animatedIncome.toLocaleString()}`}
        trend={revenueTrend}
        trendLabel={`环比 ${momChange >= 0 ? '+' : ''}${momChange}%`}
        sparklineData={last7DaysIncome}
        color="#10B981"
        icon={<DollarSign className="w-6 h-6 text-income" />}
      />

      {/* 进行中任务 */}
      <KPICard
        title="进行中任务"
        value={animatedInProgress}
        color="#3B82F6"
        icon={<CheckSquare className="w-6 h-6 text-profit" />}
      />

      {/* 目标达成率 */}
      <KPICard
        title="目标达成率"
        value={animatedGoalRate}
        suffix="%"
        color="#6366F1"
        icon={<Target className="w-6 h-6 text-primary" />}
      />

      {/* 总资产 = 实时现金 */}
      <KPICard
        title="总资产"
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
        color="#F59E0B"
        icon={<Wallet className="w-6 h-6 text-amber-500" />}
      />

      <KPICard
        title="团队状态"
        value={teamState}
        color="#8B5CF6"
        icon={<HeartPulse className="w-6 h-6 text-cash" />}
      />
    </div>
  )
}
