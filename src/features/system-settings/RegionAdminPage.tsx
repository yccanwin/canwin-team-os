import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, MapPinned, Pencil, Plus, Save, UsersRound, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { RegionAdminDataSource } from './regionDataSource'
import type { RegionAdminMember, RegionAdminRegion, RegionDraft, RegionLevel } from './regionTypes'

const emptyDraft: RegionDraft = { code: '', name: '', regionLevel: 'district', parentId: null, isActive: true }
const levelLabels: Record<RegionLevel, string> = { province: '省级', city: '市级', district: '区县', custom: '自定义' }

export function RegionAdminPage({ dataSource }: { dataSource: RegionAdminDataSource }) {
  const [regions, setRegions] = useState<RegionAdminRegion[]>([])
  const [members, setMembers] = useState<RegionAdminMember[]>([])
  const [draft, setDraft] = useState<RegionDraft | null>(null)
  const [selectedMemberId, setSelectedMemberId] = useState('')
  const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([])
  const [primaryRegionId, setPrimaryRegionId] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    setBusy(true); setError('')
    try { const snapshot = await dataSource.loadSnapshot(); setRegions(snapshot.regions); setMembers(snapshot.members) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '读取区域配置失败') }
    finally { setBusy(false) }
  }
  useEffect(() => {
    let active = true
    dataSource.loadSnapshot().then((snapshot) => {
      if (!active) return
      setRegions(snapshot.regions); setMembers(snapshot.members)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '读取区域配置失败')
    }).finally(() => {
      if (active) setBusy(false)
    })
    return () => { active = false }
  }, [dataSource])

  const activeRegions = useMemo(() => regions.filter((region) => region.isActive), [regions])
  const chooseMember = (member: RegionAdminMember) => {
    setSelectedMemberId(member.id)
    setSelectedRegionIds(member.regions.map((item) => item.regionId))
    setPrimaryRegionId(member.regions.find((item) => item.isPrimary)?.regionId ?? null)
    setError(''); setNotice('')
  }
  const toggleRegion = (regionId: string) => {
    if (selectedRegionIds.includes(regionId)) {
      const next = selectedRegionIds.filter((id) => id !== regionId)
      setSelectedRegionIds(next)
      if (primaryRegionId === regionId) setPrimaryRegionId(next[0] ?? null)
    } else {
      setSelectedRegionIds((current) => [...current, regionId])
      if (!primaryRegionId) setPrimaryRegionId(regionId)
    }
  }
  const saveRegion = async () => {
    if (!draft || !draft.code.trim() || !draft.name.trim()) { setError('请填写区域编码和名称'); return }
    setBusy(true); setError(''); setNotice('')
    try { await dataSource.saveRegion(draft); setDraft(null); await load(); setNotice('区域配置已保存') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存区域失败') }
    finally { setBusy(false) }
  }
  const saveAssignments = async () => {
    if (!selectedMemberId) return
    if (selectedRegionIds.length > 0 && !primaryRegionId) { setError('已分配区域时必须指定一个主区域'); return }
    setBusy(true); setError(''); setNotice('')
    try { await dataSource.saveMemberRegions(selectedMemberId, selectedRegionIds, primaryRegionId); await load(); setNotice('人员区域分配已保存') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存人员区域失败') }
    finally { setBusy(false) }
  }

  return <section className="mx-auto w-full max-w-7xl pb-12">
    <Link to="/settings-v3" className="mb-4 inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-slate-600 hover:bg-white hover:text-slate-900"><ArrowLeft size={17} />返回系统配置</Link>
    <header className="rounded-2xl bg-slate-950 px-5 py-6 text-white shadow-lg sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.2em] text-cyan-300">基础资料</p><h1 className="mt-2 text-2xl font-semibold">销售区域与人员分配</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">新增、编辑或停用区域，并为人员指定一个主区域和多个协作区域。所有保存均由服务端验证管理员权限。</p></div><button onClick={() => setDraft(emptyDraft)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200"><Plus size={18} />新增区域</button></div>
      <div className="mt-5 flex flex-wrap gap-3 text-xs"><span className="rounded-full bg-white/10 px-3 py-1.5">{activeRegions.length} 个启用区域</span><span className="rounded-full bg-white/10 px-3 py-1.5">{members.filter((member) => member.status === 'active').length} 名在职成员</span></div>
    </header>
    {error && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {notice && <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex items-center justify-between"><div><h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><MapPinned size={20} className="text-cyan-700" />区域清单</h2><p className="mt-1 text-sm text-slate-500">停用不会删除历史线索或订单。</p></div>{busy && <span className="text-xs text-slate-400">正在同步…</span>}</div>
        <div className="mt-4 grid gap-3">{regions.map((region) => <article key={region.id} className={`rounded-xl border p-4 ${region.isActive ? 'border-slate-200' : 'border-slate-200 bg-slate-50 opacity-75'}`}><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><strong className="text-slate-900">{region.name}</strong><span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">{region.code}</span><span className={`rounded-full px-2 py-0.5 text-xs ${region.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{region.isActive ? '已启用' : '已停用'}</span></div><p className="mt-2 text-xs text-slate-500">{levelLabels[region.regionLevel]} · 已分配 {region.assignedCount} 人{region.parentId ? ` · 上级：${regions.find((item) => item.id === region.parentId)?.name ?? '未知'}` : ''}</p></div><button aria-label={`编辑${region.name}`} onClick={() => setDraft({ id: region.id, code: region.code, name: region.name, regionLevel: region.regionLevel, parentId: region.parentId, isActive: region.isActive })} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"><Pencil size={16} /></button></div></article>)}{!busy && regions.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">尚未配置区域，点击“新增区域”开始。</p>}</div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><UsersRound size={20} className="text-indigo-600" />人员区域分配</h2><p className="mt-1 text-sm text-slate-500">选择成员后配置主区域与协作区域。</p>
        <label className="mt-4 block text-sm font-medium text-slate-700">成员<select value={selectedMemberId} onChange={(event) => { const member = members.find((item) => item.id === event.target.value); if (member) chooseMember(member); else setSelectedMemberId('') }} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="">请选择成员</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}{member.status !== 'active' ? '（已停用账号）' : ''}</option>)}</select></label>
        {selectedMemberId && <div className="mt-4 grid gap-2">{regions.filter((region) => region.isActive || selectedRegionIds.includes(region.id)).map((region) => { const checked = selectedRegionIds.includes(region.id); return <div key={region.id} className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border p-3 ${checked ? 'border-indigo-200 bg-indigo-50/60' : 'border-slate-200'}`}><input aria-label={`分配${region.name}`} type="checkbox" checked={checked} onChange={() => toggleRegion(region.id)} className="h-4 w-4 accent-indigo-600" /><div><strong className="text-sm text-slate-800">{region.name}</strong><span className="ml-2 text-xs text-slate-400">{region.code}</span>{!region.isActive && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">已停用，请移除</span>}</div><button disabled={!checked || !region.isActive} onClick={() => setPrimaryRegionId(region.id)} className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium disabled:opacity-35 ${primaryRegionId === region.id ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>{primaryRegionId === region.id && <Check size={14} />}{primaryRegionId === region.id ? '主区域' : '设为主区域'}</button></div>})}<button disabled={busy} onClick={() => void saveAssignments()} className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"><Save size={17} />保存人员区域</button></div>}
      </section>
    </div>
    {draft && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="region-dialog-title"><div className="w-full max-w-lg rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6"><div className="flex items-center justify-between"><h2 id="region-dialog-title" className="text-xl font-semibold text-slate-900">{draft.id ? '编辑区域' : '新增区域'}</h2><button aria-label="关闭" onClick={() => setDraft(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">区域编码<input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} placeholder="例如 YZ_HD" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 uppercase" /></label><label className="text-sm font-medium text-slate-700">区域名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如 邗江区" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3" /></label><label className="text-sm font-medium text-slate-700">区域级别<select value={draft.regionLevel} onChange={(event) => setDraft({ ...draft, regionLevel: event.target.value as RegionLevel })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3">{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-medium text-slate-700">上级区域<select value={draft.parentId ?? ''} onChange={(event) => setDraft({ ...draft, parentId: event.target.value || null })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="">无上级</option>{activeRegions.filter((region) => region.id !== draft.id).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select></label></div><label className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 p-3 text-sm font-medium text-slate-700"><span><strong className="block">启用状态</strong><small className="font-normal text-slate-500">停用后不能分配给新成员</small></span><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} className="h-5 w-5 accent-emerald-600" /></label><div className="mt-5 flex gap-3"><button onClick={() => setDraft(null)} className="min-h-11 flex-1 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700">取消</button><button disabled={busy} onClick={() => void saveRegion()} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-semibold text-white disabled:opacity-50"><Save size={17} />保存</button></div></div></div>}
  </section>
}
