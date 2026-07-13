import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { QuickLeadContext, SalesWorkbenchDataSource } from './dataSource'

const sources = ['客户转介绍', '电话咨询', '上门拜访', '活动获客', '线上渠道', '其他']

export function QuickLeadForm({ dataSource, onCreated }: { dataSource: SalesWorkbenchDataSource; onCreated: (leadId: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [context, setContext] = useState<QuickLeadContext | null>(null)
  const [title, setTitle] = useState('')
  const [phone, setPhone] = useState('')
  const [source, setSource] = useState('')
  const [regionId, setRegionId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || context) return
    void dataSource.loadQuickLeadContext().then((value) => {
      setContext(value)
      setRegionId(value.defaultRegionId ?? '')
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '读取区域失败'))
  }, [context, dataSource, open])

  const submit = async () => {
    if (!title.trim() || !phone.trim() || !source.trim()) return setError('请填写客户称呼、联系电话和来源')
    if (context?.requiresRegionSelection && !regionId) return setError('当前账号有多个区域，请选择本条线索所属区域')
    setBusy(true); setError('')
    try {
      const leadId = await dataSource.createQuickLead({ title, phone, source, regionId: regionId || undefined })
      setTitle(''); setPhone(''); setSource(''); setOpen(false)
      await onCreated(leadId)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '新增线索失败') }
    finally { setBusy(false) }
  }

  if (!open) return <button className="sw-quick-lead-trigger" onClick={() => setOpen(true)}><Plus size={17} />新增线索</button>
  return <section className="sw-quick-lead" aria-label="一分钟新增线索">
    <header><div><strong>一分钟新增线索</strong><span>先记录最少信息，其余资料可在联系确认后补充</span></div><button aria-label="关闭新增线索" onClick={() => setOpen(false)}><X size={18} /></button></header>
    <div className="sw-quick-lead-fields">
      <label>客户 / 联系人称呼或线索标题<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：张老板新店" /></label>
      <label>联系电话<input type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="用于后续联系" /></label>
      <label>来源<select value={source} onChange={(event) => setSource(event.target.value)}><option value="">请选择来源</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label>
      {context?.requiresRegionSelection && <label>所属区域<select value={regionId} onChange={(event) => setRegionId(event.target.value)}><option value="">请选择区域</option>{context.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select></label>}
    </div>
    {!context && !error && <p className="sw-loading">正在确认默认区域…</p>}
    {context && !context.requiresRegionSelection && <p className="sw-region-hint">区域已按当前销售的主区域自动填写</p>}
    {error && <div className="sw-data-error" role="alert">{error}</div>}
    <button className="sw-primary" disabled={busy || !context} onClick={submit}>{busy ? '正在保存…' : '保存到我的线索'}</button>
  </section>
}
