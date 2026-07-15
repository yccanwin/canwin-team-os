import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { QuickLeadContext, SalesWorkbenchDataSource } from './dataSource'

const sources = [
  { value: 'field_visit', label: '现场发现' }, { value: 'site_hoarding', label: '围挡' },
  { value: '客户转介绍', label: '客户转介绍' }, { value: '电话咨询', label: '电话咨询' },
  { value: '上门拜访', label: '上门拜访' }, { value: '活动获客', label: '活动获客' },
  { value: '线上渠道', label: '线上渠道' }, { value: '其他', label: '其他' },
] as const

export function QuickLeadForm({ dataSource, onCreated }: { dataSource: SalesWorkbenchDataSource; onCreated: (leadId: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [context, setContext] = useState<QuickLeadContext | null>(null)
  const [title, setTitle] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [source, setSource] = useState('')
  const [regionId, setRegionId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fieldSource = source === 'field_visit' || source === 'site_hoarding'

  useEffect(() => {
    if (!open || context) return
    void dataSource.loadQuickLeadContext().then((value) => {
      setContext(value)
      setRegionId(value.defaultRegionId ?? '')
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '读取区域失败'))
  }, [context, dataSource, open])

  const submit = async () => {
    if (!title.trim() || !source.trim()) return setError('请填写客户称呼和来源')
    if (!fieldSource && !phone.trim()) return setError('非现场线索必须填写联系电话')
    if (!fieldSource && context?.requiresRegionSelection && !regionId) return setError('当前账号有多个区域，请选择本条线索所属区域')
    setBusy(true); setError('')
    try {
      const region = context?.regions.find((item) => item.id === regionId)
      const leadId = fieldSource
        ? await dataSource.submitFieldLead({ title, contactName, phone, source, regionText: region?.name, address })
        : await dataSource.createQuickLead({ title, phone, source, regionId: regionId || undefined })
      setTitle(''); setContactName(''); setPhone(''); setAddress(''); setSource(''); setOpen(false)
      await onCreated(leadId)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '新增线索失败') }
    finally { setBusy(false) }
  }

  if (!open) return <button className="sw-quick-lead-trigger" onClick={() => setOpen(true)}><Plus size={17} />新增线索</button>
  return <section className="sw-quick-lead" aria-label="一分钟新增线索">
    <header><div><strong>一分钟新增线索</strong><span>先记录最少信息，其余资料可在联系确认后补充</span></div><button aria-label="关闭新增线索" onClick={() => setOpen(false)}><X size={18} /></button></header>
    <div className="sw-quick-lead-fields">
      <label>客户 / 联系人称呼或线索标题<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：张老板新店" /></label>
      {fieldSource && <label>联系人（选填）<input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="待确认可留空" /></label>}
      <label>联系电话{fieldSource ? '（选填）' : ''}<input type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={fieldSource ? '待确认可留空' : '用于后续联系'} /></label>
      <label>来源<select value={source} onChange={(event) => setSource(event.target.value)}><option value="">请选择来源</option>{sources.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      {fieldSource && <label>现场地址<input value={address} onChange={(event) => { const value = event.target.value; setAddress(value); const matches = context?.regions.filter((region) => value.includes(region.name)) ?? []; if (matches.length === 1) setRegionId(matches[0].id) }} placeholder="粘贴地址可自动匹配区域" /></label>}
      {(fieldSource || context?.requiresRegionSelection) && <label>所属区域<select value={regionId} onChange={(event) => setRegionId(event.target.value)}><option value="">未匹配 / 进入公海待确认</option>{context?.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select></label>}
    </div>
    {!context && !error && <p className="sw-loading">正在确认默认区域…</p>}
    {context && !fieldSource && !context.requiresRegionSelection && <p className="sw-region-hint">区域已按当前销售的主区域自动填写</p>}
    {fieldSource && regionId && <p className="sw-region-hint">已确认区域：{context?.regions.find((region) => region.id === regionId)?.name}</p>}
    {fieldSource && !regionId && <p className="sw-data-error">地址未匹配已启用区域，提交后进入待分区公海。</p>}
    {fieldSource && !phone.trim() && <p className="sw-region-hint">待补关键人：下一步由接收销售确认联系人和联系电话。</p>}
    {error && <div className="sw-data-error" role="alert">{error}</div>}
    <button className="sw-primary" disabled={busy || !context} onClick={submit}>{busy ? '正在保存…' : '保存到我的线索'}</button>
  </section>
}
