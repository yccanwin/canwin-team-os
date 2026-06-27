import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { FinanceRecord } from '@/types'
import { mockFinance } from '@/data/mockData'

interface FinanceState {
  records: FinanceRecord[]
}

interface FinanceActions {
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
      records: mockFinance,

      addRecord: (record) =>
        set((state) => ({
          records: [
            ...state.records,
            { ...record, id: crypto.randomUUID() },
          ],
        })),

      updateRecord: (id, updates) =>
        set((state) => ({
          records: state.records.map((r) =>
            r.id === id ? { ...r, ...updates } : r
          ),
        })),

      deleteRecord: (id) =>
        set((state) => ({
          records: state.records.filter((r) => r.id !== id),
        })),

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
      name: 'canwin-finance', storage: safeStorage,
    }
  )
)
