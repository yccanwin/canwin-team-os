import { useState, useRef } from 'react'
import { Upload, X, Loader2 } from 'lucide-react'
import { compressImage } from '@/utils/imageCompressor'

interface ImageUploaderProps {
  images: string[]
  onChange: (images: string[]) => void
}

const MAX_IMAGES = 9

export default function ImageUploader({ images, onChange }: ImageUploaderProps) {
  const [compressing, setCompressing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    if (images.length >= MAX_IMAGES) return

    const remaining = MAX_IMAGES - images.length
    const selected = Array.from(files).slice(0, remaining)
    const newImages: string[] = []

    setCompressing(true)
    for (const file of selected) {
      if (!file.type.startsWith('image/')) continue
      try {
        const compressed = await compressImage(file, 200)
        newImages.push(compressed)
      } catch {
        alert('图片压缩失败，请重新选择')
      }
    }
    setCompressing(false)

    if (newImages.length > 0) {
      onChange([...images, ...newImages])
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const removeImage = (index: number) => {
    onChange(images.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-brand-400">
        图片 ({images.length}/{MAX_IMAGES})
      </label>

      {/* 预览区 */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img, i) => (
            <div key={i} className="relative group">
              <img
                src={img}
                alt={`upload-${i}`}
                className="w-12 h-12 object-cover rounded-lg border border-brand-100"
              />
              <button
                onClick={() => removeImage(i)}
                className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 上传区 */}
      {images.length < MAX_IMAGES && (
        <>
          {compressing ? (
            <div className="flex items-center justify-center h-20 border-2 border-dashed border-gray-300 rounded-lg bg-brand-50">
              <Loader2 className="w-5 h-5 text-primary animate-spin mr-2" />
              <span className="text-sm text-brand-300">压缩中...</span>
            </div>
          ) : (
            <div
              ref={dropZoneRef}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="flex flex-col items-center justify-center h-20 border-2 border-dashed border-gray-300 rounded-lg bg-brand-50 hover:border-primary hover:bg-indigo-50 cursor-pointer transition-colors"
            >
              <Upload className="w-5 h-5 text-brand-200 mb-1" />
              <span className="text-xs text-brand-300">点击或拖拽上传</span>
            </div>
          )}
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />
    </div>
  )
}
