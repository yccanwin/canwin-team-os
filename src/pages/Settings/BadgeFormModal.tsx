import { useState, useEffect } from 'react'
import Modal from '@/components/Modal'
import { useBadgeStore } from '@/stores/useBadgeStore'
import type { BadgeConfig } from '@/types'

interface BadgeFormModalProps {
  isOpen: boolean
  onClose: () => void
  badge?: BadgeConfig  // 编辑时传入
}

const triggerTypeOptions = [
  { value: 'task_count', label: '完成任务数' },
  { value: 'login_streak', label: '连续登录' },
  { value: 'metric', label: '业务指标' },
  { value: 'custom', label: '自定义' },
]

const categoryOptions = [
  { value: 'basic', label: '基础' },
  { value: 'business', label: '业务' },
  { value: 'behavior', label: '行为' },
]

export default function BadgeFormModal({
  isOpen,
  onClose,
  badge,
}: BadgeFormModalProps) {
  const addBadge = useBadgeStore((s) => s.addBadge)
  const updateBadge = useBadgeStore((s) => s.updateBadge)

  const isEdit = !!badge

  // 表单字段
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('⭐')
  const [description, setDescription] = useState('')
  const [triggerType, setTriggerType] = useState<BadgeConfig['triggerType']>('task_count')
  const [triggerParams, setTriggerParams] = useState('')
  const [xpReward, setXpReward] = useState('50')
  const [category, setCategory] = useState<BadgeConfig['category']>('basic')

  // 错误
  const [errors, setErrors] = useState<Record<string, string>>({})

  // 回填
  useEffect(() => {
    if (badge) {
      setName(badge.name)
      setIcon(badge.icon)
      setDescription(badge.description)
      setTriggerType(badge.triggerType)
      setTriggerParams(JSON.stringify(badge.triggerParams, null, 2))
      setXpReward(String(badge.xpReward))
      setCategory(badge.category)
    }
  }, [badge])

  // 验证
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!name.trim()) newErrors.name = '名称不能为空'
    if (!icon.trim()) newErrors.icon = '图标不能为空'
    if (!description.trim()) newErrors.description = '描述不能为空'
    const xp = Number(xpReward)
    if (!xpReward || isNaN(xp) || xp < 0) newErrors.xpReward = 'XP奖励无效'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // 提交
  const handleSubmit = () => {
    if (!validate()) return

    let params: Record<string, any> = {}
    try {
      params = triggerParams ? JSON.parse(triggerParams) : {}
    } catch {
      // Keep empty params if JSON is invalid
      params = {}
    }

    const data = {
      name: name.trim(),
      icon: icon.trim(),
      description: description.trim(),
      triggerType,
      triggerParams: params,
      xpReward: Number(xpReward),
      category,
    }

    if (isEdit) {
      updateBadge(badge.id, data)
    } else {
      addBadge(data)
    }

    onClose()
  }

  // 根据触发类型生成默认参数
  const placeholderByType: Record<string, string> = {
    task_count: '{\n  "count": 10\n}',
    login_streak: '{\n  "days": 7\n}',
    metric: '{\n  "metric": "monthly_sales",\n  "threshold": 50000\n}',
    custom: '{\n  "key": "value"\n}',
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? '编辑勋章' : '新增勋章'}
      size="lg"
    >
      <div className="space-y-4">
        {/* 名称 + 图标 */}
        <div className="grid grid-cols-[1fr,80px] gap-4">
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              名称 <span className="text-expense">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：初来乍到"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                errors.name ? 'border-expense' : 'border-gray-300'
              }`}
            />
            {errors.name && (
              <p className="text-xs text-expense mt-1">{errors.name}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              图标 <span className="text-expense">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="⭐"
                maxLength={4}
                className="w-14 px-2 py-2 border border-gray-300 rounded-lg text-center text-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <div className="flex-1 flex items-center justify-center text-2xl bg-brand-50 rounded-lg border border-brand-100">
                {icon || '⭐'}
              </div>
            </div>
            {errors.icon && (
              <p className="text-xs text-expense mt-1">{errors.icon}</p>
            )}
          </div>
        </div>

        {/* 描述 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            描述 <span className="text-expense">*</span>
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="如：完成首个任务"
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
              errors.description ? 'border-expense' : 'border-gray-300'
            }`}
          />
          {errors.description && (
            <p className="text-xs text-expense mt-1">{errors.description}</p>
          )}
        </div>

        {/* 触发类型 + 分类 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              触发类型 <span className="text-expense">*</span>
            </label>
            <select
              value={triggerType}
              onChange={(e) => {
                setTriggerType(e.target.value as BadgeConfig['triggerType'])
                setTriggerParams('')
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              {triggerTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              XP 奖励 <span className="text-expense">*</span>
            </label>
            <input
              type="number"
              value={xpReward}
              onChange={(e) => setXpReward(e.target.value)}
              placeholder="50"
              min={0}
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                errors.xpReward ? 'border-expense' : 'border-gray-300'
              }`}
            />
            {errors.xpReward && (
              <p className="text-xs text-expense mt-1">{errors.xpReward}</p>
            )}
          </div>
        </div>

        {/* 分类 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            分类 <span className="text-expense">*</span>
          </label>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            {categoryOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setCategory(opt.value as BadgeConfig['category'])}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  category === opt.value
                    ? 'bg-primary text-white'
                    : 'bg-white text-brand-400 hover:bg-brand-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 触发参数（动态） */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            触发参数
          </label>
          <textarea
            value={triggerParams}
            onChange={(e) => setTriggerParams(e.target.value)}
            placeholder={placeholderByType[triggerType] || '{}'}
            rows={5}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
          />
          <p className="text-xs text-brand-200 mt-1">JSON 格式</p>
        </div>

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
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-indigo-600 transition-colors"
          >
            {isEdit ? '保存修改' : '创建勋章'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
