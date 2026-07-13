import { useState, useEffect } from 'react'
import Modal from '@/components/Modal'
import ImageUploader from '@/components/Timeline/ImageUploader'
import FileUploader from '@/components/Timeline/FileUploader'
import { useUserStore } from '@/stores/useUserStore'
import { useTimelineStore } from '@/stores/useTimelineStore'
import { CATEGORY_CONFIG } from '@/types'
import type { TimelineEvent } from '@/types'

interface EventModalProps {
  open: boolean
  onClose: () => void
  event?: TimelineEvent  // 有值=编辑模式，无值=新建模式
  isCaptain: boolean
}

const MAX_TITLE = 50
const MAX_DESC = 500

export default function EventModal({
  open,
  onClose,
  event,
  isCaptain,
}: EventModalProps) {
  const users = useUserStore((s) => s.users)
  const currentUser = useUserStore((s) => s.currentUser)
  const { addEvent, updateEvent } = useTimelineStore()
  const isEdit = !!event

  // 表单状态
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [category, setCategory] = useState<TimelineEvent['category'] | ''>('')
  const [description, setDescription] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [attachments, setAttachments] = useState<TimelineEvent['attachments']>([])
  const [participants, setParticipants] = useState<string[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})

  // 初始化表单（编辑模式）
  useEffect(() => {
    if (open) {
      if (event) {
        setTitle(event.title)
        setDate(event.date)
        setCategory(event.category)
        setDescription(event.description || '')
        setImages(event.images)
        setAttachments(event.attachments)
        setParticipants(event.participants)
      } else {
        resetForm()
      }
    }
  }, [open, event])

  const resetForm = () => {
    setTitle('')
    setDate('')
    setCategory('')
    setDescription('')
    setImages([])
    setAttachments([])
    setParticipants([])
    setErrors({})
  }

  const validate = (): boolean => {
    const errs: Record<string, string> = {}

    if (!title.trim()) errs.title = '标题不能为空'
    else if (title.trim().length > MAX_TITLE) errs.title = `标题不能超过${MAX_TITLE}字`

    if (!date) errs.date = '日期不能为空'
    else if (date > new Date().toISOString().slice(0, 10)) errs.date = '日期不能晚于今天'

    if (!category) errs.category = '请选择分类'

    if (description.length > MAX_DESC) errs.desc = `描述不能超过${MAX_DESC}字`

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    const data = {
      title: title.trim(),
      date,
      description: description.trim() || undefined,
      images,
      attachments,
      participants,
      category: category as TimelineEvent['category'],
      createdBy: event?.createdBy || currentUser.id,
    }

    if (isEdit) {
      updateEvent(event!.id, data)
    } else {
      addEvent(data)
    }
    onClose()
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const toggleParticipant = (userId: string) => {
    setParticipants((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    )
  }

  return (
    <Modal isOpen={open} onClose={handleClose} title={isEdit ? '编辑事件' : '添加事件'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 标题 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            标题 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE}
            placeholder="输入事件标题"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
          />
          {errors.title && (
            <p className="text-xs text-red-500 mt-1">{errors.title}</p>
          )}
        </div>

        {/* 日期 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            日期 <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
          />
          {errors.date && (
            <p className="text-xs text-red-500 mt-1">{errors.date}</p>
          )}
        </div>

        {/* 分类 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-2">
            分类 <span className="text-red-500">*</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CATEGORY_CONFIG) as TimelineEvent['category'][]).map(
              (cat) => {
                const cfg = CATEGORY_CONFIG[cat]
                const selected = category === cat
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                      selected
                        ? `${cfg.bg} ${cfg.text} border-current font-medium`
                        : 'bg-white border-brand-100 text-brand-400 hover:border-gray-300'
                    }`}
                  >
                    {cfg.icon} {cfg.label}
                  </button>
                )
              }
            )}
          </div>
          {errors.category && (
            <p className="text-xs text-red-500 mt-1">{errors.category}</p>
          )}
        </div>

        {/* 描述 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            描述
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={MAX_DESC}
            rows={3}
            placeholder="支持 **粗体**、列表和链接"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none"
          />
          <div className="flex justify-between mt-1">
            {errors.desc && (
              <p className="text-xs text-red-500">{errors.desc}</p>
            )}
            <span className="text-xs text-brand-200 ml-auto">
              {description.length}/{MAX_DESC}
            </span>
          </div>
        </div>

        {/* 图片上传 */}
        <ImageUploader images={images} onChange={setImages} />

        {/* 附件上传 */}
        <FileUploader files={attachments} onChange={setAttachments} />

        {/* 参与人 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-2">
            参与人
          </label>
          <div className="flex flex-wrap gap-2">
            {users.map((user) => {
              const selected = participants.includes(user.id)
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => toggleParticipant(user.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    selected
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-medium'
                      : 'bg-white border-brand-100 text-brand-400 hover:border-gray-300'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-xs text-white ${
                      selected ? 'bg-indigo-500' : 'bg-gray-400'
                    }`}
                  >
                    {user.name.charAt(0)}
                  </div>
                  {user.name}
                </button>
              )
            })}
          </div>
        </div>

        {/* 提交按钮 */}
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm text-brand-400 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          {isCaptain && (
            <button
              type="submit"
              className="px-4 py-2 text-sm text-white bg-primary rounded-lg hover:bg-indigo-600 transition-colors"
            >
              {isEdit ? '保存修改' : '添加事件'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}
