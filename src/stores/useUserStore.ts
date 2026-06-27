import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { User } from '@/types'
import { mockUsers, currentUser } from '@/data/mockData'
import { getLevel } from '@/utils/xpCalculator'

interface UserState {
  users: User[]
  currentUser: User
}

interface UserActions {
  switchUser: (userId: string) => void
  addXP: (userId: string, amount: number) => void
  addBadge: (userId: string, badgeId: string) => void
  getUserById: (userId: string) => User | undefined

  // 成员管理 CRUD（Phase 8.4）
  addUser: (user: Omit<User, 'id'>) => void
  updateUser: (id: string, updates: Partial<User>) => void
  deleteUser: (id: string) => boolean
  resetUserXP: (id: string) => void
}

export const useUserStore = create<UserState & UserActions>()(
  persist(
    (set, get) => ({
      users: mockUsers,
      currentUser: currentUser,

      switchUser: (userId) => {
        const user = get().users.find((u) => u.id === userId)
        if (user) {
          set({ currentUser: user })
        }
      },

      addXP: (userId, amount) =>
        set((state) => {
          const updatedUsers = state.users.map((u) =>
            u.id === userId
              ? { ...u, xp: u.xp + amount, level: getLevel(u.xp + amount) }
              : u
          )
          const currentUserUpdated =
            state.currentUser.id === userId
              ? {
                  ...state.currentUser,
                  xp: state.currentUser.xp + amount,
                  level: getLevel(state.currentUser.xp + amount),
                }
              : state.currentUser
          return { users: updatedUsers, currentUser: currentUserUpdated }
        }),

      addBadge: (userId, badgeId) =>
        set((state) => ({
          users: state.users.map((u) =>
            u.id === userId && !u.badges.includes(badgeId)
              ? { ...u, badges: [...u.badges, badgeId] }
              : u
          ),
          currentUser:
            state.currentUser.id === userId &&
            !state.currentUser.badges.includes(badgeId)
              ? {
                  ...state.currentUser,
                  badges: [...state.currentUser.badges, badgeId],
                }
              : state.currentUser,
        })),

      getUserById: (userId) => {
        return get().users.find((u) => u.id === userId)
      },

      // ============================================================
      // 成员管理 CRUD
      // ============================================================

      addUser: (user) =>
        set((state) => ({
          users: [
            ...state.users,
            { ...user, id: crypto.randomUUID() },
          ],
        })),

      updateUser: (id, updates) =>
        set((state) => {
          const updatedUsers = state.users.map((u) =>
            u.id === id ? { ...u, ...updates } : u
          )
          // 如果更新的是当前登录用户，同步更新 currentUser
          const updatedCurrent =
            state.currentUser.id === id
              ? { ...state.currentUser, ...updates }
              : state.currentUser
          return { users: updatedUsers, currentUser: updatedCurrent }
        }),

      deleteUser: (id) => {
        // 不能删除自己
        if (id === get().currentUser.id) return false

        set((state) => ({
          users: state.users.filter((u) => u.id !== id),
        }))
        return true
      },

      resetUserXP: (id) =>
        set((state) => {
          const updatedUsers = state.users.map((u) =>
            u.id === id ? { ...u, xp: 0, level: 1 } : u
          )
          const updatedCurrent =
            state.currentUser.id === id
              ? { ...state.currentUser, xp: 0, level: 1 }
              : state.currentUser
          return { users: updatedUsers, currentUser: updatedCurrent }
        }),
    }),
    {
      name: 'canwin-users',
      storage: {
        getItem: (name: string) => {
          try {
            const v = localStorage.getItem(name)
            localStorage.setItem('debug-persist-get', JSON.stringify({ name, hasValue: !!v, valuePreview: v ? v.slice(0,80) : null, time: Date.now() }))
            return v
          } catch (e) {
            localStorage.setItem('debug-persist-get', JSON.stringify({ name, error: String(e), time: Date.now() }))
            return null
          }
        },
        setItem: (name: string, value: any) => {
          localStorage.setItem(name, typeof value === 'string' ? value : JSON.stringify(value))
        },
        removeItem: (name: string) => localStorage.removeItem(name),
      } as any,
      onRehydrateStorage: (state) => {
        localStorage.setItem('debug-persist-rehydrate', JSON.stringify({ currentUser: state?.currentUser?.name, userCount: state?.users?.length, time: Date.now() }))
      },
    }
  )
)
