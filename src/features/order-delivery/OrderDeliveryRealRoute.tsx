import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, HardDrive, PackageCheck, RefreshCw, ShieldCheck, Truck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { RealHardwareWorkspace, RealOrderDelivery } from './dataSource'
import { createSupabaseOrderDeliveryDataSource } from './supabaseDataSource'
import AfterSalesLifecyclePanel from './AfterSalesLifecyclePanel'

const dataSource = createSupabaseOrderDeliveryDataSource(supabase)
const requestedOrderId = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('order') ?? ''
const money = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const stateLabel: Record<string, string> = { pending: '待处理', opening: '开通中', active: '已开通', failed: '失败', reserved: '已备货', shortage: '缺货', shipped: '已出库', completed: '已完成' }

export default function OrderDeliveryRealRoute() {
  const [orders, setOrders] = useState<RealOrderDelivery[]>([])
  const [selected, setSelected] = useState<RealOrderDelivery | null>(null)
  const [hardware, setHardware] = useState<RealHardwareWorkspace | null>(null)
  const [stockId, setStockId] = useState('')
  const [stockQuantity, setStockQuantity] = useState('1')
  const [expectedOn, setExpectedOn] = useState('')
  const [stockKey, setStockKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const rows = await dataSource.listOrders(); setOrders(rows)
      setSelected(current => current ? rows.find(row => row.orderId === current.orderId) ?? null : rows.find(row => row.orderId === requestedOrderId()) ?? rows[0] ?? null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '读取真实订单履约失败') }
    finally { setBusy(false) }
  }, [])
  const loadHardware = useCallback(async (deliveryId: string) => {
    try {
      const workspace = await dataSource.loadHardwareWorkspace(deliveryId); setHardware(workspace)
      setStockId(current => workspace.stocks.some(stock => stock.id === current) ? current : workspace.stocks[0]?.id ?? '')
    } catch (caught) { setHardware(null); setError(caught instanceof Error ? caught.message : '读取订单硬件工作区失败') }
  }, [])
  useEffect(() => { queueMicrotask(() => { void load() }) }, [load])
  useEffect(() => { queueMicrotask(() => { if (selected?.deliveryId) void loadHardware(selected.deliveryId); else setHardware(null) }) }, [selected?.deliveryId, loadHardware])

  const run = async (label: string, operation: () => Promise<void>) => {
    setBusy(true); setError(null); setNotice(null)
    try {
      await operation(); setNotice(`${label}成功`); await load()
      if (selected?.deliveryId) await loadHardware(selected.deliveryId)
      return true
    } catch (caught) { setError(caught instanceof Error ? caught.message : `${label}失败`); return false }
    finally { setBusy(false) }
  }
  const reserve = async () => {
    if (!selected?.deliveryId || !stockId || !expectedOn) return
    const succeeded = await run('库存请求处理', () => dataSource.reserveStock(selected.deliveryId!, stockId, Number(stockQuantity), expectedOn, stockKey))
    if (succeeded) setStockKey(crypto.randomUUID())
  }

  const d = selected
  const selectedStock = hardware?.stocks.find(stock => stock.id === stockId)
  return <main className="min-h-screen bg-slate-50 p-3 pb-24 md:p-6">
    <header className="mx-auto max-w-6xl rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-900 p-5 text-white md:p-7"><a href="#/sales-v3" className="mb-5 inline-flex items-center gap-1 text-sm text-indigo-100"><ArrowLeft size={16}/>返回销售工作台</a><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold tracking-widest text-indigo-200">正式订单之后</p><h1 className="mt-1 text-2xl font-bold md:text-3xl">订单履约工作台</h1><p className="mt-2 text-sm text-slate-300">一张订单内分别推进软件和硬件；报价与定金阶段不会读取或占用库存。</p></div><div className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm"><ShieldCheck size={19}/><span>内部款结清后才解锁履约</span></div></div></header>
    <section className="mx-auto mt-4 max-w-6xl">{error && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={17}/>{notice}</p>}
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-slate-900">正式订单</h2><button disabled={busy} onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50"><RefreshCw size={15}/>刷新</button></div>
      {!busy && !error && orders.length === 0 && <p className="rounded-xl border border-dashed bg-white p-5 text-sm text-slate-500">当前账号没有可见的正式订单。</p>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{orders.map(item => <button key={item.orderId} onClick={() => { setSelected(item); setError(null); setNotice(null); setStockKey(crypto.randomUUID()) }} className={`rounded-xl border bg-white p-4 text-left shadow-sm ${d?.orderId === item.orderId ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-slate-200'}`}><div className="flex items-start justify-between gap-2"><span><strong className="text-slate-900">{item.brandName ? `${item.brandName} · ` : ''}{item.storeName}</strong><small className="mt-1 block text-slate-500">{item.orderNumber}</small></span><em className={`rounded-full px-2 py-1 text-xs not-italic ${item.fulfillmentAllowed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{item.fulfillmentAllowed ? '已解锁' : '待内部款'}</em></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><Status label="软件" value={item.state?.softwareStatus}/><Status label="硬件" value={item.state?.hardwareStatus}/></div></button>)}</div>

      {d && <div className="mt-4 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]"><aside className="space-y-3"><section className="rounded-xl border bg-white p-4"><h2 className="font-semibold text-slate-900">{d.storeName}</h2><p className="mt-1 text-xs text-slate-500">{d.orderNumber} · 单订单双履约</p><div className="mt-4 grid grid-cols-2 gap-2 text-sm"><span>内部应付<br/><b>{money(d.internalDue)}</b></span><span>内部已付<br/><b>{money(d.internalPaid)}</b></span></div>{!d.fulfillmentAllowed && <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><b>履约锁定</b><p className="mt-1">内部应付尚未结清。软件开通、硬件库存读取和扣减均不可执行。</p></div>}{d.fulfillmentAllowed && !d.deliveryId && <button disabled={busy || !d.storeId} onClick={() => void run('建立履约', () => dataSource.createDelivery(d.orderId, d.storeId, null))} className="mt-4 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">为该订单建立履约</button>}</section>
        <AfterSalesLifecyclePanel key={d.orderId} order={d} dataSource={dataSource} busy={busy} run={run}/></aside>

      <div className="space-y-4"><section className="rounded-xl border bg-white p-4 md:p-5"><div className="flex items-center justify-between"><span className="flex items-center gap-2"><HardDrive className="text-indigo-600"/><b className="text-slate-900">软件履约</b></span><em className="rounded-full bg-indigo-50 px-3 py-1 text-xs not-italic text-indigo-700">{stateLabel[d.state?.softwareStatus ?? 'pending'] ?? d.state?.softwareStatus}</em></div><p className="mt-2 text-sm text-slate-500">软件状态独立推进，不等待硬件出库。</p>{d.deliveryId && <button disabled={busy || !d.fulfillmentAllowed || d.state?.softwareStatus === 'active'} onClick={() => void run('软件开通', () => dataSource.activateSoftware(d.deliveryId!))} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{d.state?.softwareStatus === 'active' ? '软件已开通' : '确认软件开通'}</button>}</section>

      <section className="rounded-xl border bg-white p-4 md:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2"><PackageCheck className="text-indigo-600"/><b className="text-slate-900">硬件履约</b></span><em className={`rounded-full px-3 py-1 text-xs not-italic ${d.state?.hardwareStatus === 'shortage' ? 'bg-red-50 text-red-700' : 'bg-indigo-50 text-indigo-700'}`}>{stateLabel[d.state?.hardwareStatus ?? 'pending'] ?? d.state?.hardwareStatus}</em></div><p className="mt-2 text-sm text-slate-500">只按冻结报价中的硬件SKU和数量准备，不记录序列号。</p>
        {hardware?.lockedReason && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{hardware.lockedReason}</div>}
        {hardware && hardware.requirements.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2">{hardware.requirements.map(item => <div key={item.catalogItemId} className="rounded-lg bg-slate-50 p-3 text-sm"><b>{item.name}</b><small className="block text-slate-500">SKU {item.sku}</small><span className="mt-2 block">订单数量 {item.requiredQuantity} · 已准备 {item.allocatedQuantity}</span></div>)}</div>}
        {hardware && hardware.requirements.length === 0 && <p className="mt-4 rounded-lg border border-dashed p-3 text-sm text-slate-500">该订单没有硬件项目，可直接完成硬件状态。</p>}
        {hardware?.canManage && !hardware.lockedReason && <><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_90px_160px_auto]"><label className="text-xs text-slate-600">订单硬件<select value={stockId} onChange={event => { setStockId(event.target.value); setStockKey(crypto.randomUUID()) }} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"><option value="">选择硬件</option>{hardware.stocks.map(stock => <option key={stock.id} value={stock.id}>{stock.name}（可用 {stock.availableQuantity}）</option>)}</select></label><label className="text-xs text-slate-600">数量<input type="number" min="1" step="1" value={stockQuantity} onChange={event => { setStockQuantity(event.target.value); setStockKey(crypto.randomUUID()) }} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label><label className="text-xs text-slate-600">预计到货日<input type="date" min={new Date().toISOString().slice(0,10)} value={expectedOn} onChange={event => { setExpectedOn(event.target.value); setStockKey(crypto.randomUUID()) }} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label><button disabled={busy || !stockId || !(Number(stockQuantity)>0) || !expectedOn} onClick={() => void reserve()} className="self-end rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">准备库存</button></div>{selectedStock && Number(stockQuantity)>selectedStock.availableQuantity && <p className="mt-2 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><AlertTriangle size={17}/>当前可用数量不足；提交后将生成缺货异常并记录预计到货日。</p>}
          <div className="mt-4 grid gap-2">{hardware.reservations.map(reservation => <div key={reservation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm"><span>{reservation.itemName} × {reservation.quantity} · {stateLabel[reservation.status] ?? reservation.status}</span>{reservation.status === 'reserved' && <button disabled={busy} onClick={() => void run('硬件出库', () => dataSource.shipStock(reservation.id))} className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 px-3 py-1.5 text-indigo-700"><Truck size={15}/>确认出库</button>}</div>)}</div>
          <button disabled={busy || d.state?.hardwareStatus === 'completed'} onClick={() => void run('硬件履约完成', () => dataSource.completeHardware(d.deliveryId!))} className="mt-4 rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 disabled:opacity-50">{d.state?.hardwareStatus === 'completed' ? '硬件已完成' : '确认硬件全部完成'}</button></>}
        {hardware && !hardware.canManage && <p className="mt-3 text-sm text-slate-500">当前为只读视图；库存数量和操作仅仓库或财务角色可用。</p>}
        {d.exceptions.filter(item => item.status === 'open').map((item,index) => <div key={`${item.type}-${index}`} className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"><b>履约异常：{item.details}</b><p className="mt-1">预计解决：{item.expectedResolutionOn ?? '待确认'}</p></div>)}
      </section></div></div>}
    </section>
  </main>
}

function Status({ label, value }: { label: string; value?: string }) {
  return <span className="rounded-lg bg-slate-50 p-2 text-slate-600">{label}<b className="ml-1 text-slate-900">{stateLabel[value ?? 'pending'] ?? value}</b></span>
}
