import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { Achievement } from '@/types'
import {
  createAchievementRecord,
  deleteAchievementRecord,
  updateAchievementRecord,
} from '@/services/achievements'

interface AchievementState {
  achievements: Achievement[]

  setAchievements:   (achievements: Achievement[]) => void
  addAchievement:    (data: Omit<Achievement, 'id' | 'createdAt'>) => void
  updateAchievement: (id: string, updates: Partial<Achievement>) => void
  deleteAchievement: (id: string) => void
}

export const useAchievementStore = create<AchievementState>()(
  persist(
    (set, get) => ({
      achievements: [],

      setAchievements: (achievements) => set({ achievements }),

      addAchievement: (data) => {
        let optimisticAchievement: Achievement
        set((s) => {
          const newAchievement: Achievement = {
            ...data,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
          }
          optimisticAchievement = newAchievement
          return {
            achievements: [...s.achievements, newAchievement].sort(
              (a, b) => b.achievedDate.localeCompare(a.achievedDate)
            ),
          }
        })
        void createAchievementRecord(data)
          .then((savedAchievement) =>
            set((state) => ({
              achievements: state.achievements
                .map((a) => (a.id === optimisticAchievement.id ? savedAchievement : a))
                .sort((a, b) => b.achievedDate.localeCompare(a.achievedDate)),
            }))
          )
          .catch(() =>
            set((state) => ({
              achievements: state.achievements.filter((a) => a.id !== optimisticAchievement.id),
            }))
          )
      },

      updateAchievement: (id, updates) => {
        const previous = get().achievements
        set((s) => ({
          achievements: s.achievements
            .map((a) =>
              a.id === id
                ? { ...a, ...updates, updatedAt: new Date().toISOString() }
                : a
            )
            .sort((a, b) => b.achievedDate.localeCompare(a.achievedDate)),
        }))
        void updateAchievementRecord(id, updates).catch(() => set({ achievements: previous }))
      },

      deleteAchievement: (id) => {
        const previous = get().achievements
        set((s) => ({
          achievements: s.achievements.filter((a) => a.id !== id),
        }))
        void deleteAchievementRecord(id).catch(() => set({ achievements: previous }))
      },
    }),
    {
      name: 'canwin-achievements',
      version: 2,
      storage: safeStorage,
      migrate: () => ({ achievements: [] }),
    }
  )
)
