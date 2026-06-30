import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { Task } from '@/types'
import { mockTasks } from '@/data/mockData'
import { createTask, deleteTaskRecord, updateTaskRecord } from '@/services/tasks'

interface TaskState {
  tasks: Task[]
}

interface TaskActions {
  setTasks: (tasks: Task[]) => void
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

      setTasks: (tasks) => set({ tasks }),

      addTask: (task) => {
        const optimisticTask = { ...task, id: crypto.randomUUID() }
        set((state) => ({ tasks: [optimisticTask, ...state.tasks] }))
        void createTask(task)
          .then((savedTask) =>
            set((state) => ({
              tasks: state.tasks.map((t) => (t.id === optimisticTask.id ? savedTask : t)),
            }))
          )
          .catch(() =>
            set((state) => ({
              tasks: state.tasks.filter((t) => t.id !== optimisticTask.id),
            }))
          )
      },

      updateTask: (id, updates) => {
        const previous = get().tasks
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        }))
        void updateTaskRecord(id, updates).catch(() => set({ tasks: previous }))
      },

      deleteTask: (id) => {
        const previous = get().tasks
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }))
        void deleteTaskRecord(id).catch(() => set({ tasks: previous }))
      },

      updateTaskStatus: (id, status) => {
        const previous = get().tasks
        const completedAt = status === 'done' ? new Date().toISOString() : undefined
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status,
                  ...(completedAt ? { completedAt } : {}),
                }
              : t
          ),
        }))
        void updateTaskRecord(id, { status, completedAt }).catch(() => set({ tasks: previous }))
      },

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
