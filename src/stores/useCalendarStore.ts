import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { CalendarEvent } from '@/types/calendar'

interface CalendarState {
  events: CalendarEvent[]
}

interface CalendarActions {
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

      addEvent: (event) =>
        set((state) => ({
          events: [
            ...state.events,
            {
              ...event,
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
            },
          ],
        })),

      updateEvent: (id, updates) =>
        set((state) => ({
          events: state.events.map((e) =>
            e.id === id ? { ...e, ...updates } : e
          ),
        })),

      deleteEvent: (id) =>
        set((state) => ({
          events: state.events.filter((e) => e.id !== id),
        })),

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
