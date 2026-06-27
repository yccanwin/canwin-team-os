import { useState, useEffect } from 'react'
import Modal from '@/components/Modal'
import { useGoalStore } from '@/stores/useGoalStore'
import type { Goal } from '@/types'

interface GoalEditModalProps {
  isOpen: boolean
  onClose: () => void
  goal?: Goal | null
}

export default function GoalEditModal({
  isOpen,
  onClose,
  goal,
}: GoalEditModalProps) {
  const updateGoal = useGoalStore((s) => s.updateGoal)
  const updateGoalAmount = useGoalStore((s) => s.updateGoalAmount)
  const addGoal = useGoalStore((s) => s.addGoal)
  const checkPhaseCompletion = useGoalStore((s) => s.checkPhaseCompletion)

  const isNew = !goal

  // 表单字段
  const [title, setTitle] = useState(goal?.title ?? '')
  const [targetAmount, setTargetAmount] = useState('')
  const [priority, setPriority] = useState(goal?.priority ?? 3)
  const [icon, setIcon] = useState('🎯')
  const [currentAmount, setCurrentAmount] = useState('')
  const [monthlyGrowth, setMonthlyGrowth] = useState('')
  const [status, setStatus] = useState<Goal['status']>(goal?.status ?? 'enabled')

  // 错误
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  // 回填表单
  useEffect(() => {
    if (goal) {
      setTitle(goal.title)
      setTargetAmount(String(goal.targetAmount))
      setPriority(goal.priority)
      setCurrentAmount(String(goal.currentAmount))
      setMonthlyGrowth(
        goal.monthlyGrowth ? String(goal.monthlyGrowth) : ''
      )
      setStatus(goal.status)
    }
  }, [goal])

  // 验证
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!title.trim()) newErrors.title = '目标名称不能为空'

    const target = Number(targetAmount)
    if (!targetAmount || isNaN(target) || target <= 0) {
      newErrors.targetAmount = '目标金额必须大于0'
    }

    const current = Number(currentAmount)
    if (currentAmount !== '' && (!isNaN(current) && current > target)) {
      newErrors.currentAmount = '当前金额不能超过目标金额'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // 提交
  const handleSubmit = () => {
    if (!validate()) return
    setSubmitting(true)

    if (isNew) {
      // 新建模式
      addGoal({
        title: title.trim(),
        targetAmount: Number(targetAmount),
        currentAmount: currentAmount ? Number(currentAmount) : 0,
        priority,
        monthlyGrowth: monthlyGrowth ? Number(monthlyGrowth) : undefined,
        status,
        icon,
      })
    } else {
      // 编辑模式
      const updates: Partial<Goal> = {
        title: title.trim(),
        targetAmount: Number(targetAmount),
        priority,
        monthlyGrowth: monthlyGrowth
          ? Number(monthlyGrowth)
          : undefined,
        status,
      }

      updateGoal(goal!.id, updates)

      // 调整当前金额（使用 updateGoalAmount 触发自动完成检测）
      if (currentAmount !== '') {
        updateGoalAmount(goal!.id, Number(currentAmount))
      }
    }

    setSubmitting(false)
    onClose()
  }

  const isInProgressOrEnabled =
    status === 'in_progress' || status === 'enabled'

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="编辑目标" size="lg">
      <div className="space-y-4">
        {/* 目标名称 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            目标名称 <span className="text-expense">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="如：阶段一：月营收突破10万"
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
              errors.title ? 'border-expense' : 'border-gray-300'
            }`}
          />
          {errors.title && (
            <p className="text-xs text-expense mt-1">{errors.title}</p>
          )}
        </div>

        {/* 目标金额 + 当前金额 同行 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              目标金额 <span className="text-expense">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-200 text-sm">
                ¥
              </span>
              <input
                type="number"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                placeholder="0"
                min={0}
                step="0.01"
                className={`w-full pl-7 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                  errors.targetAmount ? 'border-expense' : 'border-gray-300'
                }`}
              />
            </div>
            {errors.targetAmount && (
              <p className="text-xs text-expense mt-1">
                {errors.targetAmount}
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              当前金额
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-200 text-sm">
                ¥
              </span>
              <input
                type="number"
                value={currentAmount}
                onChange={(e) => setCurrentAmount(e.target.value)}
                placeholder="0"
                min={0}
                step="0.01"
                className={`w-full pl-7 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                  errors.currentAmount
                    ? 'border-expense'
                    : 'border-gray-300'
                }`}
              />
            </div>
            {errors.currentAmount && (
              <p className="text-xs text-expense mt-1">
                {errors.currentAmount}
              </p>
            )}
          </div>
        </div>

        {/* 优先级 + 月均增长 同行 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              优先级
            </label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setPriority(star)}
                  className="text-xl transition-colors"
                  aria-label={`优先级 ${star}`}
                >
                  {star <= priority ? '★' : '☆'}
                </button>
              ))}
              <span className="ml-2 text-xs text-brand-200">
                {priority}/5
              </span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              月均增长
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-200 text-sm">
                ¥
              </span>
              <input
                type="number"
                value={monthlyGrowth}
                onChange={(e) => setMonthlyGrowth(e.target.value)}
                placeholder="可选"
                min={0}
                step="0.01"
                className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* 图标 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            图标
          </label>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="输入 emoji 或图标名"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <div className="w-10 h-10 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center text-xl">
              {icon || '🎯'}
            </div>
          </div>
        </div>

        {/* 状态（仅对 enabled/in_progress 阶段可切换） */}
        {isInProgressOrEnabled && (
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              状态
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Goal['status'])}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              <option value="enabled">待开始</option>
              <option value="in_progress">进行中</option>
              <option value="completed">已完成</option>
            </select>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-brand-400 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50"
          >
            {submitting ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
