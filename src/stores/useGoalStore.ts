import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { Goal } from '@/types'
import {
  createGoalRecord,
  deleteGoalRecord,
  updateGoalRecord,
} from '@/services/goals'

// 团队动态统一通过 useActivityStore 写入
import { useActivityStore } from '@/stores/useActivityStore'
import type { ActivityLog } from '@/types'

/** 向团队动态中添加一条记录 */
function addActivityLog(userId: string, content: string, type: ActivityLog['type'] = 'announcement') {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  useActivityStore.getState().addLog({
    userId,
    type,
    content,
    createdAt: new Date().toISOString(),
    expiresAt,
  })
}

interface GoalState {
  goals: Goal[]
}

interface GoalActions {
  setGoals: (goals: Goal[]) => void
  addGoal: (goal: Omit<Goal, 'id'>) => void
  updateGoal: (id: string, updates: Partial<Goal>) => void
  deleteGoal: (id: string) => void
  updateGoalProgress: (id: string, amount: number) => void

  // 混合模式C — 自动检测阶段完成
  checkPhaseCompletion: () => void

  // 队长手动启用下一阶段
  unlockNextPhase: () => Goal | null

  // 队长手动调整当前金额
  updateGoalAmount: (goalId: string, newCurrentAmount: number) => void

  // 将 enabled 阶段设为 locked
  disablePhase: (goalId: string) => void

  getCurrentGoal: () => Goal | undefined
  clearAllGoals: () => void
}

