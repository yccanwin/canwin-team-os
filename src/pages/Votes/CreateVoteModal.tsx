import { useState } from 'react'
import { Plus, Minus } from 'lucide-react'
import Modal from '@/components/Modal'
import { useVoteStore } from '@/stores/useVoteStore'
import { useUserStore } from '@/stores/useUserStore'
import type { Vote } from '@/types'

interface CreateVoteModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function CreateVoteModal({ isOpen, onClose }: CreateVoteModalProps) {
  const createVote = useVoteStore((s) => s.createVote)
  const currentUser = useUserStore((s) => s.currentUser)

  // --- 表单状态 ---
  const [title, setTitle] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [deadline, setDeadline] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // --- 重置表单 ---
  const resetForm = () => {
    setTitle('')
    setOptions(['', ''])
    setDeadline('')
    setDescription('')
    setErrors({})
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  // --- 选项操作 ---
  const addOption = () => {
    if (options.length < 3) {
      setOptions([...options, ''])
    }
  }

  const removeOption = (index: number) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index))
    }
  }

  const updateOption = (index: number, value: string) => {
    const newOptions = [...options]
    newOptions[index] = value
    setOptions(newOptions)
    if (errors[`option${index}`]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[`option${index}`]
        return next
      })
    }
  }

  // --- 提交 ---
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const newErrors: Record<string, string> = {}

    if (!title.trim()) {
      newErrors.title = '议题标题不能为空'
    }

    const validOptions = options.filter((opt) => opt.trim())
    if (validOptions.length < 2) {
      newErrors.options = '至少需要 2 个选项'
    } else {
      options.forEach((opt, i) => {
        if (!opt.trim()) {
          newErrors[`option${i}`] = '选项不能为空'
        }
      })
    }

    if (!deadline) {
      newErrors.deadline = '请设置截止时间'
    } else if (new Date(deadline) <= new Date()) {
      newErrors.deadline = '截止时间必须在未来'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    // 创建投票
    createVote({
      title: title.trim(),
      options: validOptions.map((label, i) => ({
        id: crypto.randomUUID(),
        label,
      })),
      deadline: new Date(deadline).toISOString(),
      createdBy: currentUser.id,
      isActive: true,
      description: description.trim() || undefined,
    } as any)

    handleClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="发起投票" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 议题标题 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            议题标题 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              if (errors.title) setErrors((prev) => ({ ...prev, title: '' }))
            }}
            placeholder="请输入议题标题"
            className={`w-full px-3 py-2 text-sm border rounded-lg outline-none transition-colors ${
              errors.title
                ? 'border-red-300 focus:border-red-400'
                : 'border-brand-100 focus:border-indigo-300'
            }`}
          />
          {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title}</p>}
        </div>

        {/* 投票选项 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-2">
            选项 <span className="text-red-500">*</span>
            <span className="text-xs text-brand-200 ml-1">（2-3 个）</span>
          </label>

          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs font-medium text-brand-200 w-5 text-right">
                  {String.fromCharCode(65 + i)}.
                </span>
                <input
                  type="text"
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                  placeholder={`选项 ${i + 1}`}
                  className={`flex-1 px-3 py-2 text-sm border rounded-lg outline-none transition-colors ${
                    errors[`option${i}`]
                      ? 'border-red-300 focus:border-red-400'
                      : 'border-brand-100 focus:border-indigo-300'
                  }`}
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    className="p-1.5 rounded-md text-brand-200 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {options.length < 3 && (
            <button
              type="button"
              onClick={addOption}
              className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              添加选项
            </button>
          )}

          {errors.options && <p className="mt-1 text-xs text-red-500">{errors.options}</p>}
        </div>

        {/* 截止时间 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            截止时间 <span className="text-red-500">*</span>
          </label>
          <input
            type="datetime-local"
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
        </div>

        {/* 描述 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="投票说明（可选）"
            rows={2}
            className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 transition-colors resize-none"
          />
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
            发起投票
          </button>
        </div>
      </form>
    </Modal>
  )
}
