import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ChevronLeft, ChevronRight, Download, User, Calendar, Tag, Trash2, Edit3, Clock, Users } from 'lucide-react'
import type { TimelineEvent } from '../../types/timeline'
import { CATEGORY_CONFIG } from '../../types/timeline'
import { useUserStore } from '../../stores/useUserStore'

interface EventDetailProps {
  event: TimelineEvent
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  isCaptain: boolean
}

function renderMarkdown(text: string): string {
  if (!text) return ''
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:underline">$1</a>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>')
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatRelativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = now - then

  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`

  const hours = Math.floor(diff / 3600000)
  if (hours < 24) return `${hours}小时前`

  const days = Math.floor(diff / 86400000)
  if (days < 7) return `${days}天前`

  const date = new Date(iso)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function EventDetail({ event, onClose, onEdit, onDelete, isCaptain }: EventDetailProps) {
  const navigate = useNavigate()
  const users = useUserStore((s) => s.users)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const cat = CATEGORY_CONFIG[event.category]

  const participantsData = useMemo(
    () => event.participants.map((uid) => users.find((u) => u.id === uid)).filter(Boolean),
    [event.participants, users],
  )

  const creator = users.find((u) => u.id === event.createdBy)

  const handleDownload = (attachment: TimelineEvent['attachments'][number]) => {
    const link = document.createElement('a')
    link.href = attachment.url
    link.download = attachment.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleUserClick = (userId: string) => {
    navigate(`/profile?id=${userId}`)
  }

  // Preview navigation
  const goPrev = () => {
    if (previewIndex !== null && previewIndex > 0) setPreviewIndex(previewIndex - 1)
  }
  const goNext = () => {
    if (previewIndex !== null && previewIndex < event.images.length - 1) setPreviewIndex(previewIndex + 1)
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-12 pb-12 overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-start justify-between p-6 pb-4 border-b border-gray-100">
            <div className="flex-1 min-w-0 pr-4">
              <h2 className="font-heading text-xl font-bold text-brand-400 break-words">{event.title}</h2>
              <div className="flex items-center gap-3 mt-2 text-sm text-brand-300">
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {event.date}
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cat.bg} ${cat.text}`}
                >
                  <Tag className="w-3 h-3" />
                  {cat.label}
                </span>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0">
              <X className="w-5 h-5 text-brand-200" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-5">
            {/* Description */}
            {event.description && (
              <div>
                <h3 className="font-heading text-sm font-semibold text-brand-400 mb-2">事件描述</h3>
                <div
                  className="text-sm text-brand-400 leading-relaxed prose-sm"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(event.description) }}
                />
              </div>
            )}

            {/* Images Grid */}
            {event.images.length > 0 && (
              <div>
                <h3 className="font-heading text-sm font-semibold text-brand-400 mb-2">
                  图片 ({event.images.length})
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {event.images.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setPreviewIndex(idx)}
                      className="relative aspect-square rounded-lg overflow-hidden border border-brand-100 hover:ring-2 hover:ring-indigo-400 transition-all group cursor-pointer"
                    >
                      <img
                        src={img}
                        alt={`${event.title} 图片 ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Attachments */}
            {event.attachments.length > 0 && (
              <div>
                <h3 className="font-heading text-sm font-semibold text-brand-400 mb-2">
                  附件 ({event.attachments.length})
                </h3>
                <div className="space-y-1.5">
                  {event.attachments.map((att, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleDownload(att)}
                      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg hover:bg-brand-50 transition-colors text-left group"
                    >
                      <Download className="w-4 h-4 text-brand-200 group-hover:text-indigo-500 transition-colors" />
                      <span className="flex-1 text-sm text-brand-400 truncate">{att.name}</span>
                      <span className="text-xs text-brand-200">{formatFileSize(att.size)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Participants */}
            {participantsData.length > 0 && (
              <div>
                <h3 className="font-heading text-sm font-semibold text-brand-400 mb-2">
                  <Users className="w-4 h-4 inline mr-1" />
                  参与人 ({participantsData.length})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {participantsData.map((user) => (
                    user && (
                      <button
                        key={user.id}
                        onClick={() => handleUserClick(user.id)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-50 hover:bg-indigo-50 transition-colors border border-gray-100"
                      >
                        <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-indigo-600">
                            {user.name?.charAt(0) || user.id.charAt(0)}
                          </span>
                        </div>
                        <span className="text-sm text-brand-400">{user.name || user.id}</span>
                      </button>
                    )
                  ))}
                </div>
              </div>
            )}

            {/* Footer: creator + time */}
            <div className="flex items-center gap-2 pt-2 text-xs text-brand-200">
              <User className="w-3.5 h-3.5" />
              <span>创建人：{creator?.name || event.createdBy}</span>
              <span className="mx-1">·</span>
              <Clock className="w-3.5 h-3.5" />
              <span>{formatRelativeTime(event.createdAt)}</span>
              {event.updatedAt && (
                <>
                  <span className="mx-1">·</span>
                  <span>已编辑</span>
                </>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between p-4 border-t border-gray-100 bg-brand-50 rounded-b-2xl">
            <div className="flex gap-2">
              {isCaptain && (
                <>
                  <button
                    onClick={onEdit}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-indigo-600 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                    编辑
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    删除
                  </button>
                </>
              )}
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-brand-400 bg-white border border-brand-100 rounded-lg hover:bg-gray-100 transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading text-lg font-semibold text-brand-400">确认删除</h3>
            <p className="mt-2 text-sm text-brand-400">确定要删除该事件吗？此操作不可撤销。</p>
            <div className="flex gap-3 mt-5 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-brand-400 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  onDelete()
                  setShowDeleteConfirm(false)
                  onClose()
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
              >
                确定删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Image Preview */}
      {previewIndex !== null && (
        <div
          className="fixed inset-0 bg-black/90 z-[70] flex items-center justify-center"
          onClick={() => setPreviewIndex(null)}
        >
          {/* Close button */}
          <button
            onClick={() => setPreviewIndex(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
          >
            <X className="w-6 h-6 text-white" />
          </button>

          {/* Prev Arrow */}
          {event.images.length > 1 && previewIndex > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                goPrev()
              }}
              className="absolute left-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
            >
              <ChevronLeft className="w-6 h-6 text-white" />
            </button>
          )}

          {/* Next Arrow */}
          {event.images.length > 1 && previewIndex < event.images.length - 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                goNext()
              }}
              className="absolute right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
            >
              <ChevronRight className="w-6 h-6 text-white" />
            </button>
          )}

          {/* Image */}
          <img
            src={event.images[previewIndex]}
            alt={`${event.title} 图片 ${previewIndex + 1}`}
            className="max-w-[90vw] max-h-[85vh] object-contain select-none"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Counter */}
          {event.images.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-white/10 text-white text-sm">
              {previewIndex + 1} / {event.images.length}
            </div>
          )}
        </div>
      )}
    </>
  )
}
