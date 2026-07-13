import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, FilePlus2, PackagePlus, ReceiptText, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { DealOrderRecord, DealQuoteRecord } from './dataSource'
import { createSupabaseQuoteOrderDataSource } from './supabaseDataSource'
import { InternalPaymentPanel } from './InternalPaymentPanel'
import './quote-order.css'

const dataSource = createSupabaseQuoteOrderDataSource(supabase)
type Options = Awaited<ReturnType<typeof dataSource.loadDraftOptions>>
type DraftLine = { id: string; kind: 'package' | 'hardware' | 'addon'; sourceId: string; itemName?: string; quantity: string; customerPrice: string }

const blankLine = (): DraftLine => ({ id: crypto.randomUUID(), kind: 'package', sourceId: '', quantity: '1', customerPrice: '' })
const requestedOpportunityId = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('opportunity') ?? ''
const money = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const statusLabel: Record<string, string> = {
  draft: '草稿', pending_approval: '待审批', approval_pending: '待审批', submitted: '已提交', approved: '已批准', frozen: '已冻结', rejected: '已驳回',
}

export default function QuoteOrderRealRoute() {
  const [quotes, setQuotes] = useState<DealQuoteRecord[]>([])
  const [quote, setQuote] = useState<DealQuoteRecord | null>(null)
  const [order, setOrder] = useState<DealOrderRecord | null>(null)
  const [options, setOptions] = useState<Options | null>(null)
  const [opportunityId, setOpportunityId] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([blankLine()])
  const [amount, setAmount] = useState('')
  const [externalRef, setExternalRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draftLinesReady, setDraftLinesReady] = useState(false)

  const load = async () => {
    setBusy(true); setError('')
    try {
      const [nextQuotes, nextOptions] = await Promise.all([dataSource.listQuotes(), dataSource.loadDraftOptions()])
      setQuotes(nextQuotes); setOptions(nextOptions)
      setOpportunityId(current => current || (nextOptions.opportunities.some(item => item.id === requestedOpportunityId) ? requestedOpportunityId : '') || nextOptions.opportunities[0]?.id || '')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '读取报价数据失败') }
    finally { setBusy(false) }
  }

  useEffect(() => { queueMicrotask(() => { void load() }) }, [])

  const updateQuote = (next: DealQuoteRecord) => {
    setQuote(next)
    setQuotes(current => [next, ...current.filter(item => item.id !== next.id)])
  }
  const act = async (operation: () => Promise<DealQuoteRecord | DealOrderRecord>, success: string) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await operation()
      if ('opportunityId' in result) updateQuote(result); else setOrder(result)
      setNotice(success)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '报价操作失败') }
    finally { setBusy(false) }
  }
  const openQuote = async (target: DealQuoteRecord) => {
    setQuote(target); setOrder(null); setError(''); setNotice(''); setDraftLinesReady(false)
    if (target.status !== 'draft') return
    setBusy(true)
    try {
      const saved = await dataSource.getDraftLines(target.id)
      setLines(saved.length ? saved.map(line => ({ id: line.lineId, kind: line.kind, sourceId: line.sourceId, itemName: line.itemName, quantity: String(line.quantity), customerPrice: String(line.customerPrice) })) : [blankLine()])
      setDraftLinesReady(true)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '读取已保存报价明细失败') }
    finally { setBusy(false) }
  }
  const createDraft = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      const created = await dataSource.createDraft(opportunityId)
      updateQuote(created)
      await openQuote(created)
      setNotice('报价草稿已创建或重新打开')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '创建报价草稿失败') }
    finally { setBusy(false) }
  }
  const saveLines = () => {
    if (!quote || quote.status !== 'draft' || !draftLinesReady) { setError('请先成功读取已保存明细，再进行保存'); return }
    if (lines.some(line => !line.sourceId || !(Number(line.quantity) > 0) || Number(line.customerPrice) < 0 || line.customerPrice === '')) { setError('每行必须选择项目，并填写有效数量和客户单价'); return }
    void act(() => dataSource.replaceDraftLines(quote.id, lines.map(line => ({ kind: line.kind, sourceId: line.sourceId, quantity: Number(line.quantity), customerPrice: Number(line.customerPrice) }))), '报价明细已保存')
  }
  const choices = (line: DraftLine) => {
    const available = line.kind === 'package' ? options?.packages ?? [] : (options?.items ?? []).filter(item => line.kind === 'hardware' ? item.itemType === 'hardware' : item.itemType !== 'hardware')
    return line.sourceId && !available.some(item => item.id === line.sourceId) ? [{ id: line.sourceId, name: `${line.itemName ?? '已保存项目'}（目录已变更）` }, ...available] : available
  }
  const patchLine = (id: string, patch: Partial<DraftLine>) => setLines(current => current.map(line => line.id === id ? { ...line, ...patch } : line))
  const selectedOpportunity = options?.opportunities.find(item => item.id === opportunityId)
  const canConfirmDeposit = quote && ['approval_pending', 'pending_approval', 'submitted', 'approved'].includes(quote.status)
  const draftTotal = useMemo(() => lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.customerPrice || 0), 0), [lines])
  const completeDemo = async () => {
    setBusy(true); setError(''); setNotice('')
    try { await dataSource.completeOpportunityDemo(opportunityId); setOptions(await dataSource.loadDraftOptions()); setNotice('A类商机演示已确认') }
    catch (caught) { setError(caught instanceof Error ? caught.message : '确认A类演示失败') }
    finally { setBusy(false) }
  }

  return <main className="qo-shell">
    <header className="qo-header">
      <div>
        <a href="#/sales-v3" className="qo-back"><ArrowLeft size={16} />返回销售工作台</a>
        <span className="qo-eyebrow">成交工作区</span>
        <h1>报价与定金</h1>
        <p>从商机创建报价，财务确认定金后才生成订单。</p>
      </div>
      <div className="qo-rule"><ShieldCheck size={20} /><span><b>库存规则</b>报价不占用库存</span></div>
    </header>

    <section className="qo-summary" aria-label="报价概览">
      <article><ReceiptText /><span><b>{quotes.length}</b>全部报价</span></article>
      <article><FilePlus2 /><span><b>{quotes.filter(item => item.status === 'draft').length}</b>草稿待处理</span></article>
      <article><WalletCards /><span><b>{quotes.filter(item => ['submitted', 'approved', 'pending_approval', 'approval_pending'].includes(item.status)).length}</b>待定金确认</span></article>
    </section>

    {error && <p role="alert" className="qo-message is-error">{error}</p>}
    {notice && <p role="status" className="qo-message is-success"><CheckCircle2 size={17} />{notice}</p>}

    <div className="qo-grid">
      <aside className="qo-sidebar">
        <section className="qo-card qo-create" aria-labelledby="create-quote-title">
          <div className="qo-title"><span>01</span><div><h2 id="create-quote-title">创建报价</h2><p>选择已转为有效商机的客户</p></div></div>
          <label>商机 / 客户<select value={opportunityId} onChange={event => setOpportunityId(event.target.value)}><option value="">请选择商机</option>{options?.opportunities.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          {selectedOpportunity?.valueGrade === 'A' && <div className="qo-demo"><b>A类商机需先完成演示</b><button disabled={busy || selectedOpportunity.demoCompleted} onClick={() => void completeDemo()}>{selectedOpportunity.demoCompleted ? '演示已完成' : '确认演示完成'}</button></div>}
          <button className="qo-primary" disabled={busy || !opportunityId} onClick={() => void createDraft()}><FilePlus2 size={17} />创建或打开草稿</button>
        </section>

        <section className="qo-card qo-list" aria-labelledby="quote-list-title">
          <div className="qo-title"><span>02</span><div><h2 id="quote-list-title">报价列表</h2><p>点击查看明细和后续操作</p></div><button className="qo-icon-button" disabled={busy} onClick={() => void load()} title="刷新"><RefreshCw size={16} /></button></div>
          <div className="qo-list-items">{quotes.map(item => <button key={item.id} onClick={() => void openQuote(item)} className={quote?.id === item.id ? 'is-selected' : ''}>
            <span><strong>{item.brandName ? `${item.brandName} · ` : ''}{item.storeName}</strong><small>V{item.versionNo} · 有效至 {item.validUntil}</small></span>
            <span className="qo-list-meta"><em className={`is-${item.status}`}>{statusLabel[item.status] ?? item.status}</em><b>{money(item.customerTotal)}</b></span>
          </button>)}</div>
          {!busy && quotes.length === 0 && <p className="qo-empty">暂无报价，请从上方商机创建。</p>}
        </section>
      </aside>

      <section className="qo-content">
        <article className="qo-card qo-detail" aria-labelledby="quote-detail-title">
          <div className="qo-title"><span>03</span><div><h2 id="quote-detail-title">报价明细</h2><p>编辑套餐、硬件和加购项</p></div></div>
          {!quote ? <div className="qo-placeholder"><ReceiptText size={34} /><b>请先选择或创建报价</b><span>报价明细会显示在这里</span></div> : <>
            <div className="qo-detail-head"><div><span>{quote.brandName ? `${quote.brandName} · ` : ''}{quote.storeName}</span><h3>报价 V{quote.versionNo}</h3></div><em className={`is-${quote.status}`}>{statusLabel[quote.status] ?? quote.status}</em></div>
            {quote.status !== 'draft' && <div className="qo-readonly-total"><span>客户报价合计</span><strong>{money(quote.customerTotal)}</strong><small>当前报价已提交，明细不可编辑</small></div>}
            {quote.status === 'draft' && !draftLinesReady && <div className="qo-message is-warning">明细尚未读取成功，当前禁止保存。<button disabled={busy} onClick={() => void openQuote(quote)}>重试</button></div>}
            {quote.status === 'draft' && draftLinesReady && <>
              <div className="qo-lines">{lines.map((line, index) => <div key={line.id} className="qo-line">
                <div className="qo-line-number">{String(index + 1).padStart(2, '0')}</div>
                <label>类型<select value={line.kind} onChange={event => patchLine(line.id, { kind: event.target.value as DraftLine['kind'], sourceId: '', itemName: undefined })}><option value="package">套餐</option><option value="hardware">硬件</option><option value="addon">加购</option></select></label>
                <label className="qo-item-field">目录项目<select value={line.sourceId} onChange={event => { const sourceId = event.target.value; const item = options?.items.find(x => x.id === sourceId); const pkg = options?.packages.find(x => x.id === sourceId); patchLine(line.id, { sourceId, itemName: item?.name ?? pkg?.name, customerPrice: item ? String(item.listPrice) : line.customerPrice }) }}><option value="">请选择</option>{choices(line).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label>数量<input type="number" min="0.01" step="0.01" value={line.quantity} onChange={event => patchLine(line.id, { quantity: event.target.value })} /></label>
                <label>客户单价<input type="number" min="0" step="0.01" value={line.customerPrice} onChange={event => patchLine(line.id, { customerPrice: event.target.value })} /></label>
                <button className="qo-remove" disabled={lines.length === 1} onClick={() => setLines(current => current.filter(item => item.id !== line.id))}>删除</button>
              </div>)}</div>
              <button className="qo-add-line" onClick={() => setLines(current => [...current, blankLine()])}><PackagePlus size={16} />增加报价行</button>
              <div className="qo-total"><span>客户报价合计</span><strong>{money(draftTotal)}</strong></div>
              <div className="qo-actions"><button disabled={busy || !draftLinesReady} onClick={saveLines} className="qo-primary">保存明细</button><button disabled={busy} onClick={() => void act(() => dataSource.submitQuote(quote.id), '报价已提交')} className="qo-secondary">提交报价</button></div>
            </>}
          </>}
        </article>

        <article className="qo-card qo-deposit" aria-labelledby="deposit-title">
          <div className="qo-title"><span>04</span><div><h2 id="deposit-title">定金确认</h2><p>财务核对凭证后确认，系统再生成订单</p></div></div>
          {!quote && <p className="qo-empty">选择已提交的报价后可进行定金确认。</p>}
          {quote && !canConfirmDeposit && <div className="qo-lock"><ShieldCheck size={20} /><span><b>当前不可确认定金</b>请先保存并提交报价。</span></div>}
          {quote && canConfirmDeposit && <div className="qo-deposit-form"><div className="qo-deposit-quote"><span>{quote.storeName} · V{quote.versionNo}</span><strong>{money(quote.customerTotal)}</strong></div><label>本次定金金额<input value={amount} onChange={event => setAmount(event.target.value)} type="number" min="0.01" placeholder="0.00" /></label><label>付款凭证号<input value={externalRef} onChange={event => setExternalRef(event.target.value)} placeholder="银行流水号或财务凭证号" /></label><button disabled={busy || !(Number(amount) > 0) || !externalRef.trim()} onClick={() => void act(() => dataSource.confirmDeposit({ quoteId: quote.id, amount: Number(amount), externalRef: externalRef.trim(), idempotencyKey: crypto.randomUUID() }), '定金已确认，订单已生成')} className="qo-primary"><WalletCards size={17} />确认定金并生成订单</button></div>}
          {order && <div className="qo-order-created"><CheckCircle2 size={22} /><span><b>订单已生成</b>订单 {order.id} · 内部应付 {money(order.internalDue)}</span><a href={`#/orders-v3?order=${encodeURIComponent(order.id)}`}>进入订单履约</a></div>}
        </article>
      </section>
    </div>
    <InternalPaymentPanel dataSource={dataSource} />
  </main>
}
