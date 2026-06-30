import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { Photo } from '@/types'
import {
  createPhotoRecord,
  deletePhotoRecord,
  updatePhotoRecord,
} from '@/services/photos'

interface PhotoState {
  photos: Photo[]

  setPhotos:   (photos: Photo[]) => void
  addPhoto:    (data: Omit<Photo, 'id' | 'uploadedAt' | 'year' | 'month'>) => void
  updatePhoto: (id: string, updates: Partial<Photo>) => void
  deletePhoto: (id: string) => void
}

/**
 * 从 YYYY-MM-DD 解析出 year 和 month
 */
function parseYearMonth(dateStr: string): { year: number; month: number } {
  const [y, m] = dateStr.split('-').map(Number)
  return { year: y, month: m }
}

export const usePhotoStore = create<PhotoState>()(
  persist(
    (set, get) => ({
      photos: [],

      setPhotos: (photos) => set({ photos }),

      addPhoto: (data) => {
        let optimisticPhoto: Photo
        set((s) => {
          const { year, month } = parseYearMonth(data.date)
          const newPhoto: Photo = {
            ...data,
            id: crypto.randomUUID(),
            uploadedAt: new Date().toISOString(),
            year,
            month,
          }
          optimisticPhoto = newPhoto
          return {
            photos: [...s.photos, newPhoto].sort(
              (a, b) => b.date.localeCompare(a.date)
            ),
          }
        })
        void createPhotoRecord(data)
          .then((savedPhoto) =>
            set((state) => ({
              photos: state.photos
                .map((p) => (p.id === optimisticPhoto.id ? savedPhoto : p))
                .sort((a, b) => b.date.localeCompare(a.date)),
            }))
          )
          .catch(() =>
            set((state) => ({
              photos: state.photos.filter((p) => p.id !== optimisticPhoto.id),
            }))
          )
      },

      updatePhoto: (id, updates) => {
        const previous = get().photos
        set((s) => ({
          photos: s.photos.map((p) => {
            if (p.id !== id) return p
            const merged = { ...p, ...updates }
            // 如果更新了 date，重新解析 year/month
            if (updates.date) {
              const { year, month } = parseYearMonth(updates.date)
              return { ...merged, year, month }
            }
            return merged
          }),
        }))
        void updatePhotoRecord(id, updates).catch(() => set({ photos: previous }))
      },

      deletePhoto: (id) => {
        const previous = get().photos
        set((s) => ({
          photos: s.photos.filter((p) => p.id !== id),
        }))
        void deletePhotoRecord(id).catch(() => set({ photos: previous }))
      },
    }),
    {
      name: 'canwin-photos', storage: safeStorage,
    }
  )
)
