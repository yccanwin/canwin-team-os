import { Calendar, MapPin, User, Upload, Edit3, Trash2, X, Camera } from 'lucide-react'
import type { Photo } from '@/types'
import { useUserStore } from '@/stores/useUserStore'

interface Props {
  photo: Photo
  onClose: () => void
  onEdit: (photo: Photo) => void
  onDelete: (id: string) => void
  canEdit: boolean
  canDelete: boolean
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function PhotoDetailModal({
  photo,
  onClose,
  onEdit,
  onDelete,
  canEdit,
  canDelete,
}: Props) {
  const users = useUserStore((s) => s.users)
  const uploader = users.find((u) => u.id === photo.uploadedBy)
  const participants = photo.participants
    .map((pid) => users.find((u) => u.id === pid))
    .filter(Boolean)

  const handleDelete = () => {
    if (window.confirm('确定删除这张照片吗？此操作不可撤销。')) {
      onDelete(photo.id)
      onClose()
    }
  }

  const handleEdit = () => {
    onEdit(photo)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* 弹窗 */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/30 hover:bg-black/50 text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* 大图 */}
        <div className="bg-black rounded-t-xl flex items-center justify-center min-h-[200px] max-h-[60vh] overflow-hidden">
          <img
            src={photo.url}
            alt={photo.title || '照片'}
            className="object-contain max-h-[60vh] w-full"
          />
        </div>

        <div className="p-6">
          {/* 标题 */}
          {photo.title && (
            <h2 className="font-heading text-lg font-semibold text-brand-400 mb-3">
              {photo.title}
            </h2>
          )}

          {/* 元信息 */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4 text-sm text-brand-300">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-brand-200" />
              <span>{photo.date}</span>
            </div>
            {photo.location && (
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-brand-200" />
                <span>{photo.location}</span>
              </div>
            )}
          </div>

          {/* 描述 */}
          {photo.description && (
            <p className="text-sm text-brand-400 leading-relaxed mb-4">
              {photo.description}
            </p>
          )}

          {/* 参与人 */}
          {participants.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 text-sm text-brand-300 mb-2">
                <User className="w-4 h-4 text-brand-200" />
                <span>参与人</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {participants.map((u) => (
                  <span
                    key={u!.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 text-xs text-indigo-700 font-medium"
                  >
                    {u!.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 上传信息 */}
          <div className="flex items-center gap-1.5 text-xs text-brand-200 mb-5 pt-3 border-t border-gray-100">
            <Upload className="w-3.5 h-3.5" />
            <span>
              上传人：{uploader?.name || '未知'} · {formatDate(photo.uploadedAt)}
            </span>
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-between items-center">
            <div className="flex gap-2">
              {canEdit && (
                <button
                  onClick={handleEdit}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
                >
                  <Edit3 className="w-4 h-4 inline mr-1" />
                  编辑
                </button>
              )}
              {canDelete && (
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
                >
                  <Trash2 className="w-4 h-4 inline mr-1" />
                  删除
                </button>
              )}
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-100 text-brand-400 rounded-lg text-sm hover:bg-gray-200 transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
