import { useEffect, useState } from 'react'
import type { CaseCandidate, CaseData, CaseRecord, PublicCaseRecord } from './domain/case'
import type { AuthenticatedWorkspace } from './lib/access'
import { SupabaseCaseReader } from './lib/supabase-case-reader'
import { EmptyState, StatusBadge } from './ui'

const reader = new SupabaseCaseReader()
const statusLabels = { draft: '草稿', published: '已发布', unpublished: '已下架', archived: '已归档' } as const
const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '未记录'

function PublicCases({ rows }: { rows: readonly PublicCaseRecord[] }) {
  if (!rows.length) return <EmptyState title="当前没有公开案例" description="只有客户授权有效且通过管理员审核的案例才会在这里展示。" />
  return <ol className="work-item-list" data-testid="case-published-list">{rows.map((item, index) => {
    const media = [item.logoPublicPath && '品牌 Logo', item.displayCodePublicPath && '展示码'].filter(Boolean)
    return <li key={`${item.brandDisplayName}:${item.storeDisplayName}:${item.sortOrder}:${index}`} data-testid="case-row">
      <div>
        <strong>{item.brandDisplayName} · {item.storeDisplayName}</strong>
        <span>{item.region} · {item.industry} · {item.storeKind}</span>
        <small>产品与服务：{item.productsAndServices}</small>
        <small>原问题：{item.originalProblem}</small>
        <small>解决方案：{item.solution}</small>
        <small>上线成果：{item.launchResult}</small>
        <small>服务团队：{item.serviceTeamDisplay}</small>
        {media.length > 0 && <small>公开材料：{media.join(' · ')}</small>}
      </div>
      <StatusBadge tone="success">公开展示</StatusBadge>
    </li>
  })}</ol>
}

function authorizationState(candidate: CaseCandidate | undefined) {
  if (!candidate) return { label: '缺少授权记录', tone: 'danger' as const }
  if (candidate.authorizationWithdrawnAt) return { label: '授权已撤回', tone: 'danger' as const }
  if (!candidate.displayAuthorizationValid) return { label: '未获展示授权', tone: 'neutral' as const }
  if (candidate.authorizationValidUntil && Date.parse(candidate.authorizationValidUntil) <= Date.now()) return { label: '授权已过期', tone: 'danger' as const }
  return { label: '授权有效', tone: 'success' as const }
}

function AdminCases({ rows, data }: { rows: readonly CaseRecord[]; data: CaseData }) {
  if (!rows.length) return <EmptyState title="暂无待审核案例" description="案例候选进入系统后，授权与审核信息会在这里汇总。" />
  return <ol className="work-item-list" data-testid="case-candidate-list">{rows.map(item => {
    const candidate = data.candidates.find(record => record.id === item.candidateId)
    const authorization = authorizationState(candidate)
    const media = data.media.filter(file => file.caseId === item.id)
    return <li key={item.id} data-testid="case-admin-row">
      <div>
        <strong>{item.title}</strong>
        <span>{item.summary}</span>
        <small>授权来源：{candidate?.authorizationSource ?? '未记录'} · 授权范围：{candidate?.authorizationScope ?? '未记录'}</small>
        <small>授权凭证引用：{candidate?.authorizationEvidenceReference ?? '未记录'}</small>
        <small>授权记录：{formatDate(candidate?.authorizationRecordedAt ?? null)} · 有效期至：{candidate?.authorizationValidUntil ? formatDate(candidate.authorizationValidUntil) : '长期或未注明'}</small>
        <small>管理员审核：{item.adminReviewedAt ? formatDate(item.adminReviewedAt) : '尚未完成'} · 媒体材料：{media.length ? media.map(file => file.mediaType === 'logo' ? 'Logo' : '展示码').join('、') : '未提交'}</small>
        {candidate?.authorizationWithdrawalReason && <p>撤回原因：{candidate.authorizationWithdrawalReason}</p>}
      </div>
      <StatusBadge tone={authorization.tone}>{authorization.label}</StatusBadge>
      <StatusBadge tone={item.status === 'published' ? 'success' : 'neutral'}>{statusLabels[item.status]}</StatusBadge>
    </li>
  })}</ol>
}

export function CasesPage({ user }: { user: AuthenticatedWorkspace }) {
  const [data, setData] = useState<CaseData>()
  const [error, setError] = useState(false)
  const isAdmin = user.primaryRole === 'admin'

  useEffect(() => {
    const controller = new AbortController()
    setError(false)
    reader.load(user.companyId, isAdmin, controller.signal).then(setData).catch(() => {
      if (!controller.signal.aborted) setError(true)
    })
    return () => controller.abort()
  }, [user.companyId, isAdmin])

  if (error) return <section className="workspace" data-testid="cases-error"><StatusBadge tone="danger">案例读取失败</StatusBadge></section>
  if (!data) return <section className="workspace" data-testid="cases-loading"><StatusBadge tone="info">正在读取案例…</StatusBadge></section>

  return <section className="workspace" data-testid="cases-page">
    <h1>案例馆</h1>
    {isAdmin && <>
      <div className="notice" data-testid="cases-admin-view">
        <strong>管理员案例审核视图</strong>
        <p>这里仅汇总真实授权与审核状态。发布、撤回和媒体处理必须经可信服务执行，当前页面不提供绕过安全边界的操作。</p>
      </div>
      <section className="work-items-section" data-testid="cases-internal">
        <h2>授权与审核台账</h2>
        <AdminCases rows={data.cases} data={data} />
      </section>
    </>}
    <section className="work-items-section" data-testid="cases-public">
      <h2>公开案例</h2>
      <p className="section-hint">公开侧仅展示审核后的品牌、门店、行业、区域、方案与成果等脱敏字段，不展示联系人、详细地址、价格、利润、授权来源或内部记录。</p>
      <PublicCases rows={data.publicCases} />
    </section>
  </section>
}
