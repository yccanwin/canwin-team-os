import { useState, useMemo } from 'react'
import { Plus, Search, Filter, Check, Square, Users } from 'lucide-react'
import { useTaskStore } from '@/stores/useTaskStore'
import { useUserStore } from '@/stores/useUserStore'
import StatusBadge from '@/components/StatusBadge'
import EmptyState from '@/components/EmptyState'
import EmptyStateIllustration from '@/components/EmptyStateIllustration'
import { formatRelative, formatDate } from '@/utils/dateUtils'
import { isCaptainRole } from '@/services/profile'
import CreateTaskModal from './CreateTaskModal'
import TaskDetailPanel from './TaskDetailPanel'
import type { Task } from '@/types'

// ============================================================
// 类型标签配置
// ============================================================
const typeConfig: Record<Task['type'], { label: string; color: string; bg: string }> = {
  sales: { label: '销售', color: '#6366F1', bg: '#EEF2FF' },
  operation: { label: '运营', color: '#10B981', bg: '#ECFDF5' },
  purchase: { label: '采购', color: '#F59E0B', bg: '#FFFBEB' },
  other: { label: '其他', color: '#6B7280', bg: '#F9FAFB' },
}

// ============================================================
// 状态→StatusBadge variant 映射
// ============================================================
const statusVariant: Record<Task['status'], 'neutral' | 'info' | 'success'> = {
  todo: 'neutral',
  in_progress: 'info',
  done: 'success',
}

const statusLabel: Record<Task['status'], string> = {
  todo: '未开始',
  in_progress: '进行中',
  done: '已完成',
}

