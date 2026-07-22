import { useEffect, useState } from 'react'
import type { AuthenticatedWorkspace } from './lib/access'
import type { SalesPipeline } from './domain/sales-pipeline'
import type { CommerceData } from './domain/commerce'
import type { FinanceData } from './domain/finance'
import { SupabaseSalesPipelineReader } from './lib/supabase-sales-pipeline-reader'
import { SupabaseCommerceReader } from './lib/supabase-commerce-reader'
import { SupabaseFinanceReader } from './lib/supabase-finance-reader'
import { EmptyState, StatusBadge } from './ui'

type DayData = { readonly sales?: SalesPipeline; readonly commerce?: CommerceData; readonly finance?: FinanceData }
const money = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' })
const signedTotal = (rows: readonly { readonly eventType: string; readonly amount: number }[]) => rows.reduce((sum, row) => sum + (row.eventType === 'reversed' ? -row.amount : row.amount), 0)

function SalesDay({ data }: { data: DayData }) {
  if (!data.sales || !data.commerce) return null
  const mine = data.sales.leads.filter((lead) => lead.ownerId !== null)
  const publicPool = data.sales.leads.filter((lead) => lead.poolStatus === 'public_pool')
  const active = data.sales.opportunities.filter((item) => !['won', 'lost'].includes(item.stage))
  const openQuotes = data.commerce.quotes.filter((item) => ['draft', 'issued'].includes(item.status))
  const openOrders = data.commerce.orders.filter((item) => !['completed', 'cancelled'].includes(item.status))
  return <><div className="metric-grid" data-testid="sales-day-metrics"><article><span>我的在跟线索</span><strong>{mine.length}</strong></article><article><span>进行中商机</span><strong>{active.length}</strong></article><article><span>待推进报价/订单</span><strong>{openQuotes.length + openOrders.length}</strong></article></div><section className="work-items-section"><h3>今天优先处理</h3>{!active.length && !openQuotes.length && !openOrders.length ? <EmptyState title="当前没有待推进销售业务" description="这里只汇总当前账号可读取的真实线索、商机、报价和订单。" /> : <ol className="work-item-list" data-testid="sales-day-priority-list">{active.slice(0, 5).map((item) => <li key={item.id}><div><strong>{item.name}</strong><span>商机阶段</span></div><StatusBadge tone="info">{item.stage}</StatusBadge></li>)}{openQuotes.slice(0, 3).map((item) => <li key={item.id}><div><strong>报价 {item.id}</strong><span>客户 {item.customerId}</span></div><StatusBadge tone="warning">{item.status}</StatusBadge></li>)}{openOrders.slice(0, 3).map((item) => <li key={item.id}><div><strong>订单 {item.id}</strong><span>客户 {item.customerId}</span></div><StatusBadge tone="info">{item.status}</StatusBadge></li>)}</ol>}</section>{publicPool.length > 0 && <p className="notice" data-testid="sales-day-public-pool">区域公海还有 {publicPool.length} 条可见线索。</p>}</>
}

function FinanceDay({ finance }: { finance: FinanceData }) {
  const requested = finance.refunds.filter((item) => item.eventType === 'requested' || item.eventType === 'approved')
  return <><div className="metric-grid" data-testid="finance-day-metrics"><article><span>确认收付款净额</span><strong>{money.format(signedTotal(finance.payments))}</strong></article><article><span>内部款净额</span><strong>{money.format(signedTotal(finance.internalPayments))}</strong></article><article><span>待处理退款</span><strong>{requested.length}</strong></article></div><section className="work-items-section"><h3>退款与冲销关注</h3>{!requested.length ? <EmptyState title="当前没有待处理退款" description="汇总来自真实且不可变的财务事件。" /> : <ol className="work-item-list" data-testid="finance-day-refund-list">{requested.map((item) => <li key={item.id}><div><strong>订单 {item.orderId}</strong><span>{item.reason}</span></div><StatusBadge tone="warning">{item.eventType}</StatusBadge><small>{money.format(item.amount)}</small></li>)}</ol>}</section></>
}

