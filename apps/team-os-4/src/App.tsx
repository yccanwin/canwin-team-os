import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Navigate, NavLink, Route, Routes, useParams } from 'react-router-dom'
import { PRIMARY_ROLE_LABELS, type PrimaryRole } from '../../../packages/team-os-4-domain/src/index'
import { canOpenWorkspace, workspacePath, type AuthenticatedWorkspace } from './lib/access'
import { loadAuthenticatedWorkspace } from './lib/current-user'
import { getGreenfieldSupabase, hasGreenfieldEnvironment } from './lib/supabase'
import type { WorkItem, WorkItemSurface } from './domain/work-item'
import { selectWorkItems } from './domain/select-work-items'
import { SupabaseWorkItemReader } from './lib/supabase-work-item-reader'
import { EmptyState, KPICard, ProgressBar, StatusBadge } from './ui'

const ROLE_FOCUS: Readonly<Record<PrimaryRole, string>> = {
  sales: '客户、商机、报价、订单与续费', implementation: '排期、安装、培训、验收与交接',
  operations: '售后、异常、续费协作与服务交付', finance: '收付款、冲销、利润与收益结算',
  admin: '人员权限、经营配置、审批与审计',
}

function LoginGate({ error, onSignedIn }: { error?: string; onSignedIn: (session: Session) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loginError, setLoginError] = useState<string>()
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setLoginError(undefined)
    const result = await getGreenfieldSupabase().auth.signInWithPassword({ email: email.trim(), password })
    setSubmitting(false)
    if (result.error || !result.data.session) setLoginError('登录失败，请检查邮箱和密码。')
    else onSignedIn(result.data.session)
  }
  return (
    <main className="auth-page" data-testid="login-gate">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <div className="brand auth-brand"><span>CW</span><div><strong>CanWin</strong><small>Team OS 4.0</small></div></div>
        <p className="eyebrow">全新独立系统</p><h1>进入岗位工作台</h1>
        <label>邮箱<input data-testid="login-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>密码<input data-testid="login-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {(loginError || error) && <p className="auth-error" data-testid="login-error">{loginError ?? error}</p>}
        <button className="ui-button auth-submit" data-testid="login-submit" disabled={submitting}>{submitting ? '正在登录…' : '登录'}</button>
      </form>
    </main>
  )
}

function WorkItemQueue({ items, surface, user, loading, error }: {
  items: readonly WorkItem[]
  surface: WorkItemSurface
  user: AuthenticatedWorkspace
  loading: boolean
  error?: string
}) {
  if (loading) return <section className="work-items-state" data-testid={`work-items-${surface}-loading`}><StatusBadge tone="info">正在读取工作项…</StatusBadge></section>
  if (error) return <section className="work-items-state" data-testid={`work-items-${surface}-error`}><StatusBadge tone="danger">工作项读取失败</StatusBadge><p>{error}</p></section>
  const selected = selectWorkItems(items, { surface, assigneeId: user.userId, now: new Date().toISOString() })
  if (selected.length === 0) return <div data-testid={`work-items-${surface}-empty`}><EmptyState title="当前没有工作项" description="这里仅显示全新 4.0 中分配给你的真实工作项。" /></div>
  return (
    <ol className="work-item-list" data-testid={`work-items-${surface}-list`}>
      {selected.map((item) => <li key={item.id} data-testid="work-item"><div><strong>{item.nextStep}</strong><span>{item.sourceBusiness}</span></div><StatusBadge tone={item.status === 'waiting' ? 'warning' : item.status === 'completed' ? 'success' : 'info'}>{item.status}</StatusBadge><small>{item.dueAt ?? item.plannedAt ?? '未设置时间'}</small>{item.blockedReason && <p>{item.blockedReason}</p>}</li>)}
    </ol>
  )
}

function Workspace({ user, items, loading, error }: { user: AuthenticatedWorkspace; items: readonly WorkItem[]; loading: boolean; error?: string }) {
  const { role = '' } = useParams()
  if (!canOpenWorkspace(user, role)) {
    return <section className="workspace access-denied" data-testid="access-denied"><p className="eyebrow">访问已拒绝</p><h1>这不是你的岗位工作台</h1><p className="lead">系统只允许进入当前账号的主岗位。</p><NavLink className="ui-button auth-submit" to={workspacePath(user.primaryRole)}>返回我的工作台</NavLink></section>
  }
  const currentRole = role as PrimaryRole
  const workbenchItems = selectWorkItems(items, { surface: 'workbench', assigneeId: user.userId, now: new Date().toISOString() })
  const waitingCount = workbenchItems.filter((item) => item.status === 'waiting').length
  return (
    <section className="workspace" data-testid={`workspace-${currentRole}`} aria-labelledby="workspace-title">
      <p className="eyebrow">4.0 独立岗位工作台</p><h1 id="workspace-title">{PRIMARY_ROLE_LABELS[currentRole]}工作台</h1><p className="lead">{ROLE_FOCUS[currentRole]}</p>
      <div className="metric-grid"><KPICard label="今日推进" value={workbenchItems.length} note="来自统一工作项" tone="success" /><KPICard label="待我处理" value={workbenchItems.filter((item) => item.status === 'pending' || item.status === 'in_progress').length} note="本人当前开放工作项" tone="info" /><KPICard label="阻塞提醒" value={waitingCount} note="等待处理的阻塞工作项" tone="warning" /></div>
      <div className="foundation-progress"><ProgressBar label="G1 岗位壳层" value={30} /></div>
      <section className="work-items-section" data-testid="work-items-workbench" aria-labelledby="workbench-queue-title"><div className="section-heading"><p className="eyebrow">统一工作项</p><h2 id="workbench-queue-title">我的工作台队列</h2></div><WorkItemQueue items={items} surface="workbench" user={user} loading={loading} error={error} /></section>
      {currentRole === 'admin' && <div className="notice" data-testid="admin-management-view"><strong>管理员管理视图</strong><p>人员、权限、经营配置与审计入口将在本视图内逐项开放。</p></div>}
    </section>
  )
}

