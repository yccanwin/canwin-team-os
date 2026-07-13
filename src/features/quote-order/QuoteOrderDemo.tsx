import { useState } from 'react'
import { FileLock2, ShieldAlert } from 'lucide-react'
import { demoQuote } from './demoData'
import type { DemoQuote, QuoteActionResult } from './types'
import { approveSpecialContent, completeDemonstration, createChangeOrder, freezeAfterDepositConfirmation, quoteTotal, submitQuote } from './workflow'

const statusLabel = { draft: '草稿', pending_approval: '待主管审批', approved: '已批准', frozen: '已冻结' }

export function QuoteOrderDemo({ initialQuote = demoQuote }: { initialQuote?: DemoQuote }) {
  const [quote, setQuote] = useState(() => structuredClone(initialQuote))
  const [notice, setNotice] = useState<Pick<QuoteActionResult, 'ok' | 'message'> | null>(null)
  const apply = (next: QuoteActionResult) => { setNotice(next); if (next.ok) setQuote(next.quote) }
  const now = new Date().toISOString()

  return <section className="min-h-screen bg-slate-50 p-4 md:p-6">
    <header className="mb-5"><p className="text-sm font-medium text-indigo-600">本地流程演示</p><h1 className="text-2xl font-bold text-slate-900">报价与订单</h1><p className="mt-1 text-sm text-slate-500">不触发真实付款、审批或订单写入，刷新页面即重置。</p></header>
    <div className="max-w-3xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{quote.customerName}</h2><p className="text-sm text-slate-500">客户等级 {quote.customerGrade} · 报价 V{quote.version} · 有效至 {quote.validUntil}</p></div><span className="h-fit rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-700">{statusLabel[quote.status]}</span></div>
      <div className="my-4 divide-y divide-slate-100 rounded-lg border border-slate-100">{quote.lines.map(line => <div key={line.itemId} className="flex justify-between p-3 text-sm"><div>{line.itemNameSnapshot} <span className="text-slate-400">目录V{line.catalogVersion}</span>{line.specialContent && <p className="text-amber-700">特殊：{line.specialContent}</p>}</div><span>¥{(line.quantity * line.unitPrice).toLocaleString()}</span></div>)}</div>
      <p className="text-right font-semibold">合计 ¥{quoteTotal(quote.lines).toLocaleString()}</p>
      {notice && <p role="status" className={`my-3 rounded-lg p-3 text-sm ${notice.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{notice.message}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => apply(completeDemonstration(quote))}>完成A类演示</button>
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => apply(submitQuote(quote))}>提交报价</button>
        <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => apply(approveSpecialContent(quote))}>主管批准特殊内容</button>
        <button className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white" onClick={() => apply(freezeAfterDepositConfirmation(quote, now))}>演示确认定金并冻结</button>
        <button className="rounded-lg border border-amber-300 px-3 py-2 text-sm text-amber-800" onClick={() => apply(createChangeOrder(quote, '客户申请调整交付内容', now))}>生成变更单</button>
      </div>
      {quote.frozenSnapshot && <div className="mt-4 flex gap-2 rounded-lg bg-slate-100 p-3 text-sm text-slate-700"><FileLock2 size={18} /><span>快照 V{quote.frozenSnapshot.version} 已冻结，金额 ¥{quote.frozenSnapshot.totalAmount.toLocaleString()}</span></div>}
      {quote.changeOrders.length > 0 && <div className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"><ShieldAlert size={18} /><span>已生成 {quote.changeOrders.length} 张变更单；原报价未改动。</span></div>}
    </div>
  </section>
}

export default QuoteOrderDemo
