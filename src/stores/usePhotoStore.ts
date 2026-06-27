import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { Photo } from '@/types'

interface PhotoState {
  photos: Photo[]

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
    (set) => ({
      photos: [],

      addPhoto: (data) =>
        set((s) => {
          const { year, month } = parseYearMonth(data.date)
          const newPhoto: Photo = {
            ...data,
            id: crypto.randomUUID(),
            uploadedAt: new Date().toISOString(),
            year,
            month,
          }
          return {
            photos: [...s.photos, newPhoto].sort(
              (a, b) => b.date.localeCompare(a.date)
            ),
          }
        }),

      updatePhoto: (id, updates) =>
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
        })),

      deletePhoto: (id) =>
        set((s) => ({
          photos: s.photos.filter((p) => p.id !== id),
        })),
    }),
    {
      name: 'canwin-photos', storage: safeStorage,
    }
  )
)
