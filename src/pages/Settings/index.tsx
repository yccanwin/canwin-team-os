import { useState, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { useUserStore } from '@/stores/useUserStore'
import { useFinanceStore } from '@/stores/useFinanceStore'
import { useGoalStore } from '@/stores/useGoalStore'
import { useTeamStore } from '@/stores/useTeamStore'
import { isSupabaseConfigured } from '@/lib/supabase'
import { isCaptainRole, roleLabel } from '@/services/profile'
import { disableTeamMember } from '@/services/adminMembers'
import { formatDate } from '@/utils/dateUtils'
import GoalEditModal from '@/pages/Goals/GoalEditModal'
import MemberFormModal from './MemberFormModal'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { FinanceRecord } from '@/types'

type TabKey = 'members' | 'finance' | 'goals' | 'system'

const tabs: { key: TabKey; label: string }[] = [
  { key: 'members', label: '团队成员' },
  { key: 'finance', label: '财务录入' },
  { key: 'goals', label: '目标管理' },
  { key: 'system', label: '系统维护' },
]

export default function SettingsPage() {
  const currentUser = useUserStore((s) => s.currentUser)
  const isCaptain = isCaptainRole(currentUser.role)

  const [activeTab, setActiveTab] = useState<TabKey>('members')

  // 路由守卫
  if (!isCaptain) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="px-3 lg:px-6 py-4">
      <h1 className="font-heading text-lg font-semibold text-brand-400 mb-6">设置中心</h1>

      {/* Tab 导航 */}
      <div className="flex flex-wrap gap-1 border-b border-brand-100 mb-6">
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
        {activeTab === 'finance' && <FinanceEntryTab />}
        {activeTab === 'goals' && <GoalManagementTab />}
        {activeTab === 'members' && <MemberManagementTab />}
        {activeTab === 'system' && <SystemMaintenanceTab />}
      </div>
    </div>
  )
}

// ============================================================
// Tab 1: 财务录入
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
// Tab 2: 目标管理
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
// Tab 3: 团队成员管理
// ============================================================

function MemberManagementTab() {
  const users = useUserStore((s) => s.users)
  const currentUser = useUserStore((s) => s.currentUser)
  const deleteUser = useUserStore((s) => s.deleteUser)

  const [editingMember, setEditingMember] = useState<(typeof users)[0] | null>(null)
  const [newMemberOpen, setNewMemberOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<(typeof users)[0] | null>(null)
  const [deleteError, setDeleteError] = useState('')

  const handleDelete = async () => {
    if (!deleteTarget) return
    if (deleteTarget.id === currentUser.id) {
      setDeleteError('不能删除自己')
      return
    }
    try {
      await disableTeamMember(deleteTarget.id)
      const success = deleteUser(deleteTarget.id)
      if (!success) {
        setDeleteError('删除失败，不能删除当前登录用户')
        return
      }
      setDeleteTarget(null)
      setDeleteError('')
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '删除成员失败')
    }
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
                <th className="text-left px-4 py-3 font-medium text-brand-400">协作资料</th>
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
                  <td className="px-4 py-2.5 text-brand-400">
                    <div className="space-y-1 text-xs">
                      <p>{user.restDays?.length ? `休息日：${user.restDays.join('、')}` : '休息日未设置'}</p>
                      <p className="text-brand-200">
                        {user.communicationPreference ? '已填写沟通偏好' : '沟通偏好未设置'}
                      </p>
                    </div>
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
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {deleteError && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {deleteError}
        </p>
      )}

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

    </div>
  )
}

// ============================================================
// Tab 4: 系统维护
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

function SystemMaintenanceTab() {
  return (
    <div>
      <h2 className="font-heading text-base font-semibold text-brand-400 mb-4">系统维护</h2>

      {/* 团队同步信息 */}
      <TeamInfoCard />

      <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
        <span className="text-green-600 text-lg mt-0.5">✓</span>
        <div>
          <p className="text-sm font-medium text-green-800 mb-1">云端正式表已启用</p>
          <p className="text-xs text-green-700">
            任务、财务、库存、目标、投票、日历、文化内容、工具箱和军机处已从 Supabase 正式业务表读取和写入。
          </p>
        </div>
      </div>

      <div className="bg-white rounded-card shadow-card p-6">
        <h3 className="font-heading text-sm font-semibold text-brand-400 mb-3">本地备份与恢复已停用</h3>
        <p className="text-xs text-brand-300 mb-4">
          旧版 JSON 备份只覆盖浏览器 localStorage，不能代表当前 Supabase 云端数据。为避免误恢复旧缓存覆盖正式业务表，入口已关闭。
        </p>
        <p className="text-xs text-brand-300 mb-4">
          云端数据清理和导出应在 Supabase 后台按表执行，或通过后续专门的管理工具实现。
        </p>
        <div className="rounded-lg bg-brand-50 px-4 py-3">
          <p className="text-xs font-medium text-brand-400 mb-1">保留的本地数据</p>
          <p className="text-xs text-brand-300">
            当前仅保留登录会话、UI 临时状态和少量未迁移的团队动态缓存。刷新页面后，核心业务数据以云端表为准。
          </p>
        </div>
      </div>
    </div>
  )
}
