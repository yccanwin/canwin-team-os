import { useState, useRef } from 'react'
import { Upload, Loader2, Camera, X, Plus } from 'lucide-react'
import Modal from '@/components/Modal'
import { useUserStore } from '@/stores/useUserStore'
import { compressPhoto } from '@/utils/imageCompressor'
import type { Photo } from '@/types'

interface Props {
  photo?: Photo | null // null = 新建模式，非 null = 编辑模式
  onClose: () => void
  onSubmit: (data: Omit<Photo, 'id' | 'uploadedAt' | 'year' | 'month' | 'uploadedBy'>) => void
}

interface FormData {
  url: string
  title: string
  date: string
  location: string
  description: string
  participants: string[]
}

const EMPTY_FORM: FormData = {
  url: '',
  title: '',
  date: '',
  location: '',
  description: '',
  participants: [],
}

export default function PhotoUploadModal({
  photo,
  onClose,
  onSubmit,
}: Props) {
  const users = useUserStore((s) => s.users)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isEdit = !!photo

  const [form, setForm] = useState<FormData>(
    photo
      ? {
          url: photo.url,
          title: photo.title || '',
          date: photo.date,
          location: photo.location || '',
          description: photo.description || '',
          participants: [...photo.participants],
        }
      : { ...EMPTY_FORM }
  )
  const [compressing, setCompressing] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({})

  const set = (patch: Partial<FormData>) => {
    setForm((prev) => ({ ...prev, ...patch }))
    // 清除对应字段的错误
    setErrors((prev) => {
      const next = { ...prev }
      for (const key of Object.keys(patch)) {
        delete next[key as keyof FormData]
      }
      return next
    })
  }

  const toggleParticipant = (userId: string) => {
    setForm((prev) => ({
      ...prev,
      participants: prev.participants.includes(userId)
        ? prev.participants.filter((id) => id !== userId)
        : [...prev.participants, userId],
    }))
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 检查大小：≤2MB
    if (file.size > 2 * 1024 * 1024) {
      alert('文件过大，请选择 ≤2MB 的图片')
      return
    }

    // 检查格式
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      alert('仅支持 JPG / PNG 格式')
      return
    }

    setCompressing(true)
    try {
      const dataUrl = await compressPhoto(file)
      set({ url: dataUrl })
    } catch {
      alert('图片压缩失败，请重新选择')
    } finally {
      setCompressing(false)
    }
  }

  const validate = (): boolean => {
    const errs: Partial<Record<keyof FormData, string>> = {}
    if (!form.url) errs.url = '请选择一张照片'
    if (!form.date) errs.date = '请选择拍摄日期'
    if (form.title.length > 30) errs.title = '标题不能超过30字'
    if (form.location.length > 50) errs.location = '地点不能超过50字'
    if (form.description.length > 200) errs.description = '描述不能超过200字'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return
    onSubmit(form)
    onClose()
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? '编辑照片' : '上传照片'}
      size="lg"
    >
      {/* ============ 照片选择 / 预览 ============ */}
      <div className="mb-5">
        <label className="block text-sm font-medium text-brand-400 mb-1">
          选择照片 <span className="text-red-500">*</span>
        </label>

        {form.url ? (
          <div className="relative">
            <img
              src={form.url}
              alt={form.title || '预览'}
              className="max-h-40 object-contain rounded-lg border border-brand-100 mx-auto"
            />
            <button
              onClick={() => {
                set({ url: '' })
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              className="absolute top-1 right-1 p-1 bg-white/80 rounded-full hover:bg-white shadow-sm"
              type="button"
            >
              <X className="w-4 h-4 text-brand-300" />
            </button>
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50 transition-colors"
          >
            {compressing ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                <span className="text-sm text-brand-300">正在压缩...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-brand-200" />
                <span className="text-sm text-brand-400 font-medium">
                  点击或拖拽上传
                </span>
                <span className="text-xs text-brand-200">
                  支持 JPG / PNG，单张 ≤2MB
                </span>
              </div>
            )}
          </div>
        )}
        {errors.url && <p className="text-xs text-red-500 mt-1">{errors.url}</p>}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* ============ 标题 ============ */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-brand-400 mb-1">
          照片标题
        </label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="可选，最多30字"
          maxLength={30}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
        />
        {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title}</p>}
      </div>

      {/* ============ 拍摄日期 ============ */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-brand-400 mb-1">
          拍摄日期 <span className="text-red-500">*</span>
        </label>
        <input
          type="date"
          value={form.date}
          onChange={(e) => set({ date: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
        />
        {errors.date && <p className="text-xs text-red-500 mt-1">{errors.date}</p>}
      </div>

      {/* ============ 拍摄地点 ============ */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-brand-400 mb-1">
          拍摄地点
        </label>
        <input
          type="text"
          value={form.location}
          onChange={(e) => set({ location: e.target.value })}
          placeholder="可选，最多50字"
          maxLength={50}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
        />
        {errors.location && <p className="text-xs text-red-500 mt-1">{errors.location}</p>}
      </div>

      {/* ============ 描述 ============ */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-brand-400 mb-1">
          描述
        </label>
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="可选，最多200字"
          maxLength={200}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none resize-none"
        />
        {errors.description && <p className="text-xs text-red-500 mt-1">{errors.description}</p>}
      </div>

      {/* ============ 参与人 ============ */}
      <div className="mb-5">
        <label className="block text-sm font-medium text-brand-400 mb-2">
          参与人
        </label>
        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
          {users.map((u) => {
            const isSelected = form.participants.includes(u.id)
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => toggleParticipant(u.id)}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  isSelected
                    ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
                    : 'bg-gray-100 text-brand-400 border border-brand-100 hover:bg-gray-200'
                }`}
              >
                {isSelected && <Plus className="w-3 h-3 rotate-45" />}
                {u.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* ============ 按钮 ============ */}
      <div className="flex justify-end gap-3 pt-3 border-t border-brand-100">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-gray-100 text-brand-400 rounded-lg text-sm hover:bg-gray-200 transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          {isEdit ? '保存' : '上传'}
        </button>
      </div>
    </Modal>
  )
}
