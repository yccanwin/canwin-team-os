import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { TimelineEvent } from '@/types'
import {
  createTimelineEvent,
  deleteTimelineEventRecord,
  updateTimelineEventRecord,
} from '@/services/timeline'

interface TimelineState {
  events: TimelineEvent[]

  setEvents:     (events: TimelineEvent[]) => void
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

      setEvents: (events) => set({ events }),

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
        void createTimelineEvent(data)
          .then((savedEvent) =>
            set((s) => ({
              events: s.events
                .map((e) => (e.id === newEvent.id ? savedEvent : e))
                .sort((a, b) => b.date.localeCompare(a.date)),
            }))
          )
          .catch(() =>
            set((s) => ({
              events: s.events.filter((e) => e.id !== newEvent.id),
            }))
          )
      },

      updateEvent: (id, updates) => {
        const previous = get().events
        set((s) => ({
          events: s.events.map((e) =>
            e.id === id
              ? { ...e, ...updates, updatedAt: new Date().toISOString() }
              : e
          ).sort((a, b) => b.date.localeCompare(a.date)),
        }))
        void updateTimelineEventRecord(id, updates).catch(() => set({ events: previous }))
      },

      deleteEvent: (id) => {
        const previous = get().events
        set((s) => ({
          events: s.events.filter((e) => e.id !== id),
        }))
        void deleteTimelineEventRecord(id).catch(() => set({ events: previous }))
      },

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
      name: 'canwin-timeline',
      version: 2,
      storage: safeStorage,
      migrate: () => ({ events: [] }),
    }
  )
)
