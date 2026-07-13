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

function normalizePolicy(policy: WarRoomPolicy): WarRoomPolicy {
  return {
    ...policy,
    category: policy.category ?? 'strategy',
    status: policy.status ?? 'discussing',
    priority: policy.priority ?? 'medium',
    linkedTaskIds: policy.linkedTaskIds ?? [],
    comments: policy.comments ?? [],
  }
}

interface WarRoomState {
  policies: WarRoomPolicy[]

  setPolicies: (policies: WarRoomPolicy[]) => void
  addPolicy: (data: {
    title: string
    content: string
    category: WarRoomPolicy['category']
    priority: WarRoomPolicy['priority']
    creatorId: string
  }) => void
  updatePolicy: (id: string, updates: Partial<WarRoomPolicy>) => void
  deletePolicy: (id: string) => void

  addComment: (policyId: string, userId: string, content: string) => void
  deleteComment: (policyId: string, commentId: string) => void
}

export const useWarRoomStore = create<WarRoomState>()(
  persist(
    (set, get) => ({
      policies: [],

      setPolicies: (policies) => set({ policies: policies.map(normalizePolicy) }),

      addPolicy: ({ title, content, category, priority, creatorId }) => {
        const policy: WarRoomPolicy = {
          id: genPolicyId(),
          title,
          content,
          category,
          priority,
          status: 'discussing',
          linkedTaskIds: [],
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

      updatePolicy: (id, updates) => {
        const previous = get().policies
        let changedPolicy: WarRoomPolicy | undefined
        set((s) => ({
          policies: s.policies.map((p) => {
            if (p.id !== id) return p
            changedPolicy = { ...p, ...updates }
            return changedPolicy
          }),
        }))
        if (changedPolicy) {
          void updateWarRoomPolicy(changedPolicy).catch(() => set({ policies: previous }))
        }
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
      version: 3,
      migrate: () => ({ policies: [] }),
    }
  )
)
