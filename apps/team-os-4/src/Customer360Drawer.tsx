import type { Brand, Customer, Store } from './domain/customer'
import { StatusBadge } from './ui'

export function Customer360Drawer({ customer, brands, stores, onClose }: { customer: Customer; brands: readonly Brand[]; stores: readonly Store[]; onClose: () => void }) {
  const customerBrands = brands.filter((brand) => brand.customerId === customer.id)
  const brandIds = new Set(customerBrands.map((brand) => brand.id))
  const customerStores = stores.filter((store) => brandIds.has(store.brandId))
  return <div className="customer-drawer-shell" data-testid="customer-360">
    <button className="customer-drawer-backdrop" aria-label="关闭客户360" onClick={onClose} />
    <aside className="customer-drawer" role="dialog" aria-modal="true" aria-labelledby="customer-360-title">
      <header><div><p className="eyebrow">客户 360</p><h2 id="customer-360-title">{customer.name}</h2></div><button className="ui-icon-button" data-testid="customer-360-close" aria-label="关闭" onClick={onClose}>×</button></header>
      <dl><div><dt>区域</dt><dd>{customer.region}</dd></div><div><dt>品牌</dt><dd>{customerBrands.length}</dd></div><div><dt>门店</dt><dd>{customerStores.length}</dd></div></dl>
      <section><h3>品牌</h3>{customerBrands.map((brand) => <div className="customer-360-row" key={brand.id}><strong>{brand.name}</strong><StatusBadge tone="success">品牌</StatusBadge></div>)}</section>
      <section><h3>门店</h3>{customerStores.map((store) => <div className="customer-360-row" key={store.id}><div><strong>{store.name}</strong><small>{store.address}</small></div><StatusBadge tone="neutral">{store.storeType === 'new' ? '新店' : '竞品存量店'}</StatusBadge></div>)}</section>
    </aside>
  </div>
}
