import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { DealOrderRecord, DealQuoteRecord } from './dataSource'
import { createSupabaseQuoteOrderDataSource } from './supabaseDataSource'
import { InternalPaymentPanel } from './InternalPaymentPanel'

const dataSource = createSupabaseQuoteOrderDataSource(supabase)
type Options = Awaited<ReturnType<typeof dataSource.loadDraftOptions>>
type DraftLine = { id: string; kind: 'package' | 'hardware' | 'addon'; sourceId: string; itemName?: string; quantity: string; customerPrice: string }
const blankLine = (): DraftLine => ({ id: crypto.randomUUID(), kind: 'package', sourceId: '', quantity: '1', customerPrice: '' })
const requestedOpportunityId = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('opportunity') ?? ''

export default function QuoteOrderRealRoute() {
  const [quotes, setQuotes] = useState<DealQuoteRecord[]>([]); const [quote, setQuote] = useState<DealQuoteRecord | null>(null); const [order, setOrder] = useState<DealOrderRecord | null>(null)
  const [options, setOptions] = useState<Options | null>(null); const [opportunityId, setOpportunityId] = useState(''); const [lines, setLines] = useState<DraftLine[]>([blankLine()])
  const [amount, setAmount] = useState(''); const [externalRef, setExternalRef] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [draftLinesReady, setDraftLinesReady] = useState(false)

  const load = async () => {
    setBusy(true); setError('')
    try { const [q, o] = await Promise.all([dataSource.listQuotes(), dataSource.loadDraftOptions()]); setQuotes(q); setOptions(o); setOpportunityId(x => x || (o.opportunities.some(item => item.id === requestedOpportunityId) ? requestedOpportunityId : '') || o.opportunities[0]?.id || '') }
    catch (e) { setError(e instanceof Error ? e.message : '读取真实报价数据失败') } finally { setBusy(false) }
  }
  useEffect(() => { queueMicrotask(() => { void load() }) }, [])
  const act = async (operation: () => Promise<DealQuoteRecord | DealOrderRecord>, success: string) => {
    setBusy(true); setError(''); setNotice('')
    try { const result = await operation(); if ('opportunityId' in result) { setQuote(result); setQuotes(x => [result, ...x.filter(y => y.id !== result.id)]) } else setOrder(result); setNotice(success) }
    catch (e) { setError(e instanceof Error ? e.message : '报价操作失败') } finally { setBusy(false) }
  }
  const openQuote = async (target: DealQuoteRecord) => {
    setQuote(target); setOrder(null); setError(''); setNotice(''); setDraftLinesReady(false)
    if (target.status !== 'draft') return
    setBusy(true)
    try {
      const saved = await dataSource.getDraftLines(target.id)
      setLines(saved.length ? saved.map(line => ({ id: line.lineId, kind: line.kind, sourceId: line.sourceId, itemName: line.itemName, quantity: String(line.quantity), customerPrice: String(line.customerPrice) })) : [blankLine()])
      setDraftLinesReady(true)
    } catch (e) { setError(e instanceof Error ? e.message : '读取已保存报价明细失败') }
    finally { setBusy(false) }
  }
  const createDraft = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      const created = await dataSource.createDraft(opportunityId)
      setQuotes(current => [created, ...current.filter(item => item.id !== created.id)])
      await openQuote(created); setNotice('报价草稿已创建或重新打开')
    } catch (e) { setError(e instanceof Error ? e.message : '创建报价草稿失败') }
    finally { setBusy(false) }
  }
  const saveLines = () => {
    if (!quote || quote.status !== 'draft' || !draftLinesReady) { setError('请先成功读取已保存报价明细，再进行保存'); return }
    if (lines.some(x => !x.sourceId || !(Number(x.quantity) > 0) || Number(x.customerPrice) < 0 || x.customerPrice === '')) { setError('每行必须选择项目，并填写有效数量和客户单价'); return }
    void act(() => dataSource.replaceDraftLines(quote.id, lines.map(x => ({ kind: x.kind, sourceId: x.sourceId, quantity: Number(x.quantity), customerPrice: Number(x.customerPrice) }))), '报价明细已保存')
  }
  const choices = (line: DraftLine) => {
    const available = line.kind === 'package' ? options?.packages ?? [] : (options?.items ?? []).filter(x => line.kind === 'hardware' ? x.itemType === 'hardware' : x.itemType !== 'hardware')
    return line.sourceId && !available.some(item => item.id === line.sourceId) ? [{ id: line.sourceId, name: `${line.itemName ?? '已保存项目'}（目录已变更）` }, ...available] : available
  }
  const patchLine = (id: string, patch: Partial<DraftLine>) => setLines(x => x.map(y => y.id === id ? { ...y, ...patch } : y))
  const selectedOpportunity = options?.opportunities.find(item => item.id === opportunityId)
  const completeDemo = async () => { setBusy(true); setError(''); setNotice(''); try { await dataSource.completeOpportunityDemo(opportunityId); const next = await dataSource.loadDraftOptions(); setOptions(next); setNotice('A类商机演示已由服务端确认并记录审计') } catch (e) { setError(e instanceof Error ? e.message : '确认A类演示失败') } finally { setBusy(false) } }

  return <section className="min-h-screen bg-slate-50 p-3 sm:p-6"><header className="mb-5"><p className="text-sm font-medium text-indigo-600">真实数据入口</p><h1 className="text-2xl font-bold text-slate-900">报价与定金工作台</h1><p className="mt-1 text-sm text-slate-500">报价写入仅通过服务端安全 RPC；内部结算价由目录采购成本自动生成。</p></header>
    {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {selectedOpportunity?.valueGrade === 'A' && <div className="mb-3 max-w-5xl rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><span>{selectedOpportunity.label} · A类商机提交报价前必须完成演示。</span><button disabled={busy || selectedOpportunity.demoCompleted} onClick={() => void completeDemo()} className="ml-3 rounded-lg border border-amber-500 px-3 py-2 disabled:opacity-60">{selectedOpportunity.demoCompleted ? '演示已完成' : '确认真实演示完成'}</button></div>}
    <div className="grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="rounded-xl border bg-white p-4"><h2 className="font-semibold">新建报价</h2><label className="mt-3 block text-sm">商机 / 客户<select value={opportunityId} onChange={e => setOpportunityId(e.target.value)} className="mt-1 w-full rounded-lg border p-2"><option value="">请选择</option>{options?.opportunities.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label><button disabled={busy || !opportunityId} onClick={() => void createDraft()} className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2 text-white disabled:opacity-50">创建或打开草稿</button><h2 className="mt-5 font-semibold">已有报价</h2><div className="mt-2 grid gap-2">{quotes.map(x => <button key={x.id} onClick={() => void openQuote(x)} className={`rounded-lg border p-3 text-left text-sm ${quote?.id === x.id ? 'border-indigo-500 bg-indigo-50' : ''}`}><strong>{x.brandName ? `${x.brandName} · ` : ''}{x.storeName}</strong><span className="block text-slate-500">V{x.versionNo} · {x.status} · ¥{x.customerTotal.toLocaleString()}</span></button>)}</div>{!busy && quotes.length === 0 && <p className="mt-2 text-sm text-slate-500">暂无报价，可从商机创建。</p>}</div>
      <div className="rounded-xl border bg-white p-4">{!quote ? <p className="text-sm text-slate-500">请选择或创建报价草稿。</p> : <><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">报价 V{quote.versionNo} · {quote.status}</h2><span className="text-sm text-slate-500">有效至 {quote.validUntil}</span></div>
        {quote.status === 'draft' && !draftLinesReady && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">报价明细尚未成功读取。为保护原数据，当前禁止保存。<button disabled={busy} onClick={() => void openQuote(quote)} className="ml-2 rounded border border-amber-400 px-2 py-1">重试读取</button></div>}
        {quote.status === 'draft' && draftLinesReady && <><div className="mt-3 grid gap-3">{lines.map((line, index) => <div key={line.id} className="rounded-lg border bg-slate-50 p-3"><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs">类型<select value={line.kind} onChange={e => patchLine(line.id, { kind: e.target.value as DraftLine['kind'], sourceId: '', itemName: undefined })} className="mt-1 w-full rounded border p-2"><option value="package">套餐</option><option value="hardware">硬件</option><option value="addon">加购</option></select></label><label className="text-xs">目录项目<select value={line.sourceId} onChange={e => { const sourceId = e.target.value; const item = options?.items.find(x => x.id === sourceId); const pkg = options?.packages.find(x => x.id === sourceId); patchLine(line.id, { sourceId, itemName: item?.name ?? pkg?.name, customerPrice: item ? String(item.listPrice) : line.customerPrice }) }} className="mt-1 w-full rounded border p-2"><option value="">请选择</option>{choices(line).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label className="text-xs">数量<input type="number" min="0.01" step="0.01" value={line.quantity} onChange={e => patchLine(line.id, { quantity: e.target.value })} className="mt-1 w-full rounded border p-2" /></label><label className="text-xs">客户单价 / 套餐总价<input type="number" min="0" step="0.01" value={line.customerPrice} onChange={e => patchLine(line.id, { customerPrice: e.target.value })} className="mt-1 w-full rounded border p-2" /></label></div><button disabled={lines.length === 1} onClick={() => setLines(x => x.filter(y => y.id !== line.id))} className="mt-2 text-xs text-red-700 disabled:opacity-40">删除第 {index + 1} 行</button></div>)}</div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => setLines(x => [...x, blankLine()])} className="rounded-lg border px-3 py-2 text-sm">增加报价行</button><button disabled={busy || !draftLinesReady} onClick={saveLines} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white">保存报价明细</button><button disabled={busy} onClick={() => act(() => dataSource.submitQuote(quote.id), '报价已提交')} className="rounded-lg border border-indigo-500 px-3 py-2 text-sm text-indigo-700">提交报价</button></div></>}
        {['approval_pending', 'submitted', 'approved'].includes(quote.status) && <div className="mt-4 border-t pt-4"><h3 className="font-semibold">财务确认定金</h3><div className="mt-2 grid gap-2 sm:grid-cols-2"><input value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0.01" placeholder="定金金额" className="rounded-lg border p-2" /><input value={externalRef} onChange={e => setExternalRef(e.target.value)} placeholder="付款凭证号" className="rounded-lg border p-2" /></div><button disabled={busy || !(Number(amount) > 0) || !externalRef.trim()} onClick={() => act(() => dataSource.confirmDeposit({ quoteId: quote.id, amount: Number(amount), externalRef: externalRef.trim(), idempotencyKey: crypto.randomUUID() }), '定金已确认，订单已生成')} className="mt-2 rounded-lg bg-indigo-600 px-3 py-2 text-white disabled:opacity-50">确认定金并生成订单</button></div>}{order && <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">订单 {order.id} 已生成，内部应付 ¥{order.internalDue.toLocaleString()}<a className="ml-3 inline-block rounded-lg bg-indigo-600 px-3 py-2 text-white" href={`#/orders-v3?order=${encodeURIComponent(order.id)}`}>进入订单履约</a></div>}</>}</div>
    </div>
    <InternalPaymentPanel dataSource={dataSource} />
  </section>
}
