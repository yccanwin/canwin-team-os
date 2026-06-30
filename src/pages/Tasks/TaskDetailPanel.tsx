import { useState, useEffect } from 'react'
import { X, Trash2, Edit3, Check, User, Calendar, Clock, Star } from 'lucide-react'
import { useTaskStore } from '@/stores/useTaskStore'
import { useUserStore } from '@/stores/useUserStore'
import StatusBadge from '@/components/StatusBadge'
import ConfirmDialog from '@/components/ConfirmDialog'
import { formatRelative, formatDate } from '@/utils/dateUtils'
import { isCaptainRole } from '@/services/profile'
import type { Task } from '@/types'

interface TaskDetailPanelProps {
  task: Task | null
  onClose: () => void
}

const typeConfig: Record<Task['type'], { label: string; color: string; bg: string }> = {
  sales: { label: '销售', color: '#6366F1', bg: '#EEF2FF' },
  operation: { label: '运营', color: '#10B981', bg: '#ECFDF5' },
  purchase: { label: '采购', color: '#F59E0B', bg: '#FFFBEB' },
  other: { label: '其他', color: '#6B7280', bg: '#F9FAFB' },
}

const statusVariantMap: Record<Task['status'], 'neutral' | 'info' | 'success'> = {
  todo: 'neutral',
  in_progress: 'info',
  done: 'success',
}

const statusLabelMap: Record<Task['status'], string> = {
  todo: '未开始',
  in_progress: '进行中',
  done: '已完成',
}

const typeOptions: { value: Task['type']; label: string }[] = [
  { value: 'sales', label: '销售' },
  { value: 'operation', label: '运营' },
  { value: 'purchase', label: '采购' },
  { value: 'other', label: '其他' },
]

