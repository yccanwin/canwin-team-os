import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { Task } from '@/types'
import { mockTasks } from '@/data/mockData'

interface TaskState {
  tasks: Task[]
}

interface TaskActions {
  addTask: (task: Omit<Task, 'id'>) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  deleteTask: (id: string) => void
  updateTaskStatus: (id: string, status: Task['status']) => void
  getTasksByAssignee: (userId: string) => Task[]
  getTasksByStatus: (status: Task['status']) => Task[]
  getImportantTasks: () => Task[]
  clearAllTasks: () => void
}

export const useTaskStore = create<TaskState & TaskActions>()(
  persist(
    (set, get) => ({
      tasks: mockTasks,

      addTask: (task) =>
        set((state) => ({
          tasks: [
            ...state.tasks,
            { ...task, id: crypto.randomUUID() },
          ],
        })),

      updateTask: (id, updates) =>
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        })),

      deleteTask: (id) =>
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== id),
        })),

      updateTaskStatus: (id, status) =>
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status,
                  ...(status === 'done'
                    ? { completedAt: new Date().toISOString() }
                    : {}),
                }
              : t
          ),
        })),

      getTasksByAssignee: (userId) => {
        return get().tasks.filter((t) => t.assigneeId === userId)
      },

      getTasksByStatus: (status) => {
        return get().tasks.filter((t) => t.status === status)
      },

      getImportantTasks: () => {
        return get().tasks.filter((t) => t.isImportant)
      },

      clearAllTasks: () => set({ tasks: [] }),
    }),
    {
      name: 'canwin-tasks', storage: safeStorage,
    }
  )
)
