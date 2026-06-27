import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ChevronLeft, ChevronRight, Calendar, User, Clock, Edit3, Trash2, ArrowRight, Link } from 'lucide-react'
import type { Achievement } from '@/types'
import { useUserStore } from '@/stores/useUserStore'

interface Props {
  achievement: Achievement
  onClose: () => void
  onEdit: (achievement: Achievement) => void
  onDelete: (id: string) => void
  isCaptain: boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  chain: '连锁',
  'big-meal': '大餐',
  'small-meal': '小餐',
  other: '其他',
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

export default function AchievementDetailModal({
  achievement,
  onClose,
  onEdit,
  onDelete,
  isCaptain,
}: Props) {
  const navigate = useNavigate()
  const users = useUserStore((s) => s.users)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const creator = users.find((u) => u.id === achievement.createdBy)

  const goPrev = () => {
    if (previewIndex !== null && previewIndex > 0) setPreviewIndex(previewIndex - 1)
  }
  const goNext = () => {
    if (previewIndex !== null && previewIndex < achievement.images.length - 1)
      setPreviewIndex(previewIndex + 1)
  }

  const handleGotoTimeline = () => {
    navigate('/timeline')
    onClose()
  }

  const handleDelete = () => {
    onDelete(achievement.id)
    setShowDeleteConfirm(false)
    onClose()
  }

  return (
    <>
      {/* 遮罩 + 弹窗 */}
      <div
        className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-12 pb-12 overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between p-6 pb-4 border-b border-gray-100">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              {achievement.icon ? (
                <img
                  src={achievement.icon}
                  alt={achievement.name}
                  className="w-16 h-16 object-contain rounded-xl border border-gray-100 flex-shrink-0"
                />
              ) : (
                <span className="text-5xl flex-shrink-0 text-neutral-tertiary">🏢</span>
              )}
              <div className="min-w-0">
                <h2 className="font-heading text-xl font-bold text-brand-400 break-words">
                  {achievement.name}
                </h2>
                <div className="flex items-center gap-3 mt-1 text-sm text-brand-300">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {achievement.achievedDate}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-600">
                    {CATEGORY_LABELS[achievement.category] || achievement.category}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
            >
              <X className="w-5 h-5 text-brand-200" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-5">
            {/* Description */}
            {achievement.description && (
              <div>
                <h3 className="font-heading text-sm font-semibold text-brand-400 mb-2">案例描述</h3>
                <p className="text-sm text-brand-400 leading-relaxed">
                  {achievement.description}
                </p>
              </div>
            )}

            {/* Images Grid */}
            {achievement.images.length > 0 && (
              <div>
                <h3 className="font-heading text-sm font-semibold text-brand-400 mb-2">
                  图片 ({achievement.images.length})
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {achievement.images.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setPreviewIndex(idx)}
                      className="relative aspect-square rounded-lg overflow-hidden border border-brand-100 hover:ring-2 hover:ring-indigo-400 transition-all group cursor-pointer"
                    >
                      <img
                        src={img}
                        alt={`${achievement.name} 图片 ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 关联编年史 */}
            {achievement.timelineEventId && (
              <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Link className="w-4 h-4 text-indigo-500" />
                  <span className="text-sm font-semibold text-indigo-700">关联编年史</span>
                </div>
                <button
                  onClick={handleGotoTimeline}
                  className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
                >
                  查看事件详情
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Footer: creator + time */}
            <div className="flex items-center gap-2 pt-2 text-xs text-brand-200">
              <User className="w-3.5 h-3.5" />
              <span>创建人：{creator?.name || achievement.createdBy}</span>
              <span className="mx-1">·</span>
              <Clock className="w-3.5 h-3.5" />
              <span>{formatRelativeTime(achievement.createdAt)}</span>
              {achievement.updatedAt && (
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
                    onClick={() => onEdit(achievement)}
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

      {/* 删除确认 */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-heading text-lg font-semibold text-brand-400">确认删除</h3>
            <p className="mt-2 text-sm text-brand-400">
              确定要删除案例「{achievement.name}」吗？此操作不可撤销。
            </p>
            <div className="flex gap-3 mt-5 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-brand-400 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
              >
                确定删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 全屏图片预览 */}
      {previewIndex !== null && (
        <div
          className="fixed inset-0 bg-black/90 z-[70] flex items-center justify-center"
          onClick={() => setPreviewIndex(null)}
        >
          <button
            onClick={() => setPreviewIndex(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
          >
            <X className="w-6 h-6 text-white" />
          </button>

          {achievement.images.length > 1 && previewIndex > 0 && (
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

          {achievement.images.length > 1 && previewIndex < achievement.images.length - 1 && (
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

          <img
            src={achievement.images[previewIndex]}
            alt={`${achievement.name} 图片 ${previewIndex + 1}`}
            className="max-w-[90vw] max-h-[85vh] object-contain select-none"
            onClick={(e) => e.stopPropagation()}
          />

          {achievement.images.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-white/10 text-white text-sm">
              {previewIndex + 1} / {achievement.images.length}
            </div>
          )}
        </div>
      )}
    </>
  )
}
