import { useState, useMemo } from 'react'
import { Plus, Building2, Pencil, Trash2, MapPin } from 'lucide-react'
import { useAssetStore } from '@/stores/useAssetStore'
import { useUserStore } from '@/stores/useUserStore'
import AssetFormModal from './AssetFormModal'
import { isCaptainRole, isFinanceRole, isWarehouseRole } from '@/services/profile'
import type { Asset, AssetCategory, AssetStatus } from '@/types'

// ============================================================
// 配置常量
// ============================================================

const CATEGORY_CONFIG: Record<AssetCategory, { icon: string; color: string; label: string }> = {
  vehicle:   { icon: '🚗', color: '#3B82F6', label: '车辆' },
  equipment: { icon: '🔧', color: '#F59E0B', label: '设备' },
  computer:  { icon: '💻', color: '#6366F1', label: '电脑' },
  warehouse: { icon: '🏭', color: '#10B981', label: '仓储' },
  other:     { icon: '📦', color: '#6B7280', label: '其他' },
}

const STATUS_CONFIG: Record<AssetStatus, { label: string; className: string }> = {
  in_use:   { label: '使用中', className: 'bg-green-50 text-green-700' },
  idle:     { label: '闲置',   className: 'bg-yellow-50 text-yellow-700' },
  disposed: { label: '已处置', className: 'bg-brand-50 text-brand-300' },
}

const FILTER_OPTIONS: { label: string; value: AssetCategory | 'all' }[] = [
  { label: '全部', value: 'all' },
  { label: '车辆', value: 'vehicle' },
  { label: '设备', value: 'equipment' },
  { label: '电脑', value: 'computer' },
  { label: '仓储', value: 'warehouse' },
  { label: '其他', value: 'other' },
]

// ============================================================
// 组件
// ============================================================

export default function AssetsPage() {
  const assets = useAssetStore((s) => s.assets)
  const totalValue = useAssetStore((s) => s.getTotalValue())
  const currentUser = useUserStore((s) => s.currentUser)
  const isCaptain = isCaptainRole(currentUser?.role)
  const canViewAmount =
    isCaptain || isFinanceRole(currentUser?.role) || isWarehouseRole(currentUser?.role)

  const [activeFilter, setActiveFilter] = useState<AssetCategory | 'all'>('all')
  const [formModal, setFormModal] = useState<Asset | null | 'new'>(null)

  // 筛选
  const filteredAssets = useMemo(() => {
    if (activeFilter === 'all') return assets
    return assets.filter((a) => a.category === activeFilter)
  }, [assets, activeFilter])

  // 删除
  const handleDelete = (id: string) => {
    if (window.confirm('确定删除这个资产记录吗？此操作不可撤销。')) {
      useAssetStore.getState().deleteAsset(id)
    }
  }

  // 表单提交
  const handleSubmit = (data: Omit<Asset, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => {
    if (formModal === 'new') {
      useAssetStore.getState().addAsset({
        ...data,
        createdBy: currentUser!.id,
      })
    } else if (formModal && typeof formModal === 'object') {
      useAssetStore.getState().updateAsset(formModal.id, data)
    }
    setFormModal(null)
  }

  return (
    <div className="px-3 lg:px-6 py-4">
      {/* 标题行 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="">资产馆</h1>
          <p className="text-sm text-brand-200 mt-0.5">管理团队实物资产</p>
        </div>
        {isCaptain && (
          <button
            onClick={() => setFormModal('new')}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加资产
          </button>
        )}
      </div>

      {/* 资产概览卡片 */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-6 border border-amber-100 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-amber-600 font-medium">
              {canViewAmount ? '资产总值' : '资产概览'}
            </p>
            {canViewAmount ? (
              <p className="text-3xl font-bold text-brand-400 mt-1">
                ¥{totalValue.toLocaleString()}
              </p>
            ) : (
              <p className="text-3xl font-bold text-brand-400 mt-1">
                {assets.length} 项
              </p>
            )}
            <p className="text-xs text-amber-500 mt-1">
              {assets.filter((a) => a.currentStatus === 'in_use').length} 项使用中
              {' · '}
              {assets.filter((a) => a.currentStatus === 'disposed').length} 项已处置
            </p>
          </div>
          <div className="text-5xl">{canViewAmount ? '💰' : '📦'}</div>
        </div>
      </div>

      {/* 类别筛选器 */}
      <div className="flex flex-wrap gap-2 mb-6">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setActiveFilter(opt.value)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              activeFilter === opt.value
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-gray-100 text-brand-400 hover:bg-gray-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 空状态 */}
      {filteredAssets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-brand-200">
          <Building2 className="w-16 h-16 text-neutral-tertiary mb-4" />
          {assets.length === 0 ? (
            <>
              <p className="text-lg font-medium text-brand-300">暂无资产记录</p>
              {isCaptain && (
                <p className="text-sm mt-1">点击右上角"添加资产"开始记录</p>
              )}
            </>
          ) : (
            <p className="text-lg font-medium text-brand-300">
              当前筛选条件下无匹配资产
            </p>
          )}
        </div>
      ) : (
        /* 资产卡片列表 */
        <div className="space-y-4">
          {filteredAssets.map((asset) => {
            const cat = CATEGORY_CONFIG[asset.category]
            const status = STATUS_CONFIG[asset.currentStatus]
            return (
              <div
                key={asset.id}
                className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow"
              >
                {/* 第一行：图标 + 名称 + 操作按钮 */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{cat.icon}</span>
                    <div>
                      <h3 className="font-heading text-lg font-bold text-brand-400 leading-tight">
                        {asset.name}
                      </h3>
                      <p className="text-sm text-brand-200 mt-0.5">
                        {cat.label} · 购入 {asset.purchaseDate}
                      </p>
                    </div>
                  </div>
                  {isCaptain && (
                    <div className="flex items-center gap-1.5 shrink-0 ml-4">
                      <button
                        onClick={() => setFormModal(asset)}
                        className="p-1.5 text-brand-200 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        title="编辑"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(asset.id)}
                        className="p-1.5 text-brand-200 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* 第二行：金额 + 状态 */}
                <div className="flex items-center gap-3 mb-2">
                  {canViewAmount && asset.amount !== undefined && (
                    <span className="text-base font-semibold text-brand-400">
                      ¥{asset.amount.toLocaleString()}
                    </span>
                  )}
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}
                  >
                    {status.label}
                  </span>
                </div>

                {/* 位置 */}
                {asset.location && (
                  <div className="flex items-center gap-1.5 text-sm text-brand-300 mb-2">
                    <MapPin className="w-3.5 h-3.5" />
                    {asset.location}
                  </div>
                )}

                {/* 描述 */}
                {asset.description && (
                  <p className="text-sm text-brand-300 mb-3 line-clamp-2">
                    {asset.description}
                  </p>
                )}

                {/* 图片缩略图 */}
                {asset.images.length > 0 && (
                  <div className="flex gap-2 mt-3 pt-3 border-t border-gray-50">
                    {asset.images.map((img, i) => (
                      <img
                        key={i}
                        src={img}
                        alt={`${asset.name} ${i + 1}`}
                        className="w-16 h-16 object-cover rounded-lg border border-brand-100 hover:scale-105 transition-transform cursor-pointer"
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 表单弹窗 */}
      {(formModal === 'new' || (formModal && typeof formModal === 'object')) && (
        <AssetFormModal
          asset={typeof formModal === 'object' ? formModal : null}
          onClose={() => setFormModal(null)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}
