import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { Achievement } from '@/types'

interface AchievementState {
  achievements: Achievement[]

  addAchievement:    (data: Omit<Achievement, 'id' | 'createdAt'>) => void
  updateAchievement: (id: string, updates: Partial<Achievement>) => void
  deleteAchievement: (id: string) => void
}

export const useAchievementStore = create<AchievementState>()(
  persist(
    (set) => ({
      achievements: [],

      addAchievement: (data) =>
        set((s) => {
          const newAchievement: Achievement = {
            ...data,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
          }
          return {
            achievements: [...s.achievements, newAchievement].sort(
              (a, b) => b.achievedDate.localeCompare(a.achievedDate)
            ),
          }
        }),

      updateAchievement: (id, updates) =>
        set((s) => ({
          achievements: s.achievements
            .map((a) =>
              a.id === id
                ? { ...a, ...updates, updatedAt: new Date().toISOString() }
                : a
            )
            .sort((a, b) => b.achievedDate.localeCompare(a.achievedDate)),
        })),

      deleteAchievement: (id) =>
        set((s) => ({
          achievements: s.achievements.filter((a) => a.id !== id),
        })),
    }),
    {
      name: 'canwin-achievements', storage: safeStorage,
    }
  )
)
