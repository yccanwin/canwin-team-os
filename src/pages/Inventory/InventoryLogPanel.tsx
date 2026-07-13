import { useMemo, useState } from 'react'
import Modal from '@/components/Modal'
import { useUserStore } from '@/stores/useUserStore'
import { useInventoryStore } from '@/stores/useInventoryStore'
import type { InventoryLog } from '@/types'
import { formatRelative } from '@/utils/dateUtils'
import { ClipboardList, ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { isWarehouseRole } from '@/services/profile'

interface InventoryLogPanelProps {
  isOpen: boolean
  onClose: () => void
  logs: InventoryLog[]
}

export default function InventoryLogPanel({
  isOpen,
  onClose,
  logs,
}: InventoryLogPanelProps) {
  const users = useUserStore((s) => s.users)
  const currentUser = useUserStore((s) => s.currentUser)
  const deleteLog = useInventoryStore((s) => s.deleteLog)

  // 仅授权库存角色可查看/操作，云端 RLS 会再次校验
  const canManageInventory = isWarehouseRole(currentUser.role)

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [deleteError, setDeleteError] = useState('')

  // 获取操作人姓名
  const getOperatorName = (operatorId: string): string => {
    const user = users.find((u) => u.id === operatorId)
    return user ? user.name : '未知'
  }

  // 按时间倒序，最多 30 条
  const displayedLogs = useMemo(() => {
    return [...logs]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, 30)
  }, [logs])

  // 打开删除确认
  const handleDeleteClick = (log: InventoryLog) => {
    setDeleteTarget({ id: log.id, name: log.itemName })
    setDeleteError('')
  }

  // 确认删除
  const handleConfirmDelete = () => {
    if (!canManageInventory) {
      setDeleteError('当前账号没有库存日志维护权限')
      return
    }
    if (deleteTarget) {
      const success = deleteLog(deleteTarget.id)
      if (!success) {
        setDeleteError('未找到这条操作记录，请刷新后重试')
        return
      }
    }
    setDeleteTarget(null)
    setDeleteError('')
  }

  // 取消删除
  const handleCancelDelete = () => {
    setDeleteTarget(null)
    setDeleteError('')
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="库存操作日志"
      size="lg"
    >
      {!canManageInventory ? (
        <div className="flex flex-col items-center py-8">
          <p className="text-brand-300">仅队长和仓库负责人可查看操作日志</p>
        </div>
      ) : displayedLogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8">
          <ClipboardList className="w-12 h-12 text-neutral-tertiary mb-3" />
          <p className="text-brand-300 text-sm">暂无操作记录</p>
        </div>
      ) : (
        <div className="-mx-2 sm:-mx-6 sm:-my-4">
          <div className="space-y-3 px-2 sm:hidden">
            {displayedLogs.map((log) => {
              const isStockIn = log.operation === 'in'
              return (
                <div key={log.id} className="rounded-xl border border-brand-100 bg-white p-4 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-brand-400">{log.itemName}</p>
                      <p className="mt-1 text-xs text-brand-300">
                        {formatRelative(log.createdAt)} · {getOperatorName(log.operatorId)}
                      </p>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                        isStockIn ? 'bg-green-50 text-[#10B981]' : 'bg-red-50 text-[#EF4444]'
                      }`}
                    >
                      {isStockIn ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />}
                      {isStockIn ? '入库' : '出库'}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2">
                    <span className="text-xs text-brand-300">数量变动</span>
                    <span className={`text-sm font-semibold ${isStockIn ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                      {isStockIn ? '+' : '-'}{log.quantityChange}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteClick(log)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-100 px-3 py-2 text-sm font-medium text-expense transition-colors hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    删除记录
                  </button>
                </div>
              )
            })}
          </div>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-100 bg-brand-50">
                  <th className="text-left px-4 py-2.5 font-medium text-brand-400 text-xs">
                    时间
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-brand-400 text-xs">
                    操作类型
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-brand-400 text-xs">
                    商品名称
                  </th>
                  <th className="text-right px-4 py-2.5 font-medium text-brand-400 text-xs">
                    数量变动
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-brand-400 text-xs">
                    操作人
                  </th>
                  <th className="text-center px-4 py-2.5 font-medium text-brand-400 text-xs w-16">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-gray-100 hover:bg-brand-50 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-xs text-brand-300 whitespace-nowrap">
                      {formatRelative(log.createdAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      {log.operation === 'in' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-[#10B981]">
                          <ArrowDown className="w-3 h-3" />
                          入库
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-[#EF4444]">
                          <ArrowUp className="w-3 h-3" />
                          出库
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-brand-400">
                      {log.itemName}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {log.operation === 'in' ? (
                        <span className="text-[#10B981] font-medium">
                          +{log.quantityChange}
                        </span>
                      ) : (
                        <span className="text-[#EF4444] font-medium">
                          -{log.quantityChange}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-brand-400">
                      {getOperatorName(log.operatorId)}
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <button
                        onClick={() => handleDeleteClick(log)}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-brand-200 hover:text-expense hover:bg-red-50 transition-colors"
                        title="删除此条记录"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <Modal
          isOpen={!!deleteTarget}
          onClose={handleCancelDelete}
          title="确认删除操作记录"
          size="sm"
        >
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-800">
                将删除「<strong>{deleteTarget.name}</strong>」的操作记录，同时<strong>撤回库存变动</strong>并<strong>清除关联财务记录</strong>。此操作不可撤销。
              </p>
            </div>
            <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-300">
              此操作使用当前 Supabase 登录身份执行，云端权限和审计日志会记录这次撤回。
            </p>
            {deleteError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {deleteError}
              </p>
            )}
            <div className="flex gap-3 pt-1">
              <button
                onClick={handleCancelDelete}
                className="flex-1 px-4 py-2 text-sm font-medium text-brand-400 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-expense rounded-lg hover:bg-red-600 transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  )
}