// ============================================================
// 组件
// ============================================================
export default function TasksPage() {
  // --- Store ---
  const tasks = useTaskStore((s) => s.tasks)
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus)
  const currentUser = useUserStore((s) => s.currentUser)
  const users = useUserStore((s) => s.users)
  const getUserById = useUserStore((s) => s.getUserById)

  const isCaptain = isCaptainRole(currentUser.role)

  // --- 本地状态 ---
  const [statusFilter, setStatusFilter] = useState<Task['status'] | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<Task['type'] | 'all'>('all')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  // --- 筛选后的任务 ---
  const filteredTasks = useMemo(() => {
    let result = [...tasks]

    if (statusFilter !== 'all') {
      result = result.filter((t) => t.status === statusFilter)
    }
    if (typeFilter !== 'all') {
      result = result.filter((t) => t.type === typeFilter)
    }
    if (searchKeyword.trim()) {
      const kw = searchKeyword.trim().toLowerCase()
      result = result.filter((t) => t.title.toLowerCase().includes(kw))
    }

    // 按创建时间倒序
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return result
  }, [tasks, statusFilter, typeFilter, searchKeyword])

  // --- 处理状态流转（复选框点击） ---
  const handleStatusToggle = (task: Task) => {
    if (task.status === 'done') return // 已完成不可操作

    const nextStatus = task.status === 'todo' ? 'in_progress' : 'done'
    updateTaskStatus(task.id, nextStatus as Task['status'])

  }

  // --- 处理行点击（打开详情） ---
  const handleRowClick = (taskId: string) => {
    setSelectedTaskId(taskId)
  }

  // --- 当前选中的任务 ---
  const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : null

  return (
    <div className="px-3 lg:px-6 py-4">
      {/* ========== 顶部操作栏 ========== */}
      <div className="flex flex-col gap-4 mb-6">
        {/* 标题行 */}
        <div className="flex items-center justify-between">
          <h1 className="">任务管理</h1>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
            style={{ backgroundColor: '#6366F1' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4F46E5')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#6366F1')}
          >
            <Plus className="w-4 h-4" />
            新建任务
          </button>
        </div>

        {/* 筛选栏 */}
        <div className="flex flex-wrap items-center gap-3">
          {/* 状态筛选 */}
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            {(['all', 'todo', 'in_progress', 'done'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  statusFilter === s
                    ? 'bg-white text-brand-400 shadow-sm'
                    : 'text-brand-300 hover:text-brand-400'
                }`}
              >
                {s === 'all' ? '全部' : statusLabel[s]}
              </button>
            ))}
          </div>

          {/* 类型筛选 */}
          <div className="flex items-center gap-1.5 bg-gray-100 rounded-lg p-1">
            <Filter className="w-3.5 h-3.5 text-brand-200 ml-1.5" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as Task['type'] | 'all')}
              className="bg-transparent text-sm font-medium text-brand-400 px-2 py-1.5 rounded-md outline-none cursor-pointer"
            >
              <option value="all">全部类型</option>
              <option value="sales">销售</option>
              <option value="operation">运营</option>
              <option value="purchase">采购</option>
              <option value="other">其他</option>
            </select>
          </div>

          {/* 搜索框 */}
          <div className="relative flex-1 min-w-[200px] max-w-[320px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-200" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="搜索任务名称..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-brand-100 rounded-lg outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 transition-colors"
            />
          </div>

          {/* 任务计数 */}
          <span className="text-xs text-brand-200 ml-auto">
            共 {filteredTasks.length} 项
          </span>
        </div>
      </div>

      {/* ========== 任务表格 ========== */}
      {filteredTasks.length === 0 ? (
        tasks.length === 0 ? (
          <EmptyStateIllustration
            variant="tasks"
            title="还没有任务？"
            description="点击创建第一个任务开始协作"
            action={
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors shadow-sm hover:shadow-md"
                style={{ backgroundColor: '#6366F1' }}
              >
                <Plus className="w-4 h-4" />
                创建第一个任务
              </button>
            }
          />
        ) : (
          <EmptyState
            title="没有匹配的任务"
            description="换个筛选条件或关键词试试"
          />
        )
      ) : (
        <div className="bg-white rounded-card shadow-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="w-10 px-4 py-3" />
                <th className="text-left px-4 py-3 text-xs font-medium text-brand-200 uppercase tracking-wider">
                  任务名称
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-brand-200 uppercase tracking-wider">
                  类型
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-brand-200 uppercase tracking-wider">
                  负责人
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-brand-200 uppercase tracking-wider">
                  状态
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-brand-200 uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">
                  创建时间
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-brand-200 uppercase tracking-wider whitespace-nowrap">
                  完成时间
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => {
                const assignee = getUserById(task.assigneeId)
                const isDone = task.status === 'done'

                return (
                  <tr
                    key={task.id}
                    onClick={() => handleRowClick(task.id)}
                    className="border-b border-gray-50 hover:bg-brand-50/50 cursor-pointer transition-colors"
                  >
                    {/* 复选框 */}
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleStatusToggle(task)}
                        disabled={isDone}
                        className={`flex items-center justify-center w-5 h-5 rounded border-2 transition-colors ${
                          isDone
                            ? 'bg-green-50 border-green-200 cursor-not-allowed'
                            : task.status === 'in_progress'
                              ? 'bg-blue-50 border-blue-200 hover:border-blue-400'
                              : 'bg-white border-brand-100 hover:border-indigo-400'
                        }`}
                        title={
                          isDone
                            ? '已完成'
                            : task.status === 'todo'
                              ? '点击标记为进行中'
                              : '点击标记为已完成'
                        }
                      >
                        {isDone && <Check className="w-3.5 h-3.5 text-green-500" />}
                        {task.status === 'in_progress' && (
                          <span className="w-2 h-2 rounded-sm bg-blue-400" />
                        )}
                      </button>
                    </td>

                    {/* 任务名称 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${isDone ? 'text-brand-200 line-through' : 'text-brand-400'}`}>
                          {task.title}
                        </span>
                        {task.isImportant && (
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded text-xs" title="重要任务">
                            ⭐
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 类型标签 */}
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          backgroundColor: typeConfig[task.type].bg,
                          color: typeConfig[task.type].color,
                        }}
                      >
                        {typeConfig[task.type].label}
                      </span>
                    </td>

                    {/* 负责人 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                          style={{ backgroundColor: '#6366F1' }}
                        >
                          {assignee?.name?.charAt(0) ?? '?'}
                        </div>
                        <span className="text-sm text-brand-400">{assignee?.name ?? '未分配'}</span>
                      </div>
                    </td>

                    {/* 状态 */}
                    <td className="px-4 py-3">
                      <StatusBadge
                        label={statusLabel[task.status]}
                        variant={statusVariant[task.status]}
                      />
                    </td>

                    {/* 创建时间 */}
                    <td className="px-4 py-3 text-sm text-brand-300 whitespace-nowrap hidden sm:table-cell">
                      {formatRelative(task.createdAt)}
                    </td>

                    {/* 完成时间 */}
                    <td className="px-4 py-3 text-sm text-brand-300 whitespace-nowrap">
                      {task.completedAt ? formatRelative(task.completedAt) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ========== 新建任务弹窗 ========== */}
      <CreateTaskModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />

      {/* ========== 任务详情面板 ========== */}
      <TaskDetailPanel
        task={selectedTask ?? null}
        onClose={() => setSelectedTaskId(null)}
      />
    </div>
  )
}
