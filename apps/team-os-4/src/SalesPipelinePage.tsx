import { useEffect, useState } from 'react'
import type { SalesPipeline } from './domain/sales-pipeline'
import type { AuthenticatedWorkspace } from './lib/access'
import { SupabaseSalesPipelineReader } from './lib/supabase-sales-pipeline-reader'
import { EmptyState, StatusBadge } from './ui'
const reader = new SupabaseSalesPipelineReader()
export function SalesPipelinePage({ user }: { user: AuthenticatedWorkspace }) {
  const allowed = user.primaryRole === 'sales' || user.primaryRole === 'admin'; const [data, setData] = useState<SalesPipeline>(); const [error, setError] = useState(false)
  useEffect(() => { if (!allowed) return; const controller = new AbortController(); reader.load(user.companyId, user.userId, user.primaryRole === 'admin', controller.signal).then(setData).catch(() => { if (!controller.signal.aborted) setError(true) }); return () => controller.abort() }, [allowed, user.companyId, user.primaryRole, user.userId])
  if (!allowed) return <section className="workspace access-denied" data-testid="sales-pipeline-denied"><h1>无权访问销售线索</h1></section>
  if (error) return <section className="workspace" data-testid="sales-pipeline-error"><StatusBadge tone="danger">销售数据读取失败</StatusBadge></section>
  if (!data) return <section className="workspace" data-testid="sales-pipeline-loading"><StatusBadge tone="info">正在读取线索与商机…</StatusBadge></section>
  const owned = data.leads.filter((item) => item.ownerId === user.userId); const pool = data.leads.filter((item) => item.poolStatus === 'public_pool')
  return <section className="workspace" data-testid="sales-pipeline-page"><p className="eyebrow">销售工作台</p><h1>线索与商机</h1>{!data.leads.length && !data.opportunities.length ? <EmptyState title="当前没有线索或商机" description="这里仅展示全新 4.0 的真实销售数据。" /> : <><h2>我的线索</h2><ol className="work-item-list" data-testid="sales-lead-owned">{owned.map((item) => <li key={item.id} data-testid="lead-row"><div><strong>{item.name}</strong><span>{item.region}</span></div><StatusBadge tone="info">{item.poolStatus}</StatusBadge></li>)}</ol><h2>区域公海</h2><ol className="work-item-list" data-testid="sales-lead-pool">{pool.map((item) => <li key={item.id} data-testid="lead-pool-row"><div><strong>{item.name}</strong><span>{item.region}</span></div><StatusBadge tone="neutral">公海</StatusBadge></li>)}</ol><h2>进行中商机</h2><ol className="work-item-list" data-testid="sales-opportunity-list">{data.opportunities.map((item) => <li key={item.id} data-testid="opportunity-row"><strong>{item.name}</strong><StatusBadge tone="info">{item.stage}</StatusBadge></li>)}</ol></>}</section>
}
