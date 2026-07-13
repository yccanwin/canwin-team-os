import { useMemo, memo } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardList, Landmark, PackageCheck, Sparkles } from 'lucide-react'
import { useFinanceStore } from '@/stores/useFinanceStore'
import { useInventoryStore } from '@/stores/useInventoryStore'
import { useTaskStore } from '@/stores/useTaskStore'
import { useTimelineStore } from '@/stores/useTimelineStore'
import { useVoteStore } from '@/stores/useVoteStore'

const SurvivalStatusSection = memo(function SurvivalStatusSection() {
  const records = useFinanceStore((s) => s.records)
  const items = useInventoryStore((s) => s.items)
  const tasks = useTaskStore((s) => s.tasks)
  const timelineEvents = useTimelineStore((s) => s.events)
  const votes = useVoteStore((s) => s.votes)

  const stats = useMemo(() => {
    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    // 本月收入/支出
    const monthIncome = records
      .filter((r) => r.type === 'income' && r.date.startsWith(thisMonth))
      .reduce((sum, r) => sum + r.amount, 0)
    const monthExpense = records
      .filter((r) => r.type === 'expense' && r.date.startsWith(thisMonth))
      .reduce((sum, r) => sum + r.amount, 0)
    const netCashFlow = monthIncome - monthExpense

    // 现金余额
    const totalIncome = records
      .filter((r) => r.type === 'income')
      .reduce((sum, r) => sum + r.amount, 0)
    const totalExpense = records
      .filter((r) => r.type === 'expense')
      .reduce((sum, r) => sum + r.amount, 0)
    const cashBalance = totalIncome - totalExpense

    // 可持续月数
    const sustainMonths = netCashFlow < 0 && netCashFlow !== 0
      ? Math.floor(cashBalance / Math.abs(netCashFlow))
      : Infinity

    const lowStockCount = items.filter((i) => i.quantity <= 10).length
    const openTasks = tasks.filter((task) => task.status !== 'done').length
    const doneTasks = tasks.filter((task) => task.status === 'done').length
    const activeVotes = votes.filter((vote) => vote.isActive).length
    const monthMemoryCount = timelineEvents.filter((event) => event.date.startsWith(thisMonth)).length

    const healthScore = [
      netCashFlow >= 0,
      lowStockCount === 0,
      openTasks <= Math.max(doneTasks + 3, 5),
      monthMemoryCount > 0,
      activeVotes > 0 || votes.length > 0,
    ].filter(Boolean).length

    const phase =
      healthScore >= 5 ? '成熟期'
        : healthScore >= 4 ? '增长期'
          : healthScore >= 3 ? '透明期'
            : healthScore >= 2 ? '稳定期'
              : '起步期'

    const status =
      healthScore >= 4 ? '稳定运转'
        : healthScore >= 3 ? '持续推进'
          : '需要关注'

    const highlights = [
      doneTasks > 0 ? `已完成 ${doneTasks} 项任务` : '',
      monthMemoryCount > 0 ? `本月新增 ${monthMemoryCount} 条团队记录` : '',
      votes.length > 0 ? `已有 ${votes.length} 次团队决策` : '',
    ].filter(Boolean)

    const risks = [
      netCashFlow < 0 ? '本月现金流为负' : '',
      lowStockCount > 0 ? `${lowStockCount} 项库存偏低` : '',
      openTasks > Math.max(doneTasks + 3, 5) ? '待推进任务偏多' : '',
      monthMemoryCount === 0 ? '本月团队记录偏少' : '',
    ].filter(Boolean)

    return { netCashFlow, cashBalance, sustainMonths, lowStockCount, openTasks, monthMemoryCount, votesCount: votes.length, healthScore, phase, status, highlights, risks }
  }, [records, items, tasks, timelineEvents, votes])

  const isProfitable = stats.netCashFlow >= 0

  return (
    <section className="bg-white rounded-card shadow-card p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium text-emerald-700">团队健康度</p>
          <h3 className="mt-1 font-heading text-lg font-semibold text-brand-400">{stats.status}</h3>
        </div>
        <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          成长阶段：{stats.phase}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="flex items-start gap-3 rounded-lg bg-brand-50 p-3">
          <Landmark className={`w-5 h-5 mt-0.5 flex-shrink-0 ${isProfitable ? 'text-income' : 'text-expense'}`} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-brand-300 mb-0.5">本月现金流</p>
            <p className={`text-lg font-bold break-all ${isProfitable ? 'text-income' : 'text-expense'}`}>
              {isProfitable ? '+' : ''}¥{stats.netCashFlow.toLocaleString()}
            </p>
            <p className="text-xs text-brand-200 mt-1 break-words">
              {stats.sustainMonths === Infinity ? '现金流稳定' : `可维持 ${stats.sustainMonths} 个月`}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg bg-brand-50 p-3">
          <AlertTriangle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${stats.lowStockCount > 0 ? 'text-expense' : 'text-income'}`} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-brand-300 mb-0.5">库存预警</p>
            <p className={`text-lg font-bold ${stats.lowStockCount > 0 ? 'text-expense' : 'text-income'}`}>
              {stats.lowStockCount}
            </p>
            <p className="text-xs text-brand-200 mt-1 break-words">
              低库存项
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg bg-brand-50 p-3">
          <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-brand-300 mb-0.5">任务推进</p>
            <p className="text-lg font-bold text-brand-400">{stats.openTasks}</p>
            <p className="mt-1 text-xs text-brand-200">待处理任务</p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg bg-brand-50 p-3">
          <PackageCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-brand-300 mb-0.5">记录透明</p>
            <p className="text-lg font-bold text-brand-400">{stats.monthMemoryCount}</p>
            <p className="mt-1 text-xs text-brand-200">本月团队记录</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            本月亮点
          </div>
          <p className="text-sm leading-6 text-brand-300">
            {stats.highlights.length ? stats.highlights.join(' / ') : '等待更多团队记录沉淀'}
          </p>
        </div>
        <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-700">
            <Sparkles className="h-4 w-4" />
            当前关注
          </div>
          <p className="text-sm leading-6 text-brand-300">
            {stats.risks.length ? stats.risks.join(' / ') : '现金流、库存、任务和记录都在正常范围'}
          </p>
        </div>
      </div>
    </section>
  )
})

export { SurvivalStatusSection }
export default SurvivalStatusSection
