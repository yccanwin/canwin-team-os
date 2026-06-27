import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { TimelineEvent } from '@/types'

interface TimelineState {
  events: TimelineEvent[]

  addEvent:      (data: Omit<TimelineEvent, 'id' | 'createdAt'>) => void
  updateEvent:   (id: string, updates: Partial<TimelineEvent>) => void
  deleteEvent:   (id: string) => void
  getByCategory: (category: TimelineEvent['category']) => TimelineEvent[]
  search:        (keyword: string) => TimelineEvent[]
}

const MAX_EVENTS = 20

export const useTimelineStore = create<TimelineState>()(
  persist(
    (set, get) => ({
      events: [],

      addEvent: (data) => {
        const state = get()
        if (state.events.length >= MAX_EVENTS) {
          alert(`事件数已达上限（${MAX_EVENTS}个），请清理旧事件后再添加`)
          return
        }

        const newEvent: TimelineEvent = {
          ...data,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        }

        set((s) => ({
          events: [...s.events, newEvent].sort(
            (a, b) => b.date.localeCompare(a.date)
          ),
        }))
      },

      updateEvent: (id, updates) =>
        set((s) => ({
          events: s.events.map((e) =>
            e.id === id
              ? { ...e, ...updates, updatedAt: new Date().toISOString() }
              : e
          ).sort((a, b) => b.date.localeCompare(a.date)),
        })),

      deleteEvent: (id) =>
        set((s) => ({
          events: s.events.filter((e) => e.id !== id),
        })),

      getByCategory: (category) => {
        return get().events.filter((e) => e.category === category).sort(
          (a, b) => b.date.localeCompare(a.date)
        )
      },

      search: (keyword) => {
        const k = keyword.toLowerCase()
        return get().events.filter(
          (e) =>
            e.title.toLowerCase().includes(k) ||
            e.description?.toLowerCase().includes(k)
        ).sort((a, b) => b.date.localeCompare(a.date))
      },
    }),
    {
      name: 'canwin-timeline', storage: safeStorage,
    }
  )
)
