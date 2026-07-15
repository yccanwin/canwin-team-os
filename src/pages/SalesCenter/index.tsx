import { useMemo, useState } from 'react'
import { Award, BarChart3, ChevronRight, PackageOpen, Target, TrendingUp, Users, X } from 'lucide-react'
import { performanceCenterDataSource } from '@/features/performance-center/dataSource'
import type { ContributionOrder, PerformanceMember, ProductContribution } from '@/features/performance-center/types'
import { SalesMeetingPanel } from '@/features/management-board/SalesMeetingPanel'
import { isCaptainRole } from '@/services/profile'
import { useSalesStore } from '@/stores/useSalesStore'
import { useUserStore } from '@/stores/useUserStore'

const money = (value: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 }).format(value)
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
const rate = (actual: number, target: number) => target > 0 ? Math.min(999, Math.round(actual / target * 100)) : 0

function currentQuarter() {
  const now = new Date(); const quarter = Math.floor(now.getMonth() / 3) + 1; const month = (quarter - 1) * 3
  return { key: `${now.getFullYear()}-Q${quarter}`, start: `${now.getFullYear()}-${String(month + 1).padStart(2, '0')}-01`, label: `${now.getFullYear()} Q${quarter} · ${month + 1}月 / ${month + 2}月 / ${month + 3}月` }
}

const EMPTY_ORDERS: ContributionOrder[] = []
const EMPTY_MEMBERS: PerformanceMember[] = []
const EMPTY_PRODUCTS: ProductContribution[] = []

