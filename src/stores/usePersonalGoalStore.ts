import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { PersonalGoal, PersonalGoalUpdate } from '@/types'
import {
  addPersonalGoalUpdateRecord,
  createPersonalGoalRecord,
  updatePersonalGoalRecord,
} from '@/services/personalGoals'

interface PersonalGoalState {
  personalGoals: PersonalGoal[]
}

interface PersonalGoalActions {
  setPersonalGoals: (goals: PersonalGoal[]) => void
  addPersonalGoal: (goal: Omit<PersonalGoal, 'id' | 'createdAt' | 'updates' | 'currentAmount'>) => void
  updatePersonalGoal: (id: string, updates: Partial<PersonalGoal>) => void
  addGoalUpdate: (goalId: string, update: Pick<PersonalGoalUpdate, 'content' | 'amountDelta' | 'imageUrl'>) => void
  getVisibleGoalsForUser: (userId: string, viewerId: string) => PersonalGoal[]
  getOwnGoals: (userId: string) => PersonalGoal[]
}

function withDerivedLock(goal: PersonalGoal): PersonalGoal {
  if (goal.lockStatus !== 'cooldown') return goal
  const pastCooldown = Date.now() - new Date(goal.createdAt).getTime() >= 24 * 60 * 60 * 1000
  return pastCooldown ? { ...goal, lockStatus: 'locked' } : goal
}

export const usePersonalGoalStore = create<PersonalGoalState & PersonalGoalActions>()(
  persist(
    (set, get) => ({
      personalGoals: [],

      setPersonalGoals: (personalGoals) => set({ personalGoals: personalGoals.map(withDerivedLock) }),

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
            goal.id === id ? withDerivedLock({ ...goal, ...updates }) : goal
          ),
        }))
        void updatePersonalGoalRecord(id, updates).catch(() => set({ personalGoals: previous }))
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
          .map(withDerivedLock)
          .filter((goal) => goal.userId === userId && (goal.visibility === 'team' || goal.userId === viewerId)),

      getOwnGoals: (userId) =>
        get().personalGoals
          .map(withDerivedLock)
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
