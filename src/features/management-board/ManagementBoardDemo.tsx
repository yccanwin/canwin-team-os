import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, Target } from 'lucide-react'
import { managementBoardDemoItems } from './demoData'
import type { BoardFilter, ManagementBoardItem } from './types'
import { filterBoardItems, handleLocally } from './workflow'

const labels = { overdue: '逾期', blocked: '阻塞', closing_soon: '7天内决策' }
const filters: { value: BoardFilter; label: string }[] = [
  { value: 'meeting', label: '销售会项目' }, { value: 'overdue', label: '逾期' }, { value: 'blocked', label: '阻塞' }, { value: 'closing_soon', label: '临门商机' }, { value: 'handled', label: '已处置' },
]

export function ManagementBoardDemo({ initialItems = managementBoardDemoItems, today = '2026-07-13' }: { initialItems?: ManagementBoardItem[]; today?: string }) {
  const [items, setItems] = useState(() => structuredClone(initialItems))
  const [filter, setFilter] = useState<BoardFilter>('meeting')
  const visible = useMemo(() => filterBoardItems(items, filter, today), [items, filter, today])
  const handle = (id: string) => setItems(current => current.map(item => item.id === id ? handleLocally(item, '主管已在演示会议中确认负责人和期限') : item))

  return <section className="min-h-screen bg-slate-50 p-4 md:p-6">
    <header className="mb-5"><p className="text-sm font-medium text-indigo-600">两天一次销售会</p><h1 className="text-2xl font-bold text-slate-900">主管异常与临门商机板</h1><p className="mt-1 text-sm text-slate-500">只展示逾期、阻塞、已报价且7天内决策；所有处置仅在本页演示。</p></header>
    <div className="mb-4 flex flex-wrap gap-2">{filters.map(option => <button type="button" key={option.value} onClick={() => setFilter(option.value)} className={`rounded-lg px-3 py-2 text-sm ${filter === option.value ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>{option.label}</button>)}</div>
    <div className="grid gap-4 lg:grid-cols-2">{visible.map(item => <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex justify-between gap-3"><div><p className="text-xs text-slate-500">{item.customerName}</p><h2 className="font-semibold text-slate-900">{item.opportunityName}</h2></div><span className={`h-fit rounded-full px-2.5 py-1 text-xs ${item.status === 'handled' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{item.status === 'handled' ? '已处置' : labels[item.exceptionType]}</span></div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-600"><p className="flex items-center gap-1"><Target size={15}/>负责人：{item.ownerName}</p><p className="flex items-center gap-1"><Clock3 size={15}/>期限：{item.deadline}</p></div>
      {item.blocker && <p className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 p-2 text-sm text-red-700"><AlertTriangle size={16}/>{item.blocker}</p>}
      {item.decisionDate && <p className="mt-2 text-sm text-indigo-700">客户决策日：{item.decisionDate} · {item.quoteIssued ? '已报价' : '未报价'}</p>}
      {item.handledNote && <p className="mt-2 text-sm text-emerald-700">{item.handledNote}</p>}
      {item.status === 'open' && <button type="button" onClick={() => handle(item.id)} className="mt-3 flex items-center gap-1 rounded-lg border border-emerald-200 px-3 py-2 text-sm text-emerald-700"><CheckCircle2 size={16}/>本地标记已处置</button>}
    </article>)}</div>
    {visible.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">当前筛选没有项目</p>}
  </section>
}

export default ManagementBoardDemo
