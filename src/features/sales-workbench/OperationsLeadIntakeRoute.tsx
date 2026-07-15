import { useEffect, useMemo, useState } from 'react'
import { ClipboardPaste, RotateCcw, SearchCheck, Send, ShieldCheck, UserRoundCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { parseLeadPaste } from '@/utils/leadPasteParser'
import './operations-lead-intake.css'

type RegionOption = { id: string; name: string }
type AssignmentPreview = { mode: 'salesperson' | 'public_pool'; salespersonName?: string; regionName?: string; reason?: string }
type DuplicateHint = { matched: boolean; message?: string }
type IntakeContext = { regions: RegionOption[]; canSubmit: boolean }
type LeadDraft = { customerName: string; contactName: string; phone: string; regionText: string; address: string; notes: string }
type SubmissionRow = { id: string; customerName: string; regionText?: string; assignmentType: string; ownerName?: string; leadStatus: string; submittedAt: string }

const EMPTY_DRAFT: LeadDraft = { customerName: '', contactName: '', phone: '', regionText: '', address: '', notes: '' }

function normalizeContext(data: unknown): IntakeContext {
  const value = (data ?? {}) as Record<string, unknown>
  const rawRegions = Array.isArray(value.regions) ? value.regions : []
  return { regions: rawRegions.map((item) => { const row = item as Record<string, unknown>; return { id: String(row.id), name: String(row.name) } }), canSubmit: value.can_submit !== false }
}

function normalizePreview(data: unknown): { preview: AssignmentPreview; duplicate: DuplicateHint } {
  const value = (data ?? {}) as Record<string, unknown>
  const matchedRegion = (value.matchedRegion ?? {}) as Record<string, unknown>
  const salespersonName = value.ownerName ? String(value.ownerName) : undefined
  const duplicateMatched = value.duplicate === true
  const assignmentType = String(value.assignmentType ?? '')
  return {
    preview: {
      mode: salespersonName ? 'salesperson' : 'public_pool',
      salespersonName,
      regionName: matchedRegion.name ? String(matchedRegion.name) : undefined,
      reason: assignmentType === 'unmatched_pool' ? '区域无法唯一识别，将进入待分区公海' : assignmentType === 'regional_pool' ? '该区域暂无可分配销售，将进入区域公海' : undefined,
    },
    duplicate: { matched: duplicateMatched, message: duplicateMatched ? `已存在相同电话的线索 ${String(value.duplicateLeadId ?? '')}`.trim() : undefined },
  }
}

export default function OperationsLeadIntakeRoute() {
  const [rawText, setRawText] = useState('')
  const [draft, setDraft] = useState<LeadDraft>(EMPTY_DRAFT)
  const [intakeSource, setIntakeSource] = useState<'field_visit' | 'site_hoarding'>('field_visit')
  const [context, setContext] = useState<IntakeContext | null>(null)
  const [preview, setPreview] = useState<AssignmentPreview | null>(null)
  const [duplicate, setDuplicate] = useState<DuplicateHint | null>(null)
  const [busy, setBusy] = useState(false)
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let active = true
    void supabase.rpc('get_operations_lead_intake_context').then(({ data, error }) => {
      if (!active) return
      if (error) setMessage({ tone: 'error', text: `读取线索录入配置失败：${error.message}` })
      else setContext(normalizeContext(data))
    })
    return () => { active = false }
  }, [])

  const loadSubmissions = async () => {
    const { data, error } = await supabase.rpc('get_my_lead_submissions', { p_limit: 20 })
    if (error) return setMessage({ tone: 'error', text: `读取报备状态失败：${error.message}` })
    const rows = Array.isArray(data) ? data : []
    setSubmissions(rows.map((item) => { const row = item as Record<string, unknown>; return { id: String(row.submission_id), customerName: String(row.customer_name), regionText: row.region_text ? String(row.region_text) : undefined, assignmentType: String(row.assignment_type), ownerName: row.owner_name ? String(row.owner_name) : undefined, leadStatus: String(row.lead_status), submittedAt: String(row.submitted_at) } }))
  }

  useEffect(() => { queueMicrotask(() => { void loadSubmissions() }) }, [])

  const matchedRegion = useMemo(() => {
    const keyword = draft.regionText.trim()
    if (!keyword || !context) return undefined
    return context.regions.find((region) => keyword.includes(region.name) || region.name.includes(keyword))
  }, [context, draft.regionText])

  const update = (field: keyof LeadDraft, value: string) => { setDraft((current) => ({ ...current, [field]: value })); setPreview(null); setDuplicate(null); setMessage(null) }

  const recognize = () => {
    if (!rawText.trim()) return setMessage({ tone: 'error', text: '请先粘贴客户信息。' })
    const parsed = parseLeadPaste(rawText)
    setDraft({ customerName: parsed.customerName ?? '', contactName: parsed.contactName ?? '', phone: parsed.phone ?? '', regionText: parsed.regionText ?? '', address: parsed.address ?? '', notes: parsed.notes ?? '' })
    setPreview(null); setDuplicate(null); setMessage({ tone: 'success', text: '已完成识别，请检查六项信息后预览分配。' })
  }

  const requestPreview = async () => {
    if (!draft.customerName.trim()) return setMessage({ tone: 'error', text: '客户/门店名称不能为空。' })
    setBusy(true); setMessage(null)
    const { data, error } = await supabase.rpc('get_operations_lead_intake_context', { p_phone: draft.phone.trim(), p_region_text: draft.regionText.trim() || null })
    setBusy(false)
    if (error) return setMessage({ tone: 'error', text: `预览分配失败：${error.message}` })
    const normalized = normalizePreview(data); setPreview(normalized.preview); setDuplicate(normalized.duplicate)
  }

  const submit = async () => {
    if (!preview) return setMessage({ tone: 'error', text: '信息发生变化，请先重新预览分配结果。' })
    if (duplicate?.matched) return setMessage({ tone: 'error', text: '发现重复线索，请核实后再处理，当前不会重复提交。' })
    setBusy(true); setMessage(null)
    const { data, error } = await supabase.rpc('submit_operations_lead', { p_customer_name: draft.customerName.trim(), p_contact_name: draft.contactName.trim() || null, p_phone: draft.phone.trim() || null, p_region_text: draft.regionText.trim() || null, p_address: draft.address.trim() || null, p_notes: draft.notes.trim() || null, p_raw_text: rawText, p_intake_source: intakeSource })
    setBusy(false)
    if (error) return setMessage({ tone: 'error', text: `提交线索失败：${error.message}` })
    const value = (data ?? {}) as Record<string, unknown>; const target = value.ownerName ? `已分配给${String(value.ownerName)}` : '已进入区域公海'
    setMessage({ tone: 'success', text: `线索提交成功，${target}。` }); setRawText(''); setDraft(EMPTY_DRAFT); setPreview(null); setDuplicate(null); void loadSubmissions()
  }

  return <main className="oli-page">
    <header className="oli-hero"><div><span className="oli-kicker">客如云中心 / 线索录入</span><h1>粘贴信息，确认后转交销售</h1><p>原始内容会随线索保留；无法匹配负责销售的区域自动进入公海。</p></div><div className="oli-rule"><ShieldCheck size={20}/><span><b>分配规则</b>匹配区域自动分配 · 跨区或未知区域进公海</span></div></header>
    <section className="oli-card oli-paste-card"><div className="oli-section-title"><ClipboardPaste size={22}/><div><h2>粘贴客户信息</h2><p>支持微信消息、表格单行或自由文本</p></div></div><textarea value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder="例如：教场新开的餐厅，联系人王老板，15851057688，六合区雄州街道，月底开业，想了解收银和后厨打印。" rows={6}/><button className="oli-secondary" onClick={recognize} disabled={!rawText.trim() || busy}><SearchCheck size={18}/>识别并填入六项信息</button></section>
    <section className="oli-card"><div className="oli-section-title"><UserRoundCheck size={22}/><div><h2>核对线索信息</h2><p>识别结果可以修改，修改后请重新预览分配</p></div></div>
      <div className="oli-grid">
        <label><span>客户/门店名称 *</span><input value={draft.customerName} onChange={(e) => update('customerName', e.target.value)} placeholder="客户或门店名称"/></label><label><span>联系人（选填）</span><input value={draft.contactName} onChange={(e) => update('contactName', e.target.value)} placeholder="待确认可留空"/></label><label><span>联系电话（选填）</span><input value={draft.phone} inputMode="tel" onChange={(e) => update('phone', e.target.value)} placeholder="待确认可留空"/></label>
        <label><span>来源</span><select value={intakeSource} onChange={(e) => setIntakeSource(e.target.value as 'field_visit' | 'site_hoarding')}><option value="field_visit">现场发现</option><option value="site_hoarding">围挡</option></select></label><label><span>所在区域</span><select value={matchedRegion?.name ?? ''} onChange={(e) => update('regionText', e.target.value)}><option value="">未匹配 / 进入公海待确认</option>{context?.regions.map((region) => <option key={region.id} value={region.name}>{region.name}</option>)}</select><small>{matchedRegion ? `已确认：${matchedRegion.name}` : '只读取后台已启用区域；未确认时进入公海'}</small></label><label className="oli-wide"><span>详细地址</span><input value={draft.address} onChange={(e) => { const value = e.target.value; update('address', value); const matches = context?.regions.filter((region) => value.includes(region.name)) ?? []; if (matches.length === 1) update('regionText', matches[0].name) }} placeholder="粘贴地址可自动匹配区域"/></label><label className="oli-wide"><span>备注/需求</span><textarea value={draft.notes} onChange={(e) => update('notes', e.target.value)} rows={3} placeholder="开业时间、产品需求、客户承诺等"/></label>
      </div>
      {!draft.phone.trim() && <div className="oli-message is-success">待补关键人：下一步由接收销售确认联系人和联系电话。</div>}
      <div className="oli-preview"><div><b>自动分配预览</b><span>{preview ? (preview.mode === 'salesperson' ? `分配给 ${preview.salespersonName}` : '进入区域公海') : '等待预览'}</span>{preview?.regionName && <small>区域：{preview.regionName}</small>}{preview?.reason && <small>{preview.reason}</small>}</div><div className={duplicate?.matched ? 'is-warning' : ''}><b>手机号查重</b><span>{duplicate ? (duplicate.matched ? '发现疑似重复' : '未发现重复') : '等待检查'}</span>{duplicate?.message && <small>{duplicate.message}</small>}</div></div>
      {message && <div className={`oli-message is-${message.tone}`}>{message.text}</div>}{!context?.canSubmit && context && <div className="oli-message is-error">当前账号没有线索录入权限。</div>}
      <div className="oli-actions"><button className="oli-ghost" onClick={() => { setRawText(''); setDraft(EMPTY_DRAFT); setPreview(null); setDuplicate(null); setMessage(null) }}><RotateCcw size={17}/>清空</button><button className="oli-secondary" onClick={requestPreview} disabled={busy || !context?.canSubmit}>预览分配</button><button className="oli-primary" onClick={submit} disabled={busy || !preview || duplicate?.matched || !context?.canSubmit}><Send size={18}/>{busy ? '处理中…' : '确认提交线索'}</button></div>
    </section>
    <section className="oli-card"><div className="oli-section-title"><UserRoundCheck size={22}/><div><h2>我的报备状态</h2><p>仅显示你提交的线索和当前分配结果</p></div></div>{submissions.length === 0 ? <div className="oli-empty">暂无报备记录</div> : <div className="oli-status-list">{submissions.map((item) => <article key={item.id}><div><b>{item.customerName}</b><small>{item.regionText || '未识别区域'} · {new Date(item.submittedAt).toLocaleString('zh-CN')}</small></div><div><span>{item.ownerName ? `已分配：${item.ownerName}` : item.assignmentType === 'duplicate' ? '重复线索' : '区域公海'}</span><small>线索状态：{item.leadStatus}</small></div></article>)}</div>}</section>
  </main>
}
