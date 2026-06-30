import { useState, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { useUserStore } from '@/stores/useUserStore'
import { useBadgeStore } from '@/stores/useBadgeStore'
import { useFinanceStore } from '@/stores/useFinanceStore'
import { useGoalStore } from '@/stores/useGoalStore'
import { useTaskStore } from '@/stores/useTaskStore'
import { useVoteStore } from '@/stores/useVoteStore'
import { useInventoryStore } from '@/stores/useInventoryStore'
import { useActivityStore } from '@/stores/useActivityStore'
import { useTeamStore } from '@/stores/useTeamStore'
import { isSupabaseConfigured } from '@/lib/supabase'
import { isCaptainRole, roleLabel } from '@/services/profile'
import { formatDate } from '@/utils/dateUtils'
import BadgeFormModal from './BadgeFormModal'
import GoalEditModal from '@/pages/Goals/GoalEditModal'
import MemberFormModal from './MemberFormModal'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { BadgeConfig, FinanceRecord, Goal } from '@/types'

type TabKey = 'badges' | 'finance' | 'goals' | 'members' | 'system'

const tabs: { key: TabKey; label: string }[] = [
  { key: 'badges', label: '勋章配置' },
  { key: 'finance', label: '财务录入' },
  { key: 'goals', label: '目标管理' },
  { key: 'members', label: '团队成员' },
  { key: 'system', label: '系统维护' },
]

export default function SettingsPage() {
  const currentUser = useUserStore((s) => s.currentUser)
  const isCaptain = isCaptainRole(currentUser.role)

  const [activeTab, setActiveTab] = useState<TabKey>('badges')

  // 密码门状态
  const [isPasswordVerified, setIsPasswordVerified] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState('')

  // 路由守卫
  if (!isCaptain) {
    return <Navigate to="/" replace />
  }

  // 密码验证
  const handlePasswordSubmit = () => {
    if (passwordInput === '9527') {
      setIsPasswordVerified(true)
      setPasswordError('')
    } else {
      setPasswordError('密码错误，请重试')
      setPasswordInput('')
    }
  }

  // 密码门
  if (!isPasswordVerified) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-card shadow-card p-8 w-full max-w-sm text-center">
          <div className="text-3xl mb-3">🔒</div>
          <h1 className="font-heading text-lg font-semibold text-brand-400 mb-2">设置中心</h1>
          <p className="text-sm text-brand-300 mb-5">请输入 4 位数字密码进入</p>
          <div className="mb-4">
            <input
              type="password"
              maxLength={4}
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value)
                setPasswordError('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePasswordSubmit()
              }}
              placeholder="••••"
              className="w-32 text-center text-2xl tracking-[0.5em] px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              autoFocus
            />
          </div>
          {passwordError && (
            <p className="text-sm text-expense mb-3">{passwordError}</p>
          )}
          <button
            onClick={handlePasswordSubmit}
            disabled={passwordInput.length !== 4}
            className="w-full px-6 py-2.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            确认
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-3 lg:px-6 py-4">
      <h1 className="font-heading text-lg font-semibold text-brand-400 mb-6">设置中心</h1>

      {/* Tab 导航 */}
      <div className="flex border-b border-brand-100 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
              activeTab === tab.key
                ? 'text-primary'
                : 'text-brand-300 hover:text-brand-400'
            }`}
          >
            {tab.label}
            {activeTab === tab.key && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div>
        {activeTab === 'badges' && <BadgeConfigTab />}
        {activeTab === 'finance' && <FinanceEntryTab />}
        {activeTab === 'goals' && <GoalManagementTab />}
        {activeTab === 'members' && <MemberManagementTab />}
        {activeTab === 'system' && <SystemMaintenanceTab />}
      </div>
    </div>
  )
}

// ============================================================
// Tab 1: 勋章配置
// ============================================================

function BadgeConfigTab() {
  const badges = useBadgeStore((s) => s.badges)
  const deleteBadge = useBadgeStore((s) => s.deleteBadge)

  const [editingBadge, setEditingBadge] = useState<BadgeConfig | null>(null)
  const [newBadgeOpen, setNewBadgeOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BadgeConfig | null>(null)

  const triggerTypeLabels: Record<string, string> = {
    task_count: '完成任务数',
    login_streak: '连续登录',
    metric: '业务指标',
    custom: '自定义',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading text-base font-semibold text-brand-400">勋章配置</h2>
        <button
          onClick={() => setNewBadgeOpen(true)}
          className="px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-indigo-600 transition-colors"
        >
          新增勋章
        </button>
      </div>

      {/* 勋章列表 */}
      <div className="bg-white rounded-card shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-100 bg-brand-50">
                <th className="text-left px-4 py-3 font-medium text-brand-400">名称</th>
                <th className="text-left px-4 py-3 font-medium text-brand-400">图标</th>
                <th className="text-left px-4 py-3 font-medium text-brand-400">描述</th>
                <th className="text-left px-4 py-3 font-medium text-brand-400">触发类型</th>
                <th className="text-right px-4 py-3 font-medium text-brand-400">XP奖励</th>
                <th className="text-left px-4 py-3 font-medium text-brand-400">分类</th>
                <th className="text-center px-4 py-3 font-medium text-brand-400">操作</th>
              </tr>
            </thead>
            <tbody>
              {badges.map((badge) => (
                <tr
                  key={badge.id}
                  className="border-b border-gray-100 hover:bg-brand-50"
                  style={{ height: '48px' }}
                >
                  <td className="px-4 py-2.5 font-medium text-brand-400">
                    {badge.name}
                  </td>
                  <td className="px-4 py-2.5 text-lg">{badge.icon}</td>
                  <td className="px-4 py-2.5 text-brand-400 max-w-[200px] truncate">
                    {badge.description}
                  </td>
                  <td className="px-4 py-2.5 text-brand-400">
                    {triggerTypeLabels[badge.triggerType] || badge.triggerType}
                  </td>
                  <td className="px-4 py-2.5 text-right text-brand-400">
                    +{badge.xpReward} XP
                  </td>
                  <td className="px-4 py-2.5 text-brand-400">
                    {badge.category === 'basic'
                      ? '基础'
                      : badge.category === 'business'
                        ? '业务'
                        : '行为'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setEditingBadge(badge)}
                        className="px-2 py-1 text-xs text-primary hover:bg-indigo-50 rounded transition-colors"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => setDeleteTarget(badge)}
                        className="px-2 py-1 text-xs text-expense hover:bg-red-50 rounded transition-colors"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {badges.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-brand-200">
                    暂无勋章配置
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增弹窗 */}
      {newBadgeOpen && (
        <BadgeFormModal
          isOpen={newBadgeOpen}
          onClose={() => setNewBadgeOpen(false)}
        />
      )}

      {/* 编辑弹窗 */}
      {editingBadge && (
        <BadgeFormModal
          isOpen={!!editingBadge}
          onClose={() => setEditingBadge(null)}
          badge={editingBadge}
        />
      )}

      {/* 删除确认 */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onConfirm={() => {
          if (deleteTarget) {
            deleteBadge(deleteTarget.id)
            setDeleteTarget(null)
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        title="删除勋章"
        message={`确定要删除勋章「${deleteTarget?.name}」吗？此操作不可撤销。`}
        variant="danger"
      />
    </div>
  )
}

// ============================================================
// Tab 2: 财务录入
// ============================================================

function FinanceEntryTab() {
  const records = useFinanceStore((s) => s.records)
  const addRecord = useFinanceStore((s) => s.addRecord)
  const deleteRecord = useFinanceStore((s) => s.deleteRecord)
  const currentUser = useUserStore((s) => s.currentUser)
  const users = useUserStore((s) => s.users)
  const isCaptain = isCaptainRole(currentUser.role)

  // 表单
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [type, setType] = useState<'income' | 'expense'>('income')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [note, setNote] = useState('')
  const [recordUserId, setRecordUserId] = useState('')

  // 错误 & 状态
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [successMsg, setSuccessMsg] = useState('')

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<FinanceRecord | null>(null)

  // 月份筛选
  const [monthFilter, setMonthFilter] = useState('all')

  // 类别下拉选项
  const incomeCategories = ['销售收入', '其他收入', '工资', '分红']
  const expenseCategories = ['采购成本', '物流成本', '工资支出', '运营支出', '其他支出', '工资', '分红']

  const categories = type === 'income' ? incomeCategories : expenseCategories

  // 最近 50 条（支持月份筛选）
  const recentRecords = useMemo(() => {
    const filtered = monthFilter === 'all'
      ? records
      : records.filter((r) => r.date.startsWith(monthFilter))
    return [...filtered]
      .sort(
        (a, b) =>
          new Date(b.date).getTime() - new Date(a.date).getTime() ||
          records.indexOf(b) - records.indexOf(a)
      )
      .slice(0, 50)
  }, [records, monthFilter])

  // 从记录中提取可用月份
  const availableMonths = useMemo(() => {
    const months = new Set<string>()
    records.forEach((r) => months.add(r.date.slice(0, 7)))
    return Array.from(months).sort().reverse()
  }, [records])

  // 验证
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!date) newErrors.date = '日期不能为空'
    const amt = Number(amount)
    if (!amount || isNaN(amt) || amt <= 0) newErrors.amount = '金额必须大于0'
    if (!category) newErrors.category = '请选择类别'
    if ((category === '工资' || category === '分红') && !recordUserId) {
      newErrors.recordUserId = '请选择归属成员'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // 提交
  const handleSubmit = () => {
    if (!validate()) return
    addRecord({
      type,
      amount: Number(amount),
      date,
      category,
      note: note.trim() || undefined,
      createdBy: currentUser.id,
      ...(recordUserId && { userId: recordUserId }),
    })

    // 重置表单
    setAmount('')
    setCategory('')
    setNote('')
    setRecordUserId('')
    setSuccessMsg('录入成功')

    setTimeout(() => setSuccessMsg(''), 2000)
  }

  return (
    <div>
      <h2 className="font-heading text-base font-semibold text-brand-400 mb-4">财务录入</h2>

      {/* 录入表单 */}
      <div className="bg-white rounded-card shadow-card p-5 mb-6">
        <div className="space-y-4">
          {/* 日期 + 类型 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-brand-400 mb-1">
                日期 <span className="text-expense">*</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                  errors.date ? 'border-expense' : 'border-gray-300'
                }`}
              />
              {errors.date && (
                <p className="text-xs text-expense mt-1">{errors.date}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-400 mb-1">
                类型 <span className="text-expense">*</span>
              </label>
              <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    setType('income')
                    setCategory('')
                  }}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    type === 'income'
                      ? 'bg-[#10B981] text-white'
                      : 'bg-white text-brand-400 hover:bg-brand-50'
                  }`}
                >
                  收入
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setType('expense')
                    setCategory('')
                  }}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    type === 'expense'
                      ? 'bg-[#EF4444] text-white'
                      : 'bg-white text-brand-400 hover:bg-brand-50'
                  }`}
                >
                  支出
                </button>
              </div>
            </div>
          </div>

          {/* 金额 + 类别 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-brand-400 mb-1">
                金额 <span className="text-expense">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-200 text-sm">
                  ¥
                </span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  min={0}
                  step="0.01"
                  className={`w-full pl-7 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                    errors.amount ? 'border-expense' : 'border-gray-300'
                  }`}
                />
              </div>
              {errors.amount && (
                <p className="text-xs text-expense mt-1">{errors.amount}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-400 mb-1">
                类别 <span className="text-expense">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                  errors.category ? 'border-expense' : 'border-gray-300'
                }`}
              >
                <option value="">请选择类别</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {errors.category && (
                <p className="text-xs text-expense mt-1">
                  {errors.category}
                </p>
              )}
            </div>
          </div>

          {/* 归属成员（工资/分红时显示） */}
          {(category === '工资' || category === '分红') && (
            <div>
              <label className="block text-sm font-medium text-brand-400 mb-1">
                归属成员 <span className="text-expense">*</span>
              </label>
              <select
                value={recordUserId}
                onChange={(e) => setRecordUserId(e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                  errors.recordUserId ? 'border-expense' : 'border-gray-300'
                }`}
              >
                <option value="">请选择成员</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              {errors.recordUserId && (
                <p className="text-xs text-expense mt-1">{errors.recordUserId}</p>
              )}
            </div>
          )}

          {/* 备注 */}
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              备注
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="选填"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {/* 确认按钮 + 成功提示 */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSubmit}
              className="px-6 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-indigo-600 transition-colors"
            >
              确认录入
            </button>
            {successMsg && (
              <span className="text-sm text-[#10B981] font-medium">
                {successMsg}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 最近录入历史 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-heading text-sm font-semibold text-brand-400">
            最近录入（最近 {recentRecords.length} 条）
          </h3>
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          >
            <option value="all">全部月份</option>
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="bg-white rounded-card shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-100 bg-brand-50">
                  <th className="text-left px-4 py-2.5 font-medium text-brand-400 text-xs">
                    日期
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-brand-400 text-xs">
                    类型
                  </th>
                  <th className="text-right px-4 py-2.5 font-medium text-brand-400 text-xs">
                    金额
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-brand-400 text-xs">
                    类别
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-brand-400 text-xs">
                    备注
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-brand-400 text-xs">
                    录入人
                  </th>
                  {isCaptain && (
                    <th className="text-center px-4 py-2.5 font-medium text-brand-400 text-xs">
                      操作
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {recentRecords.map((record) => {
                  const operator = useUserStore
                    .getState()
                    .users.find((u) => u.id === record.createdBy)
                  return (
                    <tr
                      key={record.id}
                      className="border-b border-gray-100"
                    >
                      <td className="px-4 py-2.5 text-brand-300 text-xs">
                        {record.date}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                            record.type === 'income'
                              ? 'bg-[#D1FAE5] text-[#065F46]'
                              : 'bg-[#FEE2E2] text-[#991B1B]'
                          }`}
                        >
                          {record.type === 'income' ? '收入' : '支出'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-brand-400">
                        ¥{record.amount.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-brand-400">
                        {record.category}
                      </td>
                      <td className="px-4 py-2.5 text-brand-300 truncate max-w-[120px]">
                        {record.note || '-'}
                      </td>
                      <td className="px-4 py-2.5 text-brand-300">
                        {operator?.name || record.createdBy}
                      </td>
                      {isCaptain && (
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-center">
                            <button
                              onClick={() => setDeleteTarget(record)}
                              className="px-2 py-1 text-xs text-expense hover:bg-red-50 rounded transition-colors"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {recentRecords.length === 0 && (
                  <tr>
                    <td
                      colSpan={isCaptain ? 7 : 6}
                      className="px-4 py-8 text-center text-brand-200"
                    >
                      暂无财务记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 删除确认 */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onConfirm={() => {
          if (deleteTarget) {
            deleteRecord(deleteTarget.id)
            setDeleteTarget(null)
          }
        }}
        onCancel={() => setDeleteTarget(null)}
        title="删除财务记录"
        message="确定要删除这条财务记录吗？"
        variant="danger"
      />
    </div>
  )
}

// ============================================================
// Tab 3: 目标管理
// ============================================================

function GoalManagementTab() {
  const goals = useGoalStore((s) => s.goals)
  const unlockNextPhase = useGoalStore((s) => s.unlockNextPhase)
  const disablePhase = useGoalStore((s) => s.disablePhase)
  const addGoal = useGoalStore((s) => s.addGoal)

  const [editingGoal, setEditingGoal] = useState<(typeof goals)[0] | null>(null)
  const [newGoalOpen, setNewGoalOpen] = useState(false)

  const sortedGoals = useMemo(() => {
    return [...goals].sort((a, b) => b.priority - a.priority)
  }, [goals])

  const statusLabels: Record<string, string> = {
    enabled: '待开始',
    in_progress: '进行中',
    completed: '已完成',
    locked: '未解锁',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading text-base font-semibold text-brand-400">目标管理</h2>
        <button
          onClick={() => setNewGoalOpen(true)}
          className="px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-indigo-600 transition-colors"
        >
          新增目标
        </button>
      </div>

      <div className="bg-white rounded-card shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-100 bg-brand-50">
                <th className="text-left px-4 py-3 font-medium text-brand-400">名称</th>
                <th className="text-right px-4 py-3 font-medium text-brand-400">目标金额</th>
                <th className="text-right px-4 py-3 font-medium text-brand-400">当前金额</th>
                <th className="text-center px-4 py-3 font-medium text-brand-400">优先级</th>
                <th className="text-left px-4 py-3 font-medium text-brand-400">状态</th>
                <th className="text-center px-4 py-3 font-medium text-brand-400">操作</th>
              </tr>
            </thead>
            <tbody>
              {sortedGoals.map((goal) => (
                <tr
                  key={goal.id}
                  className="border-b border-gray-100 hover:bg-brand-50"
                  style={{ height: '48px' }}
                >
                  <td className="px-4 py-2.5 font-medium text-brand-400">
                    {goal.title}
                  </td>
                  <td className="px-4 py-2.5 text-right text-brand-400">
                    ¥{goal.targetAmount.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-brand-400">
                    ¥{goal.currentAmount.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {'★'.repeat(goal.priority)}
                    {'☆'.repeat(5 - goal.priority)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                        goal.status === 'in_progress'
                          ? 'bg-[#EEF2FF] text-primary'
                          : goal.status === 'completed'
                            ? 'bg-[#D1FAE5] text-[#065F46]'
                            : goal.status === 'enabled'
                              ? 'bg-[#DBEAFE] text-[#1E40AF]'
                              : 'bg-gray-100 text-brand-300'
                      }`}
                    >
                      {statusLabels[goal.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setEditingGoal(goal)}
                        className="px-2 py-1 text-xs text-primary hover:bg-indigo-50 rounded transition-colors"
                      >
                        编辑
                      </button>
                      {goal.status === 'enabled' && (
                        <button
                          onClick={() => unlockNextPhase()}
                          className="px-2 py-1 text-xs text-[#10B981] hover:bg-green-50 rounded transition-colors"
                        >
                          启用
                        </button>
                      )}
                      {goal.status === 'enabled' && (
                        <button
                          onClick={() => disablePhase(goal.id)}
                          className="px-2 py-1 text-xs text-expense hover:bg-red-50 rounded transition-colors"
                        >
                          禁用
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {sortedGoals.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-brand-200">
                    暂无目标
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 编辑弹窗 */}
      {editingGoal && (
        <GoalEditModal
          isOpen={!!editingGoal}
          onClose={() => setEditingGoal(null)}
          goal={editingGoal}
        />
      )}

      {/* 新增弹窗 */}
      {newGoalOpen && (
        <GoalEditModal
          isOpen={newGoalOpen}
          onClose={() => setNewGoalOpen(false)}
          goal={{
            id: '',
            title: '',
            targetAmount: 0,
            currentAmount: 0,
            priority: 3,
            status: 'enabled' as const,
            monthlyGrowth: undefined,
          }}
        />
      )}
    </div>
  )
}

// ============================================================
// Tab 4: 团队成员管理
// ============================================================

function MemberManagementTab() {
  const users = useUserStore((s) => s.users)
  const currentUser = useUserStore((s) => s.currentUser)
  const deleteUser = useUserStore((s) => s.deleteUser)
  const resetUserXP = useUserStore((s) => s.resetUserXP)

  const [editingMember, setEditingMember] = useState<(typeof users)[0] | null>(null)
  const [newMemberOpen, setNewMemberOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<(typeof users)[0] | null>(null)
  const [resetTarget, setResetTarget] = useState<(typeof users)[0] | null>(null)
  const [deleteError, setDeleteError] = useState('')

  const handleDelete = () => {
    if (!deleteTarget) return
    if (deleteTarget.id === currentUser.id) {
      setDeleteError('不能删除自己')
      return
    }
    const success = deleteUser(deleteTarget.id)
    if (!success) {
      setDeleteError('删除失败，不能删除当前登录用户')
    }
    setDeleteTarget(null)
    setDeleteError('')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading text-base font-semibold text-brand-400">团队成员管理</h2>
        <button
          onClick={() => setNewMemberOpen(true)}
          className="px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-indigo-600 transition-colors"
        >
          新增成员
        </button>
      </div>

      <div className="bg-white rounded-card shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-100 bg-brand-50">
                <th className="text-left px-4 py-3 font-medium text-brand-400">姓名</th>
                <th className="text-left px-4 py-3 font-medium text-brand-400">岗位</th>
                <th className="text-left px-4 py-3 font-medium text-brand-400">角色</th>
                <th className="text-left px-4 py-3 font-medium text-brand-400">入职时间</th>
                <th className="text-center px-4 py-3 font-medium text-brand-400">等级</th>
                <th className="text-center px-4 py-3 font-medium text-brand-400">XP</th>
                <th className="text-center px-4 py-3 font-medium text-brand-400">徽章</th>
                <th className="text-center px-4 py-3 font-medium text-brand-400">密码</th>
                <th className="text-center px-4 py-3 font-medium text-brand-400">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-gray-100 hover:bg-brand-50"
                  style={{ height: '48px' }}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {/* 头像 */}
                      {user.avatar ? (
                        <img
                          src={user.avatar}
                          alt={user.name}
                          className="w-7 h-7 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-xs font-semibold">
                          {user.name.charAt(0)}
                        </div>
                      )}
                      <span className="font-medium text-brand-400">
                        {user.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-brand-400">
                    {user.position}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                        isCaptainRole(user.role)
                          ? 'bg-[#EEF2FF] text-primary'
                          : 'bg-gray-100 text-[#6B7280]'
                      }`}
                    >
                      {roleLabel(user.role)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-brand-400">
                    {formatDate(user.joinDate)}
                  </td>
                  <td className="px-4 py-2.5 text-center text-brand-400">
                    Lv.{user.level}
                  </td>
                  <td className="px-4 py-2.5 text-center text-brand-400">
                    {user.xp.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-center text-brand-400">
                    {user.badges?.length || 0}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {user.switchPassword ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-xs font-medium">
                        🔒 已设
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 text-brand-400 rounded text-xs">
                        🔓 无
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setEditingMember(user)}
                        className="px-2 py-1 text-xs text-primary hover:bg-indigo-50 rounded transition-colors"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => setDeleteTarget(user)}
                        className="px-2 py-1 text-xs text-expense hover:bg-red-50 rounded transition-colors"
                      >
                        删除
                      </button>
                      <button
                        onClick={() => setResetTarget(user)}
                        className="px-2 py-1 text-xs text-yellow-600 hover:bg-yellow-50 rounded transition-colors"
                      >
                        重置XP
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增/编辑弹窗 */}
      {(editingMember || newMemberOpen) && (
        <MemberFormModal
          isOpen={!!(editingMember || newMemberOpen)}
          onClose={() => {
            setEditingMember(null)
            setNewMemberOpen(false)
          }}
          member={editingMember || undefined}
        />
      )}

      {/* 删除确认 */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onConfirm={handleDelete}
        onCancel={() => {
          setDeleteTarget(null)
          setDeleteError('')
        }}
        title="删除成员"
        message={
          deleteTarget?.id === currentUser.id
            ? '不能删除自己'
            : `确定要删除成员「${deleteTarget?.name}」吗？此操作不可撤销。`
        }
        variant="danger"
      />

      {/* 重置 XP 确认 */}
      <ConfirmDialog
        isOpen={!!resetTarget}
        onConfirm={() => {
          if (resetTarget) {
            resetUserXP(resetTarget.id)
            setResetTarget(null)
          }
        }}
        onCancel={() => setResetTarget(null)}
        title="重置 XP"
        message={`确定要重置「${resetTarget?.name}」的 XP 吗？所有 XP 和等级将被清零。`}
        variant="warning"
      />
    </div>
  )
}

// ============================================================
// Tab 5: 系统维护
// ============================================================

// 团队同步信息卡片
function TeamInfoCard() {
  const { teamId, teamName } = useTeamStore()
  const supabaseReady = isSupabaseConfigured()

  return (
    <div className="bg-white rounded-card shadow-card p-6 mb-4">
      <h3 className="font-heading text-sm font-semibold text-brand-400 mb-3">
        {supabaseReady ? '☁️ 固定团队云同步' : '🔧 本地模式'}
      </h3>

      <div className="space-y-3">
        <div className="bg-brand-50 rounded-lg px-4 py-3">
          <span className="text-xs text-brand-300">团队空间</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-brand-400">{teamName || '翻身小队'}</p>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-mono text-brand-300">
              {teamId}
            </span>
          </div>
        </div>

        {supabaseReady ? (
          <p className="text-xs text-green-600 bg-green-50 rounded-lg px-4 py-2">
            所有账号默认进入同一个团队空间，网页端和移动端共享这份云端数据。
          </p>
        ) : (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-4 py-2">
            未配置 Supabase，数据仅保存在本地浏览器。配置后启用云端同步。
          </p>
        )}
      </div>
    </div>
  )
}

// 所有持久化 store 的 localStorage key（用于备份/恢复）
const BACKUP_STORE_KEYS = [
  'canwin-team',
  'canwin-users',
  'canwin-tasks',
  'canwin-finance',
  'canwin-goals',
  'canwin-votes',
  'canwin-badges',
  'canwin-inventory',
  'canwin-activity',
  'canwin-assets',
  'canwin-achievements',
  'canwin-timeline',
  'canwin-photos',
  'canwin-toolbox',
  'canwin-warroom',
  'canwin-calendar',
]

const BACKUP_KEY = 'canwin-last-backup'

function readLastBackupTime(): string | null {
  try {
    return localStorage.getItem(BACKUP_KEY)
  } catch { return null }
}

function writeLastBackupTime() {
  const now = new Date().toISOString()
  try { localStorage.setItem(BACKUP_KEY, now) } catch { /* ignore */ }
}

function createBackup(): string {
  const stores: Record<string, string | null> = {}
  for (const key of BACKUP_STORE_KEYS) {
    try {
      stores[key] = localStorage.getItem(key)
    } catch {
      stores[key] = null
    }
  }
  const backup = {
    version: 1,
    app: 'CanWin Team OS',
    timestamp: new Date().toISOString(),
    stores,
  }
  return JSON.stringify(backup, null, 2)
}

function downloadBackup(json: string) {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `canwin-backup-${date}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function restoreBackup(json: string): { success: boolean; restored: number; error?: string; logs?: string[] } {
  const logs: string[] = []
  try {
    const backup = JSON.parse(json)
    logs.push(`[restoreBackup] 顶层 keys: ${Object.keys(backup).join(', ')}`)
    // 兼容两种格式：{version, app, timestamp, stores: {...}} 或直接 {canwin-xx: ...}
    const stores = backup.stores || backup
    logs.push(`[restoreBackup] stores 类型: ${typeof stores}, 是否数组: ${Array.isArray(stores)}`)
    if (!stores || typeof stores !== 'object' || Array.isArray(stores)) {
      return { success: false, restored: 0, error: '备份文件格式不正确', logs }
    }

    // 先清空所有目标 key，避免旧数据残留
    for (const key of BACKUP_STORE_KEYS) {
      try { localStorage.removeItem(key) } catch { /* ignore */ }
    }
    logs.push('[restoreBackup] 已清空现有目标 key')

    let restored = 0
    for (const key of BACKUP_STORE_KEYS) {
      const exists = key in stores
      const rawValue = stores[key]
      if (exists) {
        logs.push(`[restoreBackup] ${key}: 存在, 类型=${typeof rawValue}, 非空=${rawValue != null}`)
      }
      if (exists && rawValue != null) {
        const value =
          typeof rawValue === 'string'
            ? rawValue
            : JSON.stringify(rawValue)
        try {
          localStorage.setItem(key, value)
          restored++
          logs.push(`[restoreBackup] ${key}: 已写入 (长度 ${value.length})`)
        } catch (e) {
          logs.push(`[restoreBackup] ${key}: 写入失败 ${e}`)
        }
      }
    }

    if (restored === 0) {
      return { success: false, restored: 0, error: '备份文件中没有可用数据', logs }
    }

    writeLastBackupTime()
    logs.push(`[restoreBackup] 成功恢复 ${restored} 个 store`)
    return { success: true, restored, logs }
  } catch (err) {
    logs.push(`[restoreBackup] 异常: ${err}`)
    return { success: false, restored: 0, error: '备份文件解析失败，请检查文件是否完整', logs }
  }
}

function SystemMaintenanceTab() {
  const clearAllTasks = useTaskStore((s) => s.clearAllTasks)
  const clearAllRecords = useFinanceStore((s) => s.clearAllRecords)
  const clearAllGoals = useGoalStore((s) => s.clearAllGoals)
  const clearAllVotes = useVoteStore((s) => s.clearAllVotes)
  const clearAllBadges = useBadgeStore((s) => s.clearAllBadges)
  const clearAllItems = useInventoryStore((s) => s.clearAllItems)
  const clearAllActivities = useActivityStore((s) => s.clearAllActivities)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [backupStatus, setBackupStatus] = useState<'idle' | 'done'>('idle')
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restorePassword, setRestorePassword] = useState('')
  const [restoreError, setRestoreError] = useState('')
  const [restoreRestoring, setRestoreRestoring] = useState(false)
  const [restorePreview, setRestorePreview] = useState<string | null>(null)
  const [lastBackup, setLastBackup] = useState<string | null>(() => readLastBackupTime())

  const handleClearAll = () => {
    // ⚠️ 以下 7 个模块会被清理
    clearAllTasks()
    clearAllRecords()
    clearAllGoals()
    clearAllVotes()
    clearAllBadges()
    clearAllItems()
    clearAllActivities()
    // ❌ 永久保留，不参与清理：
    //    - useAchievementStore（案例馆）
    //    - useTimelineStore（编年史）
    //    - usePhotoStore（相册）
    setConfirmOpen(false)
    setSuccessMsg('演示数据已清空')
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  const handleBackup = () => {
    const json = createBackup()
    downloadBackup(json)
    writeLastBackupTime()
    setLastBackup(new Date().toISOString())
    setBackupStatus('done')
    setTimeout(() => setBackupStatus('idle'), 3000)
  }

  const handleRestoreConfirm = () => {
    if (restorePassword !== '9527') {
      setRestoreError('密码错误，请重试')
      setRestorePassword('')
      return
    }
    if (!restoreFile) {
      setRestoreError('请选择备份文件')
      return
    }
    setRestoreRestoring(true)
    setRestoreError('')

    const reader = new FileReader()
    reader.onload = (e) => {
      const result = restoreBackup(e.target?.result as string)
      // eslint-disable-next-line no-console
      result.logs?.forEach((log) => console.log(log))
      if (result.success) {
        // 稍等一下让 localStorage 写入完成（虽然 setItem 是同步的，但保险起见）
        setTimeout(() => {
          window.location.reload()
        }, 200)
      } else {
        setRestoreRestoring(false)
        setRestoreError(result.error || '恢复失败')
      }
    }
    reader.onerror = () => {
      setRestoreRestoring(false)
      setRestoreError('文件读取失败')
    }
    reader.readAsText(restoreFile)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    setRestoreFile(file)
    setRestoreError('')
    setRestorePassword('')
    setRestorePreview(null)

    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const backup = JSON.parse(ev.target?.result as string)
        const stores = backup.stores || backup
        const info: string[] = []
        if (backup.timestamp) {
          info.push(`备份时间：${formatBackupTime(backup.timestamp)}`)
        }
        if (stores && typeof stores === 'object' && !Array.isArray(stores)) {
          let count = 0
          for (const key of BACKUP_STORE_KEYS) {
            if (key in stores && stores[key] != null) count++
          }
          info.push(`包含 ${count} 个数据模块`)

          // 关键模块数量
          const tryCount = (key: string, path: string) => {
            try {
              const raw = stores[key]
              if (!raw) return null
              const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
              const parts = path.split('.')
              let v = parsed
              for (const p of parts) v = v?.[p]
              return Array.isArray(v) ? v.length : null
            } catch {
              return null
            }
          }
          const taskCount = tryCount('canwin-tasks', 'state.tasks')
          const userCount = tryCount('canwin-users', 'state.users')
          const financeCount = tryCount('canwin-finance', 'state.records')
          const goalCount = tryCount('canwin-goals', 'state.goals')
          if (userCount != null) info.push(`成员 ${userCount} 人`)
          if (taskCount != null) info.push(`任务 ${taskCount} 条`)
          if (financeCount != null) info.push(`财务记录 ${financeCount} 条`)
          if (goalCount != null) info.push(`目标 ${goalCount} 个`)
        }
        setRestorePreview(info.join(' · '))
      } catch {
        setRestorePreview('无法解析该备份文件')
      }
    }
    reader.readAsText(file)
  }

  const formatBackupTime = (iso: string) => {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div>
      <h2 className="font-heading text-base font-semibold text-brand-400 mb-4">系统维护</h2>

      {/* 团队同步信息 */}
      <TeamInfoCard />

      {/* 警告区域 */}
      <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <span className="text-yellow-500 text-lg mt-0.5">⚠️</span>
        <div>
          <p className="text-sm font-medium text-yellow-800 mb-1">危险操作区域</p>
          <p className="text-xs text-yellow-700">
            以下操作将清空业务数据，请谨慎使用。员工账号数据将保留。
          </p>
        </div>
      </div>

      {/* 一键清理按钮 */}
      <div className="bg-white rounded-card shadow-card p-6">
        <h3 className="font-heading text-sm font-semibold text-brand-400 mb-3">清理演示数据</h3>
        <p className="text-xs text-brand-300 mb-4">
          清空：任务、财务记录、目标、投票、勋章颁发记录、库存数据、团队动态。<br />
          保留：员工账号、<strong className="text-brand-400">案例馆</strong>、<strong className="text-brand-400">编年史</strong>、<strong className="text-brand-400">相册</strong>、工具箱、军机处、日历。
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setConfirmOpen(true)}
            className="px-5 py-2.5 text-sm font-medium text-expense border-2 border-expense rounded-lg hover:bg-red-50 transition-colors"
          >
            🧹 一键清理演示数据
          </button>
          {successMsg && (
            <span className="text-sm text-[#10B981] font-medium">{successMsg}</span>
          )}
        </div>
      </div>

      {/* 数据备份 */}
      <div className="bg-white rounded-card shadow-card p-6 mt-4">
        <h3 className="font-heading text-sm font-semibold text-brand-400 mb-3">
          💾 数据备份
        </h3>
        <p className="text-xs text-brand-300 mb-4">
          一键导出所有业务数据（包括案例馆、编年史、相册、工具箱、军机处等全量数据），保存为 JSON 文件。
        </p>
        {lastBackup && (
          <p className="text-xs text-brand-200 mb-3">
            上次备份时间：{formatBackupTime(lastBackup)}
          </p>
        )}
        <button
          onClick={handleBackup}
          className="px-5 py-2.5 text-sm font-medium text-primary border-2 border-primary rounded-lg hover:bg-indigo-50 transition-colors"
        >
          📥 一键备份
        </button>
        {backupStatus === 'done' && (
          <span className="ml-3 text-sm text-[#10B981] font-medium">备份完成，文件已下载</span>
        )}
      </div>

      {/* 数据恢复 */}
      <div className="bg-white rounded-card shadow-card p-6 mt-4">
        <h3 className="font-heading text-sm font-semibold text-brand-400 mb-3">
          🔄 数据恢复
        </h3>
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
          <span className="text-amber-500 text-sm mt-0.5">⚠️</span>
          <p className="text-xs text-amber-700">
            恢复将覆盖当前所有数据，并自动刷新页面。请确保已备份当前数据。
          </p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">选择备份文件</label>
            <input
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="w-full text-sm text-brand-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-brand-50 file:text-brand-400 hover:file:bg-brand-100 file:transition-colors"
            />
          </div>
          {restorePreview && (
            <p className="text-xs text-brand-300 bg-brand-50 rounded-lg px-3 py-2">
              备份摘要：{restorePreview}
            </p>
          )}
          {restoreFile && (
            <div>
              <label className="block text-sm font-medium text-brand-400 mb-1">请输入密码确认</label>
              <input
                type="password"
                maxLength={4}
                value={restorePassword}
                onChange={(e) => {
                  setRestorePassword(e.target.value)
                  setRestoreError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRestoreConfirm()
                }}
                placeholder="••••"
                className="w-24 text-center text-lg tracking-[0.5em] px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          )}
          {restoreError && (
            <p className="text-sm text-expense">{restoreError}</p>
          )}
          <button
            onClick={() => setRestoreConfirmOpen(true)}
            disabled={!restoreFile || restorePassword.length !== 4}
            className="px-5 py-2.5 text-sm font-medium text-amber-700 border-2 border-amber-400 rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            🔄 恢复到该备份
          </button>
        </div>
      </div>

      {/* 恢复确认弹窗 */}
      <ConfirmDialog
        isOpen={restoreConfirmOpen}
        onConfirm={handleRestoreConfirm}
        onCancel={() => !restoreRestoring && setRestoreConfirmOpen(false)}
        title="确认恢复数据"
        message={
          restoreRestoring
            ? '正在恢复数据，请稍候...'
            : `将用备份文件「${restoreFile?.name || ''}」覆盖所有当前数据，恢复后页面将自动刷新。此操作不可撤销。`
        }
        confirmLabel="确认恢复"
        cancelLabel="取消"
        variant="danger"
        loading={restoreRestoring}
      />

      {/* 清理确认弹窗 */}
      <ConfirmDialog
        isOpen={confirmOpen}
        onConfirm={handleClearAll}
        onCancel={() => setConfirmOpen(false)}
        title="确认清理演示数据"
        message="此操作将清空以下业务数据：任务、财务、目标、投票、勋章、库存、动态。案例馆、编年史、相册、员工账号不受影响。此操作不可撤销。"
        confirmLabel="确认清空"
        cancelLabel="取消"
        variant="danger"
      />
    </div>
  )
}
