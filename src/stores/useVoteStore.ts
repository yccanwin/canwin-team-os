import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { Vote } from '@/types'
import {
  castVoteRecord,
  closeVoteRecord,
  createVoteRecord,
  deleteVoteRecord,
} from '@/services/votes'

interface VoteStats {
  optionId: string
  label: string
  count: number
  percentage: number
}

interface VoteState {
  votes: Vote[]
}

interface VoteActions {
  setVotes: (votes: Vote[]) => void
  createVote: (vote: Omit<Vote, 'id' | 'votes'>) => void
  deleteVote: (id: string) => void
  castVote: (voteId: string, userId: string, optionId: string) => void
  getVoteStats: (voteId: string) => VoteStats[]
  closeVote: (id: string) => void
  clearAllVotes: () => void
}

export const useVoteStore = create<VoteState & VoteActions>()(
  persist(
    (set, get) => ({
      votes: [],

      setVotes: (votes) => set({ votes }),

      createVote: (vote) => {
        const optimisticVote = { ...vote, id: crypto.randomUUID(), votes: [] }
        set((state) => ({ votes: [optimisticVote, ...state.votes] }))
        void createVoteRecord(vote)
          .then((savedVote) =>
            set((state) => ({
              votes: state.votes.map((v) => (v.id === optimisticVote.id ? savedVote : v)),
            }))
          )
          .catch(() =>
            set((state) => ({
              votes: state.votes.filter((v) => v.id !== optimisticVote.id),
            }))
          )
      },

      deleteVote: (id) => {
        const previous = get().votes
        set((state) => ({ votes: state.votes.filter((v) => v.id !== id) }))
        void deleteVoteRecord(id).catch(() => set({ votes: previous }))
      },

      castVote: (voteId, userId, optionId) => {
        const previous = get().votes
        set((state) => ({
          votes: state.votes.map((v) => {
            if (v.id !== voteId) return v
            // 一人一票，已投则忽略（不可改票）
            const alreadyVoted = v.votes.some((r) => r.userId === userId)
            if (alreadyVoted) return v
            return {
              ...v,
              votes: [
                ...v.votes,
                { userId, optionId, votedAt: new Date().toISOString() },
              ],
            }
          }),
        }))
        void castVoteRecord(voteId, userId, optionId).catch(() => set({ votes: previous }))
      },

      getVoteStats: (voteId) => {
        const vote = get().votes.find((v) => v.id === voteId)
        if (!vote) return []

        const totalVotes = vote.votes.length
        return vote.options.map((opt) => {
          const count = vote.votes.filter(
            (r) => r.optionId === opt.id
          ).length
          return {
            optionId: opt.id,
            label: opt.label,
            count,
            percentage: totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0,
          }
        })
      },

      closeVote: (id) => {
        const previous = get().votes
        set((state) => ({
          votes: state.votes.map((v) =>
            v.id === id ? { ...v, isActive: false } : v
          ),
        }))
        void closeVoteRecord(id).catch(() => set({ votes: previous }))
      },

      clearAllVotes: () => set({ votes: [] }),
    }),
    {
      name: 'canwin-votes', storage: safeStorage,
    }
  )
)