function AdminDay({ data }: { data: DayData }) {
  if (!data.sales || !data.commerce || !data.finance) return null
  const unowned = data.sales.leads.filter((item) => item.ownerId === null && item.poolStatus === 'public_pool')
  const active = data.sales.opportunities.filter((item) => !['won', 'lost'].includes(item.stage))
  const fulfilling = data.commerce.orders.filter((item) => item.status === 'confirmed' || item.status === 'fulfilling')
  const refunds = data.finance.refunds.filter((item) => item.eventType === 'requested' || item.eventType === 'approved')
  return <><div className="metric-grid" data-testid="admin-day-metrics"><article><span>待分配公海线索</span><strong>{unowned.length}</strong></article><article><span>在途商机/履约</span><strong>{active.length + fulfilling.length}</strong></article><article><span>退款关注</span><strong>{refunds.length}</strong></article></div><section className="work-items-section"><h3>今日经营关注</h3>{!unowned.length && !active.length && !fulfilling.length && !refunds.length ? <EmptyState title="当前没有经营异常" description="管理员总览只汇总当前公司真实可见数据。" /> : <ol className="work-item-list" data-testid="admin-day-attention-list">{unowned.slice(0, 4).map((item) => <li key={item.id}><div><strong>{item.name}</strong><span>{item.region}</span></div><StatusBadge tone="warning">待分配</StatusBadge></li>)}{fulfilling.slice(0, 4).map((item) => <li key={item.id}><div><strong>订单 {item.id}</strong><span>履约关注</span></div><StatusBadge tone="info">{item.status}</StatusBadge></li>)}{refunds.slice(0, 4).map((item) => <li key={item.id}><div><strong>订单 {item.orderId}</strong><span>{item.reason}</span></div><StatusBadge tone="warning">退款 {item.eventType}</StatusBadge></li>)}</ol>}</section></>
}

export function RoleDayOverview({ user }: { user: AuthenticatedWorkspace }) {
  const supported = ['sales', 'finance', 'admin'].includes(user.primaryRole)
  const [data, setData] = useState<DayData>()
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!supported) return
    const controller = new AbortController()
    const sales = new SupabaseSalesPipelineReader(), commerce = new SupabaseCommerceReader(), finance = new SupabaseFinanceReader()
    const request: Promise<DayData> = user.primaryRole === 'sales' ? Promise.all([sales.load(user.companyId, user.userId, false, controller.signal), commerce.load(user.companyId, controller.signal)]).then(([salesData, commerceData]) => ({ sales: salesData, commerce: commerceData })) : user.primaryRole === 'finance' ? finance.loadFinance(user.companyId, controller.signal).then((financeData) => ({ finance: financeData })) : Promise.all([sales.load(user.companyId, user.userId, true, controller.signal), commerce.load(user.companyId, controller.signal), finance.loadFinance(user.companyId, controller.signal)]).then(([salesData, commerceData, financeData]) => ({ sales: salesData, commerce: commerceData, finance: financeData }))
    setData(undefined); setError(false); request.then(setData).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [supported, user.companyId, user.primaryRole, user.userId])
  if (!supported) return null
  return <section className="work-items-section role-day-overview" data-testid={`role-day-${user.primaryRole}`}><div className="section-heading"><p className="eyebrow">真实业务汇总</p><h2>今天先看这里</h2></div>{error ? <StatusBadge tone="danger">岗位业务汇总读取失败</StatusBadge> : !data ? <StatusBadge tone="info">正在读取岗位业务…</StatusBadge> : user.primaryRole === 'sales' ? <SalesDay data={data} /> : user.primaryRole === 'finance' && data.finance ? <FinanceDay finance={data.finance} /> : <AdminDay data={data} />}</section>
}
