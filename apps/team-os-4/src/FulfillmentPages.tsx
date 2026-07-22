import { useEffect, useState } from 'react'
import type { FulfillmentData, ServiceAssignment, ServiceType } from './domain/fulfillment'
import type { AuthenticatedWorkspace } from './lib/access'
import { SupabaseFulfillmentReader } from './lib/supabase-fulfillment-reader'
import { EmptyState, StatusBadge } from './ui'

const reader = new SupabaseFulfillmentReader()
const SERVICE_LABELS: Readonly<Record<ServiceType, string>> = {
  installation: '安装',
  training: '培训',
  acceptance: '验收',
  operations_handoff: '运维交接',
}
const IMPLEMENTATION_TYPES: readonly ServiceType[] = ['installation', 'training', 'acceptance']
const DATE_TIME = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

function useData(user: AuthenticatedWorkspace, allowed: boolean) {
  const [data, setData] = useState<FulfillmentData>()
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!allowed) return
    const controller = new AbortController()
    reader.load(user.companyId, controller.signal).then(setData).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [allowed, user.companyId])
  return { data, error }
}

export function WarehousePage({ user }: { user: AuthenticatedWorkspace }) {
  const allowed = user.primaryRole === 'admin' || user.additionalCapabilities.includes('warehouse')
  const state = useData(user, allowed)
  if (!allowed) return <section className="workspace access-denied" data-testid="warehouse-denied"><h1>当前账号没有仓库职能</h1></section>
  if (state.error) return <section className="workspace" data-testid="warehouse-error"><StatusBadge tone="danger">库存读取失败</StatusBadge></section>
  if (!state.data) return <section className="workspace" data-testid="warehouse-loading"><StatusBadge tone="info">正在读取库存…</StatusBadge></section>
  return <section className="workspace" data-testid="warehouse-page"><h1>仓库处理</h1>{!state.data.stock.length ? <EmptyState title="当前没有库存记录" description="这里仅显示真实库存。" /> : <ol className="work-item-list">{state.data.stock.map((item) => <li key={item.id} data-testid="warehouse-row"><div><strong>{item.productId}</strong><span>仓库 {item.warehouseId}</span></div><StatusBadge>可用 {item.onHandQuantity - item.reservedQuantity}</StatusBadge><small>已预留 {item.reservedQuantity}</small></li>)}</ol>}</section>
}

function AssignmentList({ assignments }: { assignments: readonly ServiceAssignment[] }) {
  if (!assignments.length) return <EmptyState title="当前没有本人服务任务" description="这里只显示数据库真实分配给当前账号的服务任务。" />
  return <ol className="work-item-list" data-testid="service-assignment-list">{assignments.map((item) => <li key={item.id} data-testid={`service-assignment-${item.serviceType}`}><div><strong>{SERVICE_LABELS[item.serviceType]}</strong><span>履约单元 {item.fulfillmentUnitId}</span></div><StatusBadge tone={item.status === 'completed' ? 'success' : item.status === 'in_progress' ? 'info' : 'neutral'}>{item.status}</StatusBadge><small>{item.scheduledAt ? `计划 ${DATE_TIME.format(new Date(item.scheduledAt))}` : '尚未排期'}</small></li>)}</ol>
}

export function FulfillmentPage({ user }: { user: AuthenticatedWorkspace }) {
  const allowed = ['implementation', 'operations', 'admin'].includes(user.primaryRole)
  const state = useData(user, allowed)
  if (!allowed) return <section className="workspace access-denied" data-testid="fulfillment-denied"><h1>无权访问履约任务</h1></section>
  if (state.error) return <section className="workspace" data-testid="fulfillment-error"><StatusBadge tone="danger">履约读取失败</StatusBadge></section>
  if (!state.data) return <section className="workspace" data-testid="fulfillment-loading"><StatusBadge tone="info">正在读取履约任务…</StatusBadge></section>

  const visible = state.data.assignments.filter((item) => user.primaryRole === 'admin' || item.assigneeId === user.userId)
  const implementation = visible.filter((item) => IMPLEMENTATION_TYPES.includes(item.serviceType))
  const operations = visible.filter((item) => item.serviceType === 'operations_handoff')

  if (user.primaryRole === 'implementation') return <section className="workspace" data-testid="implementation-service-page"><p className="eyebrow">实施岗位</p><h1>安装、培训与验收</h1><AssignmentList assignments={implementation} /></section>
  if (user.primaryRole === 'operations') return <section className="workspace" data-testid="operations-service-page"><p className="eyebrow">运维岗位</p><h1>运维交接服务</h1><AssignmentList assignments={operations} /></section>
  return <section className="workspace" data-testid="admin-service-page"><p className="eyebrow">管理员经营视图</p><h1>实施与运维服务总览</h1><div className="metric-grid"><article><span>实施服务</span><strong>{implementation.length}</strong></article><article><span>运维交接</span><strong>{operations.length}</strong></article><article><span>处理中</span><strong>{visible.filter((item) => item.status === 'in_progress').length}</strong></article></div><section className="work-items-section"><h2>实施队列</h2><AssignmentList assignments={implementation} /></section><section className="work-items-section"><h2>运维队列</h2><AssignmentList assignments={operations} /></section></section>
}
