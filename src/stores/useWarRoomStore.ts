import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WarRoomPolicy, WarRoomComment } from '@/types/warroom'
import { safeStorage } from '@/utils/safeStorage'

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

  addPolicy: (data: { title: string; content: string; creatorId: string }) => void
  deletePolicy: (id: string) => void

  addComment: (policyId: string, userId: string, content: string) => void
  deleteComment: (policyId: string, commentId: string) => void
}

export const useWarRoomStore = create<WarRoomState>()(
  persist(
    (set, get) => ({
      policies: [],

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
      },

      deletePolicy: (id) => {
        set((s) => ({ policies: s.policies.filter((p) => p.id !== id) }))
      },

      addComment: (policyId, userId, content) => {
        const comment: WarRoomComment = {
          id: genCommentId(),
          policyId,
          userId,
          content,
          createdAt: new Date().toISOString(),
        }
        set((s) => ({
          policies: s.policies.map((p) =>
            p.id === policyId ? { ...p, comments: [...p.comments, comment] } : p
          ),
        }))
      },

      deleteComment: (policyId, commentId) => {
        set((s) => ({
          policies: s.policies.map((p) =>
            p.id === policyId
              ? { ...p, comments: p.comments.filter((c) => c.id !== commentId) }
              : p
          ),
        }))
      },
    }),
    {
      name: 'canwin-warroom',
      storage: safeStorage,
      version: 1,
    }
  )
)
