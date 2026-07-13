import { useEffect, useState } from 'react'
import type { CrmEditorOptions, SalesWorkbenchDataSource } from './dataSource'

export function QualificationEvidenceEditor({ leadId, dataSource, onQualified }: { leadId: string; dataSource: SalesWorkbenchDataSource; onQualified: () => Promise<void> }) {
  const [opts, setOpts] = useState<CrmEditorOptions | null>(null)
  const [area, setArea] = useState(''); const [rooms, setRooms] = useState('')
  const [landmark, setLandmark] = useState(false); const [takeaway, setTakeaway] = useState(false)
  const [annual, setAnnual] = useState(''); const [contactId, setContactId] = useState(''); const [meeting, setMeeting] = useState('')
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(true); const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    dataSource.loadCrmEditorOptions().then(x => { if (active) setOpts(x) }).catch(e => { if (active) setError(e instanceof Error ? e.message : '读取资格数据失败') }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [dataSource, retry])

  const lead = opts?.leads.find(x => x.id === leadId)
  const store = opts?.stores.find(x => x.id === lead?.storeId)
  const contacts = opts?.contacts.filter(x => x.isKeyPerson && (x.storeId === lead?.storeId || (!x.storeId && x.brandId === lead?.brandId))) ?? []

  const saveEvidence = async () => {
    if (!lead?.storeId) { setError('必须先为线索关联真实门店'); return }
    if (!annual.trim()) { setError('请填写年费产品适配事实'); return }
    if (!contactId) { setError('请选择已建档的关键联系人'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      await dataSource.recordStoreQualificationFacts({ storeId: lead.storeId, areaSqm: area ? Number(area) : undefined, privateRoomCount: rooms ? Number(rooms) : undefined, isLandmark: landmark, isTakeawayOnly: takeaway })
      await dataSource.recordQualificationEvidence({ leadId, evidenceType: 'annual_fee_viable', detail: annual })
      if (meeting) await dataSource.recordQualificationEvidence({ leadId, evidenceType: 'key_person_meeting_scheduled', detail: '已明确预约关键人', contactId, meetingAt: meeting })
      else await dataSource.recordQualificationEvidence({ leadId, evidenceType: 'key_person_contacted', detail: '已接触关键人', contactId })
      setNotice('资格事实与证据已保存，可提交服务端判定')
    } catch (e) { setError(e instanceof Error ? e.message : '保存资格证据失败') } finally { setBusy(false) }
  }

  const qualify = async () => {
    setBusy(true); setError('')
    try { await dataSource.qualifyLead(leadId); setNotice('已转为有效商机'); await onQualified() }
    catch (e) { setError(e instanceof Error ? e.message : '转商机失败') } finally { setBusy(false) }
  }

  if (busy && !opts) return <p className="sw-loading">正在加载资格资料…</p>
  if (error && !opts) return <section className="sw-evidence-editor"><div className="sw-data-error">{error}</div><button className="sw-secondary" onClick={() => setRetry(x => x + 1)}>重试加载</button></section>
  return <section className="sw-evidence-editor"><h3>真实资格事实</h3><p>门店：{store?.name ?? '未关联'}。系统按持久化事实计算 A/B/C/D，前端不能指定等级。</p><div className="sw-evidence-grid"><label>面积㎡<input type="number" min="0" value={area} onChange={e => setArea(e.target.value)} /></label><label>包厢数<input type="number" min="0" value={rooms} onChange={e => setRooms(e.target.value)} /></label></div><label className="sw-check"><input type="checkbox" checked={landmark} onChange={e => setLandmark(e.target.checked)} />标志性门店</label><label className="sw-check"><input type="checkbox" checked={takeaway} onChange={e => setTakeaway(e.target.checked)} />纯外卖店（将判为 D）</label><label>年费产品适配事实<input value={annual} onChange={e => setAnnual(e.target.value)} placeholder="记录客户需求或适配依据" /></label><label>关键联系人<select value={contactId} onChange={e => setContactId(e.target.value)}><option value="">请选择</option>{contacts.map(x => <option key={x.id} value={x.id}>{x.name} · {x.title}</option>)}</select></label><label>关键人预约时间（不填表示已接触）<input type="datetime-local" value={meeting} onChange={e => setMeeting(e.target.value)} /></label>{error && <div className="sw-data-error">{error}</div>}{notice && <div className="sw-success">{notice}</div>}<button className="sw-secondary" disabled={busy} onClick={saveEvidence}>保存事实与证据</button><button className="sw-primary" disabled={busy} onClick={qualify}>提交服务端资格判定</button></section>
}
