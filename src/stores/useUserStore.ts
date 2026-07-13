import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { User } from '@/types'

interface UserState {
  users: User[]
  currentUser: User
}

interface UserActions {
  setCurrentUser: (user: User | null) => void
  setUsers: (users: User[]) => void
  logout: () => void
  getUserById: (userId: string) => User | undefined

  // 成员管理 CRUD（Phase 8.4）
  addUser: (user: User) => void
  updateUser: (id: string, updates: Partial<User>) => void
  deleteUser: (id: string) => boolean
}

export const useUserStore = create<UserState & UserActions>()(
  persist(
    (set, get) => ({
      users: [],
      currentUser: null as unknown as User,

      setCurrentUser: (user) => set({ currentUser: user as unknown as User }),

      setUsers: (users) => set({ users }),

      logout: () => set({ currentUser: null as unknown as User }),

      getUserById: (userId) => {
        return get().users.find((u) => u.id === userId)
      },

      // ============================================================
      // 成员管理 CRUD
      // ============================================================

      addUser: (user) =>
        set((state) => ({
          users: [...state.users.filter((item) => item.id !== user.id), user],
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
      version: 3,
      storage: safeStorage,
      migrate: () => {
        return {
          users: [],
          currentUser: null as unknown as User,
        }
      },
    }
  )
)
