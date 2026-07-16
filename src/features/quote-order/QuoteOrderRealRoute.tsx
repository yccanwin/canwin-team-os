import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, FilePlus2, PackagePlus, ReceiptText, RefreshCw, ShieldAlert, ShieldCheck, WalletCards } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { DealOrderRecord, DealQuoteApprovalRecord, DealQuoteRecord } from './dataSource'
import { createSupabaseQuoteOrderDataSource } from './supabaseDataSource'
import { InternalPaymentPanel } from './InternalPaymentPanel'
import './quote-order.css'

const dataSource = createSupabaseQuoteOrderDataSource(supabase)
type Options = Awaited<ReturnType<typeof dataSource.loadDraftOptions>>
type DraftLine = { id: string; kind: 'package' | 'software' | 'hardware' | 'addon'; sourceId: string; itemName?: string; quantity: string; customerPrice: string }

const blankLine = (): DraftLine => ({ id: crypto.randomUUID(), kind: 'package', sourceId: '', quantity: '1', customerPrice: '' })
const requestedOpportunityId = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('opportunity') ?? ''
const money = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const statusLabel: Record<string, string> = { draft: '草稿', approval_pending: '待主管审批', submitted: '已提交', approved: '已批准', frozen: '已冻结', rejected: '已驳回' }
const approvalLabel: Record<DealQuoteApprovalRecord['status'], string> = { not_required: '无需审批', pending: '待主管审批', approved: '主管已批准', rejected: '主管已驳回' }
const orderStatusLabel: Record<string, string> = { deposit_confirmed: '定金已确认', internal_paid: '内部款已结清', fulfilling: '履约中', completed: '已完成', cancelled: '已取消' }

