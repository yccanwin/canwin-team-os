import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { User } from '@/types'
import { mockUsers } from '@/data/mockData'

interface UserState {
  users: User[]
  currentUser: User
}

interface UserActions {
  switchUser: (userId: string) => void
  setCurrentUser: (user: User | null) => void
  setUsers: (users: User[]) => void
  logout: () => void
  addBadge: (userId: string, badgeId: string) => void
  getUserById: (userId: string) => User | undefined

  // 成员管理 CRUD（Phase 8.4）
  addUser: (user: Omit<User, 'id'>) => void
  updateUser: (id: string, updates: Partial<User>) => void
  deleteUser: (id: string) => boolean
}

export const useUserStore = create<UserState & UserActions>()(
  persist(
    (set, get) => ({
      users: mockUsers,
      currentUser: null as unknown as User,

      switchUser: (userId) => {
        const user = get().users.find((u) => u.id === userId)
        if (user) {
          set({ currentUser: user })
        }
      },

      setCurrentUser: (user) => set({ currentUser: user as unknown as User }),

      setUsers: (users) => set({ users }),

      logout: () => set({ currentUser: null as unknown as User }),

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

    }),
    {
      name: 'canwin-users',
      version: 2,
      storage: safeStorage,
      migrate: (persisted) => {
        const state = persisted as Partial<UserState> | null
        return {
          users: state?.users && state.users.length > 0 ? state.users : mockUsers,
          currentUser: null as unknown as User,
        }
      },
    }
  )
)
