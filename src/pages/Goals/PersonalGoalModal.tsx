import { useState } from 'react'
import Modal from '@/components/Modal'
import { usePersonalGoalStore } from '@/stores/usePersonalGoalStore'
import { useUserStore } from '@/stores/useUserStore'
import type { PersonalGoal } from '@/types'

interface PersonalGoalModalProps {
  isOpen: boolean
  onClose: () => void
  goal?: PersonalGoal | null
}

export default function PersonalGoalModal({ isOpen, onClose, goal }: PersonalGoalModalProps) {
  const currentUser = useUserStore((s) => s.currentUser)
  const addPersonalGoal = usePersonalGoalStore((s) => s.addPersonalGoal)
  const updatePersonalGoal = usePersonalGoalStore((s) => s.updatePersonalGoal)
  const addGoalUpdate = usePersonalGoalStore((s) => s.addGoalUpdate)

  const isNew = !goal
  const isLocked = goal?.lockStatus === 'locked' || goal?.lockStatus === 'review'

  const [title, setTitle] = useState(goal?.title ?? '')
  const [description, setDescription] = useState(goal?.description ?? '')
  const [goalType, setGoalType] = useState(goal?.goalType ?? 'personal')
  const [targetAmount, setTargetAmount] = useState(goal?.targetAmount ? String(goal.targetAmount) : '')
  const [deadline, setDeadline] = useState(goal?.deadline ?? '')
  const [visibility, setVisibility] = useState<PersonalGoal['visibility']>(goal?.visibility ?? 'team')
  const [updateContent, setUpdateContent] = useState('')
  const [amountDelta, setAmountDelta] = useState('')
  const [error, setError] = useState('')

  const handleSaveGoal = () => {
    if (!title.trim()) {
      setError('目标名称不能为空')
      return
    }

    const payload = {
      userId: currentUser.id,
      title: title.trim(),
      description: description.trim() || undefined,
      goalType,
      targetAmount: targetAmount ? Number(targetAmount) : undefined,
      deadline: deadline || undefined,
      visibility,
      lockStatus: 'cooldown' as const,
      lockedAt: undefined,
      unlockAt: undefined,
    }

    if (isNew) {
      addPersonalGoal(payload)
    } else if (goal && !isLocked) {
      updatePersonalGoal(goal.id, payload)
    }
    onClose()
  }

  const handleAddUpdate = () => {
    if (!goal || !updateContent.trim()) {
      setError('进展内容不能为空')
      return
    }
    addGoalUpdate(goal.id, {
      content: updateContent.trim(),
      amountDelta: amountDelta ? Number(amountDelta) : undefined,
    })
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isNew ? '新建个人目标' : '个人目标进展'} size="lg">
      <div className="space-y-4">
        {!isNew && goal && (
          <div className="rounded-lg bg-blue-50 px-4 py-3 text-xs text-blue-800">
            {isLocked
              ? '目标已锁定：标题、金额和截止日不可随意修改，只能追加进展或进入复盘。'
              : '目标处于 24 小时冷静期，仍可调整核心信息。'}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-brand-400 mb-1">目标名称</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isLocked}
              placeholder="如：年底买一台工作电脑"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">类型</label>
            <input
              value={goalType}
              onChange={(e) => setGoalType(e.target.value)}
              disabled={isLocked}
              placeholder="存钱 / 技能 / 健康 / 巡店"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">公开范围</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as PersonalGoal['visibility'])}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="team">团队可见</option>
              <option value="private">仅自己可见</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">目标金额/数值</label>
            <input
              type="number"
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
              disabled={isLocked}
              min={0}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">截止日期</label>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              disabled={isLocked}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-brand-400 mb-1">说明</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLocked}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-50"
            />
          </div>
        </div>

        {!isNew && goal && (
          <div className="rounded-xl border border-brand-100 p-4">
            <h3 className="mb-3 text-sm font-semibold text-brand-400">追加进展 / 复盘</h3>
            <textarea
              value={updateContent}
              onChange={(e) => setUpdateContent(e.target.value)}
              rows={3}
              placeholder="记录今天推进了什么、遇到什么阻碍、下一步怎么做"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <div className="mt-3">
              <label className="block text-sm font-medium text-brand-400 mb-1">金额/数值增量</label>
              <input
                type="number"
                value={amountDelta}
                onChange={(e) => setAmountDelta(e.target.value)}
                placeholder="可选"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>
        )}

        {error && <p className="text-sm text-expense">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm font-medium text-brand-400 bg-gray-100 rounded-lg">
            取消
          </button>
          {!isNew && goal && (
            <button onClick={handleAddUpdate} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg">
              追加进展
            </button>
          )}
          {(!goal || !isLocked) && (
            <button onClick={handleSaveGoal} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg">
              保存目标
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
