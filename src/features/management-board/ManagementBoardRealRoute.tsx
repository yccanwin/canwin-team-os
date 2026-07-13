import { useEffect, useState } from 'react'
import { AlertTriangle, Clock3 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { SupervisorExceptionRecord } from './dataSource'
import { createSupabaseManagementBoardDataSource } from './supabaseDataSource'
import { ManagementOperationsPanels } from './ManagementOperationsPanels'

const dataSource = createSupabaseManagementBoardDataSource(supabase)
const typeLabels: Record<string, string> = { action_exception: '逾期/阻塞异常', closing_opportunity: '已报价 · 7天内决策' }

export default function ManagementBoardRealRoute() {
  const [items, setItems] = useState<SupervisorExceptionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SupervisorExceptionRecord | null>(null)
  const [resolutionDueAt, setResolutionDueAt] = useState('')
  const [resolutionNote, setResolutionNote] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const load = () => {
    let cancelled = false
    setLoading(true); setError(null)
    dataSource.listExceptions().then(rows => { if (!cancelled) setItems(rows) }).catch(caught => { if (!cancelled) setError(caught instanceof Error ? caught.message : '读取真实主管板失败') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }
  useEffect(() => {
    let cleanup: (() => void) | undefined
    queueMicrotask(() => { cleanup = load() })
    return () => cleanup?.()
  }, [])
  const submitResolution = async () => {
    if (!selected || !resolutionDueAt || !resolutionNote.trim()) return
    setLoading(true); setError(null); setNotice(null)
    try {
      await dataSource.resolveException({ itemType: selected.itemType, entityId: selected.entityId, ownerId: selected.ownerId, dueAt: new Date(resolutionDueAt).toISOString(), note: resolutionNote.trim(), idempotencyKey: crypto.randomUUID() })
      setNotice('处置已由服务器记录，正在重新读取主管板'); setSelected(null); setResolutionDueAt(''); setResolutionNote('')
      const rows = await dataSource.listExceptions(); setItems(rows)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '提交真实处置失败') } finally { setLoading(false) }
  }

  return <section className="min-h-screen bg-slate-50 p-4 md:p-6">
    <header className="mb-5"><p className="text-sm font-medium text-indigo-600">两天一次销售会</p><h1 className="text-2xl font-bold text-slate-900">主管异常与临门商机板</h1><p className="mt-1 text-sm text-slate-500">只看逾期、阻塞、已报价且0–7天内决策商机；每条必须留下负责人和完成期限。</p></header>
    {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {loading && <p className="text-sm text-slate-500">正在加载真实异常…</p>}
    {!loading && !error && items.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">当前没有主管可见异常</p>}
    <div className="grid gap-3 lg:grid-cols-2">{items.map((item, index) => <article key={`${item.entityType}-${item.dueAt}-${index}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex justify-between gap-2"><h2 className="font-semibold text-slate-900">{item.title}</h2><span className="rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-700">{typeLabels[item.entityType] ?? item.actionType}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-600"><p>负责人：{item.ownerName}</p><p className="flex items-center gap-1"><Clock3 size={15}/>期限：{new Date(item.dueAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p></div><p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800"><AlertTriangle size={16}/>{item.actionType} · {item.urgency}</p><button type="button" onClick={() => { setSelected(item); setResolutionNote(''); setResolutionDueAt('') }} className="mt-3 rounded-lg border border-indigo-200 px-3 py-2 text-sm text-indigo-700">制定处置</button></article>)}</div>
    {selected && <div className="mt-4 max-w-xl rounded-xl border border-indigo-200 bg-white p-4"><h2 className="font-semibold">处置：{selected.title}</h2><label className="mt-3 block text-sm">负责人<input value={selected.ownerName} readOnly className="mt-1 w-full rounded-lg border bg-slate-50 px-3 py-2"/></label><label className="mt-3 block text-sm">完成期限<input type="datetime-local" value={resolutionDueAt} onChange={e => setResolutionDueAt(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2"/></label><label className="mt-3 block text-sm">处置说明<textarea value={resolutionNote} onChange={e => setResolutionNote(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" rows={3}/></label><div className="mt-3 flex gap-2"><button disabled={loading || !resolutionDueAt || !resolutionNote.trim()} onClick={() => void submitResolution()} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">RPC提交处置</button><button onClick={() => setSelected(null)} className="rounded-lg border px-3 py-2 text-sm">取消</button></div></div>}
    <a href="#/notifications-v3" className="mt-5 inline-flex rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-indigo-700">查看企业微信提醒状态</a>
    <ManagementOperationsPanels dataSource={dataSource}/>
  </section>
}
