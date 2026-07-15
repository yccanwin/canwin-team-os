import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Clock3 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { ManagementBoardDataSource, SupervisorExceptionRecord } from './dataSource'
import { createSupabaseManagementBoardDataSource } from './supabaseDataSource'

const defaultDataSource = createSupabaseManagementBoardDataSource(supabase)
const typeLabels: Record<string, string> = {
  action_exception: '逾期/阻塞异常',
  closing_opportunity: '已报价 · 7天内决策',
}

type SalesMeetingPanelProps = {
  dataSource?: ManagementBoardDataSource
  className?: string
}

export function SalesMeetingPanel({ dataSource = defaultDataSource, className = '' }: SalesMeetingPanelProps) {
  const [items, setItems] = useState<SupervisorExceptionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SupervisorExceptionRecord | null>(null)
  const [resolutionDueAt, setResolutionDueAt] = useState('')
  const [resolutionNote, setResolutionNote] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await dataSource.listExceptions())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取销售会议失败')
    } finally {
      setLoading(false)
    }
  }, [dataSource])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) void load() })
    return () => { cancelled = true }
  }, [load])

  const submitResolution = async () => {
    if (!selected || !resolutionDueAt || !resolutionNote.trim()) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      await dataSource.resolveException({
        itemType: selected.itemType,
        entityId: selected.entityId,
        ownerId: selected.ownerId,
        dueAt: new Date(resolutionDueAt).toISOString(),
        note: resolutionNote.trim(),
        idempotencyKey: crypto.randomUUID(),
      })
      setNotice('处置已记录，销售会议清单已刷新')
      setSelected(null)
      setResolutionDueAt('')
      setResolutionNote('')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '提交处置失败')
      setLoading(false)
    }
  }

  return (
    <section id="sales-meeting" className={`scroll-mt-6 rounded-[18px] border border-cyan-100 bg-white p-4 shadow-card md:p-5 ${className}`}>
      <header className="mb-4">
        <p className="text-sm font-medium text-indigo-600">两天一次销售会</p>
        <h2 className="font-heading text-xl font-semibold text-slate-950">销售会议</h2>
        <p className="mt-1 text-sm text-slate-500">只看逾期、阻塞、已报价且 0–7 天内决策商机；每条处置必须保留负责人、期限和说明。</p>
      </header>

      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {loading && <p className="text-sm text-slate-500">正在加载销售会议…</p>}
      {!loading && !error && items.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">当前没有可见的逾期、阻塞或临门商机</p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {items.map((item, index) => (
          <article key={`${item.entityType}-${item.entityId}-${item.dueAt}-${index}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex justify-between gap-2">
              <h3 className="font-semibold text-slate-900">{item.title}</h3>
              <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-700">{typeLabels[item.entityType] ?? item.actionType}</span>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
              <p>负责人：{item.ownerName}</p>
              <p className="flex items-center gap-1"><Clock3 size={15} />期限：{new Date(item.dueAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
            </div>
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800"><AlertTriangle size={16} />{item.actionType} · {item.urgency}</p>
            <button type="button" onClick={() => { setSelected(item); setResolutionNote(''); setResolutionDueAt('') }} className="mt-3 rounded-lg border border-indigo-200 px-3 py-2 text-sm text-indigo-700">制定处置</button>
          </article>
        ))}
      </div>

      {selected && (
        <div className="mt-4 max-w-xl rounded-xl border border-indigo-200 bg-white p-4">
          <h3 className="font-semibold">处置：{selected.title}</h3>
          <label className="mt-3 block text-sm">负责人<input value={selected.ownerName} readOnly className="mt-1 w-full rounded-lg border bg-slate-50 px-3 py-2" /></label>
          <label className="mt-3 block text-sm">完成期限<input type="datetime-local" value={resolutionDueAt} onChange={(event) => setResolutionDueAt(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="mt-3 block text-sm">处置说明<textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" rows={3} /></label>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={loading || !resolutionDueAt || !resolutionNote.trim()} onClick={() => void submitResolution()} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">提交处置</button>
            <button type="button" onClick={() => setSelected(null)} className="rounded-lg border px-3 py-2 text-sm">取消</button>
          </div>
        </div>
      )}
    </section>
  )
}
