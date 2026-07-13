import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeStorage } from '@/utils/safeStorage'
import type { InventoryItem, InventoryLog } from '@/types'
import { useFinanceStore } from './useFinanceStore'
import {
  createInventoryItem,
  deleteInventoryItem,
  deleteInventoryLogWithRevert,
  recordStockIn,
  recordStockOut,
  updateInventoryItem,
} from '@/services/inventory'

interface InventoryState {
  items: InventoryItem[]
  logs: InventoryLog[]
}

interface InventoryActions {
  setInventoryData: (data: { items: InventoryItem[]; logs: InventoryLog[] }) => void

  // 入库（含财务联动）— 创建或累加库存 + 支出记录 + 入库日志
  addStock: (
    item: Omit<InventoryItem, 'id' | 'lastUpdated'>,
    costAmount: number,
    operatorId: string,
    costCategory?: string,
    costDate?: string
  ) => void

  // 出库（含财务联动）— 扣减库存 + 收入记录 + 出库日志
  removeStock: (
    itemId: string,
    quantity: number,
    incomeAmount: number,
    operatorId: string,
    incomeCategory?: string,
    incomeDate?: string
  ) => void

  addItem: (item: Omit<InventoryItem, 'id'>) => void
  updateItem: (id: string, updates: Partial<InventoryItem>) => void
  deleteItem: (id: string) => void
  getLowStockItems: (threshold: number) => InventoryItem[]

  /** 删除操作日志并撤回库存变动 + 联动清除关联财务记录 */
  deleteLog: (logId: string) => boolean

  // 清理日志：保留最近 30 条
  cleanupLogs: () => void
  // 清空所有库存数据和日志
  clearAllItems: () => void
}

