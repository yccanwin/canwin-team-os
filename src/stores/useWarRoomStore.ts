import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WarRoomPolicy, WarRoomComment } from '@/types/warroom'
import { safeStorage } from '@/utils/safeStorage'
import {
  createWarRoomPolicy,
  deleteWarRoomPolicyRecord,
  updateWarRoomPolicy,
} from '@/services/warroom'

let commentIdCounter = Date.now()
let policyIdCounter = Date.now()

function genPolicyId() {
  return `policy-${++policyIdCounter}-${Math.random().toString(36).slice(2, 6)}`
}

function genCommentId() {
  return `comment-${++commentIdCounter}-${Math.random().toString(36).slice(2, 6)}`
}

interface WarRoomState {
  policies: WarRoomPolicy[]

  setPolicies: (policies: WarRoomPolicy[]) => void
  addPolicy: (data: { title: string; content: string; creatorId: string }) => void
  deletePolicy: (id: string) => void

  addComment: (policyId: string, userId: string, content: string) => void
  deleteComment: (policyId: string, commentId: string) => void
}

export const useWarRoomStore = create<WarRoomState>()(
  persist(
    (set, get) => ({
      policies: [],

      setPolicies: (policies) => set({ policies }),

      addPolicy: ({ title, content, creatorId }) => {
        const policy: WarRoomPolicy = {
          id: genPolicyId(),
          title,
          content,
          creatorId,
          createdAt: new Date().toISOString(),
          comments: [],
        }
        set((s) => ({ policies: [policy, ...s.policies] }))
        void createWarRoomPolicy(policy)
          .then((savedPolicy) =>
            set((s) => ({
              policies: s.policies.map((p) => (p.id === policy.id ? savedPolicy : p)),
            }))
          )
          .catch(() =>
            set((s) => ({
              policies: s.policies.filter((p) => p.id !== policy.id),
            }))
          )
      },

      deletePolicy: (id) => {
        const previous = get().policies
        set((s) => ({ policies: s.policies.filter((p) => p.id !== id) }))
        void deleteWarRoomPolicyRecord(id).catch(() => set({ policies: previous }))
      },

      addComment: (policyId, userId, content) => {
        const comment: WarRoomComment = {
          id: genCommentId(),
          policyId,
          userId,
          content,
          createdAt: new Date().toISOString(),
        }
        const previous = get().policies
        let changedPolicy: WarRoomPolicy | undefined
        set((s) => ({
          policies: s.policies.map((p) => {
            if (p.id !== policyId) return p
            changedPolicy = { ...p, comments: [...p.comments, comment] }
            return changedPolicy
          }),
        }))
        if (changedPolicy) {
          void updateWarRoomPolicy(changedPolicy).catch(() => set({ policies: previous }))
        }
      },

      deleteComment: (policyId, commentId) => {
        const previous = get().policies
        let changedPolicy: WarRoomPolicy | undefined
        set((s) => ({
          policies: s.policies.map((p) => {
            if (p.id !== policyId) return p
            changedPolicy = {
              ...p,
              comments: p.comments.filter((c) => c.id !== commentId),
            }
            return changedPolicy
          }),
        }))
        if (changedPolicy) {
          void updateWarRoomPolicy(changedPolicy).catch(() => set({ policies: previous }))
        }
      },
    }),
    {
      name: 'canwin-warroom',
      storage: safeStorage,
      version: 2,
      migrate: () => ({ policies: [] }),
    }
  )
)
