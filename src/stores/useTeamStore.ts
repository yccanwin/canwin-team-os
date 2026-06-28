import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CANWIN_TEAM_ID, CANWIN_TEAM_NAME } from '@/config/team'
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
      teamId: CANWIN_TEAM_ID,
      teamName: CANWIN_TEAM_NAME,

      createTeam: (customId) => {
        const id = customId?.trim() || CANWIN_TEAM_ID
        set({ teamId: CANWIN_TEAM_ID, teamName: CANWIN_TEAM_NAME })
        return id
      },

      joinTeam: () => set({ teamId: CANWIN_TEAM_ID, teamName: CANWIN_TEAM_NAME }),

      leaveTeam: () => set({ teamId: CANWIN_TEAM_ID, teamName: CANWIN_TEAM_NAME }),

      setTeamName: (name) => set({ teamName: name }),
    }),
    {
      name: 'canwin-team',
      version: 2,
      storage: safeStorage,
      migrate: () => ({
        teamId: CANWIN_TEAM_ID,
        teamName: CANWIN_TEAM_NAME,
      }),
    }
  )
)
