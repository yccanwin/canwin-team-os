import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { FinanceRecord } from '@/types'
import {
  createFinanceRecord,
  deleteFinanceRecord,
  updateFinanceRecord,
} from '@/services/finance'

interface FinanceState {
  records: FinanceRecord[]
}

interface FinanceActions {
  setRecords: (records: FinanceRecord[]) => void
  addRecord: (record: Omit<FinanceRecord, 'id'>) => void
  updateRecord: (id: string, updates: Partial<FinanceRecord>) => void
  deleteRecord: (id: string) => void
  getRecordsByMonth: (yearMonth: string) => FinanceRecord[]
  getTotalIncome: () => number
  getTotalExpense: () => number
  getNetProfit: () => number
  getCategoryBreakdown: () => { category: string; total: number }[]
  clearAllRecords: () => void
}

export const useFinanceStore = create<FinanceState & FinanceActions>()(
  persist(
    (set, get) => ({
      records: [],

      setRecords: (records) => set({ records }),

      addRecord: (record) => {
        const optimisticRecord = { ...record, id: crypto.randomUUID() }
        set((state) => ({ records: [optimisticRecord, ...state.records] }))
        void createFinanceRecord(record)
          .then((savedRecord) =>
            set((state) => ({
              records: state.records.map((r) =>
                r.id === optimisticRecord.id ? savedRecord : r
              ),
            }))
          )
          .catch(() =>
            set((state) => ({
              records: state.records.filter((r) => r.id !== optimisticRecord.id),
            }))
          )
      },

      updateRecord: (id, updates) => {
        const previous = get().records
        set((state) => ({
          records: state.records.map((r) =>
            r.id === id ? { ...r, ...updates } : r
          ),
        }))
        void updateFinanceRecord(id, updates).catch(() => set({ records: previous }))
      },

      deleteRecord: (id) => {
        const previous = get().records
        set((state) => ({ records: state.records.filter((r) => r.id !== id) }))
        void deleteFinanceRecord(id).catch(() => set({ records: previous }))
      },

      getRecordsByMonth: (yearMonth) => {
        return get().records.filter((r) => r.date.startsWith(yearMonth))
      },

      getTotalIncome: () => {
        return get().records
          .filter((r) => r.type === 'income')
          .reduce((sum, r) => sum + r.amount, 0)
      },

      getTotalExpense: () => {
        return get().records
          .filter((r) => r.type === 'expense')
          .reduce((sum, r) => sum + r.amount, 0)
      },

      getNetProfit: () => {
        return get().getTotalIncome() - get().getTotalExpense()
      },

      getCategoryBreakdown: () => {
        const breakdown: Record<string, number> = {}
        get().records.forEach((r) => {
          breakdown[r.category] = (breakdown[r.category] || 0) + r.amount
        })
        return Object.entries(breakdown).map(([category, total]) => ({
          category,
          total,
        }))
      },

      clearAllRecords: () => set({ records: [] }),
    }),
    {
      name: 'canwin-finance',
      version: 2,
      storage: safeStorage,
      migrate: () => ({ records: [] }),
    }
  )
)
