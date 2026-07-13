import { ArrowLeft, Boxes, MapPinned } from 'lucide-react'
import { Link } from 'react-router-dom'

type ModuleKind = 'regions' | 'catalog'

const copy = {
  regions: {
    title: '区域配置',
    description: '销售区域、区县归属和跨区可见范围将在这里维护。',
    detail: '当前任务只建立配置入口和路由，尚未接入区域保存接口。',
    icon: MapPinned,
  },
  catalog: {
    title: '商品与套餐',
    description: '软件、硬件、积分、套餐和目录版本将在这里统一维护。',
    detail: '当前任务只建立配置入口和路由，尚未接入商品与套餐保存接口。',
    icon: Boxes,
  },
} as const

export default function ConfigurationPlaceholder({ kind }: { kind: ModuleKind }) {
  const module = copy[kind]

  return (
    <section className="mx-auto w-full max-w-5xl pb-10">
      <Link to="/settings-v3" className="mb-4 inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-slate-600 hover:bg-white hover:text-slate-900">
        <ArrowLeft size={17} />
        返回系统配置
      </Link>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
            <module.icon size={24} />
          </span>
          <div>
            <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">配置功能待接入</span>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">{module.title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{module.description}</p>
          </div>
        </div>
        <div className="mt-7 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
          {module.detail} 本页不会显示保存按钮，也不会写入演示数据。
        </div>
      </div>
    </section>
  )
}