function WorkItemPage({ surface, title, user, items, loading, error }: { surface: 'progress' | 'calendar'; title: string; user: AuthenticatedWorkspace; items: readonly WorkItem[]; loading: boolean; error?: string }) {
  return <section className="workspace" data-testid={`${surface}-page`}><p className="eyebrow">统一工作项</p><h1>{title}</h1><p className="lead">与我的工作台使用同一份工作项来源。</p><div data-testid={`work-items-${surface}`}><WorkItemQueue items={items} surface={surface} user={user} loading={loading} error={error} /></div></section>
}

function AuthenticatedApp({ user, onSignOut }: { user: AuthenticatedWorkspace; onSignOut: () => Promise<void> }) {
  const [items, setItems] = useState<readonly WorkItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [itemsError, setItemsError] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    setItemsLoading(true); setItemsError(undefined)
    new SupabaseWorkItemReader().load({ companyId: user.companyId, assigneeId: user.userId, signal: controller.signal })
      .then(setItems)
      .catch((reason) => { if (!controller.signal.aborted) setItemsError(reason instanceof Error ? reason.message : 'WORK_ITEM_QUERY_FAILED') })
      .finally(() => { if (!controller.signal.aborted) setItemsLoading(false) })
    return () => controller.abort()
  }, [user.companyId, user.userId])
  return (
    <div className="app-shell" data-testid="authenticated-app">
      <aside><div className="brand"><span>CW</span><div><strong>{user.companyName}</strong><small>Team OS 4.0</small></div></div><nav aria-label="岗位工作台"><NavLink to={workspacePath(user.primaryRole)}>{PRIMARY_ROLE_LABELS[user.primaryRole]}工作台</NavLink><NavLink to="/progress">推进中心</NavLink><NavLink to="/calendar">日历</NavLink></nav><div className="environment ready" data-testid="environment-status"><span aria-hidden="true" />独立测试环境已连接</div></aside>
      <main><header><div><b>{user.displayName}</b><StatusBadge tone="success">{PRIMARY_ROLE_LABELS[user.primaryRole]}</StatusBadge></div><button className="ui-button ui-button--quiet" data-testid="sign-out" onClick={() => void onSignOut()}>退出登录</button></header><Routes><Route path="/" element={<Navigate to={workspacePath(user.primaryRole)} replace />} /><Route path="/workspace/:role" element={<Workspace user={user} items={items} loading={itemsLoading} error={itemsError} />} /><Route path="/progress" element={<WorkItemPage surface="progress" title="推进中心" user={user} items={items} loading={itemsLoading} error={itemsError} />} /><Route path="/calendar" element={<WorkItemPage surface="calendar" title="日历" user={user} items={items} loading={itemsLoading} error={itemsError} />} /><Route path="*" element={<Navigate to={workspacePath(user.primaryRole)} replace />} /></Routes></main>
    </div>
  )
}

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<AuthenticatedWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const hydrate = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession); setUser(null); setError(undefined)
    if (!nextSession) { setLoading(false); return }
    setLoading(true)
    try { setUser(await loadAuthenticatedWorkspace(nextSession.user)) } catch (reason) { setError(reason instanceof Error ? reason.message : '账号岗位读取失败。') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    if (!hasGreenfieldEnvironment()) { setError('全新 4.0 环境尚未配置。'); setLoading(false); return }
    const supabase = getGreenfieldSupabase()
    void supabase.auth.getSession().then(({ data }) => hydrate(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => { void hydrate(nextSession) })
    return () => data.subscription.unsubscribe()
  }, [hydrate])
  if (loading) return <main className="auth-page" data-testid="auth-loading"><StatusBadge tone="info">正在核验 4.0 账号与岗位…</StatusBadge></main>
  if (!session || !user) return <LoginGate error={error} onSignedIn={(nextSession) => void hydrate(nextSession)} />
  return <AuthenticatedApp user={user} onSignOut={async () => { await getGreenfieldSupabase().auth.signOut(); await hydrate(null) }} />
}
