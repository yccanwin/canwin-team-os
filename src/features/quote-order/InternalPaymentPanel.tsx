import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InternalPaymentMethod, InternalPaymentWorkbenchRecord, QuoteOrderDataSource } from './dataSource'

const money = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const newKey = () => crypto.randomUUID()

export function InternalPaymentPanel({ dataSource }: { dataSource: QuoteOrderDataSource }) {
  const [rows, setRows] = useState<InternalPaymentWorkbenchRecord[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<InternalPaymentMethod>('cash_remitted')
  const [externalRef, setExternalRef] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(newKey)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selected = useMemo(() => rows.find(row => row.orderId === selectedId) ?? rows[0], [rows, selectedId])
  const load = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const next = await dataSource.listInternalPayments()
      setRows(next)
      setSelectedId(current => next.some(row => row.orderId === current) ? current : (next[0]?.orderId ?? ''))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取内部采购款失败')
    } finally { setBusy(false) }
  }, [dataSource])

  useEffect(() => { queueMicrotask(() => { void load() }) }, [load])
  useEffect(() => {
    queueMicrotask(() => { if (selected) setAmount(selected.internalRemaining > 0 ? String(selected.internalRemaining) : '') })
  }, [selected])

  const confirm = async () => {
    if (!selected?.canManage) return
    setBusy(true); setError(null); setNotice(null)
    try {
      await dataSource.confirmInternalPayment({ orderId: selected.orderId, amount: Number(amount), method, externalRef: externalRef.trim(), idempotencyKey })
      setNotice('内部采购款已确认，订单状态和交付解锁结果已刷新。')
      setExternalRef(''); setIdempotencyKey(newKey())
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '确认内部采购款失败')
    } finally { setBusy(false) }
  }

  return <section className="mt-6 max-w-5xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="internal-payment-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-sm font-medium text-indigo-600">真实财务操作</p><h2 id="internal-payment-title" className="text-xl font-bold text-slate-900">内部采购款确认</h2><p className="mt-1 text-sm text-slate-500">销售可查看进度；只有财务权限可以确认付款。</p></div>
      <button type="button" disabled={busy} onClick={() => void load()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-50">刷新</button>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {!busy && !error && rows.length === 0 && <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">暂无可查看的内部采购款订单。</p>}
    {rows.length > 0 && <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
      <div className="space-y-2">{rows.map(row => <button key={row.orderId} type="button" onClick={() => { setSelectedId(row.orderId); setError(null); setNotice(null) }} className={`w-full rounded-lg border p-3 text-left ${selected?.orderId === row.orderId ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}>
        <div className="flex items-center justify-between gap-2"><strong className="text-slate-900">{row.storeName}</strong><span className={`rounded-full px-2 py-1 text-xs ${row.fulfillmentUnlocked ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{row.fulfillmentUnlocked ? '交付已解锁' : '交付未解锁'}</span></div>
        <p className="mt-1 text-xs text-slate-500">订单 {row.orderId}</p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-sm"><span>应付<br/><b>{money(row.internalDue)}</b></span><span>已付<br/><b>{money(row.internalPaid)}</b></span><span>剩余<br/><b>{money(row.internalRemaining)}</b></span></div>
      </button>)}</div>
      {selected && <div className="rounded-lg bg-slate-50 p-4">
        <h3 className="font-semibold text-slate-900">{selected.canManage ? '财务确认' : '付款进度'}</h3>
        {!selected.canManage && <p className="mt-2 rounded-lg bg-white p-3 text-sm text-slate-600">当前为只读视图。付款确认由财务人员操作。</p>}
        {selected.canManage && <div className="mt-3 space-y-3">
          <label className="block text-sm text-slate-700">本次确认金额<input type="number" min="0.01" max={selected.internalRemaining} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/></label>
          <label className="block text-sm text-slate-700">确认方式<select value={method} onChange={event => setMethod(event.target.value as InternalPaymentMethod)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="cash_remitted">销售已汇款</option><option value="withheld_from_company_receipt">从公司收款中抵扣</option></select></label>
          <label className="block text-sm text-slate-700">外部凭证号<input value={externalRef} onChange={event => setExternalRef(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" placeholder="银行流水号或财务凭证号"/></label>
          <div className="text-sm text-slate-700">幂等键<div className="mt-1 break-all rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs">{idempotencyKey}</div></div>
          <button type="button" disabled={busy || !(Number(amount) > 0) || Number(amount) > selected.internalRemaining || !externalRef.trim() || selected.internalRemaining <= 0} onClick={() => void confirm()} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">确认内部采购款</button>
        </div>}
        <div className={`mt-3 rounded-lg p-3 text-sm ${selected.fulfillmentUnlocked ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>{selected.fulfillmentUnlocked ? <><span>内部采购款已结清，交付流程已解锁。</span><a className="ml-3 inline-block rounded-lg bg-indigo-600 px-3 py-2 text-white" href={`#/orders-v3?order=${encodeURIComponent(selected.orderId)}`}>进入订单履约</a></> : `尚欠 ${money(selected.internalRemaining)}，交付流程保持锁定。`}</div>
      </div>}
    </div>}
  </section>
}
