import { Navigate, Link } from 'react-router-dom'
import { Boxes, MapPinned, ShieldCheck, ArrowRight, Settings2 } from 'lucide-react'
import { useUserStore } from '@/stores/useUserStore'
import { isCaptainRole } from '@/services/profile'

const entries = [
  {
    title: '人员与权限',
    description: '管理成员角色、销售区域和功能权限。',
    to: '/settings-v3/access',
    icon: ShieldCheck,
    tone: 'from-cyan-500 to-blue-600',
  },
  {
    title: '区域配置',
    description: '维护区县范围、上下级关系与人员归属。',
    to: '/settings-v3/regions',
    icon: MapPinned,
    tone: 'from-emerald-500 to-teal-600',
  },
  {
    title: '商品与套餐',
    description: '维护商品目录、固定套餐和发布版本。',
    to: '/settings-v3/catalog',
    icon: Boxes,
    tone: 'from-violet-500 to-fuchsia-600',
  },
]

export default function SettingsPage() {
  const currentUser = useUserStore((state) => state.currentUser)

  if (!currentUser || !isCaptainRole(currentUser.role)) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="px-3 py-4 lg:px-6">
      <header className="overflow-hidden rounded-3xl bg-slate-950 px-5 py-7 text-white shadow-xl sm:px-8">
        <div className="flex items-center gap-3 text-cyan-300">
          <Settings2 size={20} />
          <span className="text-xs font-semibold uppercase tracking-[0.24em]">System Console</span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">设置中心</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
          只保留当前真正使用的组织、区域和商品配置。财务与目标已回归各自业务中心。
        </p>
      </header>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {entries.map(({ title, description, to, icon: Icon, tone }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
          >
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${tone} text-white shadow-lg`}>
              <Icon size={22} />
            </div>
            <h2 className="mt-5 text-lg font-semibold text-slate-900">{title}</h2>
            <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{description}</p>
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-700 group-hover:text-cyan-700">
              进入配置 <ArrowRight size={16} className="transition group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

