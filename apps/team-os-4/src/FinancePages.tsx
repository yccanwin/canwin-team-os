import { useEffect, useState } from 'react'
import type { FinanceData, LaborEarning } from './domain/finance'
import type { AuthenticatedWorkspace } from './lib/access'
import { SupabaseFinanceReader } from './lib/supabase-finance-reader'
import { EmptyState, StatusBadge } from './ui'
const reader = new SupabaseFinanceReader()
export function FinancePage({ user }: { user: AuthenticatedWorkspace }) {
  const allowed = user.primaryRole === 'finance' || user.primaryRole === 'admin'
  const [data, setData] = useState<FinanceData>()
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!allowed) return
    const controller = new AbortController()
    reader.loadFinance(user.companyId, controller.signal).then(setData).catch(() => {
      if (!controller.signal.aborted) setError(true)
    })
    return () => controller.abort()
  }, [allowed, user.companyId])
  if (!allowed) return <section className="workspace access-denied" data-testid="finance-denied"><h1>无权访问财务总账</h1></section>
  if (error) return <section className="workspace" data-testid="finance-error"><StatusBadge tone="danger">财务读取失败</StatusBadge></section>
  if (!data) return <section className="workspace" data-testid="finance-loading"><StatusBadge tone="info">正在读取财务…</StatusBadge></section>
  if (!data.payments.length && !data.internalPayments.length && !data.profits.length && !data.refunds.length) return <section className="workspace" data-testid="finance-empty"><EmptyState title="当前没有财务记录" description="这里仅显示真实不可变财务事件。" /></section>
  return <section className="workspace" data-testid="finance-page"><h1>财务、内部款与利润</h1><div className="metric-grid"><article data-testid="finance-payment-count" data-count={data.payments.length}><span>收付款事件</span><strong>{data.payments.length}</strong></article><article><span>内部款事件</span><strong>{data.internalPayments.length}</strong></article><article><span>利润事件</span><strong>{data.profits.length}</strong></article></div><section className="work-items-section" data-testid="finance-refund-list"><h2>退款异常</h2>{!data.refunds.length ? <EmptyState title="当前没有退款异常" description="这里只显示真实退款事件。" /> : <ol className="work-item-list">{data.refunds.map((item) => <li key={item.id} data-testid="refund-row"><div><strong>订单 {item.orderId}</strong><span>{item.reason}</span></div><StatusBadge tone={item.eventType === 'confirmed' ? 'warning' : 'neutral'}>{item.eventType}</StatusBadge><small>¥{item.amount}</small></li>)}</ol>}</section></section>
}
export function EarningsPage({ user }: { user: AuthenticatedWorkspace }) { const [rows, setRows] = useState<readonly LaborEarning[]>(); const [error, setError] = useState(false); useEffect(() => { const controller = new AbortController(); reader.loadEarnings(user.companyId, controller.signal).then(setRows).catch(() => { if (!controller.signal.aborted) setError(true) }); return () => controller.abort() }, [user.companyId]); if (error) return <section className="workspace" data-testid="earnings-error"><StatusBadge tone="danger">收益读取失败</StatusBadge></section>; if (!rows) return <section className="workspace" data-testid="earnings-loading"><StatusBadge tone="info">正在读取劳动收益…</StatusBadge></section>; return <section className="workspace" data-testid="earnings-page"><h1>劳动收益</h1>{!rows.length ? <EmptyState title="当前没有劳动收益" description="这里仅显示 RLS 允许本人查看的真实收益记录。" /> : <ol className="work-item-list">{rows.map((item) => <li key={item.id} data-testid="earning-row"><strong>¥{item.amount}</strong><StatusBadge tone={item.entryType === 'recognized' ? 'success' : 'warning'}>{item.entryType}</StatusBadge></li>)}</ol>}</section> }