export default function SalesCenterPage() {
  const currentUser = useUserStore((state) => state.currentUser)
  const assessments = useSalesStore((state) => state.assessments)
  const upsertAssessment = useSalesStore((state) => state.upsertAssessment)
  const quarter = useMemo(() => currentQuarter(), [])
  const canManage = isCaptainRole(currentUser?.role)
  const assessment = assessments.find((item) => item.periodQuarter === quarter.key)
  const [scope, setScope] = useState<'personal' | 'team'>(canManage ? 'team' : 'personal')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [targetOpen, setTargetOpen] = useState(false)
  const [targets, setTargets] = useState({ points: assessment?.pointTarget ?? 0, newGmv: assessment?.newGmvTarget ?? 0, renewalGmv: assessment?.renewalGmvTarget ?? 0 })
  const [message, setMessage] = useState('')

  // Until the order-performance RPC lands, actuals stay empty by design.
  const connected = performanceCenterDataSource !== null
  const actual = { points: 0, newGmv: 0, renewalGmv: 0 }
  const members = EMPTY_MEMBERS
  const products = EMPTY_PRODUCTS
  const orders = EMPTY_ORDERS

  const cards = [
    { label: '季度积分', actual: actual.points, target: targets.points, icon: Award, color: 'from-blue-600 to-cyan-400', format: number },
    { label: '新签 GMV', actual: actual.newGmv, target: targets.newGmv, icon: TrendingUp, color: 'from-emerald-500 to-cyan-400', format: money },
    { label: '续费 GMV', actual: actual.renewalGmv, target: targets.renewalGmv, icon: Target, color: 'from-orange-500 to-amber-300', format: money },
  ]
  const comprehensive = Math.round(cards.reduce((sum, item) => sum + rate(item.actual, item.target), 0) / cards.length)

  async function saveTargets() {
    if (!canManage || !currentUser) return
    setMessage('')
    try {
      await upsertAssessment({
        periodQuarter: quarter.key,
        salespersonIds: assessment?.salespersonIds ?? [],
        pointTarget: targets.points,
        newGmvTarget: targets.newGmv,
        renewalGmvTarget: targets.renewalGmv,
        newGmvActual: assessment?.newGmvActual ?? 0,
        renewalGmvActual: assessment?.renewalGmvActual ?? 0,
        updatedBy: currentUser.id,
      })
      setTargetOpen(false); setMessage('季度目标已保存；实际完成值仍只读取订单。')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }

  return <div className="mx-auto max-w-[1500px] px-3 py-5 lg:px-5">
    <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-400 text-white shadow-lg shadow-cyan-500/20"><BarChart3 /></span><div><h1 className="font-heading text-2xl font-semibold text-slate-950">业绩与积分</h1><p className="text-sm text-slate-500">订单自动采集 · {quarter.label}</p></div></div>
      <div className="flex flex-wrap gap-2">
        {canManage && <div className="flex rounded-xl border border-slate-200 bg-white p-1">{(['personal','team'] as const).map(value => <button key={value} onClick={() => setScope(value)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${scope === value ? 'bg-blue-600 text-white' : 'text-slate-500'}`}>{value === 'personal' ? '个人' : '团队'}</button>)}</div>}
        {canManage && <button onClick={() => setTargetOpen(value => !value)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">设置季度目标</button>}
      </div>
    </header>

    {!connected && <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><b>等待订单数据联动</b><span className="ml-2">业绩、积分和排行不会读取旧手工记录；数据接口上线后自动显示。</span></div>}
    {message && <div className="mb-5 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">{message}</div>}

    {targetOpen && <section className="mb-5 rounded-2xl border border-cyan-100 bg-white p-5 shadow-card"><h2 className="font-semibold">季度目标</h2><p className="mt-1 text-xs text-slate-500">仅目标可手工设置，实际完成值由订单生成。</p><div className="mt-4 grid gap-3 md:grid-cols-3">{([['points','积分目标'],['newGmv','新签 GMV 目标'],['renewalGmv','续费 GMV 目标']] as const).map(([key,label]) => <label key={key} className="text-sm text-slate-600">{label}<input type="number" min="0" value={targets[key]} onChange={event => setTargets(state => ({...state,[key]: Number(event.target.value)}))} className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3" /></label>)}</div><button onClick={() => void saveTargets()} className="mt-4 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white">保存目标</button></section>}

    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {cards.map(item => <button key={item.label} onClick={() => setDrawerOpen(true)} className="rounded-2xl border border-cyan-100 bg-white p-4 text-left shadow-card"><div className="flex items-center gap-3"><span className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${item.color} text-white`}><item.icon size={20}/></span><div><p className="text-sm text-slate-500">{item.label}</p><p className="text-xl font-semibold text-slate-950">{item.format(item.actual)} <span className="text-sm font-normal text-slate-400">/ {item.format(item.target)}</span></p></div></div><div className="mt-4 h-2 rounded-full bg-slate-100"><div className={`h-full rounded-full bg-gradient-to-r ${item.color}`} style={{width:`${Math.min(rate(item.actual,item.target),100)}%`}} /></div><p className="mt-2 flex justify-between text-xs text-slate-500"><span>查看贡献订单</span><b className="text-blue-600">{rate(item.actual,item.target)}%</b></p></button>)}
      <button onClick={() => setDrawerOpen(true)} className="rounded-2xl border border-violet-100 bg-gradient-to-br from-white to-violet-50 p-4 text-left shadow-card"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-500 text-white"><Award size={20}/></span><div><p className="text-sm text-slate-500">综合达成率</p><p className="text-3xl font-semibold text-violet-700">{comprehensive}%</p></div></div><p className="mt-5 text-xs text-slate-500">积分、新签、续费三项平均</p></button>
    </section>

    <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <Panel icon={Users} title={scope === 'team' ? '团队业绩排行' : '个人业绩'}>{members.length ? <MemberTable rows={members}/> : <Empty text={connected ? '当前季度暂无已计入业绩的订单' : '订单数据接口上线后显示销售排行'} />}</Panel>
      <Panel icon={PackageOpen} title="产品贡献 TOP5">{products.length ? <ProductList rows={products}/> : <Empty text={connected ? '当前季度暂无产品贡献' : '订单数据接口上线后按订单快照汇总产品贡献'} />}</Panel>
    </div>

    <SalesMeetingPanel className="mt-5" />
    {drawerOpen && <OrderDrawer orders={orders} connected={connected} onClose={() => setDrawerOpen(false)} />}
  </div>
}

function Panel({icon:Icon,title,children}:{icon:typeof Users;title:string;children:React.ReactNode}) { return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><h2 className="flex items-center gap-2 font-semibold text-slate-950"><Icon size={18} className="text-blue-600"/>{title}</h2><div className="mt-4">{children}</div></section> }
function Empty({text}:{text:string}) { return <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">{text}</div> }
function MemberTable({rows}:{rows:PerformanceMember[]}) { return <div>{rows.map((row,index) => <div key={row.profileId} className="grid grid-cols-[44px_1fr_auto] items-center border-b border-slate-100 py-3 text-sm"><b className="text-slate-400">#{index+1}</b><span>{row.profileName}</span><span className="font-semibold text-blue-600">{number(row.points)} 分</span></div>)}</div> }
function ProductList({rows}:{rows:ProductContribution[]}) { return <div className="space-y-3">{rows.slice(0,5).map(row => <div key={`${row.catalogItemId}-${row.productName}`}><div className="flex justify-between text-sm"><b>{row.productName}</b><span>{number(row.points)} 分 · {money(row.gmv)}</span></div><p className="mt-1 text-xs text-slate-500">{row.orderCount} 单 / {row.quantity} 件</p></div>)}</div> }
function OrderDrawer({orders,connected,onClose}:{orders:ContributionOrder[];connected:boolean;onClose:()=>void}) { return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" role="dialog" aria-modal="true"><div className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold">贡献订单</h2><p className="text-sm text-slate-500">核对业绩与积分来源</p></div><button aria-label="关闭" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100"><X/></button></div><div className="mt-5">{orders.length ? orders.map(order => <article key={order.orderId} className="mb-3 rounded-xl border p-4"><div className="flex justify-between"><b>{order.orderNumber}</b><span>{order.status}</span></div><p>{order.customerName}</p><p className="text-sm text-slate-500">{order.salespersonName} · {money(order.gmv)} · {number(order.points)} 分</p></article>) : <Empty text={connected ? '当前筛选没有贡献订单' : '订单数据接口上线后可在此核对计入、撤回和恢复记录'} />}</div><button onClick={onClose} className="mt-5 flex items-center gap-1 text-sm font-semibold text-blue-600">返回业绩中心<ChevronRight size={16}/></button></div></div> }