export const useInventoryStore = create<InventoryState & InventoryActions>()(
  persist(
    (set, get) => ({
      items: [],
      logs: [],

      setInventoryData: ({ items, logs }) => set({ items, logs }),

      // ============================================================
      // 入库 — 两步流程的 Store 层封装
      // 1. 同名同单位商品 → 数量累加，单价更新
      // 2. 新商品 → 创建 InventoryItem
      // 3. 自动生成支出记录到 financeRecords
      // 4. 记录入库日志
      // ============================================================
      addStock: (item, costAmount, operatorId, costCategory = '采购成本', costDate) => {
        const state = get()

        // 先查是否有同名商品
        const existing = state.items.find(
          (i) => i.name === item.name && i.unit === item.unit
        )

        // ✅ 提前确定 itemId，避免 updater 内靠 get() 修正的不可靠逻辑
        const itemId = existing ? existing.id : crypto.randomUUID()
        const logId = crypto.randomUUID()
        const financeId = crypto.randomUUID()

        set((state) => {
          const existingInState = state.items.find(
            (i) => i.name === item.name && i.unit === item.unit
          )

          let newItems: InventoryItem[]
          if (existingInState) {
            // 同名同单位 → 累加数量，更新单价
            newItems = state.items.map((i) =>
              i.id === existingInState.id
                ? {
                    ...i,
                    quantity: i.quantity + item.quantity,
                    unitPrice: item.unitPrice,
                    sku: item.sku || i.sku,
                    lastUpdated: new Date().toISOString(),
                  }
                : i
            )
          } else {
            // 新商品 → 创建（使用提前确定的 itemId）
            const newItem: InventoryItem = {
              ...item,
              id: itemId,
              lastUpdated: new Date().toISOString(),
            }
            newItems = [...state.items, newItem]
          }

          // 入库日志 — itemId 已提前确定，无需事后修正
          const logEntry: InventoryLog = {
            id: logId,
            itemId,
            itemName: item.name,
            operation: 'in',
            quantityChange: item.quantity,
            operatorId,
            createdAt: new Date().toISOString(),
          }

          // 跨 Store：自动生成支出记录（预生成 financeId 便于联动删除）
          useFinanceStore.setState((fs) => ({
            records: [
              {
                id: financeId,
                type: 'expense' as const,
                amount: costAmount,
                date: costDate ?? new Date().toISOString().slice(0, 10),
                category: costCategory,
                note: `入库：${item.name} × ${item.quantity}${item.unit}`,
                createdBy: operatorId,
              },
              ...fs.records,
            ],
          }))

          return {
            items: newItems,
            logs: [{ ...logEntry, financeId }, ...state.logs],
          }
        })

        void recordStockIn(item, costAmount, operatorId, costCategory, costDate)
          .then(({ item: savedItem, log: savedLog, financeRecord }) => {
            set((state) => ({
              items: state.items.map((i) => (i.id === itemId ? savedItem : i)),
              logs: state.logs.map((l) => (l.id === logId ? savedLog : l)),
            }))
            useFinanceStore.setState((fs) => ({
              records: fs.records.map((record) =>
                record.id === financeId ? financeRecord : record
              ),
            }))
          })
          .catch(() => {
            set((state) => ({
              items: existing
                ? state.items.map((i) => (i.id === itemId ? existing : i))
                : state.items.filter((i) => i.id !== itemId),
              logs: state.logs.filter((l) => l.id !== logId),
            }))
            useFinanceStore.setState((fs) => ({
              records: fs.records.filter((record) => record.id !== financeId),
            }))
          })

        // 每次入库后裁剪日志（保留最近 30 条）
        get().cleanupLogs()
      },

      // ============================================================
      // 出库 — 两步流程的 Store 层封装
      // 1. 校验 quantity ≤ 当前库存
      // 2. 扣减库存数量（归零不删除）
      // 3. 自动生成收入记录到 financeRecords
      // 4. 记录出库日志
      // ============================================================
      removeStock: (itemId, quantity, incomeAmount, operatorId, incomeCategory = '销售收入', incomeDate) => {
        const item = get().items.find((i) => i.id === itemId)
        if (!item || item.quantity < quantity) {
          throw new Error(
            `库存不足：当前库存 ${item?.quantity ?? 0}${item?.unit ?? ''}，无法出库 ${quantity}`
          )
        }

        const logId = crypto.randomUUID()
        const financeId = crypto.randomUUID()

        set((state) => ({
          items: state.items.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  quantity: i.quantity - quantity,
                  lastUpdated: new Date().toISOString(),
                }
              : i
          ),
          logs: [
            {
              id: logId,
              itemId,
              itemName: item.name,
              operation: 'out',
              quantityChange: quantity,
              operatorId,
              createdAt: new Date().toISOString(),
              financeId,
            },
            ...state.logs,
          ],
        }))

        // 跨 Store：自动生成收入记录（预生成 financeId 便于联动删除）
        useFinanceStore.setState((fs) => ({
          records: [
            {
              id: financeId,
              type: 'income' as const,
              category: incomeCategory,
              amount: incomeAmount,
              date: incomeDate ?? new Date().toISOString().split('T')[0],
              note: `出库：${item.name} × ${quantity}${item.unit}`,
              createdBy: operatorId,
            },
            ...fs.records,
          ],
        }))

        void recordStockOut(item, quantity, incomeAmount, operatorId, incomeCategory, incomeDate)
          .then(({ item: savedItem, log: savedLog, financeRecord }) => {
            set((state) => ({
              items: state.items.map((i) => (i.id === itemId ? savedItem : i)),
              logs: state.logs.map((l) => (l.id === logId ? savedLog : l)),
            }))
            useFinanceStore.setState((fs) => ({
              records: fs.records.map((record) =>
                record.id === financeId ? financeRecord : record
              ),
            }))
          })
          .catch(() => {
            set((state) => ({
              items: state.items.map((i) => (i.id === itemId ? item : i)),
              logs: state.logs.filter((l) => l.id !== logId),
            }))
            useFinanceStore.setState((fs) => ({
              records: fs.records.filter((record) => record.id !== financeId),
            }))
          })

        // 每次出库后裁剪日志（保留最近 30 条）
        get().cleanupLogs()
      },

      addItem: (item) => {
        const optimisticItem = { ...item, id: crypto.randomUUID() }
        set((state) => ({ items: [optimisticItem, ...state.items] }))
        void createInventoryItem(item)
          .then((savedItem) =>
            set((state) => ({
              items: state.items.map((i) => (i.id === optimisticItem.id ? savedItem : i)),
            }))
          )
          .catch(() =>
            set((state) => ({
              items: state.items.filter((i) => i.id !== optimisticItem.id),
            }))
          )
      },

      updateItem: (id, updates) => {
        const previous = get().items
        set((state) => ({
          items: state.items.map((i) =>
            i.id === id ? { ...i, ...updates } : i
          ),
        }))
        void updateInventoryItem(id, updates).catch(() => set({ items: previous }))
      },

      deleteItem: (id) => {
        const previous = get().items
        set((state) => ({ items: state.items.filter((i) => i.id !== id) }))
        void deleteInventoryItem(id).catch(() => set({ items: previous }))
      },

      getLowStockItems: (threshold) => {
        return get().items.filter((i) => i.quantity <= threshold)
      },

      deleteLog: (logId) => {
        const state = get()
        const log = state.logs.find((l) => l.id === logId)
        if (!log) return false

        // 1. 撤回库存变动
        set((s) => ({
          items: s.items.map((i) =>
            i.id === log.itemId
              ? {
                  ...i,
                  quantity: log.operation === 'in'
                    ? Math.max(0, i.quantity - log.quantityChange)  // 入库撤回：扣回
                    : i.quantity + log.quantityChange,                // 出库撤回：加回
                  lastUpdated: new Date().toISOString(),
                }
              : i
          ),
        }))

        // 2. 联动删除关联财务记录
        if (log.financeId) {
          useFinanceStore.setState((fs) => ({
            records: fs.records.filter((r) => r.id !== log.financeId),
          }))
        }

        // 3. 删除日志
        set((s) => ({
          logs: s.logs.filter((l) => l.id !== logId),
        }))

        void deleteInventoryLogWithRevert(log)
          .catch(() => set({ items: state.items, logs: state.logs }))

        return true
      },

      // 清理日志：保留最近 30 条
      cleanupLogs: () => {
        const logs = get().logs
        if (logs.length > 30) {
          set({ logs: logs.slice(0, 30) })
        }
      },

      clearAllItems: () => set({ items: [], logs: [] }),
    }),
    {
      name: 'canwin-inventory',
      version: 2,
      storage: safeStorage,
      migrate: () => ({ items: [], logs: [] }),
    }
  )
)
