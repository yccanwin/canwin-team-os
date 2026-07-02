import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { PersonalGoal, PersonalGoalUpdate } from '@/types'
import { withDerivedPersonalGoalStatus } from '@/utils/personalGoalStatus'
import {
  addPersonalGoalUpdateRecord,
  createPersonalGoalRecord,
  unlockPersonalGoalRecord,
  updatePersonalGoalRecord,
} from '@/services/personalGoals'

interface PersonalGoalState {
  personalGoals: PersonalGoal[]
}

interface PersonalGoalActions {
  setPersonalGoals: (goals: PersonalGoal[]) => void
  addPersonalGoal: (goal: Omit<PersonalGoal, 'id' | 'createdAt' | 'updates' | 'currentAmount'>) => void
  updatePersonalGoal: (id: string, updates: Partial<PersonalGoal>) => void
  unlockPersonalGoal: (id: string) => void
  addGoalUpdate: (goalId: string, update: Pick<PersonalGoalUpdate, 'content' | 'amountDelta' | 'imageUrl'>) => void
  getVisibleGoalsForUser: (userId: string, viewerId: string) => PersonalGoal[]
  getOwnGoals: (userId: string) => PersonalGoal[]
}

export const usePersonalGoalStore = create<PersonalGoalState & PersonalGoalActions>()(
  persist(
    (set, get) => ({
      personalGoals: [],

      setPersonalGoals: (personalGoals) => set({ personalGoals: personalGoals.map(withDerivedPersonalGoalStatus) }),

      addPersonalGoal: (goal) => {
        const optimisticGoal: PersonalGoal = {
          ...goal,
          id: crypto.randomUUID(),
          currentAmount: 0,
          lockStatus: 'cooldown',
          createdAt: new Date().toISOString(),
          updates: [],
        }
        set((state) => ({ personalGoals: [optimisticGoal, ...state.personalGoals] }))
        void createPersonalGoalRecord(goal)
          .then((savedGoal) =>
            set((state) => ({
              personalGoals: state.personalGoals.map((item) =>
                item.id === optimisticGoal.id ? savedGoal : item
              ),
            }))
          )
          .catch(() =>
            set((state) => ({
              personalGoals: state.personalGoals.filter((item) => item.id !== optimisticGoal.id),
            }))
          )
      },

      updatePersonalGoal: (id, updates) => {
        const previous = get().personalGoals
        set((state) => ({
          personalGoals: state.personalGoals.map((goal) =>
            goal.id === id ? withDerivedPersonalGoalStatus({ ...goal, ...updates }) : goal
          ),
        }))
        void updatePersonalGoalRecord(id, updates).catch(() => set({ personalGoals: previous }))
      },

      unlockPersonalGoal: (id) => {
        const previous = get().personalGoals
        set((state) => ({
          personalGoals: state.personalGoals.map((goal) =>
            goal.id === id
              ? { ...goal, lockStatus: 'unlocked', lockedAt: undefined, unlockAt: new Date().toISOString() }
              : goal
          ),
        }))
        void unlockPersonalGoalRecord(id)
          .then((savedGoal) =>
            set((state) => ({
              personalGoals: state.personalGoals.map((goal) =>
                goal.id === id ? { ...savedGoal, updates: goal.updates } : goal
              ),
            }))
          )
          .catch(() => set({ personalGoals: previous }))
      },

      addGoalUpdate: (goalId, update) => {
        const previous = get().personalGoals
        const optimisticUpdate: PersonalGoalUpdate = {
          ...update,
          id: crypto.randomUUID(),
          createdBy: '',
          createdAt: new Date().toISOString(),
        }
        set((state) => ({
          personalGoals: state.personalGoals.map((goal) =>
            goal.id === goalId
              ? {
                  ...goal,
                  currentAmount: goal.currentAmount + (update.amountDelta ?? 0),
                  updates: [...goal.updates, optimisticUpdate],
                }
              : goal
          ),
        }))
        void addPersonalGoalUpdateRecord(goalId, update)
          .then((savedUpdate) =>
            set((state) => ({
              personalGoals: state.personalGoals.map((goal) =>
                goal.id === goalId
                  ? {
                      ...goal,
                      updates: goal.updates.map((item) =>
                        item.id === optimisticUpdate.id ? savedUpdate : item
                      ),
                    }
                  : goal
              ),
            }))
          )
          .catch(() => set({ personalGoals: previous }))
      },

      getVisibleGoalsForUser: (userId, viewerId) =>
        get().personalGoals
          .map(withDerivedPersonalGoalStatus)
          .filter((goal) => goal.userId === userId && (goal.visibility === 'team' || goal.userId === viewerId)),

      getOwnGoals: (userId) =>
        get().personalGoals
          .map(withDerivedPersonalGoalStatus)
          .filter((goal) => goal.userId === userId),
    }),
    {
      name: 'canwin-personal-goals',
      version: 2,
      storage: safeStorage,
      migrate: () => ({ personalGoals: [] }),
    }
  )
)
