import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InternalPaymentMethod, InternalPaymentWorkbenchRecord, QuoteOrderDataSource } from './dataSource'
import { FinanceReversalPanel } from './FinanceReversalPanel'

type FinanceAction = 'customer' | 'internal' | 'procurement'
const money = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const newKey = () => crypto.randomUUID()
const actionLabels: Record<FinanceAction, string> = { customer: '确认客户款', internal: '确认销售汇款 / 内部应付', procurement: '记录内部采购款' }

export function InternalPaymentPanel({ dataSource }: { dataSource: QuoteOrderDataSource }) {
  const [rows, setRows] = useState<InternalPaymentWorkbenchRecord[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [action, setAction] = useState<FinanceAction>('customer')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<InternalPaymentMethod>('cash_remitted')
  const [recipientType, setRecipientType] = useState<'company' | 'sales'>('company')
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
    } catch (caught) { setError(caught instanceof Error ? caught.message : '读取订单资金闭环失败') }
    finally { setBusy(false) }
  }, [dataSource])

  useEffect(() => { queueMicrotask(() => { void load() }) }, [load])
  useEffect(() => {
    queueMicrotask(() => {
      if (!selected) return
      const suggested = action === 'customer' ? selected.customerRemaining : action === 'internal' ? selected.internalRemaining : 0
      setAmount(suggested > 0 ? String(suggested) : '')
      setExternalRef(''); setIdempotencyKey(newKey())
    })
  }, [selected, action])

  const maxAmount = action === 'customer' ? selected?.customerRemaining ?? 0 : action === 'internal' ? selected?.internalRemaining ?? 0 : Number.POSITIVE_INFINITY
  const confirm = async () => {
    if (!selected?.canManage) return
    setBusy(true); setError(null); setNotice(null)
    try {
      if (action === 'customer') await dataSource.confirmCustomerPayment({ orderId: selected.orderId, amount: Number(amount), recipientType, externalRef: externalRef.trim(), idempotencyKey })
      if (action === 'internal') await dataSource.confirmInternalPayment({ orderId: selected.orderId, amount: Number(amount), method, externalRef: externalRef.trim(), idempotencyKey })
      if (action === 'procurement') await dataSource.recordProcurementPayment({ orderId: selected.orderId, amount: Number(amount), externalRef: externalRef.trim(), idempotencyKey })
      setNotice(`${actionLabels[action]}成功，资金历史与审计记录已追加。`)
      setExternalRef(''); setIdempotencyKey(newKey()); await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : `${actionLabels[action]}失败`) }
    finally { setBusy(false) }
  }
  const finalizeMargin = async () => {
    if (!selected?.canManage) return
    setBusy(true); setError(null); setNotice(null)
    try { await dataSource.finalizeSalesMargin(selected.orderId); setNotice('最终价差已由财务确认并冻结。'); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : '确认最终价差失败') }
    finally { setBusy(false) }
  }

  return <section className="mt-6 max-w-6xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="finance-closure-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium text-indigo-600">订单资金闭环</p><h2 id="finance-closure-title" className="text-xl font-bold text-slate-900">客户款、内部应付与销售价差</h2><p className="mt-1 text-sm text-slate-500">财务确认每一笔资金；内部应付结清后才解锁履约。所有记录只追加，不覆盖历史。</p></div><button type="button" disabled={busy} onClick={() => void load()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-50">刷新</button></div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {!busy && !error && rows.length === 0 && <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">暂无可查看的成交订单。</p>}
    {rows.length > 0 && <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
      <div className="space-y-2">{rows.map(row => <button key={row.orderId} type="button" onClick={() => { setSelectedId(row.orderId); setError(null); setNotice(null) }} className={`w-full rounded-xl border p-4 text-left ${selected?.orderId === row.orderId ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}><div className="flex items-start justify-between gap-2"><span><strong className="text-slate-900">{row.storeName}</strong><small className="mt-1 block text-slate-500">{row.orderNumber} · 负责人 {row.ownerName}</small></span><span className={`rounded-full px-2 py-1 text-xs ${row.fulfillmentUnlocked ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{row.fulfillmentUnlocked ? '履约已解锁' : '履约锁定'}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><span>客户应收<br/><b>{money(row.customerTotal)}</b></span><span>客户已付<br/><b>{money(row.customerPaid)}</b></span><span>内部应付<br/><b>{money(row.internalDue)}</b></span><span>内部欠款<br/><b className={row.internalRemaining > 0 ? 'text-amber-700' : 'text-emerald-700'}>{money(row.internalRemaining)}</b></span></div></button>)}</div>
      {selected && <div className="rounded-xl bg-slate-50 p-4"><div className="grid grid-cols-2 gap-2"><Metric label="客户欠款" value={money(selected.customerRemaining)} warn={selected.customerRemaining > 0}/><Metric label="内部已付" value={money(selected.internalPaid)}/>{selected.canManage && <Metric label="采购款已记录" value={money(selected.procurementPaid)}/>} {selected.canViewMargin && <Metric label={selected.marginFinalized ? '最终价差' : '预计价差'} value={money(selected.marginFinalized ? selected.finalMargin ?? 0 : selected.estimatedMargin ?? 0)} />}</div>
        <div className={`mt-3 rounded-lg p-3 text-sm ${selected.fulfillmentUnlocked ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}><b>{selected.fulfillmentUnlocked ? '履约已解锁' : '履约锁定'}</b><p className="mt-1">{selected.lockReason}</p>{selected.fulfillmentUnlocked && <a className="mt-2 inline-block rounded-lg bg-indigo-600 px-3 py-2 text-white" href={`#/orders-v3?order=${encodeURIComponent(selected.orderId)}`}>进入订单履约</a>}</div>
        {!selected.canManage && <p className="mt-3 rounded-lg bg-white p-3 text-sm text-slate-600">当前为只读视图。财务负责确认资金；主管可查看下属订单价差，公司利润不在此页面展示。</p>}
        {selected.canManage && <><div className="mt-4 flex flex-wrap gap-2">{(['customer','internal','procurement'] as FinanceAction[]).map(item => <button key={item} type="button" onClick={() => setAction(item)} className={`rounded-lg px-3 py-2 text-xs font-medium ${action === item ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}>{actionLabels[item]}</button>)}</div><div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold text-slate-900">{actionLabels[action]}</h3><label className="block text-sm text-slate-700">本次金额<input type="number" min="0.01" max={Number.isFinite(maxAmount) ? maxAmount : undefined} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"/></label>{action === 'customer' && <label className="block text-sm text-slate-700">收款对象<select value={recipientType} onChange={event => setRecipientType(event.target.value as 'company' | 'sales')} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="company">公司收款</option><option value="sales">销售代收</option></select></label>}{action === 'internal' && <label className="block text-sm text-slate-700">确认方式<select value={method} onChange={event => setMethod(event.target.value as InternalPaymentMethod)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="cash_remitted">销售已汇款</option><option value="withheld_from_company_receipt">从公司收款中抵扣</option></select></label>}<label className="block text-sm text-slate-700">财务凭证号<input value={externalRef} onChange={event => setExternalRef(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="银行流水号或财务凭证号"/></label><button type="button" disabled={busy || !(Number(amount)>0) || Number(amount)>maxAmount || !externalRef.trim()} onClick={() => void confirm()} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{actionLabels[action]}</button></div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold text-slate-900">最终价差确认</h3><p className="mt-1 text-xs text-slate-500">客户全款且内部应付结清后，由财务一次性冻结最终价差。</p><button type="button" disabled={busy || selected.marginFinalized || selected.customerRemaining>0 || selected.internalRemaining>0} onClick={() => void finalizeMargin()} className="mt-3 w-full rounded-lg border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-700 disabled:opacity-50">{selected.marginFinalized ? `已确认 ${money(selected.finalMargin ?? 0)}` : '确认并冻结最终价差'}</button></div></>}
        {selected.canManage && <FinanceReversalPanel key={selected.orderId} orderId={selected.orderId} dataSource={dataSource} onChanged={load}/>}<p className="mt-3 text-xs leading-5 text-slate-500">退款或取消必须新增冲销记录；本页汇总已自动扣除冲销金额，不修改原付款历史。</p>
      </div>}
    </div>}
  </section>
}

function Metric({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return <div className="rounded-lg bg-white p-3"><span className="text-xs text-slate-500">{label}</span><strong className={`mt-1 block text-base ${warn ? 'text-amber-700' : 'text-slate-900'}`}>{value}</strong></div>
}
