import { useEffect, useMemo, useState } from 'react'
import {
  Award,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Crown,
  Diamond,
  Edit3,
  Medal,
  PackagePlus,
  Plus,
  Save,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react'
import { useSalesStore } from '@/stores/useSalesStore'
import { useUserStore } from '@/stores/useUserStore'
import { isCaptainRole } from '@/services/profile'
import type { SalesAssessment, SalesProduct, SalesScoreRecord, User } from '@/types'
import { SalesMeetingPanel } from '@/features/management-board/SalesMeetingPanel'

type MedalLevel = {
  key: 'none' | 'bronze' | 'silver' | 'gold' | 'diamond'
  label: string
  threshold: number
  icon: typeof Award
  color: string
}

const MEDAL_LEVELS: MedalLevel[] = [
  { key: 'none', label: '无牌', threshold: 0, icon: Award, color: 'text-slate-400' },
  { key: 'bronze', label: '铜牌', threshold: 15, icon: Medal, color: 'text-amber-700' },
  { key: 'silver', label: '银牌', threshold: 60, icon: Medal, color: 'text-slate-400' },
  { key: 'gold', label: '金牌', threshold: 95, icon: Crown, color: 'text-amber-500' },
  { key: 'diamond', label: '钻石', threshold: 180, icon: Diamond, color: 'text-cyan-500' },
]

const DEFAULT_ASSESSMENT = {
  salespersonIds: [] as string[],
  pointTarget: 3600,
  newGmvTarget: 300000,
  newGmvActual: 0,
  renewalGmvTarget: 150000,
  renewalGmvActual: 0,
}

const PRODUCT_ICONS = ['🖥️', '📦', '🖨️', '🔗', '🔄', '👑', '🛵', '🧩', '📊', '🧾']

function formatCurrency(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPoints(value: number) {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

function getQuarterInfo(date = new Date()) {
  const year = date.getFullYear()
  const quarter = Math.floor(date.getMonth() / 3) + 1
  const startMonth = (quarter - 1) * 3
  const months = [startMonth, startMonth + 1, startMonth + 2]
  const start = new Date(year, startMonth, 1)
  const end = new Date(year, startMonth + 3, 0)
  return {
    year,
    quarter,
    key: `${year}-Q${quarter}`,
    label: `${year} Q${quarter} · ${months.map((month) => `${month + 1}月`).join(' / ')}`,
    months,
    start,
    end,
  }
}

function percent(actual: number, target: number) {
  if (target <= 0) return 0
  return Math.min(999, Math.round((actual / target) * 100))
}

function inQuarter(record: SalesScoreRecord, start: Date, end: Date) {
  const date = new Date(`${record.soldAt}T00:00:00`)
  return date >= start && date <= end
}

function getMedal(points: number) {
  return MEDAL_LEVELS.reduce((current, level) => (points >= level.threshold ? level : current), MEDAL_LEVELS[0])
}

function userName(users: User[], userId: string) {
  return users.find((user) => user.id === userId)?.name ?? '未知成员'
}

export default function SalesCenterPage() {
  const currentUser = useUserStore((s) => s.currentUser)
  const users = useUserStore((s) => s.users)
  const products = useSalesStore((s) => s.products)
  const records = useSalesStore((s) => s.records)
  const assessments = useSalesStore((s) => s.assessments)
  const addProduct = useSalesStore((s) => s.addProduct)
  const updateProduct = useSalesStore((s) => s.updateProduct)
  const addRecord = useSalesStore((s) => s.addRecord)
  const upsertAssessment = useSalesStore((s) => s.upsertAssessment)

  const quarter = useMemo(() => getQuarterInfo(), [])
  const [activeMonth, setActiveMonth] = useState(new Date().getMonth())
  const [selectedProductId, setSelectedProductId] = useState('')
  const [selectedUserId, setSelectedUserId] = useState(currentUser?.id ?? '')
  const [quantity, setQuantity] = useState(1)
  const [soldAt, setSoldAt] = useState(formatDate(new Date()))
  const [note, setNote] = useState('')
  const [productName, setProductName] = useState('')
  const [productPoints, setProductPoints] = useState(0)
  const [editingProductId, setEditingProductId] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [targetEditing, setTargetEditing] = useState(false)

  const canEdit = isCaptainRole(currentUser?.role)
  const activeProducts = products.filter((product) => product.isActive)
  const selectedProduct = products.find((product) => product.id === selectedProductId) || activeProducts[0]
  const assessment = assessments.find((item) => item.periodQuarter === quarter.key)
  const assessmentDraft: SalesAssessment = assessment ?? {
    id: `draft-${quarter.key}`,
    periodQuarter: quarter.key,
    ...DEFAULT_ASSESSMENT,
    updatedBy: currentUser?.id ?? '',
    updatedAt: new Date().toISOString(),
  }
  const quarterRecords = records.filter(
    (record) =>
      inQuarter(record, quarter.start, quarter.end) &&
      assessmentDraft.salespersonIds.includes(record.salespersonId)
  )
  const monthRecords = quarterRecords.filter((record) => new Date(`${record.soldAt}T00:00:00`).getMonth() === activeMonth)
  const quarterPoints = quarterRecords.reduce((sum, record) => sum + record.points, 0)
  const medal = getMedal(quarterPoints)
  const MedalIcon = medal.icon
  const autoPoints = selectedProduct ? selectedProduct.points * quantity : 0
  const salespeople = users.filter((user) => assessmentDraft.salespersonIds.includes(user.id))
  const memberRows = salespeople
    .map((user) => {
      const userRecords = quarterRecords.filter((record) => record.salespersonId === user.id)
      const points = userRecords.reduce((sum, record) => sum + record.points, 0)
      const tags = Array.from(new Set(userRecords.slice(0, 4).map((record) => record.productName)))
      return { user, points, tags }
    })
    .sort((a, b) => b.points - a.points)

  useEffect(() => {
    if (!salespeople.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(salespeople[0]?.id ?? '')
    }
  }, [salespeople, selectedUserId])
  const topProducts = activeProducts
    .map((product) => ({
      product,
      points: quarterRecords
        .filter((record) => record.productId === product.id)
        .reduce((sum, record) => sum + record.points, 0),
    }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 5)

  const resetProductForm = () => {
    setProductName('')
    setProductPoints(0)
    setEditingProductId('')
  }

  const handleSaveProduct = async () => {
    if (!canEdit || !productName.trim() || productPoints <= 0 || !currentUser) return
    setSaveError('')
    setSaving(true)
    try {
      if (editingProductId) {
        await updateProduct(editingProductId, {
          name: productName.trim(),
          points: productPoints,
          isActive: true,
        })
      } else {
        await addProduct({
          name: productName.trim(),
          points: productPoints,
          isActive: true,
          createdBy: currentUser.id,
        })
      }
      resetProductForm()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveRecord = async () => {
    if (!canEdit || !currentUser || !selectedProduct || !selectedUserId || quantity <= 0) return
    setSaveError('')
    setSaving(true)
    try {
      await addRecord({
        salespersonId: selectedUserId,
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        quantity,
        points: autoPoints,
        soldAt,
        note: note.trim() || undefined,
        createdBy: currentUser.id,
      })
      setNote('')
      setQuantity(1)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAssessment = async (updates: Partial<SalesAssessment>) => {
    if (!canEdit || !currentUser) return
    setSaveError('')
    try {
      await upsertAssessment({
        ...assessmentDraft,
        ...updates,
        periodQuarter: quarter.key,
        updatedBy: currentUser.id,
      })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }

  const metricCards = [
    {
      label: '季度积分',
      value: `${formatPoints(quarterPoints)} / ${formatPoints(assessmentDraft.pointTarget)}`,
      rate: percent(quarterPoints, assessmentDraft.pointTarget),
      icon: Sparkles,
      color: 'from-blue-500 to-cyan-400',
    },
    {
      label: '新增销售 GMV',
      value: `${formatCurrency(assessmentDraft.newGmvActual)} / ${formatCurrency(assessmentDraft.newGmvTarget)}`,
      rate: percent(assessmentDraft.newGmvActual, assessmentDraft.newGmvTarget),
      icon: TrendingUp,
      color: 'from-teal-500 to-cyan-400',
    },
    {
      label: '续费 GMV',
      value: `${formatCurrency(assessmentDraft.renewalGmvActual)} / ${formatCurrency(assessmentDraft.renewalGmvTarget)}`,
      rate: percent(assessmentDraft.renewalGmvActual, assessmentDraft.renewalGmvTarget),
      icon: Target,
      color: 'from-orange-400 to-amber-400',
    },
    {
      label: '季度综合达成',
      value: `${Math.round((percent(quarterPoints, assessmentDraft.pointTarget) + percent(assessmentDraft.newGmvActual, assessmentDraft.newGmvTarget) + percent(assessmentDraft.renewalGmvActual, assessmentDraft.renewalGmvTarget)) / 3)}%`,
      rate: Math.round((percent(quarterPoints, assessmentDraft.pointTarget) + percent(assessmentDraft.newGmvActual, assessmentDraft.newGmvTarget) + percent(assessmentDraft.renewalGmvActual, assessmentDraft.renewalGmvTarget)) / 3),
      icon: Award,
      color: 'from-indigo-500 to-violet-500',
    },
  ]

  return (
    <div className="mx-auto max-w-[1500px] px-2 py-4 lg:px-4">
      <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-600 shadow-[0_0_24px_rgba(6,182,212,.16)]">
              <BarChart3 className="h-6 w-6" />
            </span>
            <div>
              <h1 className="font-heading text-2xl font-semibold text-slate-950">销售中心</h1>
              <p className="text-sm text-slate-500">客如云积分 · 季度销售考核</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-slate-700 shadow-sm">
              季度 <span className="ml-2 font-semibold text-slate-950">{quarter.label}</span>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              <span className="px-2 text-xs text-slate-400">记录月份</span>
              {quarter.months.map((month) => (
                <button
                  key={month}
                  type="button"
                  onClick={() => setActiveMonth(month)}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                    activeMonth === month ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {month + 1}月
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-[360px] rounded-[18px] border border-cyan-100 bg-white/90 p-4 shadow-[0_12px_34px_rgba(14,165,233,.12)]">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-100 to-blue-50">
                <MedalIcon className={`h-10 w-10 ${medal.color}`} />
              </span>
              <div>
                <p className="text-xs font-medium text-slate-500">本季牌级</p>
                <p className="text-3xl font-semibold text-blue-600">{medal.label}</p>
                <p className="text-xs text-slate-500">自动按季度积分决定 · 当前 {formatPoints(quarterPoints)} 分</p>
              </div>
            </div>
            <div className="hidden gap-3 text-center text-xs text-slate-500 md:flex">
              {MEDAL_LEVELS.map((level) => (
                <div key={level.key}>
                  <level.icon className={`mx-auto mb-1 h-4 w-4 ${level.color}`} />
                  <p>{level.label}</p>
                  <p>{level.key === 'none' ? '<15' : level.threshold}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {saveError && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {saveError}
        </div>
      )}

      <section className="mb-4 grid gap-3 lg:grid-cols-4">
        {metricCards.map((metric) => (
          <div key={metric.label} className="rounded-[18px] border border-cyan-100 bg-white p-4 shadow-card">
            <div className="mb-3 flex items-center gap-3">
              <span className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${metric.color} text-white shadow-lg shadow-cyan-500/10`}>
                <metric.icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-slate-500">{metric.label}</p>
                <p className="mt-1 text-xl font-semibold text-slate-950">{metric.value}</p>
              </div>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${Math.min(metric.rate, 100)}%` }} />
            </div>
            <p className="mt-2 text-right text-sm font-semibold text-blue-600">{metric.rate}%</p>
          </div>
        ))}
      </section>

      {canEdit && (
        <section className="mb-4 rounded-[18px] border border-cyan-100 bg-white p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-heading text-base font-semibold text-slate-950">季度指标编辑</h2>
            <button type="button" onClick={() => setTargetEditing((value) => !value)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              <Edit3 className="h-3.5 w-3.5" />
              {targetEditing ? '收起' : '编辑目标'}
            </button>
          </div>
          {targetEditing && (
            <AssessmentEditor assessment={assessmentDraft} users={users} onSave={handleSaveAssessment} />
          )}
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
        <div className="space-y-4">
          <section className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-card">
            <div className="mb-4 flex items-center gap-2">
              <Award className="h-5 w-5 text-blue-600" />
              <h2 className="font-heading text-lg font-semibold text-slate-950">销售成员积分</h2>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-100">
              <div className="grid grid-cols-[56px_1fr_100px_100px_1.5fr] bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
                <span>排名</span>
                <span>成员</span>
                <span>本季积分</span>
                <span>积分达成</span>
                <span>优势产品</span>
              </div>
              {memberRows.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-400">
                  {salespeople.length === 0 ? '请先在季度指标编辑中选择销售人员' : '本季度还没有销售积分记录'}
                </p>
              ) : memberRows.map((row, index) => (
                <div key={row.user.id} className="grid grid-cols-[56px_1fr_100px_100px_1.5fr] items-center border-t border-slate-100 px-3 py-3 text-sm">
                  <span className="font-semibold text-slate-500">#{index + 1}</span>
                  <span className="flex items-center gap-2 font-medium text-slate-800">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-600">{row.user.name.charAt(0)}</span>
                    {row.user.name}
                  </span>
                  <span className="font-semibold text-blue-600">{formatPoints(row.points)}</span>
                  <span className="text-slate-500">{percent(row.points, assessmentDraft.pointTarget)}%</span>
                  <span className="flex flex-wrap gap-1">
                    {row.tags.length === 0 ? <span className="text-slate-300">等待记录</span> : row.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">{tag}</span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <PackagePlus className="h-5 w-5 text-blue-600" />
                <h2 className="font-heading text-lg font-semibold text-slate-950">客如云积分产品</h2>
              </div>
              {canEdit && (
                <div className="flex items-center gap-2">
                  <input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="产品名称" className="h-9 w-32 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400" />
                  <input value={productPoints || ''} onChange={(event) => setProductPoints(Number(event.target.value))} type="number" min={0.1} step={0.1} placeholder="积分" className="h-9 w-20 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400" />
                  <button disabled={saving || !productName.trim() || productPoints <= 0} onClick={handleSaveProduct} className="inline-flex h-9 items-center gap-1 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white disabled:opacity-40">
                    <Plus className="h-4 w-4" />
                    {editingProductId ? '保存' : '新增'}
                  </button>
                </div>
              )}
            </div>
            {activeProducts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">
                暂无积分产品。队长或管理员新增产品后，可用于快速记积分。
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {activeProducts.map((product, index) => {
                  const active = selectedProduct?.id === product.id
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => {
                        setSelectedProductId(product.id)
                        if (canEdit) {
                          setProductName(product.name)
                          setProductPoints(product.points)
                          setEditingProductId(product.id)
                        }
                      }}
                      className={`relative rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${
                        active ? 'border-blue-500 bg-blue-50 shadow-[0_0_0_3px_rgba(59,130,246,.12)]' : 'border-slate-200 bg-white hover:border-blue-200'
                      }`}
                    >
                      <span className="mb-3 block text-3xl">{PRODUCT_ICONS[index % PRODUCT_ICONS.length]}</span>
                      <span className="block font-semibold text-slate-900">{product.name}</span>
                      <span className="mt-1 block text-xl font-semibold text-blue-600">+{formatPoints(product.points)}</span>
                      <span className="text-xs text-slate-400">积分</span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-[18px] border border-cyan-100 bg-white p-5 shadow-card">
            <div className="mb-4 flex items-center gap-2">
              <Zap className="h-5 w-5 text-blue-600" />
              <h2 className="font-heading text-lg font-semibold text-slate-950">快速记积分</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-500">销售成员</span>
                <select disabled={!canEdit} value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-blue-400 disabled:bg-slate-50">
                  {salespeople.length === 0 && <option value="">尚未选择销售人员</option>}
                  {salespeople.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-500">产品</span>
                <select disabled={!canEdit} value={selectedProduct?.id ?? ''} onChange={(event) => setSelectedProductId(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-blue-400 disabled:bg-slate-50">
                  {activeProducts.map((product) => <option key={product.id} value={product.id}>{product.name} +{formatPoints(product.points)}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-500">数量</span>
                <input disabled={!canEdit} type="number" min={1} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-blue-400 disabled:bg-slate-50" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-500">自动积分</span>
                <input readOnly value={autoPoints} className="h-11 w-full rounded-xl border border-blue-100 bg-blue-50 px-3 font-semibold text-blue-700 outline-none" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-500">日期</span>
                <input disabled={!canEdit} type="date" value={soldAt} onChange={(event) => setSoldAt(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-blue-400 disabled:bg-slate-50" />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-slate-500">备注</span>
                <input disabled={!canEdit} value={note} onChange={(event) => setNote(event.target.value)} placeholder="选填，备注说明..." maxLength={100} className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-blue-400 disabled:bg-slate-50" />
              </label>
            </div>
            <button disabled={!canEdit || saving || !selectedProduct || !selectedUserId} onClick={handleSaveRecord} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(37,99,235,.24)] transition hover:brightness-110 disabled:opacity-40">
              <Save className="h-4 w-4" />
              保存积分记录
            </button>
          </section>

          <section className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-card">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-600" />
              <h2 className="font-heading text-lg font-semibold text-slate-950">绩效拆解</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <MiniProgress title="新增 GMV 完成情况" value={assessmentDraft.newGmvActual} target={assessmentDraft.newGmvTarget} />
              <MiniProgress title="续费 GMV 完成情况" value={assessmentDraft.renewalGmvActual} target={assessmentDraft.renewalGmvTarget} />
              <MiniProgress title="产品销售积分" value={quarterPoints} target={assessmentDraft.pointTarget} />
              <div className="rounded-xl border border-slate-100 p-3">
                <p className="mb-3 text-sm font-semibold text-slate-800">产品贡献 TOP5</p>
                <div className="space-y-2">
                  {topProducts.length === 0 ? <p className="text-xs text-slate-400">等待积分记录</p> : topProducts.map(({ product, points }) => (
                    <div key={product.id}>
                      <div className="mb-1 flex justify-between text-xs text-slate-500">
                        <span>{product.name}</span>
                        <span>{formatPoints(points)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(percent(points, Math.max(quarterPoints, 1)), 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <section className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-blue-600" />
            <h2 className="font-heading text-lg font-semibold text-slate-950">积分明细</h2>
            <span className="text-xs text-slate-400">最近记录</span>
          </div>
          <span className="text-xs text-slate-400">{activeMonth + 1}月</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {monthRecords.length === 0 ? (
            <div className="w-full rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">当前月份暂无积分明细</div>
          ) : monthRecords.slice(0, 12).map((record) => (
            <div key={record.id} className="min-w-[220px] rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                <span>{record.soldAt}</span>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600">已生效</span>
              </div>
              <p className="font-semibold text-slate-900">{record.productName}</p>
              <div className="mt-2 flex items-end justify-between">
                <span className="text-sm text-slate-500">{userName(users, record.salespersonId)}</span>
                <span className="text-lg font-semibold text-blue-600">+{formatPoints(record.points)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <SalesMeetingPanel className="mt-4" />
    </div>
  )
}

function MiniProgress({ title, value, target }: { title: string; value: number; target: number }) {
  const rate = percent(value, target)
  return (
    <div className="rounded-xl border border-slate-100 p-3">
      <p className="mb-2 text-sm font-semibold text-slate-800">{title}</p>
      <p className="mb-2 text-sm text-slate-500">{typeof value === 'number' && target > 10000 ? `${formatCurrency(value)} / ${formatCurrency(target)}` : `${formatPoints(value)} / ${formatPoints(target)}`}</p>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <p className="mt-1 text-right text-xs font-semibold text-blue-600">{rate}%</p>
    </div>
  )
}

function AssessmentEditor({
  assessment,
  users,
  onSave,
}: {
  assessment: SalesAssessment
  users: User[]
  onSave: (updates: Partial<SalesAssessment>) => void
}) {
  const [draft, setDraft] = useState({
    salespersonIds: assessment.salespersonIds,
    pointTarget: assessment.pointTarget,
    newGmvTarget: assessment.newGmvTarget,
    newGmvActual: assessment.newGmvActual,
    renewalGmvTarget: assessment.renewalGmvTarget,
    renewalGmvActual: assessment.renewalGmvActual,
  })

  return (
    <div>
      <div className="mb-4">
        <p className="mb-2 text-sm text-slate-500">本季度销售人员</p>
        <div className="flex flex-wrap gap-2">
          {users.map((user) => {
            const selected = draft.salespersonIds.includes(user.id)
            return (
              <button
                key={user.id}
                type="button"
                onClick={() => setDraft((state) => ({
                  ...state,
                  salespersonIds: selected
                    ? state.salespersonIds.filter((id) => id !== user.id)
                    : [...state.salespersonIds, user.id],
                }))}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  selected
                    ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${selected ? 'bg-blue-500' : 'bg-slate-300'}`} />
                {user.name}
                <span className="text-xs opacity-60">{user.position}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
      {([
        ['pointTarget', '季度积分目标'],
        ['newGmvTarget', '新增GMV目标'],
        ['newGmvActual', '新增GMV完成'],
        ['renewalGmvTarget', '续费GMV目标'],
        ['renewalGmvActual', '续费GMV完成'],
      ] as const).map(([key, label]) => (
        <label key={key} className="text-sm">
          <span className="mb-1 block text-slate-500">{label}</span>
          <input
            type="number"
            min={0}
            step={key === 'pointTarget' ? 0.1 : 1}
            value={draft[key]}
            onChange={(event) => setDraft((state) => ({ ...state, [key]: Number(event.target.value) }))}
            className="h-10 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-blue-400"
          />
        </label>
      ))}
      <button type="button" onClick={() => onSave(draft)} className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-lg bg-slate-950 px-4 text-sm font-medium text-white">
        <CheckCircle2 className="h-4 w-4" />
        保存指标
      </button>
      </div>
    </div>
  )
}
