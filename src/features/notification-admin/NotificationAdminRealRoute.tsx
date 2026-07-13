import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BellRing, CheckCircle2, RefreshCw, ShieldAlert } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { NotificationStatusRecord } from './dataSource'
import { createSupabaseNotificationAdminDataSource } from './supabaseDataSource'

const dataSource = createSupabaseNotificationAdminDataSource(supabase)
const jobLabels: Record<NotificationStatusRecord['jobType'], string> = {
  daily_summary: '09:30 个人摘要',
  appointment_day_before: '预约前一天 10:00',
  appointment_2h: '预约前 2 小时',
}
const statusLabels: Record<NotificationStatusRecord['status'], string> = { pending: '待发送', processing: '发送中', retry: '等待重试', sent: '已发送', failed: '发送失败' }

const beijing = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })

export default function NotificationAdminRealRoute() {
  const [rows, setRows] = useState<NotificationStatusRecord[]>([])
  const [filter, setFilter] = useState<'all' | NotificationStatusRecord['status']>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setRows(await dataSource.listStatus()) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '读取企业微信通知状态失败') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) void load() })
    return () => { cancelled = true }
  }, [load])
  const visibleRows = useMemo(() => filter === 'all' ? rows : rows.filter(row => row.status === filter), [filter, rows])
  const channelConfigured = rows.length > 0 && rows.some(row => row.channelConfigured)
  const lastWorkerAt = rows.map(row => row.lastWorkerAt).filter((value): value is string => Boolean(value)).sort().at(-1)

  const retry = async (row: NotificationStatusRecord) => {
    setRetrying(row.jobId); setError(null); setNotice(null)
    try {
      await dataSource.retryOnce(row.jobId, crypto.randomUUID())
      setNotice('已提交一次人工重试。系统仍按最多 5 次自动尝试执行，不会无限循环。')
      await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '人工重试失败') }
    finally { setRetrying(null) }
  }

  return <section className="min-h-screen bg-slate-50 p-4 md:p-6">
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><a href="#/management-v3" className="mb-2 inline-flex items-center gap-1 text-sm text-indigo-700"><ArrowLeft size={16}/>返回主管工作台</a><p className="text-sm font-medium text-indigo-600">后台运营状态</p><h1 className="text-2xl font-bold text-slate-900">企业微信提醒</h1><p className="mt-1 text-sm text-slate-500">仅显示发送状态和必要错误，不展示客户电话、金额或利润。</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50"><RefreshCw size={16}/>刷新</button>
    </header>

    <div className={`mb-4 rounded-xl border p-4 ${channelConfigured ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-start gap-3">{channelConfigured ? <CheckCircle2 className="text-emerald-700"/> : <ShieldAlert className="text-amber-700"/>}<div><h2 className="font-semibold text-slate-900">{channelConfigured ? '服务端通道已配置' : '通道未上报或安全停用'}</h2><p className="mt-1 text-sm text-slate-600">密钥只保存在服务端环境变量。{lastWorkerAt ? `最近工作时间：${beijing(lastWorkerAt)}` : '尚无工作记录。'}</p></div></div>
    </div>

    {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1">{(['all', 'failed', 'retry', 'pending', 'sent'] as const).map(item => <button key={item} type="button" onClick={() => setFilter(item)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${filter === item ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>{item === 'all' ? '全部' : statusLabels[item]}</button>)}</div>

    {loading && <p className="text-sm text-slate-500">正在读取通知状态…</p>}
    {!loading && visibleRows.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"><BellRing className="mx-auto mb-2 text-slate-400"/><p className="text-sm text-slate-500">当前没有符合条件的通知记录</p></div>}
    <div className="grid gap-3 lg:grid-cols-2">{visibleRows.map(row => <article key={row.jobId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{row.recipientName}</h2><p className="mt-1 text-sm text-slate-500">{jobLabels[row.jobType]}</p></div><span className={`rounded-full px-2.5 py-1 text-xs ${row.status === 'failed' ? 'bg-red-50 text-red-700' : row.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{statusLabels[row.status]}</span></div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-slate-400">计划时间</dt><dd className="text-slate-700">{beijing(row.scheduledFor)}</dd></div><div><dt className="text-slate-400">本轮尝试</dt><dd className="text-slate-700">{row.attemptCount} / 5</dd></div></dl>
      {row.lastError && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{row.lastError}</p>}
      {row.status === 'failed' && <button type="button" onClick={() => void retry(row)} disabled={row.manualRetryUsed || retrying === row.jobId} className="mt-3 rounded-lg border border-indigo-200 px-3 py-2 text-sm text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{row.manualRetryUsed ? '人工重试已使用' : retrying === row.jobId ? '正在提交…' : '人工单次重试'}</button>}
    </article>)}</div>
  </section>
}
