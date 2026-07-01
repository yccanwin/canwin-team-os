import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Plus, Trash2, WalletCards } from 'lucide-react'
import { useFinanceStore } from '@/stores/useFinanceStore'
import { useUserStore } from '@/stores/useUserStore'
import { isFinanceRole } from '@/services/profile'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { FinanceRecord } from '@/types'

const incomeCategories = ['销售收入', '其他收入', '工资', '分红']
const expenseCategories = ['采购成本', '物流成本', '工资支出', '运营支出', '其他支出', '工资', '分红']

export default function FinancePage() {
  const records = useFinanceStore((s) => s.records)
  const addRecord = useFinanceStore((s) => s.addRecord)
  const deleteRecord = useFinanceStore((s) => s.deleteRecord)
  const currentUser = useUserStore((s) => s.currentUser)
  const users = useUserStore((s) => s.users)
  const canManageFinance = isFinanceRole(currentUser.role)

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [type, setType] = useState<'income' | 'expense'>('income')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [note, setNote] = useState('')
  const [userId, setUserId] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<FinanceRecord | null>(null)

  const totals = useMemo(() => {
    const income = records.filter((record) => record.type === 'income').reduce((sum, record) => sum + record.amount, 0)
    const expense = records.filter((record) => record.type === 'expense').reduce((sum, record) => sum + record.amount, 0)
    return { income, expense, net: income - expense }
  }, [records])

  const categoryRows = useMemo(() => {
    const rows = new Map<string, number>()
    records.forEach((record) => rows.set(record.category, (rows.get(record.category) ?? 0) + record.amount))
    return Array.from(rows.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [records])

  const recentRecords = useMemo(
    () => [...records].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50),
    [records]
  )

  const submitRecord = () => {
    const parsedAmount = Number(amount)
    if (!canManageFinance || !date || !category || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return
    if ((category === '工资' || category === '分红') && !userId) return

    addRecord({
      type,
      amount: parsedAmount,
      date,
      category,
      note: note.trim() || undefined,
      createdBy: currentUser.id,
      ...(userId ? { userId } : {}),
    })
    setAmount('')
    setCategory('')
    setNote('')
    setUserId('')
  }

  return (
    <div className="px-3 py-4 lg:px-6">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-lg font-semibold text-brand-400">财务</h1>
          <p className="mt-1 text-sm text-brand-300">
            全员看经营大盘，财务角色维护明细。
          </p>
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MetricCard label="收入" value={totals.income} tone="income" />
        <MetricCard label="支出" value={totals.expense} tone="expense" />
        <MetricCard label="结余" value={totals.net} tone={totals.net >= 0 ? 'income' : 'expense'} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-card bg-white p-5 shadow-card">
          <h2 className="mb-4 flex items-center gap-2 font-heading text-base font-semibold text-brand-400">
            <WalletCards className="h-4 w-4 text-primary" />
            支出/收入构成
          </h2>
          {categoryRows.length ? (
            <div className="space-y-3">
              {categoryRows.map(([name, total]) => (
                <div key={name}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-brand-400">{name}</span>
                    <span className="text-brand-300">¥{total.toLocaleString()}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-brand-50">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (total / Math.max(totals.income + totals.expense, 1)) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-brand-200">暂无财务记录</p>
          )}
        </section>

        <section className="rounded-card bg-white p-5 shadow-card">
          {canManageFinance ? (
            <>
              <h2 className="mb-4 font-heading text-base font-semibold text-brand-400">财务录入</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-lg border border-brand-100 px-3 py-2 text-sm" />
                <div className="flex overflow-hidden rounded-lg border border-brand-100">
                  <button onClick={() => { setType('income'); setCategory('') }} className={`flex-1 px-3 py-2 text-sm ${type === 'income' ? 'bg-emerald-500 text-white' : 'bg-white text-brand-400'}`}>收入</button>
                  <button onClick={() => { setType('expense'); setCategory('') }} className={`flex-1 px-3 py-2 text-sm ${type === 'expense' ? 'bg-red-500 text-white' : 'bg-white text-brand-400'}`}>支出</button>
                </div>
                <input type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="金额" className="rounded-lg border border-brand-100 px-3 py-2 text-sm" />
                <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border border-brand-100 px-3 py-2 text-sm">
                  <option value="">选择类别</option>
                  {(type === 'income' ? incomeCategories : expenseCategories).map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                {(category === '工资' || category === '分红') && (
                  <select value={userId} onChange={(event) => setUserId(event.target.value)} className="rounded-lg border border-brand-100 px-3 py-2 text-sm sm:col-span-2">
                    <option value="">选择归属成员</option>
                    {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                  </select>
                )}
                <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="备注" className="rounded-lg border border-brand-100 px-3 py-2 text-sm sm:col-span-2" />
              </div>
              <button onClick={submitRecord} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white">
                <Plus className="h-4 w-4" />
                确认录入
              </button>
            </>
          ) : (
            <div>
              <h2 className="mb-2 font-heading text-base font-semibold text-brand-400">公开经营大盘</h2>
              <p className="text-sm leading-6 text-brand-300">
                当前账号只展示汇总数据，不展示单笔成本、工资分红明细和敏感备注。
              </p>
            </div>
          )}
        </section>
      </div>

      <section className="mt-5 rounded-card bg-white p-5 shadow-card">
        <h2 className="mb-4 font-heading text-base font-semibold text-brand-400">{canManageFinance ? '最近明细' : '公开汇总'}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-100 text-left text-xs text-brand-300">
                <th className="py-2 pr-3">日期</th>
                <th className="py-2 pr-3">类型</th>
                <th className="py-2 pr-3 text-right">金额</th>
                <th className="py-2 pr-3">类别</th>
                <th className="py-2 pr-3">备注</th>
                {canManageFinance && <th className="py-2 text-right">操作</th>}
              </tr>
            </thead>
            <tbody>
              {recentRecords.map((record) => (
                <tr key={record.id} className="border-b border-gray-100">
                  <td className="py-2 pr-3 text-brand-300">{record.date}</td>
                  <td className="py-2 pr-3 text-brand-400">{record.type === 'income' ? '收入' : '支出'}</td>
                  <td className="py-2 pr-3 text-right text-brand-400">¥{record.amount.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-brand-400">{record.category}</td>
                  <td className="py-2 pr-3 text-brand-300">{record.note || '-'}</td>
                  {canManageFinance && (
                    <td className="py-2 text-right">
                      <button onClick={() => setDeleteTarget(record)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-expense hover:bg-red-50">
                        <Trash2 className="h-3 w-3" />
                        删除
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onConfirm={() => {
          if (deleteTarget) deleteRecord(deleteTarget.id)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
        title="删除财务记录"
        message="确定要删除这条财务记录吗？"
        variant="danger"
      />
    </div>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone: 'income' | 'expense' }) {
  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      <p className="text-sm text-brand-300">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone === 'income' ? 'text-emerald-600' : 'text-red-500'}`}>
        ¥{value.toLocaleString()}
      </p>
    </section>
  )
}
