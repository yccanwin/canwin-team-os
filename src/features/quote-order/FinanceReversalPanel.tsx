import { useCallback, useEffect, useMemo, useState } from 'react'
import type { QuoteOrderDataSource, ReversiblePaymentRecord } from './dataSource'

const money = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const typeLabel: Record<string, string> = { deposit: '定金', balance: '尾款', full: '全款' }

export function FinanceReversalPanel({ orderId, dataSource, onChanged }: { orderId: string; dataSource: QuoteOrderDataSource; onChanged: () => Promise<void> }) {
  const [payments, setPayments] = useState<ReversiblePaymentRecord[]>([])
  const [paymentId, setPaymentId] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const selected = useMemo(() => payments.find(item => item.paymentId === paymentId) ?? payments[0], [paymentId, payments])

  const load = useCallback(async () => {
    setError(null)
    try {
      const next = await dataSource.listReversiblePayments(orderId)
      setPayments(next)
      setPaymentId(current => next.some(item => item.paymentId === current) ? current : next[0]?.paymentId ?? '')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '读取可冲销付款失败') }
  }, [dataSource, orderId])
  useEffect(() => { queueMicrotask(() => { void load() }) }, [load])
  useEffect(() => { queueMicrotask(() => { setAmount(selected ? String(selected.reversibleAmount) : ''); setReason('') }) }, [selected])

  const reverse = async () => {
    if (!selected || !(Number(amount) > 0) || Number(amount) > selected.reversibleAmount || !reason.trim()) return
    setBusy(true); setError(null); setNotice(null)
    try {
      await dataSource.reversePayment({ paymentId: selected.paymentId, amount: Number(amount), reason: reason.trim(), idempotencyKey: crypto.randomUUID() })
      setNotice('冲销记录已追加，原付款保留不变。'); await load(); await onChanged()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '追加冲销失败') }
    finally { setBusy(false) }
  }
  const cancel = async () => {
    if (!cancelReason.trim()) return
    setBusy(true); setError(null); setNotice(null)
    try {
      await dataSource.recordOrderCancellation({ orderId, reason: cancelReason.trim(), idempotencyKey: crypto.randomUUID() })
      setCancelReason(''); setNotice('取消记录已追加，原订单状态和历史未被覆盖。'); await onChanged()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '追加取消记录失败') }
    finally { setBusy(false) }
  }

  return <div className="mt-3 rounded-xl border border-rose-200 bg-white p-4">
    <h3 className="font-semibold text-slate-900">冲销与取消</h3>
    <p className="mt-1 text-xs leading-5 text-slate-500">只新增历史记录，不修改或删除原付款、原订单。</p>
    {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{notice}</p>}
    <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
      <h4 className="text-sm font-medium text-slate-800">付款冲销</h4>
      {payments.length ? <><label className="block text-xs text-slate-600">原付款<select value={selected?.paymentId ?? ''} onChange={event => setPaymentId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">{payments.map(item => <option key={item.paymentId} value={item.paymentId}>{typeLabel[item.paymentType] ?? item.paymentType} · {money(item.originalAmount)} · 可冲销 {money(item.reversibleAmount)}</option>)}</select></label><label className="block text-xs text-slate-600">冲销金额<input type="number" min="0.01" step="0.01" max={selected?.reversibleAmount} value={amount} onChange={event => setAmount(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"/></label><label className="block text-xs text-slate-600">冲销原因<textarea value={reason} onChange={event => setReason(event.target.value)} className="mt-1 min-h-16 w-full rounded-lg border px-3 py-2 text-sm"/></label><button type="button" disabled={busy || !selected || !(Number(amount) > 0) || Number(amount) > selected.reversibleAmount || !reason.trim()} onClick={() => void reverse()} className="w-full rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">追加冲销记录</button></> : <p className="text-sm text-slate-500">当前订单没有可冲销余额。</p>}
    </div>
    <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3"><h4 className="text-sm font-medium text-slate-800">订单取消留痕</h4><label className="block text-xs text-slate-600">取消原因<textarea value={cancelReason} onChange={event => setCancelReason(event.target.value)} className="mt-1 min-h-16 w-full rounded-lg border px-3 py-2 text-sm"/></label><button type="button" disabled={busy || !cancelReason.trim()} onClick={() => void cancel()} className="w-full rounded-lg border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 disabled:opacity-40">追加取消记录</button></div>
  </div>
}
