import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Circle, Clock3, PackageCheck } from 'lucide-react'
import { demoOrders } from './demoData'
import type { DeliveryOrder, DemoOrderAction, FulfillmentStatus } from './types'
import { applyDemoAction, fulfillmentLabels, getOrderAlerts, stageLabels } from './workflow'

const statusTone: Record<FulfillmentStatus, string> = {
  not_started: 'bg-slate-100 text-slate-500', in_progress: 'bg-blue-50 text-blue-700', blocked: 'bg-red-50 text-red-700', completed: 'bg-emerald-50 text-emerald-700',
}

function Track({ label, status }: { label: string; status: FulfillmentStatus }) {
  const Icon = status === 'completed' ? CheckCircle2 : status === 'blocked' ? AlertTriangle : status === 'in_progress' ? Clock3 : Circle
  return <div className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${statusTone[status]}`}><Icon size={14} /><span>{label} · {fulfillmentLabels[status]}</span></div>
}

const actionLabels: Record<DemoOrderAction, string> = {
  confirm_deposit: '确认定金', confirm_internal_payment: '确认内部款', complete_software: '完成软件', complete_hardware: '完成硬件', complete_installation: '完成安装', complete_training: '完成培训', complete_handover: '完成交接', confirm_operations_acceptance: '运维确认接手',
}

const demoActions: DemoOrderAction[] = Object.keys(actionLabels) as DemoOrderAction[]

function OrderCard({ order, onAction }: { order: DeliveryOrder; onAction: (action: DemoOrderAction) => void }) {
  const alerts = getOrderAlerts(order)
  const m = order.milestones
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="text-xs text-slate-500">{order.orderNumber}</p><h3 className="font-semibold text-slate-900">{order.customerName} · {order.storeName}</h3></div>
        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">{stageLabels[order.stage]}</span>
      </div>
      <p className="mt-2 text-xs text-slate-500">负责人：{order.ownerName} · 创建：{order.createdAt}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Track label="软件" status={m.software.status} /><Track label="硬件" status={m.hardware.status} />
        <Track label="安装" status={m.installation.status} /><Track label="培训" status={m.training.status} /><Track label="售后交接" status={m.afterSalesHandover.status} />
      </div>
      {alerts.length > 0 && <div className="mt-3 space-y-1 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">{alerts.map(alert => <p key={alert}>• {alert}</p>)}</div>}
      {order.stockExceptions.map(item => <p key={item.productName} className="mt-2 text-xs text-red-700">缺货：{item.productName} × {item.shortageQuantity}，预计 {item.expectedArrivalDate ?? '待确认'} 到货</p>)}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">{demoActions.map(action => <button key={action} type="button" onClick={() => onAction(action)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:border-indigo-300 hover:text-indigo-700">{actionLabels[action]}</button>)}</div>
    </article>
  )
}

export interface OrderDeliveryWorkbenchProps { orders?: DeliveryOrder[] }

export function OrderDeliveryWorkbench({ orders = demoOrders }: OrderDeliveryWorkbenchProps) {
  const [localOrders, setLocalOrders] = useState(() => structuredClone(orders))
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null)
  const exceptionCount = localOrders.filter(order => getOrderAlerts(order).length > 0).length
  const runAction = (id: string, action: DemoOrderAction) => {
    const current = localOrders.find(order => order.id === id)
    if (!current) return
    const result = applyDemoAction(current, action)
    setNotice({ ok: result.ok, message: result.message })
    if (result.ok) setLocalOrders(items => items.map(item => item.id === id ? result.order : item))
  }
  return (
    <section className="min-h-screen bg-slate-50 p-4 md:p-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-medium text-indigo-600">CanWin Team OS 3.0</p><h1 className="text-2xl font-bold text-slate-900">订单与交付工作台</h1><p className="mt-1 text-sm text-slate-500">演示数据，不触发真实付款、库存或履约操作</p></div><div className="flex gap-2"><span className="rounded-lg bg-white px-3 py-2 text-sm shadow-sm">订单 {orders.length}</span><span className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">待处理 {exceptionCount}</span></div></header>
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-800"><PackageCheck size={18} /><span>本地演示操作：定金与内部款确认后才可推进履约；刷新页面即重置，不会写入系统。</span></div>
      {notice && <div role="status" className={`mb-4 rounded-xl p-3 text-sm ${notice.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{notice.message}</div>}
      <div className="grid gap-4 lg:grid-cols-2">{localOrders.map(order => <OrderCard key={order.id} order={order} onAction={action => runAction(order.id, action)} />)}</div>
    </section>
  )
}

export default OrderDeliveryWorkbench