export default function TaskDetailPanel({ task, onClose }: TaskDetailPanelProps) {
  const updateTask = useTaskStore((s) => s.updateTask)
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus)
  const deleteTask = useTaskStore((s) => s.deleteTask)
  const currentUser = useUserStore((s) => s.currentUser)
  const users = useUserStore((s) => s.users)
  const getUserById = useUserStore((s) => s.getUserById)

  const isCaptain = isCaptainRole(currentUser.role)
  const isDone = task?.status === 'done'
  const isOwnTask = task?.assigneeId === currentUser.id
  const canEdit = isCaptain && !isDone
  const canToggleStatus = !isDone && isOwnTask

  // --- 本地编辑状态 ---
  const [editField, setEditField] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editType, setEditType] = useState<Task['type']>('other')
  const [editAssigneeId, setEditAssigneeId] = useState('')
  const [editDeadline, setEditDeadline] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // 当 task 变化时，重置编辑状态
  useEffect(() => {
    if (task) {
      setEditField(null)
      setEditTitle(task.title)
      setEditType(task.type)
      setEditAssigneeId(task.assigneeId)
      setEditDeadline(task.deadline ? new Date(task.deadline).toISOString().slice(0, 10) : '')
      setEditDescription(task.description ?? '')
    }
  }, [task])

  if (!task) return null

  const assignee = getUserById(task.assigneeId)

  // --- 保存编辑 ---
  const handleSaveEdit = (field: string) => {
    switch (field) {
      case 'title':
        if (editTitle.trim() && editTitle !== task.title) {
          updateTask(task.id, { title: editTitle.trim() })
        }
        break
      case 'type':
        if (editType !== task.type) {
          updateTask(task.id, { type: editType })
        }
        break
      case 'assignee':
        if (editAssigneeId && editAssigneeId !== task.assigneeId) {
          updateTask(task.id, { assigneeId: editAssigneeId })
        }
        break
      case 'deadline': {
        const newDeadline = editDeadline
          ? new Date(editDeadline).toISOString()
          : undefined
        updateTask(task.id, { deadline: newDeadline })
        break
      }
      case 'description':
        if (editDescription !== (task.description ?? '')) {
          updateTask(task.id, { description: editDescription.trim() || undefined })
        }
        break
    }
    setEditField(null)
  }

  // --- 状态切换 ---
  const handleStatusToggle = () => {
    if (!canToggleStatus) return
    const nextStatus = task.status === 'todo' ? 'in_progress' : 'done'
    updateTaskStatus(task.id, nextStatus)
  }

  // --- 删除任务 ---
  const handleDelete = () => {
    deleteTask(task.id)
    setShowDeleteConfirm(false)
    onClose()
  }

  // --- 可编辑字段 UI ---
  const renderEditableField = (
    field: string,
    label: string,
    displayContent: React.ReactNode,
    editor: React.ReactNode,
    onStartEdit?: () => void
  ) => (
    <div className="py-3 border-b border-gray-100">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-brand-200 uppercase tracking-wider">{label}</span>
        {canEdit && editField !== field && (
          <button
            onClick={() => {
              setEditField(field)
              onStartEdit?.()
            }}
            className="text-neutral-tertiary hover:text-brand-300 transition-colors"
            title="编辑"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {editField === field ? (
        <div className="flex items-center gap-2">
          {editor}
          <button
            onClick={() => handleSaveEdit(field)}
            className="p-1 rounded text-green-500 hover:bg-green-50 transition-colors"
            title="保存"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={() => setEditField(null)}
            className="p-1 rounded text-brand-200 hover:bg-gray-100 transition-colors"
            title="取消"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div>{displayContent}</div>
      )}
    </div>
  )

  return (
    <>
      {/* 遮罩 */}
      {task && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onClick={onClose}
        />
      )}

      {/* 侧边面板 */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-[360px] bg-white shadow-2xl transform transition-transform duration-300 ease-out ${
          task ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100">
          <h3 className="font-heading text-sm font-medium text-brand-200 uppercase tracking-wider">任务详情</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-gray-100 transition-colors"
            aria-label="关闭"
          >
            <X className="w-5 h-5 text-brand-200" />
          </button>
        </div>

        {/* 内容 */}
        <div className="overflow-y-auto h-[calc(100%-60px-64px)]">
          <div className="px-6 py-5">
            {/* 任务名称 */}
            <div className="mb-4">
              {editField === 'title' ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="flex-1 px-2 py-1 text-lg font-semibold border border-brand-100 rounded-md outline-none focus:border-indigo-300"
                    autoFocus
                  />
                  <button onClick={() => handleSaveEdit('title')} className="p-1 text-green-500 hover:bg-green-50 rounded">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditField(null)} className="p-1 text-brand-200 hover:bg-gray-100 rounded">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-start gap-2 group">
                  <h2 className="font-heading text-xl font-bold text-brand-400 flex-1">
                    {task.title}
                  </h2>
                  {canEdit && (
                    <button
                      onClick={() => { setEditField('title'); setEditTitle(task.title) }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-neutral-tertiary hover:text-brand-300 transition-all mt-0.5"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* 标签行 */}
            <div className="flex items-center gap-2 mb-5">
              {editField === 'type' ? (
                <div className="flex items-center gap-2">
                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as Task['type'])}
                    className="px-2 py-1 text-xs border border-brand-100 rounded-md outline-none"
                    autoFocus
                  >
                    {typeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button onClick={() => handleSaveEdit('type')} className="p-1 text-green-500 hover:bg-green-50 rounded">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditField(null)} className="p-1 text-brand-200 hover:bg-gray-100 rounded">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  style={{
                    backgroundColor: typeConfig[task.type].bg,
                    color: typeConfig[task.type].color,
                  }}
                >
                  {typeConfig[task.type].label}
                  {canEdit && (
                    <button
                      onClick={() => { setEditField('type'); setEditType(task.type) }}
                      className="ml-1 text-current opacity-50 hover:opacity-100"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                  )}
                </span>
              )}
              <StatusBadge
                label={statusLabelMap[task.status]}
                variant={statusVariantMap[task.status]}
              />
              {task.isImportant && (
                <span className="text-sm" title="重要任务">⭐</span>
              )}
            </div>

            {/* 负责人 */}
            {renderEditableField(
              'assignee',
              '负责人',
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: '#6366F1' }}>
                  {assignee?.name?.charAt(0) ?? '?'}
                </div>
                <span className="text-sm text-brand-400">{assignee?.name ?? '未分配'}</span>
                {assignee?.position && (
                  <span className="text-xs text-brand-200">{assignee.position}</span>
                )}
              </div>,
              <select
                value={editAssigneeId}
                onChange={(e) => setEditAssigneeId(e.target.value)}
                className="flex-1 px-2 py-1 text-sm border border-brand-100 rounded-md outline-none"
                autoFocus
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} — {u.position}</option>
                ))}
              </select>
            )}

            {/* 创建时间 */}
            <div className="py-3 border-b border-gray-100">
              <span className="text-xs font-medium text-brand-200 uppercase tracking-wider">创建时间</span>
              <div className="flex items-center gap-1.5 mt-1 text-sm text-brand-400">
                <Clock className="w-3.5 h-3.5 text-brand-200" />
                {formatRelative(task.createdAt)}
                <span className="text-xs text-brand-200">({formatDate(task.createdAt)})</span>
              </div>
            </div>

            {/* 截止日期 */}
            {renderEditableField(
              'deadline',
              '截止日期',
              <div className="text-sm mt-1">
                {task.deadline ? (
                  <span className="text-brand-400">
                    {formatDate(task.deadline)}
                    {new Date(task.deadline) < new Date() && task.status !== 'done' && (
                      <span className="ml-2 text-xs text-red-500">已逾期</span>
                    )}
                  </span>
                ) : (
                  <span className="text-brand-200">未设置</span>
                )}
              </div>,
              <input
                type="date"
                value={editDeadline}
                onChange={(e) => setEditDeadline(e.target.value)}
                className="flex-1 px-2 py-1 text-sm border border-brand-100 rounded-md outline-none"
                autoFocus
              />,
              () => setEditDeadline(task.deadline ? new Date(task.deadline).toISOString().slice(0, 10) : '')
            )}

            {/* 完成时间 */}
            {task.completedAt && (
              <div className="py-3 border-b border-gray-100">
                <span className="text-xs font-medium text-brand-200 uppercase tracking-wider">完成时间</span>
                <div className="flex items-center gap-1.5 mt-1 text-sm text-brand-400">
                  <Check className="w-3.5 h-3.5 text-green-500" />
                  {formatRelative(task.completedAt)}
                </div>
              </div>
            )}

            {/* 描述 */}
            {renderEditableField(
              'description',
              '描述',
              <p className="text-sm text-brand-400 mt-1 leading-relaxed">
                {task.description || <span className="text-brand-200 italic">暂无描述</span>}
              </p>,
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="flex-1 px-2 py-1 text-sm border border-brand-100 rounded-md outline-none resize-none"
                rows={3}
                autoFocus
              />,
              () => setEditDescription(task.description ?? '')
            )}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="absolute bottom-0 left-0 right-0 px-6 py-4 border-t border-brand-100 bg-brand-50">
          <div className="flex gap-3">
            {/* 状态切换（仅自己的未完成任务） */}
            {canToggleStatus && (
              <button
                onClick={handleStatusToggle}
                className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
                style={{ backgroundColor: '#6366F1' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4F46E5')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#6366F1')}
              >
                {task.status === 'todo' ? '标记为进行中' : '标记为已完成'}
              </button>
            )}

            {/* 已完成状态提示 */}
            {isDone && (
              <div className="flex-1 flex items-center justify-center py-2 text-sm text-green-600 font-medium bg-green-50 rounded-lg">
                <Check className="w-4 h-4 mr-1.5" />
                任务已完成
              </div>
            )}

            {/* 非自己任务且未完成的成员：提示 */}
            {!canToggleStatus && !isDone && !isCaptain && (
              <div className="flex-1 flex items-center justify-center py-2 text-sm text-brand-200 bg-gray-100 rounded-lg">
                仅可更新自己的任务状态
              </div>
            )}

            {/* 队长删除按钮 */}
            {isCaptain && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                删除
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 删除确认 */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        title="删除任务"
        message={`确定要删除「${task.title}」吗？此操作不可撤销。`}
        confirmLabel="确认删除"
        variant="danger"
      />
    </>
  )
}
