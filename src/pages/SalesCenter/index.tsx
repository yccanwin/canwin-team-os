import { useEffect, useMemo, useRef, useState } from 'react'
import { Award, BarChart3, ChevronRight, PackageOpen, Target, TrendingUp, Users, X } from 'lucide-react'
import { performanceCenterDataSource } from '@/features/performance-center/dataSource'
import type {
  ContributionOrder,
  PerformanceCenterSnapshot,
  PerformanceMember,
  PerformanceScope,
  ProductContribution,
} from '@/features/performance-center/types'
import { SalesMeetingPanel } from '@/features/management-board/SalesMeetingPanel'
import { supabase } from '@/lib/supabase'

const money = (value: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 }).format(value)
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
const rate = (actual: number, target: number) => target > 0 ? Math.min(999, Math.round(actual / target * 100)) : 0

function currentQuarter() {
  const now = new Date()
  const quarter = Math.floor(now.getMonth() / 3) + 1
  const month = (quarter - 1) * 3
  return {
    start: `${now.getFullYear()}-${String(month + 1).padStart(2, '0')}-01`,
    label: `${now.getFullYear()} Q${quarter} · ${month + 1}月 / ${month + 2}月 / ${month + 3}月`,
  }
}

const EMPTY_SNAPSHOT: PerformanceCenterSnapshot | null = null

function targetDraftFromMember(member: PerformanceMember) {
  return {
    points: String(member.pointsTarget),
    newGmv: String(member.newGmvTarget),
    renewalGmv: String(member.renewalGmvTarget),
  }
}

