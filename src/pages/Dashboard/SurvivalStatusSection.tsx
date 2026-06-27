import { useMemo, memo } from 'react'
import { TrendingUp, AlertTriangle } from 'lucide-react'
import { useFinanceStore } from '@/stores/useFinanceStore'
import { useInventoryStore } from '@/stores/useInventoryStore'
import { getToday } from '@/utils/dateUtils'

const SurvivalStatusSection = memo(function SurvivalStatusSection() {
  const records = useFinanceStore((s) => s.records)
  const items = useInventoryStore((s) => s.items)

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

    // 库存预警（quantity <= 10 视为低库存）
    const lowStockCount = items.filter((i) => i.quantity <= 10).length

    return { netCashFlow, cashBalance, sustainMonths, lowStockCount }
  }, [records, items])

  const isProfitable = stats.netCashFlow >= 0

  return (
    <section className="bg-white rounded-card shadow-card p-5">
      <h3 className="font-heading text-lg font-semibold text-brand-400 mb-4">团队生存状态</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 现金流 */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-brand-50">
          <TrendingUp className={`w-5 h-5 mt-0.5 flex-shrink-0 ${isProfitable ? 'text-income' : 'text-expense'}`} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-brand-300 mb-0.5">本月现金流</p>
            <p className={`text-lg font-bold break-all ${isProfitable ? 'text-income' : 'text-expense'}`}>
              {isProfitable ? '+' : ''}¥{stats.netCashFlow.toLocaleString()}
            </p>
            <p className="text-xs text-brand-200 mt-1 break-words">
              {isProfitable ? '🟢 盈利中' : '🔴 亏损中'}
              <span className="ml-2">
                {stats.sustainMonths === Infinity
                  ? '∞ 可持续'
                  : `可维持 ${stats.sustainMonths} 个月`}
              </span>
            </p>
          </div>
        </div>

        {/* 库存预警 */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-brand-50">
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
      </div>
    </section>
  )
})

export { SurvivalStatusSection }
export default SurvivalStatusSection
