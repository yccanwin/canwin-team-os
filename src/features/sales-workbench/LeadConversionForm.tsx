import { useState } from 'react'
import { Building2, X } from 'lucide-react'
import type { LeadConversionPrecheck, SalesWorkbenchDataSource } from './dataSource'

export function LeadConversionForm({ leadId, defaultContactName, dataSource, onConverted }: { leadId: string; defaultContactName: string; dataSource: SalesWorkbenchDataSource; onConverted: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [brandName, setBrandName] = useState(''), [brandId, setBrandId] = useState(''), [businessMode, setBusinessMode] = useState('independent')
  const [storeName, setStoreName] = useState(''), [storeId, setStoreId] = useState(''), [businessType, setBusinessType] = useState('chinese'), [address, setAddress] = useState('')
  const [contactName, setContactName] = useState(defaultContactName), [contactId, setContactId] = useState(''), [contactTitle, setContactTitle] = useState(''), [isKeyPerson, setIsKeyPerson] = useState(false)
  const [precheck, setPrecheck] = useState<LeadConversionPrecheck | null>(null)
  const invalidate = () => { setPrecheck(null); setBrandId(''); setStoreId(''); setContactId(''); setNotice('') }
  const runPrecheck = async () => {
    if (!brandName.trim() || !storeName.trim() || !contactName.trim()) return setError('请填写品牌、门店和联系人名称')
    setBusy(true); setError('')
    try { const result = await dataSource.precheckLeadConversion({ leadId, brandName, storeName }); setPrecheck(result); setBrandId(result.brands[0]?.id ?? ''); setStoreId(result.stores[0]?.id ?? ''); setContactId(result.contacts[0]?.id ?? '') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '去重预检失败') } finally { setBusy(false) }
  }
  const convert = async () => {
    if (!precheck) return setError('请先完成去重预检')
    setBusy(true); setError('')
    try {
      const result = await dataSource.convertLeadToCustomer({ leadId, brandId: brandId || undefined, brandName, businessMode, storeId: storeId || undefined, storeName, businessType, address, contactId: contactId || undefined, contactName, contactTitle, isKeyPerson })
      setNotice(result.idempotent ? '该线索此前已转客户，已返回原客户档案' : '已转为客户并保留原线索历史')
      await onConverted()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '转客户失败') } finally { setBusy(false) }
  }
  if (!open) return <button className="sw-convert-trigger" onClick={() => setOpen(true)}><Building2 size={17} />完善客户档案 / 转客户</button>
  return <section className="sw-convert-form"><header><div><strong>完善客户档案 / 转客户</strong><span>确认有效事实后，再创建或关联客户资料</span></div><button aria-label="关闭转客户" onClick={() => setOpen(false)}><X size={18} /></button></header>
    <div className="sw-convert-grid">
      <label>品牌名称<input value={brandName} onChange={(e) => { setBrandName(e.target.value); invalidate() }} /></label>
      <label>经营模式<select value={businessMode} onChange={(e) => setBusinessMode(e.target.value)}><option value="independent">独立门店</option><option value="direct_chain">直营连锁</option><option value="franchise_chain">加盟连锁</option></select></label>
      <label>门店名称<input value={storeName} onChange={(e) => { setStoreName(e.target.value); invalidate() }} /></label>
      <label>业态<select value={businessType} onChange={(e) => setBusinessType(e.target.value)}>{[['fast_food','快餐'],['chinese','中餐'],['hotpot','火锅'],['barbecue','烧烤'],['beverage','饮品'],['bakery','烘焙'],['banquet','宴会'],['international','异国料理']].map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="is-wide">门店地址<input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
      <label>联系人<input value={contactName} onChange={(e) => setContactName(e.target.value)} /></label><label>职务<input value={contactTitle} onChange={(e) => setContactTitle(e.target.value)} /></label>
      <label className="sw-check"><input type="checkbox" checked={isKeyPerson} onChange={(e) => setIsKeyPerson(e.target.checked)} />关键人</label>
    </div>
    {!precheck ? <button className="sw-primary" disabled={busy} onClick={() => void runPrecheck()}>{busy ? '正在预检…' : '检查重复客户'}</button> : <div className="sw-dedupe-results"><strong>去重预检结果</strong>
      <label>品牌<select value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">未发现重复，创建新品牌</option>{precheck.brands.map((x) => <option key={x.id} value={x.id}>关联：{x.name}</option>)}</select></label>
      <label>门店<select value={storeId} onChange={(e) => setStoreId(e.target.value)}><option value="">未发现重复，创建新门店</option>{precheck.stores.map((x) => <option key={x.id} value={x.id}>关联：{x.name}</option>)}</select></label>
      <label>电话匹配联系人<select value={contactId} onChange={(e) => setContactId(e.target.value)}><option value="">未发现电话重复，创建联系人</option>{precheck.contacts.map((x) => <option key={x.id} value={x.id}>关联：{x.name}</option>)}</select></label>
      <button className="sw-primary" disabled={busy} onClick={() => void convert()}>{busy ? '正在转客户…' : '确认转客户'}</button></div>}
    {error && <div className="sw-data-error">{error}</div>}{notice && <div className="sw-success">{notice}</div>}
  </section>
}
