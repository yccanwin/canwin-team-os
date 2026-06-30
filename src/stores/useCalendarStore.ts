import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { CalendarEvent } from '@/types/calendar'
import {
  createCalendarEvent,
  deleteCalendarEventRecord,
  updateCalendarEventRecord,
} from '@/services/calendar'

interface CalendarState {
  events: CalendarEvent[]
}

interface CalendarActions {
  setEvents: (events: CalendarEvent[]) => void
  addEvent: (event: Omit<CalendarEvent, 'id' | 'createdAt'>) => void
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => void
  deleteEvent: (id: string) => void
  getEventsByDate: (date: string) => CalendarEvent[]
  getEventsByMonth: (yearMonth: string) => CalendarEvent[]
}

export const useCalendarStore = create<CalendarState & CalendarActions>()(
  persist(
    (set, get) => ({
      events: [],

      setEvents: (events) => set({ events }),

      addEvent: (event) => {
        const optimisticEvent = {
          ...event,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        }
        set((state) => ({
          events: [
            ...state.events,
            optimisticEvent,
          ],
        }))
        void createCalendarEvent(event)
          .then((savedEvent) =>
            set((state) => ({
              events: state.events.map((e) => (e.id === optimisticEvent.id ? savedEvent : e)),
            }))
          )
          .catch(() =>
            set((state) => ({
              events: state.events.filter((e) => e.id !== optimisticEvent.id),
            }))
          )
      },

      updateEvent: (id, updates) => {
        const previous = get().events
        set((state) => ({
          events: state.events.map((e) =>
            e.id === id ? { ...e, ...updates } : e
          ),
        }))
        void updateCalendarEventRecord(id, updates).catch(() => set({ events: previous }))
      },

      deleteEvent: (id) => {
        const previous = get().events
        set((state) => ({
          events: state.events.filter((e) => e.id !== id),
        }))
        void deleteCalendarEventRecord(id).catch(() => set({ events: previous }))
      },

      getEventsByDate: (date) => {
        return get().events.filter((e) => {
          if (e.endDate) {
            return date >= e.startDate && date <= e.endDate
          }
          return e.startDate === date
        })
      },

      getEventsByMonth: (yearMonth) => {
        return get().events.filter(
          (e) => e.startDate.startsWith(yearMonth)
        )
      },
    }),
    {
      name: 'calendar-storage',
      storage: safeStorage,
    }
  )
)
