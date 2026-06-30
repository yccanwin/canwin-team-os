import { useState, useMemo } from 'react'
import { Wallet, Award, AlertCircle } from 'lucide-react'
import { useUserStore } from '@/stores/useUserStore'
import { useFinanceStore } from '@/stores/useFinanceStore'
import { isCaptainRole } from '@/services/profile'
import type { FinanceRecord, User } from '@/types'

// ─── 主组件 ─────────────────────────────────────────────────

export default function ContributionStats() {
  // ✅ 独立 selector（避免对象解构 selector 产生新引用）
  const currentUser = useUserStore((s) => s.currentUser)
  const rawUsers = useUserStore((s) => s.users)
  const rawRecords = useFinanceStore((s) => s.records)

  // 🔒 防御式：确保 users / records 一定是数组（store persist 数据可能损坏）
  const users: User[] = Array.isArray(rawUsers) ? rawUsers : []
  const records: FinanceRecord[] = Array.isArray(rawRecords) ? rawRecords : []

  // Store 完全损坏
  if (!currentUser || !currentUser.id) {
    return (
      <div className="bg-white rounded-card shadow-card p-8 text-center">
        <AlertCircle className="w-8 h-8 text-red-300 mx-auto mb-2" />
        <p className="text-sm text-brand-300">用户信息加载失败，请刷新页面重试</p>
      </div>
    )
  }

  const isCaptain = isCaptainRole(currentUser.role)
  const [selectedUserId, setSelectedUserId] = useState<string>(currentUser.id)

  // 当前月份 YYYY-MM
  const yearMonth = (() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })()

  // ✅ 纯计算——绝不调用 store 的 set 方法
  const stats = useMemo(() => {
    const targetUserId = isCaptain ? selectedUserId : currentUser.id

    const salaryRecords = records.filter(
      (r) => r.userId === targetUserId && r.category === '工资'
    )
    const dividendRecords = records.filter(
      (r) => r.userId === targetUserId && r.category === '分红'
    )

    const monthSalary = salaryRecords
      .filter((r) => r.date?.startsWith(yearMonth))
      .reduce((sum, r) => sum + (r.amount ?? 0), 0)

    const totalSalary = salaryRecords.reduce(
      (sum, r) => sum + (r.amount ?? 0),
      0
    )

    const monthDividend = dividendRecords
      .filter((r) => r.date?.startsWith(yearMonth))
      .reduce((sum, r) => sum + (r.amount ?? 0), 0)

    const totalDividend = dividendRecords.reduce(
      (sum, r) => sum + (r.amount ?? 0),
      0
    )

    return { monthSalary, totalSalary, monthDividend, totalDividend }
  }, [records, currentUser.id, isCaptain, selectedUserId, yearMonth])

  const hasData =
    stats.monthSalary > 0 ||
    stats.totalSalary > 0 ||
    stats.monthDividend > 0 ||
    stats.totalDividend > 0

  // 候选项列表（防御）
  const memberOptions = users.filter((u) => u.id && u.name)

  return (
    <div className="space-y-4">
      {/* ── 成员切换器（仅队长可见） ── */}
      {isCaptain && memberOptions.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-brand-300 flex-shrink-0">查看成员：</span>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white
                       focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
          >
            {memberOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── 工资分红 4 卡片 ── */}
      {hasData ? (
        <div className="grid grid-cols-2 gap-4">
          <ContributionCard
            label="本月工资"
            amount={stats.monthSalary}
            color="#10B981"
            icon={<Wallet className="w-5 h-5" />}
          />
          <ContributionCard
            label="累计工资"
            amount={stats.totalSalary}
            color="#3B82F6"
            icon={<Wallet className="w-5 h-5" />}
          />
          <ContributionCard
            label="本月分红"
            amount={stats.monthDividend}
            color="#8B5CF6"
            icon={<Award className="w-5 h-5" />}
          />
          <ContributionCard
            label="累计分红"
            amount={stats.totalDividend}
            color="#F59E0B"
            icon={<Award className="w-5 h-5" />}
          />
        </div>
      ) : (
        <div className="bg-white rounded-card shadow-card p-6 text-center">
          <Wallet className="w-8 h-8 text-neutral-tertiary mx-auto mb-2" />
          <p className="text-sm text-brand-200">
            {isCaptain
              ? '该成员暂无工资/分红记录'
              : '暂无工资/分红记录'}
          </p>
          <p className="text-xs text-neutral-tertiary mt-1">
            队长可在财务模块中为成员添加工资和分红
          </p>
        </div>
      )}
    </div>
  )
}

// ─── 卡片子组件（纯展示） ──────────────────────────────────

function ContributionCard({
  label,
  amount,
  color,
  icon,
}: {
  label: string
  amount: number
  color: string
  icon: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-card shadow-card p-4 flex items-center gap-3">
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${color}15`, color }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-brand-300 mb-0.5">{label}</p>
        <p className="text-lg font-bold text-brand-400 truncate">
          ¥{(amount ?? 0).toLocaleString()}
        </p>
      </div>
    </div>
  )
}
