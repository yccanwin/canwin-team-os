import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  MapPinned,
  ShieldCheck,
  Sparkles,
  Warehouse,
} from 'lucide-react'
import { useAppContextStore } from '@/features/app-shell/useAppContextStore'
import type { PrimaryRoleId } from '@/features/app-shell/types'

const ROLE_PRESENTATION: Record<PrimaryRoleId, { label: string; headline: string; description: string; accent: string }> = {
  sales: {
    label: '销售',
    headline: '先处理今天最接近成交和续费的事项',
    description: '线索、客户、商机、报价、订单与回款协作只按本人和授权区域展开。',
    accent: 'from-cyan-500 to-blue-600',
  },
  implementation: {
    label: '实施',
    headline: '把待排期、安装、培训与验收顺序推进',
    description: '这里只汇总分配给你的订单、门店和交付异常。',
    accent: 'from-violet-500 to-indigo-600',
  },
  operations: {
    label: '运维',
    headline: '优先解决售后异常和即将到期的服务',
    description: '客户维护、续费协作和服务事项只显示已分配范围。',
    accent: 'from-emerald-500 to-teal-600',
  },
  finance: {
    label: '财务',
    headline: '先确认收付款、内部应付和待冲销事项',
    description: '资金记录与必要订单摘要在财务岗位范围内统一处理。',
    accent: 'from-amber-500 to-orange-600',
  },
  admin: {
    label: '管理员',
    headline: '先处理待审批、人员权限和经营异常',
    description: '主管体系关闭时，全部审批、分配和异常责任自动回到管理员。',
    accent: 'from-slate-700 to-slate-950',
  },
}

export default function Dashboard() {
  const context = useAppContextStore((state) => state.context)
  const navigation = useAppContextStore((state) => state.navigation)
  if (!context) return null

  const role = ROLE_PRESENTATION[context.currentWorkView]
  const roleLinks = navigation
    .filter((item) => item.group === 'role_business' && item.visible && item.enabled)
    .slice(0, 6)
  const hasWarehouse = context.additionalFunctions.includes('warehouse')
  const hasSupervisor = context.additionalFunctions.includes('supervisor')
  const supervisorActive = hasSupervisor && context.supervisorEnabled

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <section className={`overflow-hidden rounded-3xl bg-gradient-to-br ${role.accent} p-6 text-white shadow-xl sm:p-8`}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-white/75">
              <span className="rounded-full bg-white/15 px-3 py-1">{role.label}工作视图</span>
              <span>{context.company.name}</span>
            </div>
            <p className="mt-5 text-sm text-white/75">{context.user.name}，今天从这里开始</p>
            <h1 className="mt-2 text-2xl font-semibold leading-tight sm:text-4xl">{role.headline}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/80">{role.description}</p>
          </div>
          <Link to="/work" className="inline-flex w-fit items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm transition hover:-translate-y-0.5">
            打开推进中心
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Link to="/work" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-cyan-200 hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700"><CheckSquare className="h-5 w-5" /></span>
            <ArrowRight className="h-4 w-4 text-slate-300" />
          </div>
          <h2 className="mt-4 font-semibold text-slate-900">推进中心</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">全部、今天、逾期和等待他人的统一入口。</p>
        </Link>
        <Link to="/calendar" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-violet-200 hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><CalendarDays className="h-5 w-5" /></span>
            <ArrowRight className="h-4 w-4 text-slate-300" />
          </div>
          <h2 className="mt-4 font-semibold text-slate-900">日历</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">与推进中心共用同一批工作事项。</p>
        </Link>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></span>
          <h2 className="mt-4 font-semibold text-slate-900">权限已按岗位收口</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">页面入口由服务器返回；前端不再自行猜测你能看什么。</p>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.5fr_0.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><BriefcaseBusiness className="h-5 w-5" /></span>
            <div>
              <h2 className="font-semibold text-slate-900">{role.label}业务入口</h2>
              <p className="text-xs text-slate-500">当前工作视图</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {roleLinks.map((item) => (
              <Link key={item.routeId} to={item.canonicalPath} className="group flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50/50 hover:text-cyan-800">
                <span>{item.label}</span>
                <ArrowRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-600" />
              </Link>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><MapPinned className="h-4 w-4 text-cyan-600" />我的工作范围</div>
            <div className="mt-3 space-y-2 text-sm text-slate-600">
              <p>区域：{context.regionScopeIds.length ? `${context.regionScopeIds.length} 个已授权区域` : '按本人分配事项'}</p>
              <p>技能：{context.skills.length ? context.skills.join('、') : '暂无专项技能标签'}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-violet-600" />附加职能</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {hasWarehouse && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800"><Warehouse className="h-3.5 w-3.5" />仓库处理</span>}
              {supervisorActive && <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800"><ShieldCheck className="h-3.5 w-3.5" />团队审批</span>}
              {hasSupervisor && !context.supervisorEnabled && <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">主管体系未开启，责任回到管理员</span>}
              {!hasWarehouse && !hasSupervisor && <span className="text-sm text-slate-500">当前没有附加职能</span>}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
