import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { SalesAssessment, SalesProduct, SalesScoreRecord } from '@/types'
import {
  createSalesProductRecord,
  createSalesScoreRecord,
  isSalesCloudUnavailable,
  upsertSalesAssessmentRecord,
  updateSalesProductRecord,
} from '@/services/sales'

const SALES_SAVE_MESSAGE =
  '保存失败：请先在 Supabase 执行销售中心 sales_products / sales_score_records / sales_assessments 表迁移，或检查当前账号权限。'

interface SalesState {
  products: SalesProduct[]
  records: SalesScoreRecord[]
  assessments: SalesAssessment[]
}

interface SalesActions {
  setSalesData: (data: {
    products: SalesProduct[]
    records: SalesScoreRecord[]
    assessments: SalesAssessment[]
  }) => void
  addProduct: (product: Omit<SalesProduct, 'id' | 'createdAt'>) => Promise<void>
  updateProduct: (id: string, updates: Partial<Omit<SalesProduct, 'id' | 'createdAt' | 'createdBy'>>) => Promise<void>
  addRecord: (record: Omit<SalesScoreRecord, 'id' | 'createdAt'>) => Promise<void>
  upsertAssessment: (assessment: Omit<SalesAssessment, 'id' | 'updatedAt'>) => Promise<void>
}

function normalizeSalesError(error: unknown): Error {
  if (isSalesCloudUnavailable(error)) return new Error(SALES_SAVE_MESSAGE, { cause: error })
  return error instanceof Error ? error : new Error(String(error))
}

export const useSalesStore = create<SalesState & SalesActions>()(
  persist(
    (set, get) => ({
      products: [],
      records: [],
      assessments: [],

      setSalesData: ({ products, records, assessments }) => set({ products, records, assessments }),

      addProduct: async (product) => {
        const optimistic: SalesProduct = {
          ...product,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        }
        set((state) => ({ products: [...state.products, optimistic] }))
        try {
          const saved = await createSalesProductRecord(product)
          set((state) => ({
            products: state.products.map((item) => (item.id === optimistic.id ? saved : item)),
          }))
        } catch (error) {
          set((state) => ({ products: state.products.filter((item) => item.id !== optimistic.id) }))
          throw normalizeSalesError(error)
        }
      },

      updateProduct: async (id, updates) => {
        const previous = get().products
        set((state) => ({
          products: state.products.map((item) => (item.id === id ? { ...item, ...updates } : item)),
        }))
        try {
          const saved = await updateSalesProductRecord(id, updates)
          set((state) => ({
            products: state.products.map((item) => (item.id === id ? saved : item)),
          }))
        } catch (error) {
          set({ products: previous })
          throw normalizeSalesError(error)
        }
      },

      addRecord: async (record) => {
        const optimistic: SalesScoreRecord = {
          ...record,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        }
        set((state) => ({ records: [optimistic, ...state.records] }))
        try {
          const saved = await createSalesScoreRecord(record)
          set((state) => ({
            records: state.records.map((item) => (item.id === optimistic.id ? saved : item)),
          }))
        } catch (error) {
          set((state) => ({ records: state.records.filter((item) => item.id !== optimistic.id) }))
          throw normalizeSalesError(error)
        }
      },

      upsertAssessment: async (assessment) => {
        const previous = get().assessments
        const optimistic: SalesAssessment = {
          ...assessment,
          id: previous.find((item) => item.periodQuarter === assessment.periodQuarter)?.id ?? crypto.randomUUID(),
          updatedAt: new Date().toISOString(),
        }
        set((state) => ({
          assessments: [
            optimistic,
            ...state.assessments.filter((item) => item.periodQuarter !== assessment.periodQuarter),
          ],
        }))
        try {
          const saved = await upsertSalesAssessmentRecord(assessment)
          set((state) => ({
            assessments: [
              saved,
              ...state.assessments.filter((item) => item.periodQuarter !== saved.periodQuarter),
            ],
          }))
        } catch (error) {
          set({ assessments: previous })
          throw normalizeSalesError(error)
        }
      },
    }),
    {
      name: 'canwin-sales-center',
      version: 1,
      storage: safeStorage,
      migrate: () => ({ products: [], records: [], assessments: [] }),
    }
  )
)
