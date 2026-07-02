import { useState, useEffect, useRef } from 'react'
import { X, Upload, Loader2 } from 'lucide-react'
import Modal from '@/components/Modal'
import { compressPhoto } from '@/utils/imageCompressor'
import type { Asset, AssetCategory, AssetStatus } from '@/types'

interface Props {
  asset?: Asset | null
  onClose: () => void
  onSubmit: (data: Omit<Asset, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => void
}

const CATEGORY_OPTIONS: { value: AssetCategory; icon: string; label: string }[] = [
  { value: 'vehicle', icon: '🚗', label: '车辆' },
  { value: 'equipment', icon: '🔧', label: '设备' },
  { value: 'computer', icon: '💻', label: '电脑' },
  { value: 'warehouse', icon: '🏭', label: '仓储' },
  { value: 'other', icon: '📦', label: '其他' },
]

const STATUS_OPTIONS: { value: AssetStatus; label: string }[] = [
  { value: 'in_use', label: '使用中' },
  { value: 'idle', label: '闲置' },
  { value: 'disposed', label: '已处置' },
]

interface FormData {
  name: string
  category: AssetCategory
  purchaseDate: string
  amount: number
  currentStatus: AssetStatus
  description: string
  images: string[]
  location: string
}

const INITIAL_FORM: FormData = {
  name: '',
  category: 'other' as AssetCategory,
  purchaseDate: '',
  amount: 0,
  currentStatus: 'in_use' as AssetStatus,
  description: '',
  images: [],
  location: '',
}

interface FormErrors {
  name?: string
  purchaseDate?: string
  amount?: string
}

export default function AssetFormModal({ asset, onClose, onSubmit }: Props) {
  const isEdit = !!asset
  const [form, setForm] = useState<FormData>(INITIAL_FORM)
  const [errors, setErrors] = useState<FormErrors>({})
  const [compressing, setCompressing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (asset) {
      setForm({
        name: asset.name,
        category: asset.category,
        purchaseDate: asset.purchaseDate,
        amount: asset.amount ?? 0,
        currentStatus: asset.currentStatus,
        description: asset.description || '',
        images: asset.images || [],
        location: asset.location || '',
      })
    } else {
      setForm(INITIAL_FORM)
    }
    setErrors({})
  }, [asset])

  const updateField = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }))
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (form.images.length >= 3) {
      alert('最多上传3张图片')
      return
    }

    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件')
      return
    }

    setCompressing(true)
    try {
      const compressed = await compressPhoto(file)
      setForm((prev) => ({ ...prev, images: [...prev.images, compressed] }))
    } catch {
      alert('图片压缩失败，请重新选择')
    } finally {
      setCompressing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeImage = (index: number) => {
    setForm((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }))
  }

  const validate = (): boolean => {
    const newErrors: FormErrors = {}
    if (!form.name.trim()) newErrors.name = '请输入资产名称'
    if (!form.purchaseDate) newErrors.purchaseDate = '请选择购入日期'
    if (!form.amount || form.amount <= 0) newErrors.amount = '请输入有效的购入金额'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return
    onSubmit({
      name: form.name.trim(),
      category: form.category,
      purchaseDate: form.purchaseDate,
      amount: form.amount,
      currentStatus: form.currentStatus,
      description: form.description.trim(),
      images: form.images,
      location: form.location.trim(),
    })
  }

  return (
    <Modal isOpen onClose={onClose} size="lg" title={isEdit ? '编辑资产' : '添加资产'}>

      {/* 资产名称 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-brand-400 mb-1.5">
          资产名称 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => updateField('name', e.target.value)}
          maxLength={50}
          placeholder="例如：MacBook Pro x3"
          className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition ${
            errors.name ? 'border-red-300 bg-red-50' : 'border-brand-100'
          }`}
        />
        {errors.name && (
          <p className="text-xs text-red-500 mt-1">{errors.name}</p>
        )}
      </div>

      {/* 资产类别 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-brand-400 mb-2">
          资产类别 <span className="text-red-500">*</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => updateField('category', opt.value)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all flex items-center gap-1.5 ${
                form.category === opt.value
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-brand-100 text-brand-400 hover:border-gray-300'
              }`}
            >
              <span className="text-base">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 购入日期 + 购入金额 */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1.5">
            购入日期 <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={form.purchaseDate}
            onChange={(e) => updateField('purchaseDate', e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition ${
              errors.purchaseDate ? 'border-red-300 bg-red-50' : 'border-brand-100'
            }`}
          />
          {errors.purchaseDate && (
            <p className="text-xs text-red-500 mt-1">{errors.purchaseDate}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1.5">
            购入金额（元）<span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.amount || ''}
            onChange={(e) => updateField('amount', Number(e.target.value))}
            placeholder="0"
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition ${
              errors.amount ? 'border-red-300 bg-red-50' : 'border-brand-100'
            }`}
          />
          {errors.amount && (
            <p className="text-xs text-red-500 mt-1">{errors.amount}</p>
          )}
        </div>
      </div>

      {/* 当前状态 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-brand-400 mb-2">
          当前状态 <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-2">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => updateField('currentStatus', opt.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                form.currentStatus === opt.value
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-brand-100 text-brand-400 hover:border-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 存放位置 + 描述 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-brand-400 mb-1.5">
          存放位置
        </label>
        <input
          type="text"
          value={form.location}
          onChange={(e) => updateField('location', e.target.value)}
          maxLength={50}
          placeholder="例如：公司停车场"
          className="w-full px-3 py-2 border border-brand-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-brand-400 mb-1.5">
          描述
        </label>
        <textarea
          rows={3}
          value={form.description}
          onChange={(e) => updateField('description', e.target.value)}
          maxLength={200}
          placeholder="可选，最多200字"
          className="w-full px-3 py-2 border border-brand-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition resize-none"
        />
      </div>

      {/* 资产图片 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-brand-400 mb-2">
          资产图片 <span className="text-brand-200 font-normal">（最多3张）</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {form.images.map((img, i) => (
            <div key={i} className="relative group">
              <img
                src={img}
                alt={`资产图片 ${i + 1}`}
                className="w-20 h-20 object-cover rounded-lg border border-brand-100"
              />
              <button
                onClick={() => removeImage(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {form.images.length < 3 && (
            <label className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors">
              {compressing ? (
                <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
              ) : (
                <>
                  <Upload className="w-5 h-5 text-brand-200" />
                  <span className="text-xs text-brand-200 mt-0.5">上传</span>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </label>
          )}
        </div>
      </div>

      {/* 底部按钮 */}
      <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-gray-100 text-brand-400 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          保存
        </button>
      </div>
    </Modal>
  )
}
