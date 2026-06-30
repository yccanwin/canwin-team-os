import { create } from 'zustand'
import type { ActivityLog } from '@/types'

const ACTIVITY_LOG_KEY = 'canwin-activity'

function loadLogs(): ActivityLog[] {
  try {
    const raw = localStorage.getItem(ACTIVITY_LOG_KEY)
    if (raw) {
      const logs: ActivityLog[] = JSON.parse(raw)
      if (logs.length > 0) return logs
    }
  } catch { /* fallback */ }
  return []
}

interface ActivityState {
  logs: ActivityLog[]
}

interface ActivityActions {
  addLog: (log: Omit<ActivityLog, 'id'>) => void
  getRecentLogs: (limit: number) => ActivityLog[]
  clearAllActivities: () => void
}

export const useActivityStore = create<ActivityState & ActivityActions>()((set, get) => ({
  logs: loadLogs(),

  addLog: (log) => {
    const newLog = { ...log, id: crypto.randomUUID() }
    const updated = [...get().logs, newLog]
    set({ logs: updated })
    try {
      localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(updated))
    } catch { /* ignore */ }
  },

  getRecentLogs: (limit) => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    return get().logs
      .filter((l) => new Date(l.createdAt) >= thirtyDaysAgo)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit)
  },

  clearAllActivities: () => {
    set({ logs: [] })
    try {
      localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify([]))
    } catch { /* ignore */ }
  },
}))
