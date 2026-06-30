import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { Asset } from '@/types'
import {
  createAssetRecord,
  deleteAssetRecord,
  updateAssetRecord,
} from '@/services/assets'

interface AssetState {
  assets: Asset[]

  setAssets:      (assets: Asset[]) => void
  addAsset:       (data: Omit<Asset, 'id' | 'createdAt'>) => void
  updateAsset:    (id: string, updates: Partial<Asset>) => void
  deleteAsset:    (id: string) => void
  getTotalValue:  () => number
}

export const useAssetStore = create<AssetState>()(
  persist(
    (set, get) => ({
      assets: [],

      setAssets: (assets) => set({ assets }),

      addAsset: (data) => {
        let optimisticAsset: Asset
        set((s) => {
          const newAsset: Asset = {
            ...data,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
          }
          optimisticAsset = newAsset
          return {
            assets: [...s.assets, newAsset].sort(
              (a, b) => b.purchaseDate.localeCompare(a.purchaseDate)
            ),
          }
        })
        void createAssetRecord(data)
          .then((savedAsset) =>
            set((state) => ({
              assets: state.assets
                .map((a) => (a.id === optimisticAsset.id ? savedAsset : a))
                .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)),
            }))
          )
          .catch(() =>
            set((state) => ({
              assets: state.assets.filter((a) => a.id !== optimisticAsset.id),
            }))
          )
      },

      updateAsset: (id, updates) => {
        const previous = get().assets
        set((s) => ({
          assets: s.assets
            .map((a) =>
              a.id === id
                ? { ...a, ...updates, updatedAt: new Date().toISOString() }
                : a
            )
            .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate)),
        }))
        void updateAssetRecord(id, updates).catch(() => set({ assets: previous }))
      },

      deleteAsset: (id) => {
        const previous = get().assets
        set((s) => ({
          assets: s.assets.filter((a) => a.id !== id),
        }))
        void deleteAssetRecord(id).catch(() => set({ assets: previous }))
      },

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
