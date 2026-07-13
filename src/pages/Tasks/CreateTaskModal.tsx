import { useMemo, useState } from 'react'
import Modal from '@/components/Modal'
import { useTaskStore } from '@/stores/useTaskStore'
import { useUserStore } from '@/stores/useUserStore'
import type { Task } from '@/types'

interface CreateTaskModalProps {
  isOpen: boolean
  onClose: () => void
}

const typeOptions: { value: Task['type']; label: string }[] = [
  { value: 'sales', label: '销售' },
  { value: 'operation', label: '运营' },
  { value: 'purchase', label: '采购' },
  { value: 'other', label: '其他' },
]

const restDayIndex: Record<string, number> = {
  周日: 0,
  周一: 1,
  周二: 2,
  周三: 3,
  周四: 4,
  周五: 5,
  周六: 6,
}

function getRestDayWarning(deadline: string, assigneeRestDays?: string[]) {
  if (!deadline || !assigneeRestDays?.length) return ''
  const weekday = new Date(`${deadline}T00:00:00`).getDay()
  const matchedRestDay = assigneeRestDays.find((day) => restDayIndex[day] === weekday)
  return matchedRestDay ? `提醒：负责人当天是固定休息日（${matchedRestDay}），请确认是否需要调整截止日或负责人。` : ''
}

export default function CreateTaskModal({ isOpen, onClose }: CreateTaskModalProps) {
  const addTask = useTaskStore((s) => s.addTask)
  const users = useUserStore((s) => s.users)
  const currentUser = useUserStore((s) => s.currentUser)

  // --- 表单状态 ---
  const [title, setTitle] = useState('')
  const [type, setType] = useState<Task['type'] | ''>('')
  const [assigneeId, setAssigneeId] = useState(currentUser.id)
  const [deadline, setDeadline] = useState('')
  const [description, setDescription] = useState('')
  const [isImportant, setIsImportant] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const selectedAssignee = useMemo(() => {
    const assignee = users.find((user) => user.id === assigneeId)
    if (currentUser.id !== assigneeId) return assignee
    return {
      ...assignee,
      ...currentUser,
      restDays: assignee?.restDays ?? currentUser.restDays,
    }
  }, [assigneeId, currentUser, users])
  const restDayWarning = useMemo(
    () => getRestDayWarning(deadline, selectedAssignee?.restDays),
    [deadline, selectedAssignee?.restDays]
  )

  // --- 重置表单 ---
  const resetForm = () => {
    setTitle('')
    setType('')
    setAssigneeId(currentUser.id)
    setDeadline('')
    setDescription('')
    setIsImportant(false)
    setErrors({})
  }

  // --- 关闭弹窗 ---
  const handleClose = () => {
    resetForm()
    onClose()
  }

  // --- 提交 ---
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const newErrors: Record<string, string> = {}

    if (!title.trim()) {
      newErrors.title = '任务名称不能为空'
    }
    if (!type) {
      newErrors.type = '请选择任务类型'
    }
    if (deadline) {
      const deadlineDate = new Date(deadline)
      if (deadlineDate <= new Date()) {
        newErrors.deadline = '截止时间必须在未来'
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    // 调用 Store 创建任务
    addTask({
      title: title.trim(),
      type: type as Task['type'],
      assigneeId,
      status: 'todo',
      createdAt: new Date().toISOString(),
      deadline: deadline ? new Date(deadline).toISOString() : undefined,
      description: description.trim() || undefined,
      isImportant,
    })

    handleClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="新建任务" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 任务名称 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            任务名称 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              if (errors.title) setErrors((prev) => ({ ...prev, title: '' }))
            }}
            placeholder="请输入任务名称"
            className={`w-full px-3 py-2 text-sm border rounded-lg outline-none transition-colors ${
              errors.title
                ? 'border-red-300 focus:border-red-400 focus:ring-1 focus:ring-red-200'
                : 'border-brand-100 focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200'
            }`}
          />
          {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title}</p>}
        </div>

        {/* 任务类型 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            类型 <span className="text-red-500">*</span>
          </label>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as Task['type'])
              if (errors.type) setErrors((prev) => ({ ...prev, type: '' }))
            }}
            className={`w-full px-3 py-2 text-sm border rounded-lg outline-none transition-colors ${
              errors.type
                ? 'border-red-300 focus:border-red-400'
                : 'border-brand-100 focus:border-indigo-300'
            }`}
          >
            <option value="">请选择类型</option>
            {typeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {errors.type && <p className="mt-1 text-xs text-red-500">{errors.type}</p>}
        </div>

        {/* 负责人 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            负责人 <span className="text-red-500">*</span>
          </label>
          <select
            value={assigneeId}
            onChange={(e) => {
              setAssigneeId(e.target.value)
              if (errors.assigneeId) setErrors((prev) => ({ ...prev, assigneeId: '' }))
            }}
            className={`w-full px-3 py-2 text-sm border rounded-lg outline-none transition-colors ${
              errors.assigneeId
                ? 'border-red-300 focus:border-red-400'
                : 'border-brand-100 focus:border-indigo-300'
            }`}
          >
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} — {user.position}
              </option>
            ))}
          </select>
          {errors.assigneeId && (
            <p className="mt-1 text-xs text-red-500">{errors.assigneeId}</p>
          )}
        </div>

        {/* 截止日期 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">截止日期</label>
          <input
            type="date"
            value={deadline}
            onChange={(e) => {
              setDeadline(e.target.value)
              if (errors.deadline) setErrors((prev) => ({ ...prev, deadline: '' }))
            }}
            className={`w-full px-3 py-2 text-sm border rounded-lg outline-none transition-colors ${
              errors.deadline
                ? 'border-red-300 focus:border-red-400'
                : 'border-brand-100 focus:border-indigo-300'
            }`}
          />
          {errors.deadline && <p className="mt-1 text-xs text-red-500">{errors.deadline}</p>}
          {!errors.deadline && restDayWarning && (
            <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
              {restDayWarning}
            </p>
          )}
        </div>

        {/* 描述 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="任务描述（可选）"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 transition-colors resize-none"
          />
        </div>

        {/* 重要任务开关 */}
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-brand-400">是否重要任务</p>
            <p className="text-xs text-brand-200 mt-0.5">
              重要任务会在首页和任务列表中优先提醒。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsImportant(!isImportant)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              isImportant ? 'bg-indigo-500' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                isImportant ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* 按钮 */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-brand-400 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
            style={{ backgroundColor: '#6366F1' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4F46E5')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#6366F1')}
          >
            创建任务
          </button>
        </div>
      </form>
    </Modal>
  )
}
