import { useState, useMemo } from 'react'
import { Camera } from 'lucide-react'
import EmptyStateIllustration from '@/components/EmptyStateIllustration'
import { usePhotoStore } from '@/stores/usePhotoStore'
import { useUserStore } from '@/stores/useUserStore'
import PhotoUploadModal from '@/pages/Photos/PhotoUploadModal'
import PhotoDetailModal from '@/pages/Photos/PhotoDetailModal'
import type { Photo } from '@/types'

// ============================================================
// 按年月分组（年份倒序、月份倒序）
// ============================================================
function groupPhotosByYearMonth(photos: Photo[]) {
  const grouped: Record<number, Record<number, Photo[]>> = {}

  photos.forEach((photo) => {
    if (!grouped[photo.year]) grouped[photo.year] = {}
    if (!grouped[photo.year][photo.month]) grouped[photo.year][photo.month] = []
    grouped[photo.year][photo.month].push(photo)
  })

  return Object.entries(grouped)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([year, months]) => ({
      year: Number(year),
      months: Object.entries(months)
        .sort(([a], [b]) => Number(b) - Number(a))
        .map(([month, photos]) => ({
          month: Number(month),
          count: photos.length,
          photos,
        })),
    }))
}

export default function PhotosPage() {
  const photos = usePhotoStore((s) => s.photos)
  const addPhoto = usePhotoStore((s) => s.addPhoto)
  const updatePhoto = usePhotoStore((s) => s.updatePhoto)
  const deletePhoto = usePhotoStore((s) => s.deletePhoto)
  const currentUser = useUserStore((s) => s.currentUser)

  const [showUpload, setShowUpload] = useState(false)
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null)
  const [detailPhoto, setDetailPhoto] = useState<Photo | null>(null)

  const grouped = useMemo(() => groupPhotosByYearMonth(photos), [photos])

  // ============ 提交处理 ============
  const handleUploadSubmit = async (
    data: Omit<Photo, 'id' | 'uploadedAt' | 'year' | 'month' | 'uploadedBy'>
  ) => {
    addPhoto({ ...data, uploadedBy: currentUser!.id })
  }

  const handleEditSubmit = async (
    data: Omit<Photo, 'id' | 'uploadedAt' | 'year' | 'month' | 'uploadedBy'>
  ) => {
    if (editingPhoto) {
      updatePhoto(editingPhoto.id, data)
    }
  }

  const handleDelete = (id: string) => {
    if (window.confirm('确定删除这张照片吗？此操作不可撤销。')) {
      deletePhoto(id)
    }
  }

  // ============ 打开编辑 ============
  const handleEdit = (photo: Photo) => {
    setEditingPhoto(photo)
    setShowUpload(true)
  }

  return (
    <div className="px-3 lg:px-6 py-4">
      {/* ============ 标题栏 ============ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="font-heading text-xl font-semibold text-brand-400">相册</h1>
          <p className="text-sm text-brand-300 mt-1">保存团队现场、活动和日常瞬间</p>
        </div>
        <button
          onClick={() => {
            setEditingPhoto(null)
            setShowUpload(true)
          }}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 sm:w-auto"
        >
          <Camera className="w-4 h-4" />
          上传照片
        </button>
      </div>

      {/* ============ 空状态 ============ */}
      {photos.length === 0 ? (
        <EmptyStateIllustration
          variant="photos"
          title="上传第一张团队照片吧"
          description="记录团队生活的精彩瞬间"
          action={
            <button
              onClick={() => {
                setEditingPhoto(null)
                setShowUpload(true)
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              <Camera className="w-4 h-4" />
              上传照片
            </button>
          }
        />
      ) : (
        <div className="space-y-8">
          {grouped.map(({ year, months }) => (
            <div key={year}>
              {/* 年份标题 */}
              <h2 className="font-heading text-xl font-bold text-brand-400 mb-4 pb-2 border-b border-brand-100">
                {year}年
              </h2>

              {months.map(({ month, count, photos: monthPhotos }) => (
                <div key={month} className="mb-6">
                  {/* 月份标题 */}
                  <h3 className="font-heading text-lg font-semibold text-brand-400 mb-3">
                    {month}月{' '}
                    <span className="text-sm font-normal text-brand-200">
                      ({count}张)
                    </span>
                  </h3>

                  {/* 照片网格 */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                    {monthPhotos.map((photo) => (
                      <div
                        key={photo.id}
                        onClick={() => setDetailPhoto(photo)}
                        className="aspect-square rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity bg-gray-100 group relative"
                      >
                        <img
                          src={photo.url}
                          alt={photo.title || '照片'}
                          className="w-full h-full object-cover"
                        />
                        {/* 悬停浮层 */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-end p-2 opacity-0 group-hover:opacity-100">
                          {photo.title && (
                            <span className="text-white text-xs font-medium truncate">
                              {photo.title}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ============ 上传/编辑弹窗 ============ */}
      {showUpload && (
        <PhotoUploadModal
          photo={editingPhoto}
          onClose={() => {
            setShowUpload(false)
            setEditingPhoto(null)
          }}
          onSubmit={editingPhoto ? handleEditSubmit : handleUploadSubmit}
        />
      )}

      {/* ============ 详情弹窗 ============ */}
      {detailPhoto && (
        <PhotoDetailModal
          photo={detailPhoto}
          onClose={() => setDetailPhoto(null)}
          onEdit={handleEdit}
          onDelete={handleDelete}
          canEdit={true}
          canDelete={true}
        />
      )}
    </div>
  )
}
