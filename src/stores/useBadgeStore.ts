import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { BadgeConfig } from '@/types'

/** 勋章弹窗展示用的轻量类型 */
export interface PendingBadge {
  id: string
  name: string
  icon: string
  description: string
  memoryWeight: number
}

interface BadgeState {
  badges: BadgeConfig[]
  /** 待展示的记忆标签队列 */
  pendingBadges: PendingBadge[]
}

interface BadgeActions {
  addBadge: (badge: Omit<BadgeConfig, 'id'>) => void
  updateBadge: (id: string, updates: Partial<BadgeConfig>) => void
  deleteBadge: (id: string) => void
  getBadgeById: (id: string) => BadgeConfig | undefined
  getBadgesByCategory: (category: BadgeConfig['category']) => BadgeConfig[]
  /** 展示队列出队一个 */
  dismissBadge: () => void
  /** 清理所有用户获得的勋章（保留勋章配置） */
  clearAllBadges: () => void
}

export const useBadgeStore = create<BadgeState & BadgeActions>()(
  persist(
    (set, get) => ({
      badges: [],
      pendingBadges: [],

      addBadge: (badge) =>
        set((state) => ({
          badges: [
            ...state.badges,
            { ...badge, id: crypto.randomUUID() },
          ],
        })),

      updateBadge: (id, updates) =>
        set((state) => ({
          badges: state.badges.map((b) =>
            b.id === id ? { ...b, ...updates } : b
          ),
        })),

      deleteBadge: (id) =>
        set((state) => ({
          badges: state.badges.filter((b) => b.id !== id),
        })),

      getBadgeById: (id) => {
        return get().badges.find((b) => b.id === id)
      },

      getBadgesByCategory: (category) => {
        return get().badges.filter((b) => b.category === category)
      },

      dismissBadge: () =>
        set((state) => ({
          pendingBadges: state.pendingBadges.slice(1),
        })),

      clearAllBadges: () => set({ pendingBadges: [] }),
    }),
    {
      name: 'canwin-badges',
      version: 2,
      storage: safeStorage,
      migrate: () => ({ badges: [], pendingBadges: [] }),
    }
  )
)