export default function SalesCenterPage() {
  const quarter = useMemo(() => currentQuarter(), [])
  const [scope, setScope] = useState<PerformanceScope>('personal')
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [managedMembers, setManagedMembers] = useState<PerformanceMember[]>([])
  const [snapshot, setSnapshot] = useState<PerformanceCenterSnapshot | null>(EMPTY_SNAPSHOT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [canRetryLoad, setCanRetryLoad] = useState(false)
  const [message, setMessage] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [targetOpen, setTargetOpen] = useState(false)
  const targetOpenRef = useRef(false)
  const [savingTarget, setSavingTarget] = useState(false)
  const [targets, setTargets] = useState({ points: '0', newGmv: '0', renewalGmv: '0' })

  useEffect(() => {
    let cancelled = false
    let followupLoad = false
    void performanceCenterDataSource.loadSnapshot({
      quarterStart: quarter.start,
      scope,
      profileId: scope === 'personal' ? selectedProfileId ?? undefined : undefined,
    }).then((next) => {
      if (cancelled) return
      setSnapshot(next)
      if (next.viewer.effectiveScope !== scope) {
        followupLoad = true
        setScope(next.viewer.effectiveScope)
      }
      if (next.viewer.effectiveScope === 'team') {
        const nextManagedMembers = next.members.filter((member) => member.canSetTarget)
        setManagedMembers(nextManagedMembers)
        if (targetOpenRef.current && nextManagedMembers.length > 0) {
          const nextMember = nextManagedMembers.find((member) => member.profileId === selectedProfileId)
            ?? nextManagedMembers[0]
          followupLoad = true
          setTargets(targetDraftFromMember(nextMember))
          setSelectedProfileId(nextMember.profileId)
          setScope('personal')
        }
      } else {
        const nextMember = next.members.find((member) => member.profileId === next.viewer.selectedProfileId)
        if (nextMember) setTargets(targetDraftFromMember(nextMember))
      }
    }).catch((caught) => {
      if (cancelled) return
      setSnapshot(null)
      setCanRetryLoad(true)
      setError(caught instanceof Error ? caught.message : '读取业绩与积分失败')
    }).finally(() => {
      if (!cancelled && !followupLoad) setLoading(false)
    })
    return () => { cancelled = true }
  }, [quarter.start, refreshVersion, scope, selectedProfileId])

  const canManageTargets = snapshot?.viewer.canManageTargets ?? false
  const selectableMembers = useMemo(() => {
    const rows = managedMembers.length > 0
      ? managedMembers
      : snapshot?.viewer.effectiveScope === 'team'
        ? snapshot.members.filter((member) => member.canSetTarget)
        : []
    return rows.filter((member, index, all) => all.findIndex((candidate) => candidate.profileId === member.profileId) === index)
  }, [managedMembers, snapshot])
  const selectedMember = useMemo(() => {
    if (!selectedProfileId) return null
    return snapshot?.members.find((member) => member.profileId === selectedProfileId)
      ?? selectableMembers.find((member) => member.profileId === selectedProfileId)
      ?? null
  }, [selectableMembers, selectedProfileId, snapshot])

  const summary = snapshot?.summary
  const hasVisiblePerformance = Boolean(
    snapshot
    && (snapshot.viewer.effectiveScope === 'team' || snapshot.viewer.selectedProfileId !== null),
  )
  const members = snapshot?.members ?? []
  const products = snapshot?.products ?? []
  const orders = snapshot?.orders ?? []
  const cards = [
    { label: '季度积分', actual: summary?.points.actual ?? 0, target: summary?.points.target ?? 0, icon: Award, color: 'from-blue-600 to-cyan-400', format: number },
    { label: '新签 GMV', actual: summary?.newGmv.actual ?? 0, target: summary?.newGmv.target ?? 0, icon: TrendingUp, color: 'from-emerald-500 to-cyan-400', format: money },
    { label: '续费 GMV', actual: summary?.renewalGmv.actual ?? 0, target: summary?.renewalGmv.target ?? 0, icon: Target, color: 'from-orange-500 to-amber-300', format: money },
  ]
  const comprehensive = Math.round(cards.reduce((sum, item) => sum + rate(item.actual, item.target), 0) / cards.length)

  function prepareSnapshotLoad() {
    setLoading(true)
    setError('')
    setCanRetryLoad(false)
  }

  function openTargetEditor() {
    prepareSnapshotLoad()
    setMessage('')
    targetOpenRef.current = true
    setTargetOpen(true)
    setSelectedProfileId(null)
    setScope('team')
    setRefreshVersion((value) => value + 1)
  }

  function changeScope(nextScope: PerformanceScope) {
    if (nextScope === scope && !targetOpen && selectedProfileId === null) return
    prepareSnapshotLoad()
    targetOpenRef.current = false
    setTargetOpen(false)
    setMessage('')
    setSelectedProfileId(null)
    setScope(nextScope)
  }

  function changeTargetMember(profileId: string) {
    const nextMember = selectableMembers.find((member) => member.profileId === profileId)
    if (nextMember) setTargets(targetDraftFromMember(nextMember))
    prepareSnapshotLoad()
    setSelectedProfileId(profileId)
    setScope('personal')
  }

  function closeTargetEditor() {
    targetOpenRef.current = false
    setTargetOpen(false)
  }

  function retrySnapshotLoad() {
    prepareSnapshotLoad()
    setRefreshVersion((value) => value + 1)
  }

  async function saveTargets() {
    if (!selectedMember?.canSetTarget) return
    const pointsTarget = Number(targets.points)
    const newGmvTarget = Number(targets.newGmv)
    const renewalGmvTarget = Number(targets.renewalGmv)
    if (![pointsTarget, newGmvTarget, renewalGmvTarget].every((value) => Number.isFinite(value) && value >= 0)) {
      setCanRetryLoad(false)
      setError('目标必须是大于或等于 0 的数字')
      return
    }
    setSavingTarget(true)
    setError('')
    setCanRetryLoad(false)
    setMessage('')
    try {
      const { error: saveError } = await supabase.rpc('set_quarterly_performance_target', {
        p_profile_id: selectedMember.profileId,
        p_quarter_start: quarter.start,
        p_points_target: pointsTarget,
        p_new_gmv_target: newGmvTarget,
        p_renewal_gmv_target: renewalGmvTarget,
      })
      if (saveError) {
        setError(`保存季度目标失败：${saveError.message}`)
        return
      }
      setMessage(`已保存 ${selectedMember.profileName} 的季度目标；实际业绩仍只由订单生成。`)
      prepareSnapshotLoad()
      setRefreshVersion((value) => value + 1)
    } catch (caught) {
      setError(`保存季度目标失败：${caught instanceof Error ? caught.message : '网络请求异常'}`)
    } finally {
      setSavingTarget(false)
    }
  }

  return <div className="mx-auto max-w-[1500px] px-3 py-5 lg:px-5">
    <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-400 text-white shadow-lg shadow-cyan-500/20"><BarChart3 /></span>
        <div><h1 className="font-heading text-2xl font-semibold text-slate-950">业绩与积分</h1><p className="text-sm text-slate-500">订单自动采集 · {quarter.label}</p></div>
      </div>
      <div className="flex flex-wrap gap-2">
        {canManageTargets && <div className="flex rounded-xl border border-slate-200 bg-white p-1">{(['personal', 'team'] as const).map((value) => <button type="button" key={value} onClick={() => changeScope(value)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${scope === value && !targetOpen ? 'bg-blue-600 text-white' : 'text-slate-500'}`}>{value === 'personal' ? '我的业绩' : '团队业绩'}</button>)}</div>}
        {canManageTargets && <button type="button" onClick={openTargetEditor} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">设置个人目标</button>}
      </div>
    </header>

    <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><b>目标可设置，实际不可手填。</b><span className="ml-2">积分、新签 GMV、续费 GMV 只统计满足条件的订单；退款或取消会自动撤回。</span></div>
    {error && <div role="alert" className="mb-5 flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"><span>{error}</span>{canRetryLoad && <button type="button" onClick={retrySnapshotLoad} className="min-h-10 shrink-0 rounded-lg border border-red-200 bg-white px-4 font-semibold text-red-700 hover:bg-red-100">重新读取</button>}</div>}
    {message && <div role="status" className="mb-5 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">{message}</div>}

    {targetOpen && <TargetEditor
      members={selectableMembers}
      selectedProfileId={selectedProfileId}
      targets={targets}
      busy={savingTarget || loading}
      onMemberChange={changeTargetMember}
      onTargetChange={(key, value) => setTargets((state) => ({ ...state, [key]: value }))}
      onSave={() => void saveTargets()}
      onClose={closeTargetEditor}
    />}

    {loading && <div className="mb-5 rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">{snapshot ? '正在刷新订单业绩…' : '正在读取订单业绩…'}</div>}

    {snapshot && !hasVisiblePerformance && <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-5 text-sm text-blue-900"><b>当前账号未配置销售身份，没有个人业绩。</b><p className="mt-1 text-blue-700">可切换到“团队业绩”查看销售数据，或通过“设置个人目标”选择具体销售人员。</p></div>}

    {snapshot && hasVisiblePerformance && <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((item) => <button type="button" key={item.label} onClick={() => setDrawerOpen(true)} className="rounded-2xl border border-cyan-100 bg-white p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-lg"><div className="flex items-center gap-3"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${item.color} text-white`}><item.icon size={20}/></span><div className="min-w-0"><p className="text-sm text-slate-500">{item.label}</p><p className="truncate text-xl font-semibold text-slate-950">{item.format(item.actual)} <span className="text-sm font-normal text-slate-400">/ {item.format(item.target)}</span></p></div></div><div className="mt-4 h-2 rounded-full bg-slate-100"><div className={`h-full rounded-full bg-gradient-to-r ${item.color}`} style={{ width: `${Math.min(rate(item.actual, item.target), 100)}%` }} /></div><p className="mt-2 flex justify-between text-xs text-slate-500"><span>查看贡献订单</span><b className="text-blue-600">{rate(item.actual, item.target)}%</b></p></button>)}
        <button type="button" onClick={() => setDrawerOpen(true)} className="rounded-2xl border border-violet-100 bg-gradient-to-br from-white to-violet-50 p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-lg"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-500 text-white"><Award size={20}/></span><div><p className="text-sm text-slate-500">综合达成率</p><p className="text-3xl font-semibold text-violet-700">{comprehensive}%</p></div></div><p className="mt-5 text-xs text-slate-500">积分、新签、续费三项平均</p></button>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <Panel icon={Users} title={snapshot.viewer.effectiveScope === 'team' ? '团队业绩排行' : '个人业绩'}>{members.length ? <MemberTable rows={members}/> : <Empty text="当前季度暂无已计入业绩的订单" />}</Panel>
        <Panel icon={PackageOpen} title="产品贡献 TOP5">{products.length ? <ProductList rows={products}/> : <Empty text="当前季度暂无产品贡献" />}</Panel>
      </div>
      {drawerOpen && <OrderDrawer orders={orders} onClose={() => setDrawerOpen(false)} />}
    </>}
    {snapshot && canManageTargets && <SalesMeetingPanel className="mt-5" />}
  </div>
}

type TargetDraft = { points: string; newGmv: string; renewalGmv: string }

function TargetEditor({ members, selectedProfileId, targets, busy, onMemberChange, onTargetChange, onSave, onClose }: {
  members: PerformanceMember[]
  selectedProfileId: string | null
  targets: TargetDraft
  busy: boolean
  onMemberChange: (profileId: string) => void
  onTargetChange: (key: keyof TargetDraft, value: string) => void
  onSave: () => void
  onClose: () => void
}) {
  return <section className="relative mb-5 overflow-hidden rounded-2xl border border-cyan-100 bg-white p-4 shadow-card md:p-5">
    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-cyan-400 to-emerald-400" />
    <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold text-slate-950">设置个人季度目标</h2><p className="mt-1 text-xs text-slate-500">选择一名有权管理的销售；保存只更新目标，不改变订单生成的实际业绩。</p></div><button type="button" aria-label="关闭目标设置" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18}/></button></div>
    {members.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">{busy ? '正在读取可管理的销售人员…' : '没有可设置目标的销售人员'}</p> : <>
      <label className="mt-4 block text-sm font-medium text-slate-700">销售人员<select value={selectedProfileId ?? ''} onChange={(event) => onMemberChange(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 md:max-w-sm">{members.map((member) => <option key={member.profileId} value={member.profileId}>{member.profileName}</option>)}</select></label>
      <div className="mt-4 grid gap-3 md:grid-cols-3">{([['points', '积分目标'], ['newGmv', '新签 GMV 目标'], ['renewalGmv', '续费 GMV 目标']] as const).map(([key, label]) => <label key={key} className="text-sm text-slate-600">{label}<input type="number" inputMode="decimal" min="0" value={targets[key]} onChange={(event) => onTargetChange(key, event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3" /></label>)}</div>
      <button type="button" disabled={busy || !selectedProfileId} onClick={onSave} className="mt-4 w-full rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 md:w-auto">{busy ? '正在保存…' : '保存个人目标'}</button>
    </>}
  </section>
}

function Panel({ icon: Icon, title, children }: { icon: typeof Users; title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card md:p-5"><h2 className="flex items-center gap-2 font-semibold text-slate-950"><Icon size={18} className="text-blue-600"/>{title}</h2><div className="mt-4">{children}</div></section>
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">{text}</div>
}

function MemberTable({ rows }: { rows: PerformanceMember[] }) {
  return <div className="space-y-2">{rows.map((row, index) => <article key={row.profileId} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><b className="text-slate-400">#{index + 1}</b><span className="truncate font-semibold text-slate-900">{row.profileName}</span></div><span className="whitespace-nowrap font-semibold text-blue-600">{number(row.points)} 分</span></div><div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-3"><span>积分目标 {number(row.pointsTarget)}</span><span>新签 {money(row.newGmv)} / {money(row.newGmvTarget)}</span><span className="col-span-2 sm:col-span-1">续费 {money(row.renewalGmv)} / {money(row.renewalGmvTarget)}</span></div></article>)}</div>
}

function ProductList({ rows }: { rows: ProductContribution[] }) {
  return <div className="space-y-3">{rows.slice(0, 5).map((row) => <div key={`${row.catalogItemId}-${row.productName}`} className="rounded-xl bg-slate-50 p-3"><div className="flex justify-between gap-3 text-sm"><b>{row.productName}</b><span className="whitespace-nowrap">{number(row.points)} 分 · {money(row.gmv)}</span></div><p className="mt-1 text-xs text-slate-500">{row.orderCount} 单 / {row.quantity} 件</p></div>)}</div>
}

const orderStatusLabel = { counted: '已计入', reversed: '已撤回', restored: '已恢复' } as const

function OrderDrawer({ orders, onClose }: { orders: ContributionOrder[]; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" role="dialog" aria-modal="true"><div className="h-full w-full max-w-xl overflow-y-auto bg-white p-4 shadow-2xl md:p-5"><div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold">贡献订单</h2><p className="text-sm text-slate-500">核对业绩与积分来源；已撤回订单不进入汇总。</p></div><button type="button" aria-label="关闭" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100"><X/></button></div><div className="mt-5">{orders.length ? orders.map((order) => <article key={order.orderId} className={`mb-3 rounded-xl border p-4 ${order.status === 'reversed' ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-cyan-100 bg-white'}`}><div className="flex justify-between gap-3"><b>{order.orderNumber}</b><span className={order.status === 'reversed' ? 'text-slate-500' : 'text-emerald-700'}>{orderStatusLabel[order.status]}</span></div><p className="mt-1">{order.customerName}</p><p className="mt-1 text-sm text-slate-500">{order.salespersonName} · {order.saleType === 'new' ? '新签' : '续费'} · {money(order.gmv)} · {number(order.points)} 分</p></article>) : <Empty text="当前筛选没有贡献订单" />}</div><button type="button" onClick={onClose} className="mt-5 flex items-center gap-1 text-sm font-semibold text-blue-600">返回业绩中心<ChevronRight size={16}/></button></div></div>
}
