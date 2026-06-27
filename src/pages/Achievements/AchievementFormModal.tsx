import { useState, useEffect, useRef } from 'react'
import { X, Upload, ImagePlus, Loader2, Plus } from 'lucide-react'
import Modal from '@/components/Modal'
import { useTimelineStore } from '@/stores/useTimelineStore'
import { compressPhoto } from '@/utils/imageCompressor'
import type { Achievement } from '@/types'

type AchievementCategory = Achievement['category']

interface Props {
  achievement?: Achievement | null
  onClose: () => void
  onSubmit: (data: Omit<Achievement, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => void
}

const CATEGORY_OPTIONS: { value: AchievementCategory; label: string }[] = [
  { value: 'chain', label: '连锁' },
  { value: 'big-meal', label: '大餐' },
  { value: 'small-meal', label: '小餐' },
  { value: 'other', label: '其他' },
]

interface FormData {
  name: string
  icon: string
  description: string
  achievedDate: string
  category: AchievementCategory
  timelineEventId: string
  images: string[]
}

interface FormErrors {
  name?: string
  icon?: string
  description?: string
  achievedDate?: string
}

export default function AchievementFormModal({ achievement, onClose, onSubmit }: Props) {
  const isEdit = !!achievement
  const events = useTimelineStore((s) => s.events)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})

  const [form, setForm] = useState<FormData>({
    name: '',
    icon: '',
    description: '',
    achievedDate: '',
    category: 'chain',
    timelineEventId: '',
    images: [],
  })

  // 编辑模式回填数据
  useEffect(() => {
    if (achievement) {
      setForm({
        name: achievement.name,
        icon: achievement.icon,
        description: achievement.description,
        achievedDate: achievement.achievedDate,
        category: achievement.category,
        timelineEventId: achievement.timelineEventId || '',
        images: achievement.images || [],
      })
    }
  }, [achievement])

  const update = (field: keyof FormData, value: string | string[] | AchievementCategory) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    // 清除对应字段错误
    if (field in errors) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field as keyof FormErrors]
        return next
      })
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (form.images.length >= 3) {
      alert('最多3张图片')
      return
    }

    setUploading(true)
    try {
      const base64 = await compressPhoto(file)
      update('images', [...form.images, base64])
    } catch {
      alert('图片压缩失败，请重新选择')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLogoUploading(true)
    try {
      const base64 = await compressPhoto(file)
      update('icon', base64)
    } catch {
      alert('Logo 压缩失败，请重新选择')
    } finally {
      setLogoUploading(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

  const removeImage = (index: number) => {
    update('images', form.images.filter((_, i) => i !== index))
  }

  const validate = (): boolean => {
    const errs: FormErrors = {}
    if (!form.name.trim()) errs.name = '请输入案例名称'
    if (!form.icon) errs.icon = '请上传 Logo'
    if (!form.description.trim()) errs.description = '请输入成就描述'
    if (!form.achievedDate) errs.achievedDate = '请选择达成日期'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return
    onSubmit({
      ...form,
      category: form.category,
      timelineEventId: form.timelineEventId || undefined,
    })
    onClose()
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? '编辑案例' : '添加案例'}
      size="lg"
    >
      <div className="space-y-5">
        {/* 名称 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            名称 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="案例名称"
            maxLength={50}
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${
              errors.name ? 'border-red-300 bg-red-50' : 'border-gray-300'
            }`}
          />
          {errors.name && (
            <p className="text-xs text-red-500 mt-1">{errors.name}</p>
          )}
        </div>

        {/* Logo */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            Logo <span className="text-red-500">*</span>
          </label>
          <div className="flex items-center gap-4">
            {/* Logo 预览 / 占位 */}
            {form.icon ? (
              <div className="relative group">
                <img
                  src={form.icon}
                  alt="Logo"
                  className="w-16 h-16 object-contain rounded-lg border border-brand-100"
                />
                <button
                  onClick={() => update('icon', '')}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="w-16 h-16 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-brand-200">
                <Upload className="w-6 h-6" />
              </div>
            )}
            <div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
              <button
                onClick={() => logoInputRef.current?.click()}
                disabled={logoUploading}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-brand-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors disabled:opacity-50"
              >
                {logoUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    压缩中...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    {form.icon ? '更换 Logo' : '上传 Logo'}
                  </>
                )}
              </button>
              <p className="text-xs text-brand-200 mt-1">
                支持 JPG/PNG，建议正方形
              </p>
            </div>
          </div>
          {errors.icon && (
            <p className="text-xs text-red-500 mt-1">{errors.icon}</p>
          )}
        </div>

        {/* 描述 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            描述 <span className="text-red-500">*</span>
          </label>
          <textarea
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            placeholder="描述这个案例..."
            rows={3}
            maxLength={200}
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors resize-none ${
              errors.description ? 'border-red-300 bg-red-50' : 'border-gray-300'
            }`}
          />
          {errors.description && (
            <p className="text-xs text-red-500 mt-1">{errors.description}</p>
          )}
        </div>

        {/* 达成日期 + 分类 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              达成日期 <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={form.achievedDate}
              onChange={(e) => update('achievedDate', e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors ${
                errors.achievedDate ? 'border-red-300 bg-red-50' : 'border-gray-300'
              }`}
            />
            {errors.achievedDate && (
              <p className="text-xs text-red-500 mt-1">{errors.achievedDate}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">分类</label>
            <select
              value={form.category}
              onChange={(e) => update('category', e.target.value as AchievementCategory)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors bg-white"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 关联编年史 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            关联编年史（可选）
          </label>
          <select
            value={form.timelineEventId}
            onChange={(e) => update('timelineEventId', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors bg-white"
          >
            <option value="">-- 不关联 --</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title} ({ev.date})
              </option>
            ))}
          </select>
          {events.length === 0 && (
            <p className="text-xs text-brand-200 mt-1">暂无编年史事件，可先创建编年史</p>
          )}
        </div>

        {/* 图片上传 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            图片（最多3张）
          </label>

          {/* 已上传图片预览 */}
          {form.images.length > 0 && (
            <div className="flex gap-3 mb-3 flex-wrap">
              {form.images.map((img, idx) => (
                <div key={idx} className="relative group">
                  <img
                    src={img}
                    alt={`图片 ${idx + 1}`}
                    className="w-20 h-20 object-cover rounded-lg border border-brand-100"
                  />
                  <button
                    onClick={() => removeImage(idx)}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 上传按钮 */}
          {form.images.length < 3 && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-brand-300 hover:border-indigo-300 hover:text-indigo-500 transition-colors disabled:opacity-50"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    压缩中...
                  </>
                ) : (
                  <>
                    <ImagePlus className="w-4 h-4" />
                    上传图片
                  </>
                )}
              </button>
            </>
          )}
          <p className="text-xs text-brand-200 mt-1">
            支持 JPG/PNG，自动压缩。已上传 {form.images.length}/3 张
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-brand-400 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            {isEdit ? '保存修改' : '添加案例'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
