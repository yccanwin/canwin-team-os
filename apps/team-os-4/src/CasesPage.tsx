import { useEffect, useState } from 'react'
import type { CaseData, CaseRecord } from './domain/case'
import type { AuthenticatedWorkspace } from './lib/access'
import { SupabaseCaseReader } from './lib/supabase-case-reader'
import { EmptyState, StatusBadge } from './ui'

const reader = new SupabaseCaseReader()
const labels = { draft: '草稿', published: '已发布', unpublished: '已下架' } as const

function List({ rows, data, testId }: { rows: readonly CaseRecord[]; data: CaseData; testId: string }) {
  if (!rows.length) return <EmptyState title="当前没有案例" description="这里只显示权限允许查看的真实案例。" />
  return <ol className="work-item-list" data-testid={testId}>{rows.map(item => {
    const media = data.media.filter(file => file.caseId === item.id)
    return <li key={item.id} data-testid="case-row"><div><strong>{item.title}</strong><span>{item.summary}</span>{media.length > 0 && <small>{media.map(file => file.mediaType === 'logo' ? 'Logo' : '展示码').join(' · ')}</small>}</div><StatusBadge tone={item.status === 'published' ? 'success' : 'neutral'}>{labels[item.status]}</StatusBadge></li>
  })}</ol>
}

export function CasesPage({ user }: { user: AuthenticatedWorkspace }) {
  const [data, setData] = useState<CaseData>()
  const [error, setError] = useState(false)
  useEffect(() => { const controller = new AbortController(); reader.load(user.companyId, controller.signal).then(setData).catch(() => { if (!controller.signal.aborted) setError(true) }); return () => controller.abort() }, [user.companyId])
  if (error) return <section className="workspace" data-testid="cases-error"><StatusBadge tone="danger">案例读取失败</StatusBadge></section>
  if (!data) return <section className="workspace" data-testid="cases-loading"><StatusBadge tone="info">正在读取案例…</StatusBadge></section>
  const published = data.cases.filter(item => item.status === 'published')
  const internal = data.cases.filter(item => item.status !== 'published')
  return <section className="workspace" data-testid="cases-page"><h1>案例馆</h1>{user.primaryRole === 'admin' && <div className="notice" data-testid="cases-admin-view"><strong>管理员案例管理视图</strong><p>仅获客户展示授权并经管理员审核的案例可以公开；撤回授权后立即下架。</p></div>}{user.primaryRole === 'admin' && <section className="work-items-section" data-testid="cases-internal"><h2>内部待处理</h2><List rows={internal} data={data} testId="case-candidate-list" /></section>}<section className="work-items-section" data-testid="cases-public"><h2>公开发布</h2><List rows={published} data={data} testId="case-published-list" /></section></section>
}
