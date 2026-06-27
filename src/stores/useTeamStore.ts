import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'

// 团队状态（仅存 teamId，不存业务数据）
interface TeamState {
  teamId: string | null
  teamName: string
}

interface TeamActions {
  createTeam: (customId?: string) => string
  joinTeam: (id: string) => void
  leaveTeam: () => void
  setTeamName: (name: string) => void
}

export const useTeamStore = create<TeamState & TeamActions>()(
  persist(
    (set) => ({
      teamId: null,
      teamName: '',

      createTeam: (customId) => {
        const id = customId?.trim() || crypto.randomUUID().slice(0, 8).toUpperCase()
        set({ teamId: id })
        return id
      },

      joinTeam: (id) => set({ teamId: id.trim() }),

      leaveTeam: () => set({ teamId: null, teamName: '' }),

      setTeamName: (name) => set({ teamName: name }),
    }),
    {
      name: 'canwin-team',
      storage: safeStorage,
    }
  )
)
