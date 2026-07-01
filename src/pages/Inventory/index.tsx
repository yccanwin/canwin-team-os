import { useState, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { Package, Plus, Minus, ClipboardList } from 'lucide-react'
import { useUserStore } from '@/stores/useUserStore'
import { useInventoryStore } from '@/stores/useInventoryStore'
import { formatRelative } from '@/utils/dateUtils'
import EmptyStateIllustration from '@/components/EmptyStateIllustration'
import StockInModal from './StockInModal'
import StockOutModal from './StockOutModal'
import InventoryLogPanel from './InventoryLogPanel'
import { isWarehouseRole } from '@/services/profile'

export default function InventoryPage() {
  const currentUser = useUserStore((s) => s.currentUser)
  const items = useInventoryStore((s) => s.items)
  const logs = useInventoryStore((s) => s.logs)

  const canManageInventory = isWarehouseRole(currentUser.role)

  // 弹窗状态
  const [stockInOpen, setStockInOpen] = useState(false)
  const [stockOutItem, setStockOutItem] = useState<string | null>(null) // itemId
  const [logPanelOpen, setLogPanelOpen] = useState(false)

  if (!canManageInventory) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="font-heading text-lg font-semibold text-brand-400">仓库管理</h1>
          <p className="mt-1 text-sm text-brand-300">当前库存一览</p>
        </div>

        {items.length === 0 ? (
          <EmptyStateIllustration
            variant="inventory"
            title="记录团队资产，追踪物品生命周期"
          />
        ) : (
          <InventoryTable
            items={items}
            isCaptain={false}
            onStockOut={() => {}}
          />
        )}
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* 页面标题 + 操作按钮 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-lg font-semibold text-brand-400">仓库管理</h1>
          <p className="mt-1 text-sm text-brand-300">库存管理与出入库操作</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStockInOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-indigo-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            入库
          </button>
          <button
            onClick={() => setLogPanelOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white text-brand-400 text-sm font-medium rounded-lg border border-gray-300 hover:bg-brand-50 transition-colors"
          >
            <ClipboardList className="w-4 h-4" />
            操作日志
          </button>
        </div>
      </div>

      {/* 表格 */}
      {items.length === 0 ? (
        <EmptyStateIllustration
          variant="inventory"
          title="记录团队资产，追踪物品生命周期"
          action={
            <button
              onClick={() => setStockInOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-indigo-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              入库商品
            </button>
          }
        />
      ) : (
        <InventoryTable
          items={items}
          isCaptain={true}
          onStockIn={() => setStockInOpen(true)}
          onStockOut={(itemId) => setStockOutItem(itemId)}
        />
      )}

      {/* 入库弹窗 */}
      <StockInModal
        isOpen={stockInOpen}
        onClose={() => setStockInOpen(false)}
      />

      {/* 出库弹窗 */}
      {stockOutItem && (
        <StockOutModal
          isOpen={!!stockOutItem}
          onClose={() => setStockOutItem(null)}
          itemId={stockOutItem}
        />
      )}

      {/* 操作日志面板 */}
      <InventoryLogPanel
        isOpen={logPanelOpen}
        onClose={() => setLogPanelOpen(false)}
        logs={logs}
      />
    </div>
  )
}

// ============================================================
// 库存表格子组件
// ============================================================

type SortKey = 'name' | 'sku' | 'quantity' | 'unit' | 'unitPrice' | 'value' | 'lastUpdated'
type SortDir = 'asc' | 'desc'

interface InventoryTableProps {
  items: ReturnType<typeof useInventoryStore.getState>['items']
  isCaptain: boolean
  onStockIn?: () => void
  onStockOut?: (itemId: string) => void
}

function InventoryTable({
  items,
  isCaptain,
  onStockOut,
}: InventoryTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('lastUpdated')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  // 排序列头渲染
  const SortHeader = ({
    columnKey,
    label,
    align = 'left',
  }: {
    columnKey: SortKey
    label: string
    align?: 'left' | 'right' | 'center'
  }) => (
    <th
      className={`px-4 py-3 font-medium text-brand-400 cursor-pointer select-none hover:text-brand-400 transition-colors ${
        align === 'right'
          ? 'text-right'
          : align === 'center'
            ? 'text-center'
            : 'text-left'
      }`}
      onClick={() => handleSort(columnKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === columnKey && (
          <svg
            className={`w-3.5 h-3.5 transition-transform ${
              sortDir === 'asc' ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        )}
      </span>
    </th>
  )

  // 排序
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      let aVal: string | number
      let bVal: string | number
      if (sortKey === 'value') {
        aVal = a.quantity * a.unitPrice
        bVal = b.quantity * b.unitPrice
      } else {
        aVal = a[sortKey] ?? ''
        bVal = b[sortKey] ?? ''
      }
      const dir = sortDir === 'asc' ? 1 : -1
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return (aVal - bVal) * dir
      }
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal, 'zh-Hans-CN') * dir
      }
      return 0
    })
  }, [items, sortKey, sortDir])

  // 汇总计算
  const totalItems = items.length
  const totalValue = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  )

  return (
    <div>
      {/* 顶部库存总值横幅 — 仅队长可见 */}
      {isCaptain && (
        <div className="mb-4 bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 rounded-card px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium text-brand-400">
              库存总值
            </span>
          </div>
          <span className="text-lg font-bold text-brand-400">
            ¥{totalValue.toLocaleString()}
          </span>
        </div>
      )}

      <div className="bg-white rounded-card shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-100 bg-brand-50">
                <SortHeader columnKey="name" label="商品名称" />
                <SortHeader columnKey="sku" label="SKU" />
                <SortHeader
                  columnKey="quantity"
                  label="当前数量"
                  align="right"
                />
                <SortHeader columnKey="unit" label="单位" />
                {isCaptain && (
                  <>
                    <SortHeader
                      columnKey="unitPrice"
                      label="单价"
                      align="right"
                    />
                    <SortHeader
                      columnKey="value"
                      label="库存总值"
                      align="right"
                    />
                  </>
                )}
                <th className="px-4 py-3 font-medium text-brand-400 hidden sm:table-cell">
                  <span className="inline-flex items-center gap-1 cursor-pointer select-none hover:text-brand-400 transition-colors" onClick={() => handleSort('lastUpdated')}>
                    最后更新
                    {sortKey === 'lastUpdated' && (
                      <svg className={`w-3.5 h-3.5 transition-transform ${sortDir === 'asc' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </span>
                </th>
                {isCaptain && (
                  <th className="text-center px-4 py-3 font-medium text-brand-400">
                    操作
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => {
                const itemValue = item.quantity * item.unitPrice
                return (
                  <tr
                    key={item.id}
                    className="border-b border-gray-100 hover:bg-brand-50 transition-colors"
                    style={{ height: '48px' }}
                  >
                    <td className="px-4 py-2.5 font-medium text-brand-400">
                      {item.name}
                    </td>
                    <td className="px-4 py-2.5 text-brand-300">
                      {item.sku || '-'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-brand-400">
                      {item.quantity}
                    </td>
                    <td className="px-4 py-2.5 text-brand-400">
                      {item.unit}
                    </td>
                    {isCaptain && (
                      <>
                        <td className="px-4 py-2.5 text-right text-brand-400">
                          ¥{item.unitPrice.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-brand-400">
                          ¥{itemValue.toLocaleString()}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-2.5 text-brand-300 text-xs hidden sm:table-cell">
                      {formatRelative(item.lastUpdated)}
                    </td>
                    {isCaptain && (
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => onStockOut?.(item.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-expense bg-red-50 rounded-md hover:bg-red-100 transition-colors"
                            title="出库"
                          >
                            <Minus className="w-3 h-3" />
                            出库
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            {/* 汇总行 */}
            <tfoot>
              <tr className="bg-brand-50 border-t-2 border-brand-100">
                <td className="px-4 py-2.5 text-sm font-medium text-brand-400">
                  共 {totalItems} 种商品
                </td>
                <td />
                <td />
                <td />
                {isCaptain && (
                  <>
                    <td />
                    <td className="px-4 py-2.5 text-right text-sm font-semibold text-brand-400">
                      库存总值合计 ¥{totalValue.toLocaleString()}
                    </td>
                  </>
                )}
                <td />
                {isCaptain && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
