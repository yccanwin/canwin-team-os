import { useMemo, useState } from 'react'
import { CalendarClock, Check, ClipboardCheck, Headphones, Wrench } from 'lucide-react'
import type { OrderDeliveryDataSourceReal, RealOrderDelivery } from './dataSource'

const checklistItems = [
  ['customer_context', '客户背景已说明'],
  ['quoted_scope', '成交范围已交接'],
  ['payment_context', '收款情况已交接'],
  ['implementation_contact', '实施联系人已确认'],
] as const

const cnTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))

export default function AfterSalesLifecyclePanel({ order, dataSource, busy, run }: {
  order: RealOrderDelivery
  dataSource: OrderDeliveryDataSourceReal
  busy: boolean
  run: (label: string, operation: () => Promise<void>) => Promise<boolean>
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [serviceExpiresOn, setServiceExpiresOn] = useState(order.serviceExpiresOn ?? '')
  const allChecked = checklistItems.every(([key]) => checks[key])
  const renewalItems = useMemo(() => [...order.renewals].sort((a, b) => b.daysBefore - a.daysBefore), [order.renewals])
  const afterSales = order.afterSalesTask

  return <div className="space-y-4">
    <section className="rounded-xl border bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-2"><Headphones className="mt-0.5 text-indigo-600" size={19}/><div><h3 className="font-semibold text-slate-900">售后群与交接</h3><p className="mt-1 text-xs text-slate-500">定金确认后 24 小时内建群，销售按清单交接，运维确认接手。</p></div></div>
        <span className={`rounded-full px-2 py-1 text-xs ${afterSales?.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{afterSales?.status === 'accepted' ? '已接手' : afterSales?.status === 'submitted' ? '待运维确认' : '待建群'}</span>
      </div>
      {afterSales && <p className={`mt-3 rounded-lg p-2 text-sm ${!afterSales.submittedAt && new Date(afterSales.dueAt) < new Date() ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-700'}`}>截止（北京时间）：{cnTime(afterSales.dueAt)}</p>}
      {!afterSales?.submittedAt && <><div className="mt-3 grid gap-2 sm:grid-cols-2">{checklistItems.map(([key, label]) => <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm text-slate-700"><input type="checkbox" checked={Boolean(checks[key])} onChange={event => setChecks(current => ({ ...current, [key]: event.target.checked }))}/>{label}</label>)}</div><button disabled={busy || !afterSales || !allChecked} onClick={() => void run('售后群与交接提交', () => dataSource.submitAfterSales(order.orderId, checks, crypto.randomUUID()))} className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">确认已建群并提交清单</button></>}
      {afterSales?.status === 'submitted' && <button disabled={busy} onClick={() => void run('运维接手', () => dataSource.confirmAfterSales(order.orderId, crypto.randomUUID()))} className="mt-3 w-full rounded-lg border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-700 disabled:opacity-40">运维确认接手</button>}
    </section>

    {order.deliveryId && <section className="rounded-xl border bg-white p-4">
      <div className="flex gap-2"><Wrench className="mt-0.5 text-indigo-600" size={19}/><div><h3 className="font-semibold text-slate-900">实施 2 项结束</h3><p className="mt-1 text-xs text-slate-500">只需安装、培训两项；不要客户电子签名，不重复上传照片。</p></div></div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Step done={Boolean(order.installedAt)} label="安装" onClick={() => run('安装确认', () => dataSource.markImplementation(order.deliveryId!, 'installation', crypto.randomUUID()))} disabled={busy}/>
        <Step done={Boolean(order.trainedAt)} label="培训" onClick={() => run('培训确认', () => dataSource.markImplementation(order.deliveryId!, 'training', crypto.randomUUID()))} disabled={busy}/>
      </div>
      {order.implementationCompletedAt && <p className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700"><ClipboardCheck size={17}/>实施已结束</p>}
    </section>}

    <section className="rounded-xl border bg-white p-4">
      <div className="flex gap-2"><CalendarClock className="mt-0.5 text-indigo-600" size={19}/><div><h3 className="font-semibold text-slate-900">续费行动队列</h3><p className="mt-1 text-xs text-slate-500">服务到期日生成 60 / 30 / 15 天节点。</p></div></div>
      {order.deliveryId && <div className="mt-3 flex gap-2"><input aria-label="服务到期日" type="date" value={serviceExpiresOn} onChange={event => setServiceExpiresOn(event.target.value)} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"/><button disabled={busy || !serviceExpiresOn || serviceExpiresOn === order.serviceExpiresOn} onClick={() => void run('服务到期日保存', () => dataSource.setServiceExpiry(order.deliveryId!, serviceExpiresOn, order.serviceExpiresOn ? '到期日调整' : '首次设置', crypto.randomUUID()))} className="rounded-lg border border-indigo-300 px-3 py-2 text-sm text-indigo-700 disabled:opacity-40">保存</button></div>}
      {renewalItems.length ? <div className="mt-3 space-y-2">{renewalItems.map(item => { const overdue = item.status !== 'completed' && item.dueOn < new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }); return <div key={item.daysBefore} className={`flex items-center justify-between rounded-lg p-2 text-sm ${overdue ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-700'}`}><span>到期前 {item.daysBefore} 天</span><span>{item.dueOn} · {item.status === 'completed' ? '已完成' : overdue ? '已逾期' : '待跟进'}</span></div>})}</div> : <p className="mt-3 rounded-lg border border-dashed p-3 text-sm text-slate-500">设置服务到期日后自动生成。</p>}
    </section>
  </div>
}

function Step({ done, label, onClick, disabled }: { done: boolean; label: string; onClick: () => Promise<boolean>; disabled: boolean }) {
  return <button disabled={disabled || done} onClick={() => void onClick()} className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium disabled:opacity-70 ${done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-700'}`}>{done && <Check size={16}/>} {done ? `${label}已完成` : `完成${label}`}</button>
}
