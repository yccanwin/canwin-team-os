import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { Asset } from '@/types'

interface AssetState {
  assets: Asset[]

  addAsset:       (data: Omit<Asset, 'id' | 'createdAt'>) => void
  updateAsset:    (id: string, updates: Partial<Asset>) => void
  deleteAsset:    (id: string) => void
  getTotalValue:  () => number
}

export const useAssetStore = create<AssetState>()(
  persist(
    (set, get) => ({
      assets: [],

      addAsset: (data) =>
        set((s) => {
          const newAsset: Asset = {
            ...data,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
          }
          return {
            assets: [...s.assets, newAsset].sort(
              (a, b) => b.purchaseDate.localeCompare(a.purchaseDate)
            ),
          }
        }),

      updateAsset: (id, updates) =>
        set((s) => ({
          assets: s.assets
            .map((a) =>
              a.id === id
                ? { ...a, ...updates, updatedAt: new Date().toISOString() }
                : a
            )
            .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)),
        })),

      deleteAsset: (id) =>
        set((s) => ({
          assets: s.assets.filter((a) => a.id !== id),
        })),

      getTotalValue: () => {
        const { assets } = get()
        return assets
          .filter((a) => a.currentStatus !== 'disposed')
          .reduce((sum, a) => sum + a.amount, 0)
      },
    }),
    {
      name: 'canwin-assets', storage: safeStorage,
    }
  )
)
