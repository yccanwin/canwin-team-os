import { useState, useRef } from 'react'
import { Paperclip, X } from 'lucide-react'
import type { TimelineEvent } from '@/types'

interface FileUploaderProps {
  files: TimelineEvent['attachments']
  onChange: (files: TimelineEvent['attachments']) => void
}

const MAX_FILES = 5
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function FileUploader({ files, onChange }: FileUploaderProps) {
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    if (files.length >= MAX_FILES) return

    const remaining = MAX_FILES - files.length
    const selected = Array.from(fileList).slice(0, remaining)
    const newFiles: TimelineEvent['attachments'] = []

    setLoading(true)
    for (const file of selected) {
      if (file.size > MAX_FILE_SIZE) {
        alert(`文件「${file.name}」超过 2MB 限制，请重新选择`)
        continue
      }

      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error('读取失败'))
          reader.readAsDataURL(file)
        })

        newFiles.push({
          name: file.name,
          url: dataUrl,
          size: file.size,
          type: file.type,
        })
      } catch {
        alert(`文件「${file.name}」读取失败`)
      }
    }
    setLoading(false)

    if (newFiles.length > 0) {
      onChange([...files, ...newFiles])
    }
  }

  const removeFile = (index: number) => {
    onChange(files.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-brand-400">
        附件 ({files.length}/{MAX_FILES})
      </label>

      {/* 文件列表 */}
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((file, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-3 py-2 bg-brand-50 rounded-lg border border-brand-100 group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Paperclip className="w-4 h-4 text-brand-200 flex-shrink-0" />
                <span className="text-sm text-brand-400 truncate">
                  {file.name}
                </span>
                <span className="text-xs text-brand-200 flex-shrink-0">
                  {formatSize(file.size)}
                </span>
              </div>
              <button
                onClick={() => removeFile(i)}
                className="p-0.5 rounded hover:bg-red-50 text-brand-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 上传按钮 */}
      {files.length < MAX_FILES && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-primary border border-dashed border-primary/30 rounded-lg hover:bg-indigo-50 transition-colors disabled:opacity-50"
        >
          <Paperclip className="w-4 h-4" />
          {loading ? '读取中...' : '上传附件（PDF/DOC，≤2MB）'}
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />
    </div>
  )
}
