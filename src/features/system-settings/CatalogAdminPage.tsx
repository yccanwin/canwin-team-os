import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Boxes, CircleDollarSign, Pencil, Plus, Save, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { CatalogAdminDataSource } from './catalogDataSource'
import type { CatalogItem, CatalogItemDraft, CatalogItemType, CatalogSnapshot } from './catalogTypes'

const itemLabels: Record<CatalogItemType, string> = { software: '软件产品', hardware: '硬件', service: '加购项目' }
const businessTypes = [
  ['fast_food', '快餐'], ['chinese', '中餐'], ['hotpot', '火锅'], ['barbecue', '烧烤'],
  ['beverage', '饮品'], ['bakery', '烘焙'], ['banquet', '宴会'], ['international', '异国料理'],
] as const
const emptyDraft: CatalogItemDraft = { sku: '', name: '', itemType: 'software', procurementCost: 0, customerListPrice: 0, points: 0, applicableBusinessTypes: [], isActive: true }

export function CatalogAdminPage({ dataSource }: { dataSource: CatalogAdminDataSource }) {
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null)
  const [filter, setFilter] = useState<'all' | CatalogItemType>('all')
  const [draft, setDraft] = useState<CatalogItemDraft | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    setBusy(true); setError('')
    try { setSnapshot(await dataSource.loadSnapshot()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '读取商品配置失败') }
    finally { setBusy(false) }
  }
  useEffect(() => {
    let active = true
    dataSource.loadSnapshot().then((data) => { if (active) setSnapshot(data) }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '读取商品配置失败') }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [dataSource])

  const items = useMemo(() => (snapshot?.items ?? []).filter((item) => filter === 'all' || item.itemType === filter), [snapshot, filter])
  const save = async () => {
    if (!draft?.sku.trim() || !draft.name.trim()) { setError('请填写 SKU 和商品名称'); return }
    if ([draft.procurementCost, draft.customerListPrice, draft.points].some((value) => !Number.isFinite(value) || value < 0)) { setError('采购成本、建议售价和积分不能为负数'); return }
    setBusy(true); setError(''); setNotice('')
    try { await dataSource.saveItem(draft); setDraft(null); await load(); setNotice('商品配置已保存并实时生效') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存商品失败') }
    finally { setBusy(false) }
  }
  const toggleBusinessType = (value: string) => {
    if (!draft) return
    setDraft({ ...draft, applicableBusinessTypes: draft.applicableBusinessTypes.includes(value) ? draft.applicableBusinessTypes.filter((item) => item !== value) : [...draft.applicableBusinessTypes, value] })
  }

  return <section className="mx-auto w-full max-w-7xl pb-12">
    <div className="mb-4 flex items-center justify-between gap-2"><Link to="/settings-v3" className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-slate-600 hover:bg-white"><ArrowLeft size={17}/>返回系统配置</Link><Link to="/settings-v3/catalog/packages" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"><Boxes size={16}/>套餐配置</Link></div>
    <header className="rounded-2xl bg-gradient-to-r from-amber-950 via-slate-950 to-slate-900 px-5 py-6 text-white shadow-sm sm:px-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-[.2em] text-amber-300">当前商品配置</p><h1 className="mt-2 text-2xl font-semibold">软件、硬件与加购项目</h1><p className="mt-2 text-sm text-slate-300">保存后实时更新销售报价；采购成本仅管理员可见。</p></div><button onClick={() => setDraft({ ...emptyDraft })} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-300 px-4 text-sm font-semibold text-slate-950"><Plus size={18}/>新增商品</button></div></header>
    {error && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}{notice && <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Boxes size={20} className="text-amber-700"/>商品清单</h2><p className="mt-1 text-sm text-slate-500">停用后不再进入新报价，历史订单快照不受影响。</p></div><div className="flex flex-wrap gap-2">{(['all','software','hardware','service'] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={`min-h-9 rounded-lg px-3 text-sm ${filter === value ? 'bg-slate-950 text-white' : 'border border-slate-200 text-slate-600'}`}>{value === 'all' ? '全部' : itemLabels[value]}</button>)}</div></div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">{items.map((item) => <ItemCard key={item.id} item={item} onEdit={() => setDraft({ ...item })}/>)}{!busy && items.length === 0 && <p className="col-span-full rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">当前没有该类商品。</p>}</div>
    </section>
    {draft && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 sm:items-center sm:p-4" role="dialog" aria-modal="true"><div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">{draft.id ? '编辑商品' : '新增商品'}</h2><button aria-label="关闭" onClick={() => setDraft(null)}><X/></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2">
      <Field label="SKU"><input value={draft.sku} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} className="input"/></Field><Field label="名称"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="input"/></Field>
      <Field label="类型"><select value={draft.itemType} onChange={(event) => setDraft({ ...draft, itemType: event.target.value as CatalogItemType })} className="input">{Object.entries(itemLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="积分"><input type="number" min="0" step="0.1" value={draft.points} onChange={(event) => setDraft({ ...draft, points: Number(event.target.value) })} className="input"/></Field>
      <Field label="采购成本"><input type="number" min="0" step="0.01" value={draft.procurementCost} onChange={(event) => setDraft({ ...draft, procurementCost: Number(event.target.value) })} className="input"/></Field><Field label="销售建议价"><input type="number" min="0" step="0.01" value={draft.customerListPrice} onChange={(event) => setDraft({ ...draft, customerListPrice: Number(event.target.value) })} className="input"/></Field>
    </div><fieldset className="mt-4"><legend className="text-sm font-medium">适用业态 <span className="font-normal text-slate-400">（不选代表全部）</span></legend><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{businessTypes.map(([value,label]) => <label key={value} className="flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"><input type="checkbox" checked={draft.applicableBusinessTypes.includes(value)} onChange={() => toggleBusinessType(value)}/>{label}</label>)}</div></fieldset>
    <label className="mt-4 flex items-center justify-between rounded-xl border p-3 text-sm"><span><b className="block">启用状态</b><small className="text-slate-500">停用后不进入新报价</small></span><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}/></label><div className="mt-5 flex gap-3"><button onClick={() => setDraft(null)} className="min-h-11 flex-1 rounded-xl border">取消</button><button disabled={busy} onClick={() => void save()} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 font-semibold text-white disabled:opacity-50"><Save size={17}/>保存并生效</button></div><p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><CircleDollarSign size={14}/>采购成本不会返回给普通销售账号。</p></div></div>}
  </section>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm font-medium text-slate-700">{label}<span className="mt-1 block [&_.input]:min-h-11 [&_.input]:w-full [&_.input]:rounded-xl [&_.input]:border [&_.input]:border-slate-300 [&_.input]:bg-white [&_.input]:px-3">{children}</span></label> }
function ItemCard({ item, onEdit }: { item: CatalogItem; onEdit: () => void }) { return <article className={`rounded-xl border p-4 ${item.isActive ? 'border-slate-200' : 'bg-slate-50 opacity-70'}`}><div className="flex justify-between gap-3"><div><div className="flex flex-wrap gap-2"><strong>{item.name}</strong><span className="rounded bg-slate-100 px-2 font-mono text-xs">{item.sku}</span><span className="rounded-full bg-amber-50 px-2 text-xs text-amber-800">{itemLabels[item.itemType]}</span>{!item.isActive && <span className="rounded-full bg-slate-200 px-2 text-xs">已停用</span>}</div><div className="mt-3 grid grid-cols-3 gap-3 text-xs"><span><small className="block text-slate-400">采购成本</small><b>¥{item.procurementCost.toLocaleString()}</b></span><span><small className="block text-slate-400">销售建议价</small><b>¥{item.customerListPrice.toLocaleString()}</b></span><span><small className="block text-slate-400">积分</small><b>{item.points}</b></span></div><p className="mt-3 text-xs text-slate-500">适用业态：{item.applicableBusinessTypes.length ? item.applicableBusinessTypes.map((value) => businessTypes.find(([code]) => code === value)?.[1] ?? value).join('、') : '全部业态'}</p></div><button aria-label={`编辑${item.name}`} onClick={onEdit} className="rounded-lg border p-2"><Pencil size={16}/></button></div></article> }
