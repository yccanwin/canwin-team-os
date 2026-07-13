import { useCallback, useEffect, useState } from 'react'
import type { CrmEditorOptions, QualificationStatus, SalesWorkbenchDataSource } from './dataSource'

export function QualificationEvidenceEditor({ leadId, dataSource, onQualified }: { leadId: string; dataSource: SalesWorkbenchDataSource; onQualified: () => Promise<void> }) {
  const [opts, setOpts] = useState<CrmEditorOptions | null>(null)
  const [status, setStatus] = useState<QualificationStatus | null>(null)
  const [area, setArea] = useState(''); const [rooms, setRooms] = useState('')
  const [landmark, setLandmark] = useState(false); const [takeaway, setTakeaway] = useState(false)
  const [annual, setAnnual] = useState(''); const [contactId, setContactId] = useState(''); const [meeting, setMeeting] = useState('')
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(true); const [retry, setRetry] = useState(0)

  const refreshStatus = useCallback(async () => {
    const next = await dataSource.getQualificationStatus(leadId)
    setStatus(next)
    setArea(next.areaSqm == null ? '' : String(next.areaSqm)); setRooms(next.privateRoomCount == null ? '' : String(next.privateRoomCount))
    setLandmark(next.isLandmark); setTakeaway(next.isTakeawayOnly)
  }, [dataSource, leadId])

  useEffect(() => {
    let active = true
    Promise.all([dataSource.loadCrmEditorOptions(), dataSource.getQualificationStatus(leadId)])
      .then(([nextOpts, nextStatus]) => { if (!active) return; setOpts(nextOpts); setStatus(nextStatus); setArea(nextStatus.areaSqm == null ? '' : String(nextStatus.areaSqm)); setRooms(nextStatus.privateRoomCount == null ? '' : String(nextStatus.privateRoomCount)); setLandmark(nextStatus.isLandmark); setTakeaway(nextStatus.isTakeawayOnly) })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : '读取资格数据失败') })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [dataSource, leadId, retry])

  const lead = opts?.leads.find(x => x.id === leadId)
  const contacts = opts?.contacts.filter(x => x.isKeyPerson && (x.storeId === lead?.storeId || (!x.storeId && x.brandId === lead?.brandId))) ?? []
  const run = async (operation: () => Promise<unknown>, success: string) => { setBusy(true); setError(''); setNotice(''); try { await operation(); await refreshStatus(); setNotice(success) } catch (e) { setError(e instanceof Error ? e.message : success.replace('已', '失败：')) } finally { setBusy(false) } }
  const saveStoreFacts = () => {
    if (!lead?.storeId) { setError('必须先在线索中关联真实门店'); return }
    void run(() => dataSource.recordStoreQualificationFacts({ storeId: lead.storeId!, areaSqm: area ? Number(area) : undefined, privateRoomCount: rooms ? Number(rooms) : undefined, isLandmark: landmark, isTakeawayOnly: takeaway }), '门店资格事实已保存')
  }
  const saveAnnual = () => {
    if (!annual.trim()) { setError('请填写年费产品可以继续谈的真实依据'); return }
    void run(() => dataSource.recordQualificationEvidence({ leadId, evidenceType: 'annual_fee_viable', detail: annual.trim() }), '年费产品证据已保存')
  }
  const saveKeyPerson = () => {
    if (!contactId) { setError('请先选择已建档的关键联系人'); return }
    void run(() => meeting
      ? dataSource.recordQualificationEvidence({ leadId, evidenceType: 'key_person_meeting_scheduled', detail: '已明确预约关键人', contactId, meetingAt: meeting })
      : dataSource.recordQualificationEvidence({ leadId, evidenceType: 'key_person_contacted', detail: '已实际接触关键人', contactId }), '关键人证据已保存')
  }
  const qualify = async () => { setBusy(true); setError(''); try { await dataSource.qualifyLead(leadId); setNotice('已转为有效商机'); await refreshStatus(); await onQualified() } catch (e) { setError(e instanceof Error ? e.message : '转商机失败') } finally { setBusy(false) } }

  if (busy && !opts) return <p className="sw-loading">正在加载资格资料…</p>
  if (error && !opts) return <section className="sw-evidence-editor"><div className="sw-data-error">{error}</div><button className="sw-secondary" onClick={() => setRetry(x => x + 1)}>重试加载</button></section>
  return <section className="sw-evidence-editor">
    <header className="sw-evidence-head"><div><h3>有效商机资格</h3><p>{status?.storeName ?? '未关联真实门店'} · {status?.businessTypeLabel ?? '业态待补充'}</p></div><strong className={`sw-grade is-${status?.calculatedGrade ?? 'pending'}`}>{status?.calculatedGrade ?? '待判定'}</strong></header>
    <div className="sw-grade-rule"><strong>系统自动分级</strong><span>{status?.gradeReason || '先关联真实门店'}</span><small>A：连锁/宴会/标志门店；B：≥300㎡或≥5包厢；C：年费适配且未达A/B；D：纯外卖/退出漏斗</small></div>
    <div className="sw-evidence-progress"><strong>{status?.eligible ? '资格已齐全' : '还缺这些证据'}</strong>{status?.missingEvidence.map(item => <span key={item}>○ {item}</span>)}<em>下一动作：{status?.nextAction || '读取中'}</em></div>
    <fieldset><legend>1. 门店价值事实</legend><div className="sw-evidence-grid"><label>面积㎡<input type="number" min="0" value={area} onChange={e => setArea(e.target.value)} /></label><label>包厢数<input type="number" min="0" value={rooms} onChange={e => setRooms(e.target.value)} /></label></div><label className="sw-check"><input type="checkbox" checked={landmark} onChange={e => setLandmark(e.target.checked)} />标志性门店</label><label className="sw-check"><input type="checkbox" checked={takeaway} onChange={e => setTakeaway(e.target.checked)} />纯外卖店（系统判为 D）</label><button className="sw-secondary" disabled={busy} onClick={saveStoreFacts}>保存门店事实</button></fieldset>
    <fieldset><legend>2. 年费产品可以继续谈</legend><label>真实依据<input value={annual} onChange={e => setAnnual(e.target.value)} placeholder="例如：客户接受年费模式并要求下周给方案" /></label><button className="sw-secondary" disabled={busy || status?.annualFeeViable} onClick={saveAnnual}>{status?.annualFeeViable ? '年费证据已具备' : '保存年费证据'}</button></fieldset>
    <fieldset><legend>3. 已接触或明确约到关键人</legend><label>关键联系人<select value={contactId} onChange={e => setContactId(e.target.value)}><option value="">请选择</option>{contacts.map(x => <option key={x.id} value={x.id}>{x.name} · {x.title}</option>)}</select></label><label>预约时间（不填表示已接触）<input type="datetime-local" value={meeting} onChange={e => setMeeting(e.target.value)} /></label><button className="sw-secondary" disabled={busy || status?.keyPersonReady} onClick={saveKeyPerson}>{status?.keyPersonReady ? '关键人证据已具备' : '保存关键人证据'}</button></fieldset>
    {status?.demoRequiredBeforeDeposit && <div className="sw-demo-gate">A 类商机：定金确认前必须完成真实演示，服务端会强制拦截。</div>}
    {error && <div className="sw-data-error">{error}</div>}{notice && <div className="sw-success">{notice}</div>}
    <button className="sw-primary" disabled={busy || !status?.eligible || Boolean(status.opportunityId)} onClick={() => void qualify()}>{status?.opportunityId ? '已转为有效商机' : '提交服务端判定并转商机'}</button>
  </section>
}