export default function QuoteOrderRealRoute() {
  const [quotes, setQuotes] = useState<DealQuoteRecord[]>([])
  const [quote, setQuote] = useState<DealQuoteRecord | null>(null)
  const [approval, setApproval] = useState<DealQuoteApprovalRecord | null>(null)
  const [order, setOrder] = useState<DealOrderRecord | null>(null)
  const [options, setOptions] = useState<Options | null>(null)
  const [opportunityId, setOpportunityId] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([blankLine()])
  const [specialContent, setSpecialContent] = useState('')
  const [approvalNote, setApprovalNote] = useState('')
  const [amount, setAmount] = useState('')
  const [externalRef, setExternalRef] = useState('')
  const [recipientType, setRecipientType] = useState<'company' | 'sales'>('company')
  const [depositKey, setDepositKey] = useState(() => crypto.randomUUID())
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
  const refreshApproval = async (target: DealQuoteRecord) => {
    const nextApproval = await dataSource.getApproval(target.id)
    setApproval(nextApproval)
    setApprovalNote(nextApproval.note ?? '')
  }
  const openQuote = async (target: DealQuoteRecord) => {
    setQuote(target); setOrder(null); setError(''); setNotice(''); setApproval(null); setDraftLinesReady(false)
    setAmount(''); setExternalRef(''); setRecipientType('company'); setDepositKey(crypto.randomUUID())
    setBusy(true)
    try {
      await refreshApproval(target)
      if (target.status === 'draft') {
        const saved = await dataSource.getDraftLines(target.id)
        setLines(saved.length ? saved.map(line => ({ id: line.lineId, kind: line.kind === 'addon' && options?.items.some(item => item.id === line.sourceId && item.itemType === 'software') ? 'software' : line.kind, sourceId: line.sourceId, itemName: line.itemName, quantity: String(line.quantity), customerPrice: String(line.customerPrice) })) : [blankLine()])
        setSpecialContent(target.specialContent ?? '')
        setDraftLinesReady(true)
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : '读取报价详情失败') }
    finally { setBusy(false) }
  }
  const createDraft = async () => {
    if (!opportunityId) return
    setBusy(true); setError(''); setNotice('')
    try {
      const created = await dataSource.createDraft(opportunityId)
      updateQuote(created); await openQuote(created); setNotice('报价草稿已创建或重新打开')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '创建报价草稿失败') }
    finally { setBusy(false) }
  }
  const choices = (line: DraftLine) => {
    const available = line.kind === 'package' ? options?.packages ?? [] : (options?.items ?? []).filter(item => item.itemType === (line.kind === 'addon' ? 'service' : line.kind))
    return line.sourceId && !available.some(item => item.id === line.sourceId) ? [{ id: line.sourceId, name: `${line.itemName ?? '已保存项目'}（目录已变更）` }, ...available] : available
  }
  const patchLine = (id: string, patch: Partial<DraftLine>) => setLines(current => current.map(line => line.id === id ? { ...line, ...patch } : line))
  const saveLines = async () => {
    if (!quote || quote.status !== 'draft' || !draftLinesReady) { setError('请先成功读取草稿明细'); return }
    if (lines.some(line => !line.sourceId || !(Number(line.quantity) > 0) || Number(line.customerPrice) < 0 || line.customerPrice === '')) { setError('每行必须选择项目，并填写有效数量和客户单价'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await dataSource.replaceDraftLines(quote.id, lines.map(line => ({ kind: line.kind, sourceId: line.sourceId, quantity: Number(line.quantity), customerPrice: Number(line.customerPrice) })))
      updateQuote(next); setNotice('报价明细已保存')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '保存报价明细失败') }
    finally { setBusy(false) }
  }
  const saveSpecial = async () => {
    if (!quote || quote.status !== 'draft') return
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await dataSource.setSpecialContent(quote.id, specialContent)
      updateQuote(next); setNotice(next.hasSpecialContent ? '特殊内容已标记，提交后将进入主管审批' : '已清除特殊内容，本报价无需主管审批')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '保存特殊内容失败') }
    finally { setBusy(false) }
  }
  const submit = async () => {
    if (!quote) return
    if (quote.valueGrade === 'A' && !quote.demoCompleted) { setError('A类商机必须先完成演示，当前禁止提交报价'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await dataSource.submitQuote(quote.id)
      updateQuote(next); await refreshApproval(next)
      setNotice(next.status === 'approval_pending' ? '特殊报价已提交，等待主管审批' : '报价已提交')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '提交报价失败') }
    finally { setBusy(false) }
  }
  const decide = async (approved: boolean) => {
    if (!quote) return
    if (!approved && !approvalNote.trim()) { setError('驳回时必须填写原因'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await dataSource.decideQuote(quote.id, approved, approvalNote.trim() || undefined)
      updateQuote(next); await refreshApproval(next); setNotice(approved ? '特殊报价已批准' : '特殊报价已驳回')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '审批报价失败') }
    finally { setBusy(false) }
  }
  const completeDemo = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      await dataSource.completeOpportunityDemo(opportunityId)
      const nextOptions = await dataSource.loadDraftOptions(); setOptions(nextOptions)
      if (quote?.opportunityId === opportunityId) updateQuote({ ...quote, demoCompleted: true })
      setNotice('A类商机演示已确认完成')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '确认A类演示失败') }
    finally { setBusy(false) }
  }
  const confirmDeposit = async () => {
    if (!quote) return
    setBusy(true); setError(''); setNotice('')
    try {
      const nextOrder = await dataSource.confirmDeposit({
        quoteId: quote.id,
        amount: Number(amount),
        externalRef: externalRef.trim(),
        recipientType,
        idempotencyKey: depositKey,
      })
      const frozenQuote = await dataSource.getQuote(quote.id)
      setOrder(nextOrder); updateQuote(frozenQuote)
      setNotice('定金已确认，最终报价已冻结，订单已生成')
    } catch (caught) { setError(caught instanceof Error ? caught.message : '确认定金失败') }
    finally { setBusy(false) }
  }

  const selectedOpportunity = options?.opportunities.find(item => item.id === opportunityId)
  const aDemoBlocked = Boolean(quote?.valueGrade === 'A' && !quote.demoCompleted)
  const canConfirmDeposit = Boolean(quote && ['submitted', 'approved'].includes(quote.status))
  const draftTotal = useMemo(() => lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.customerPrice || 0), 0), [lines])
  const journeyCompletedThrough = order || quote?.status === 'frozen' ? 5 : quote ? 3 : opportunityId ? 2 : -1

  return <main className="qo-shell">
    <header className="qo-header"><div><a href="#/sales-v3" className="qo-back"><ArrowLeft size={16} />返回销售工作台</a><span className="qo-eyebrow">成交工作区</span><h1>报价与定金</h1><p>A类先演示，特殊报价由主管审批；财务确认定金后才生成订单。</p></div><div className="qo-rule"><ShieldCheck size={20} /><span><b>库存规则</b>报价不占用库存</span></div></header>
    <section className="qo-summary"><article><ReceiptText /><span><b>{quotes.length}</b>全部报价</span></article><article><FilePlus2 /><span><b>{quotes.filter(item => item.status === 'draft').length}</b>草稿待处理</span></article><article><ShieldAlert /><span><b>{quotes.filter(item => item.status === 'approval_pending').length}</b>待主管审批</span></article></section>
    {error && <p role="alert" className="qo-message is-error">{error}</p>}{notice && <p role="status" className="qo-message is-success"><CheckCircle2 size={17} />{notice}</p>}
    <DealJourney completedThrough={journeyCompletedThrough} />
    {!busy && options && options.opportunities.length === 0 && <section className="qo-prerequisite"><ShieldAlert size={20} /><div><b>当前没有可报价的有效商机</b><p>普通线索不能直接创建报价或订单。请先在线索页完善客户档案与资格，并由服务端确认转为有效商机。</p></div><a href="#/sales-v3?tab=leads">去完善客户或转商机</a></section>}

    <div className="qo-grid"><aside className="qo-sidebar">
      <section className="qo-card qo-create"><div className="qo-title"><span>01</span><div><h2>创建报价</h2><p>选择已转为有效商机的客户</p></div></div>
        <label>商机 / 客户<select value={opportunityId} onChange={event => setOpportunityId(event.target.value)}><option value="">请选择商机</option>{options?.opportunities.map(item => <option key={item.id} value={item.id}>{item.label} · {item.valueGrade}类</option>)}</select></label>
        {selectedOpportunity?.valueGrade === 'A' && <div className={`qo-demo ${selectedOpportunity.demoCompleted ? 'is-complete' : ''}`}><div><b>{selectedOpportunity.demoCompleted ? 'A类演示已完成' : 'A类报价提交前必须演示'}</b><small>{selectedOpportunity.demoCompleted ? '服务端已记录完成时间' : '未完成时，系统将阻止提交报价'}</small></div><button disabled={busy || selectedOpportunity.demoCompleted} onClick={() => void completeDemo()}>{selectedOpportunity.demoCompleted ? '已完成' : '确认演示完成'}</button></div>}
        <button className="qo-primary" disabled={busy || !opportunityId} onClick={() => void createDraft()}><FilePlus2 size={17} />创建或打开草稿</button>
      </section>
      <section className="qo-card qo-list"><div className="qo-title"><span>02</span><div><h2>报价列表</h2><p>点击查看明细和审批进度</p></div><button className="qo-icon-button" disabled={busy} onClick={() => void load()} title="刷新"><RefreshCw size={16} /></button></div><div className="qo-list-items">{quotes.map(item => <button key={item.id} onClick={() => void openQuote(item)} className={quote?.id === item.id ? 'is-selected' : ''}><span><strong>{item.brandName ? `${item.brandName} · ` : ''}{item.storeName}</strong><small>V{item.versionNo} · {item.valueGrade}类 · 有效至 {item.validUntil}</small></span><span className="qo-list-meta"><em className={`is-${item.status}`}>{statusLabel[item.status] ?? item.status}</em><b>{money(item.customerTotal)}</b></span></button>)}</div>{!busy && quotes.length === 0 && <p className="qo-empty">暂无报价。请先选择有效商机创建报价；普通线索不能直接建订单。</p>}</section>
    </aside>

    <section className="qo-content"><article className="qo-card qo-detail"><div className="qo-title"><span>03</span><div><h2>报价明细</h2><p>编辑套餐、硬件、加购和特殊内容</p></div></div>
      {!quote ? <div className="qo-placeholder"><ReceiptText size={34} /><b>请先选择或创建报价</b><span>报价明细会显示在这里</span></div> : <>
        <div className="qo-detail-head"><div><span>{quote.brandName ? `${quote.brandName} · ` : ''}{quote.storeName}</span><h3>报价 V{quote.versionNo}</h3></div><em className={`is-${quote.status}`}>{statusLabel[quote.status] ?? quote.status}</em></div>
        {aDemoBlocked && <div className="qo-gate is-blocked"><ShieldAlert /><div><b>A类演示未完成：禁止提交报价</b><span>请返回左侧选择该商机并确认演示完成。此规则也由服务端强制校验。</span></div></div>}
        {quote.status !== 'draft' && <div className="qo-readonly-total"><span>客户报价合计</span><strong>{money(quote.customerTotal)}</strong><small>当前报价已提交，明细不可编辑</small></div>}
        {quote.status === 'draft' && draftLinesReady && <><div className="qo-lines">{lines.map((line, index) => <div key={line.id} className="qo-line"><div className="qo-line-number">{String(index + 1).padStart(2, '0')}</div><label>类型<select value={line.kind} onChange={event => patchLine(line.id, { kind: event.target.value as DraftLine['kind'], sourceId: '', itemName: undefined })}><option value="package">套餐</option><option value="software">软件</option><option value="hardware">硬件</option><option value="addon">加购</option></select></label><label className="qo-item-field">目录项目<select value={line.sourceId} onChange={event => { const sourceId = event.target.value; const item = options?.items.find(x => x.id === sourceId); const pkg = options?.packages.find(x => x.id === sourceId); patchLine(line.id, { sourceId, itemName: item?.name ?? pkg?.name, customerPrice: item ? String(item.listPrice) : pkg ? String(pkg.standardPrice) : line.customerPrice }) }}><option value="">请选择</option>{choices(line).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>数量<input type="number" min="0.01" step="0.01" value={line.quantity} onChange={event => patchLine(line.id, { quantity: event.target.value })} /></label><label>客户单价<input type="number" min="0" step="0.01" value={line.customerPrice} onChange={event => patchLine(line.id, { customerPrice: event.target.value })} /></label><button className="qo-remove" disabled={lines.length === 1} onClick={() => setLines(current => current.filter(item => item.id !== line.id))}>删除</button></div>)}</div><button className="qo-add-line" onClick={() => setLines(current => [...current, blankLine()])}><PackagePlus size={16} />增加报价行</button><div className="qo-total"><span>客户报价合计</span><strong>{money(draftTotal)}</strong></div>
          <div className="qo-special"><label>特殊内容（选填）<textarea rows={3} value={specialContent} onChange={event => setSpecialContent(event.target.value)} placeholder="例如：更换套餐内容、额外驻店服务。填写后提交将自动进入主管审批。" /></label><button disabled={busy} onClick={() => void saveSpecial()} className="qo-secondary">保存特殊内容标记</button></div>
          <div className="qo-actions"><button disabled={busy} onClick={() => void saveLines()} className="qo-primary">保存明细</button><button disabled={busy || aDemoBlocked} onClick={() => void submit()} className="qo-secondary">{aDemoBlocked ? '演示完成后可提交' : quote.hasSpecialContent ? '提交主管审批' : '提交报价'}</button></div>
        </>}
        {approval && quote.status !== 'draft' && <div className={`qo-approval is-${approval.status}`}><div className="qo-approval-head"><span><ShieldCheck /><b>特殊报价审批</b></span><em>{approvalLabel[approval.status]}</em></div>{approval.note && <p>审批意见：{approval.note}</p>}{approval.decidedAt && <small>处理时间：{new Date(approval.decidedAt).toLocaleString('zh-CN')}</small>}{approval.status === 'pending' && approval.canDecide && <div className="qo-approval-actions"><label>主管意见<textarea rows={2} value={approvalNote} onChange={event => setApprovalNote(event.target.value)} placeholder="批准可选填；驳回必须填写原因" /></label><div><button disabled={busy} onClick={() => void decide(true)} className="qo-primary">批准报价</button><button disabled={busy} onClick={() => void decide(false)} className="qo-danger">驳回报价</button></div></div>}{approval.status === 'pending' && !approval.canDecide && <p>已提交主管，请等待主管处理。</p>}</div>}
      </>}
    </article>

    <article className="qo-card qo-deposit"><div className="qo-title"><span>04</span><div><h2>定金确认 <em className="qo-finance-only">仅财务</em></h2><p>仅已提交或主管批准的报价可确认定金</p></div></div>{!quote && <p className="qo-empty">选择已提交的报价后可进行定金确认。</p>}{quote && !canConfirmDeposit && !order && <div className="qo-lock"><ShieldCheck size={20} /><span><b>当前不可确认定金</b>{quote.status === 'approval_pending' ? '特殊报价必须等待主管批准。' : quote.status === 'frozen' ? '该报价已冻结，请从订单进入履约。' : '请先完成报价提交或审批。'}</span></div>}{quote && canConfirmDeposit && !order && <div className="qo-deposit-form"><div className="qo-deposit-quote"><span>{quote.storeName} · V{quote.versionNo}</span><strong>{money(quote.customerTotal)}</strong></div><label>本次定金金额<input value={amount} onChange={event => setAmount(event.target.value)} type="number" min="0.01" max={quote.customerTotal} placeholder="0.00" /></label><label>收款对象<select value={recipientType} onChange={event => setRecipientType(event.target.value as 'company' | 'sales')}><option value="company">公司收款</option><option value="sales">销售代收</option></select></label><label className="qo-deposit-reference">付款凭证号<input value={externalRef} onChange={event => setExternalRef(event.target.value)} placeholder="银行流水号或财务凭证号" /></label><button disabled={busy || !(Number(amount) > 0) || Number(amount) > quote.customerTotal || !externalRef.trim()} onClick={() => void confirmDeposit()} className="qo-primary"><WalletCards size={17} />确认定金、冻结报价并生成订单</button></div>}{order && <div className="qo-order-result"><div className="qo-order-created"><CheckCircle2 size={22} /><span><b>成交完成 · {orderStatusLabel[order.status] ?? order.status}</b><strong>{order.orderNumber}</strong><small>成交时间：{new Date(order.createdAt).toLocaleString('zh-CN')} · 最终报价已冻结</small></span><a href={`#/orders-v3?order=${encodeURIComponent(order.id)}`}>进入订单履约</a></div><p>退款或取消必须通过后续“冲销/取消”流程新增历史记录，不会覆盖本次定金和订单记录。</p></div>}</article>
    </section></div>
    <InternalPaymentPanel dataSource={dataSource} />
  </main>
}

const dealJourneySteps = ['线索', '客户档案与资格', '商机', '报价', '定金', '订单']

function DealJourney({ completedThrough }: { completedThrough: number }) {
  return <section className="qo-journey" aria-label="销售成交链路"><header><b>成交链路</b><span>系统按顺序校验，不能跳过资格、报价或定金</span></header><div>{dealJourneySteps.map((label, index) => <span className={index <= completedThrough ? 'is-done' : ''} key={label}><i>{index <= completedThrough ? '✓' : index + 1}</i><small>{label}</small></span>)}</div></section>
}
