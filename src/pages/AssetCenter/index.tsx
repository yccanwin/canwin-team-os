import { useMemo } from 'react'
import { Archive, ArrowDownToLine, ArrowUpFromLine, Boxes, Building2, History } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import AssetsPage from '@/pages/Assets'
import InventoryPage from '@/pages/Inventory'
import { useAssetStore } from '@/stores/useAssetStore'
import { useInventoryStore } from '@/stores/useInventoryStore'
import { useUserStore } from '@/stores/useUserStore'

type AssetView = 'inventory' | 'assets' | 'logs'

const tabs: Array<{ key: AssetView; label: string; description: string; icon: typeof Boxes }> = [
  { key: 'inventory', label: '库存物品', description: '查看数量与办理出入库', icon: Boxes },
  { key: 'assets', label: '固定资产', description: '沉淀设备与办公资产', icon: Building2 },
  { key: 'logs', label: '出入库记录', description: '追踪每一次库存变化', icon: History },
]

function isAssetView(value: string | null): value is AssetView {
  return value === 'inventory' || value === 'assets' || value === 'logs'
}

function InventoryLogView() {
  const logs = useInventoryStore((state) => state.logs)
  const users = useUserStore((state) => state.users)
  const sortedLogs = useMemo(
    () => [...logs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [logs],
  )

  return (
    <section className="px-3 py-4 lg:px-6">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-heading text-xl font-semibold text-brand-400">出入库记录</h2>
          <p className="mt-1 text-sm text-brand-300">按时间查看库存变化，记录继续使用原库存日志数据。</p>
        </div>
        <span className="w-fit rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
          共 {logs.length} 条记录
        </span>
      </div>

      {sortedLogs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-brand-100 bg-white px-6 py-16 text-center">
          <History className="mx-auto h-10 w-10 text-brand-200" />
          <p className="mt-3 font-medium text-brand-400">暂时还没有出入库记录</p>
          <p className="mt-1 text-sm text-brand-300">完成一次入库或出库后，变化会自动出现在这里。</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-card">
          <div className="divide-y divide-brand-100">
            {sortedLogs.map((log) => {
              const isStockIn = log.operation === 'in'
              const Icon = isStockIn ? ArrowDownToLine : ArrowUpFromLine
              const operator = users.find((user) => user.id === log.operatorId)
              const date = new Date(log.createdAt)

              return (
                <article key={log.id} className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-brand-50 sm:px-5">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isStockIn ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600'}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="truncate font-semibold text-brand-400">{log.itemName}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isStockIn ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
                        {isStockIn ? '入库' : '出库'} {log.quantityChange}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-brand-300">
                      {operator?.name || '团队成员'} · {Number.isNaN(date.getTime()) ? log.createdAt : date.toLocaleString('zh-CN')}
                    </p>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

export default function AssetCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const activeView: AssetView = isAssetView(requestedView) ? requestedView : 'inventory'
  const items = useInventoryStore((state) => state.items)
  const logs = useInventoryStore((state) => state.logs)
  const assets = useAssetStore((state) => state.assets)

  const selectView = (view: AssetView) => {
    const next = new URLSearchParams(searchParams)
    next.set('view', view)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-cyan-50/60 via-white to-white">
      <header className="border-b border-cyan-100 bg-gradient-to-r from-slate-950 via-cyan-950 to-indigo-950 px-4 py-6 text-white lg:px-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
              <Archive className="h-4 w-4" />
              Asset center
            </div>
            <h1 className="font-heading text-2xl font-semibold sm:text-3xl">资产中心</h1>
            <p className="mt-2 max-w-2xl text-sm text-cyan-100/80">一个入口管理流动库存与固定资产，底层数据和权限保持独立。</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:min-w-[360px]">
            <Metric label="库存品类" value={items.length} tone="cyan" />
            <Metric label="固定资产" value={assets.length} tone="violet" />
            <Metric label="流转记录" value={logs.length} tone="orange" />
          </div>
        </div>
      </header>

      <nav aria-label="资产中心二级导航" className="sticky top-0 z-10 border-b border-brand-100 bg-white/95 px-3 py-3 backdrop-blur lg:px-6">
        <div className="grid gap-2 sm:grid-cols-3">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const selected = tab.key === activeView
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => selectView(tab.key)}
                aria-current={selected ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all ${selected ? 'border-cyan-300 bg-cyan-50 text-cyan-900 shadow-sm' : 'border-transparent text-brand-300 hover:border-brand-100 hover:bg-brand-50'}`}
              >
                <Icon className={`h-5 w-5 shrink-0 ${selected ? 'text-cyan-600' : 'text-brand-200'}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{tab.label}</span>
                  <span className="hidden truncate text-xs opacity-75 md:block">{tab.description}</span>
                </span>
              </button>
            )
          })}
        </div>
      </nav>

      {activeView === 'inventory' && <InventoryPage />}
      {activeView === 'assets' && <AssetsPage />}
      {activeView === 'logs' && <InventoryLogView />}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'cyan' | 'violet' | 'orange' }) {
  const toneClass = {
    cyan: 'border-cyan-300/20 bg-cyan-400/10 text-cyan-200',
    violet: 'border-violet-300/20 bg-violet-400/10 text-violet-200',
    orange: 'border-orange-300/20 bg-orange-400/10 text-orange-200',
  }[tone]

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[11px] opacity-80">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
    </div>
  )
}
