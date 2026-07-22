import { useEffect, useState } from 'react'
import type { CustomerDirectory } from './domain/customer'
import type { AuthenticatedWorkspace } from './lib/access'
import { SupabaseCustomerDirectoryReader } from './lib/supabase-customer-directory-reader'
import { EmptyState, StatusBadge } from './ui'
const reader = new SupabaseCustomerDirectoryReader()
export function CustomerDirectoryPage({ user }: { user: AuthenticatedWorkspace }) {
  const allowed = user.primaryRole === 'sales' || user.primaryRole === 'admin'
  const [data, setData] = useState<CustomerDirectory>(); const [error, setError] = useState(false)
  useEffect(() => { if (!allowed) return; const controller = new AbortController(); reader.load(user.companyId, controller.signal).then(setData).catch(() => { if (!controller.signal.aborted) setError(true) }); return () => controller.abort() }, [allowed, user.companyId])
  if (!allowed) return <section className="workspace access-denied" data-testid="customer-access-denied"><h1>无权访问客户与门店</h1></section>
  if (error) return <section className="workspace" data-testid="customer-directory-error"><StatusBadge tone="danger">客户资料读取失败</StatusBadge></section>
  if (!data) return <section className="workspace" data-testid="customer-directory-loading"><StatusBadge tone="info">正在读取客户资料…</StatusBadge></section>
  if (!data.customers.length) return <section className="workspace" data-testid="customer-directory-empty"><h1>客户、品牌与门店</h1><EmptyState title="当前没有客户资料" description="这里仅显示全新 4.0 中的真实客户数据。" /></section>
  return <section className="workspace" data-testid="customer-directory-list"><p className="eyebrow">销售业务</p><h1>客户、品牌与门店</h1><ol className="work-item-list">{data.customers.map((customer) => { const brandIds = data.brands.filter((brand) => brand.customerId === customer.id).map((brand) => brand.id); return <li key={customer.id} data-testid="customer-row"><div><strong>{customer.name}</strong><span>{customer.region} · 品牌 {brandIds.length} · 门店 {data.stores.filter((store) => brandIds.includes(store.brandId)).length}</span></div><StatusBadge tone="success">客户</StatusBadge></li> })}</ol></section>
}
