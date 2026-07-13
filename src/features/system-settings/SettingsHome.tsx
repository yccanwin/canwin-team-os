import { ArrowRight, Boxes, MapPinned, Settings2, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

const modules = [
  {
    title: '区域配置',
    description: '维护销售区域与区县归属，为线索分配和数据隔离提供基础。',
    to: '/settings-v3/regions',
    icon: MapPinned,
    status: '可用',
    accent: 'bg-sky-50 text-sky-700',
  },
  {
    title: '商品与套餐',
    description: '统一管理软件、硬件、套餐和销售目录版本。',
    to: '/settings-v3/catalog',
    icon: Boxes,
    status: '可用',
    accent: 'bg-amber-50 text-amber-700',
  },
  {
    title: '人员权限',
    description: '按成员配置多角色和销售区域，保存操作由服务端权限校验。',
    to: '/settings-v3/access',
    icon: ShieldCheck,
    status: '可用',
    accent: 'bg-emerald-50 text-emerald-700',
  },
] as const

export default function SettingsHome() {
  return (
    <section className="mx-auto w-full max-w-6xl pb-10">
      <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-5 py-7 text-white sm:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-300/15 text-cyan-200 ring-1 ring-cyan-200/20">
              <Settings2 size={23} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/75">CanWin Team OS 3.0</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">系统配置</h1>
            </div>
          </div>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
            集中维护销售工作台使用的基础资料。未完成的模块会明确标注，不会产生假保存或演示数据。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 text-xs text-slate-500 sm:px-8">
          <span>3 个配置模块</span>
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span>沿用销售 3.0 功能开关</span>
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span>2.0 设置中心保持不变</span>
        </div>
      </header>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {modules.map((module) => (
          <Link
            key={module.to}
            to={module.to}
            className="group flex min-h-56 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2"
          >
            <div className="flex items-start justify-between gap-3">
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${module.accent}`}>
                <module.icon size={22} />
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${module.status === '可用' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                {module.status}
              </span>
            </div>
            <h2 className="mt-5 text-lg font-semibold text-slate-900">{module.title}</h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-slate-500">{module.description}</p>
            <span className="mt-5 flex items-center gap-2 text-sm font-semibold text-slate-800">
              进入模块
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