export const useGoalStore = create<GoalState & GoalActions>()(
  persist(
    (set, get) => ({
      goals: [],

      setGoals: (goals) => set({ goals }),

      addGoal: (goal) => {
        const optimisticGoal = { ...goal, id: crypto.randomUUID() }
        set((state) => ({
          goals: [
            ...state.goals,
            optimisticGoal,
          ],
        }))
        void createGoalRecord(goal)
          .then((savedGoal) =>
            set((state) => ({
              goals: state.goals.map((g) => (g.id === optimisticGoal.id ? savedGoal : g)),
            }))
          )
          .catch(() =>
            set((state) => ({
              goals: state.goals.filter((g) => g.id !== optimisticGoal.id),
            }))
          )
      },

      updateGoal: (id, updates) => {
        const previous = get().goals
        set((state) => ({
          goals: state.goals.map((g) =>
            g.id === id ? { ...g, ...updates } : g
          ),
        }))
        void updateGoalRecord(id, updates).catch(() => set({ goals: previous }))
      },

      deleteGoal: (id) => {
        const previous = get().goals
        set((state) => ({
          goals: state.goals.filter((g) => g.id !== id),
        }))
        void deleteGoalRecord(id).catch(() => set({ goals: previous }))
      },

      updateGoalProgress: (id, amount) => {
        const previous = get().goals
        let changedGoal: Goal | undefined
        set((state) => {
          const updated = state.goals.map((g) => {
            if (g.id !== id) return g
            const newCurrent = Math.min(g.currentAmount + amount, g.targetAmount)
            const newStatus: Goal['status'] =
              newCurrent >= g.targetAmount ? 'completed' : 'in_progress'
            changedGoal = { ...g, currentAmount: newCurrent, status: newStatus }
            return changedGoal
          })
          return { goals: updated }
        })
        if (changedGoal) {
          void updateGoalRecord(id, {
            currentAmount: changedGoal.currentAmount,
            status: changedGoal.status,
          }).catch(() => set({ goals: previous }))
        }
      },

      // ============================================================
      // 混合模式C — 自动检测阶段完成
      // 每次 currentAmount 更新后调用
      // 逻辑：
      //   if currentAmount ≥ targetAmount && status === 'in_progress':
      //     → status = 'completed'
      //     → 团队动态：'🎉 阶段X已达成！'
      //     → 下一阶段 locked → enabled
      // ============================================================
      checkPhaseCompletion: () => {
        const goals = get().goals
        const inProgress = goals.find((g) => g.status === 'in_progress')

        if (!inProgress) return

        if (inProgress.currentAmount >= inProgress.targetAmount) {
          const updated = goals.map((g) => {
            if (g.id === inProgress.id) {
              return { ...g, status: 'completed' as const }
            }
            // 下一阶段：如果 locked → enabled
            if (g.priority === inProgress.priority - 1 && g.status === 'locked') {
              return { ...g, status: 'enabled' as const }
            }
            return g
          })

          set({ goals: updated })
          updated
            .filter((goal) => goal.id === inProgress.id || goal.priority === inProgress.priority - 1)
            .forEach((goal) => {
              void updateGoalRecord(goal.id, { status: goal.status }).catch(() => set({ goals }))
            })

          // 团队动态
          addActivityLog(
            'u-001',
            `🎉 ${inProgress.title}已达成！`,
            'announcement'
          )
        }
      },

      // ============================================================
      // 队长手动启用下一阶段
      // 找到第一个 status='enabled' 的阶段 → 设为 in_progress
      // ============================================================
      unlockNextPhase: () => {
        const goals = get().goals
        // 按 priority 降序排列（阶段1 priority最高）
        const sorted = [...goals].sort((a, b) => b.priority - a.priority)
        const enabledGoal = sorted.find((g) => g.status === 'enabled')

        if (!enabledGoal) {
          // 兼容旧逻辑：查找 locked 阶段
          const lockedGoal = goals.find((g) => g.status === 'locked')
          if (!lockedGoal) return null

          const unlocked = goals.map((g) => {
            if (g.id === lockedGoal.id) return { ...g, status: 'enabled' as const }
            return g
          })
          set({ goals: unlocked })
          void updateGoalRecord(lockedGoal.id, { status: 'enabled' }).catch(() => set({ goals }))
          return unlocked.find((g) => g.id === lockedGoal.id) || null
        }

        const updated = goals.map((g) => {
          if (g.id === enabledGoal.id) return { ...g, status: 'in_progress' as const }
          return g
        })

        set({ goals: updated })
        void updateGoalRecord(enabledGoal.id, { status: 'in_progress' }).catch(() => set({ goals }))

        // 团队动态
        addActivityLog(
          'u-001',
          `🚀 ${enabledGoal.title}已启动！`,
          'announcement'
        )

        return enabledGoal
      },

      // ============================================================
      // 队长手动调整当前金额
      // 调整后自动触发 checkPhaseCompletion
      // ============================================================
      updateGoalAmount: (goalId, newCurrentAmount) => {
        const previous = get().goals
        let syncedAmount = newCurrentAmount
        set((state) => ({
          goals: state.goals.map((g) =>
            {
              if (g.id !== goalId) return g
              syncedAmount = Math.min(newCurrentAmount, g.targetAmount)
              return { ...g, currentAmount: syncedAmount }
            }
          ),
        }))
        void updateGoalRecord(goalId, { currentAmount: syncedAmount }).catch(() => set({ goals: previous }))

        // 延迟调用 checkPhaseCompletion（确保 state 已更新）
        setTimeout(() => {
          get().checkPhaseCompletion()
        }, 0)
      },

      // ============================================================
      // 将 enabled 阶段设为 locked（队长禁用）
      // ============================================================
      disablePhase: (goalId) => {
        const previous = get().goals
        set((state) => ({
          goals: state.goals.map((g) =>
            g.id === goalId && g.status === 'enabled'
              ? { ...g, status: 'locked' as const }
              : g
          ),
        }))
        void updateGoalRecord(goalId, { status: 'locked' }).catch(() => set({ goals: previous }))
      },

      getCurrentGoal: () => {
        return get().goals.find((g) => g.status === 'in_progress')
      },

      clearAllGoals: () => set({ goals: [] }),
    }),
    {
      name: 'canwin-goals', storage: safeStorage,
    }
  )
)
