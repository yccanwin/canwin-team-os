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
import type { ScheduleEvent } from './domain/schedule-event'
import { SupabaseScheduleEventReader } from './lib/supabase-schedule-event-reader'
import { EmptyState, KPICard, ProgressBar, StatusBadge } from './ui'
import { CustomerDirectoryPage } from './CustomerDirectoryPage'
import { SalesPipelinePage } from './SalesPipelinePage'

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

const SCHEDULE_KIND_LABELS: Readonly<Record<ScheduleEvent['kind'], string>> = { meeting: '会议', visit: '拜访', break: '休息', personal: '个人安排' }
const LOCAL_DATE_TIME = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

function ScheduleEventList({ events, loading, error }: { events: readonly ScheduleEvent[]; loading: boolean; error?: string }) {
  if (loading) return <section className="work-items-state" data-testid="schedule-events-calendar-loading"><StatusBadge tone="info">正在读取个人日程…</StatusBadge></section>
  if (error) return <section className="work-items-state" data-testid="schedule-events-calendar-error"><StatusBadge tone="danger">个人日程读取失败</StatusBadge></section>
  if (events.length === 0) return <div data-testid="schedule-events-calendar-empty"><EmptyState title="当前没有个人日程" description="会议、拜访、休息日和个人行程会显示在这里，不会复制成工作项。" /></div>
  const orderedEvents = events.toSorted((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt) || left.id.localeCompare(right.id))
  return <ol className="work-item-list schedule-event-list" data-testid="schedule-events-calendar-list">{orderedEvents.map((event) => <li key={event.id} data-testid="schedule-event"><div><strong>{event.title}</strong><span>{SCHEDULE_KIND_LABELS[event.kind]}</span></div><StatusBadge tone="neutral">个人日程</StatusBadge><small>{LOCAL_DATE_TIME.format(new Date(event.startsAt))} — {LOCAL_DATE_TIME.format(new Date(event.endsAt))}</small>{event.location && <p>{event.location}</p>}</li>)}</ol>
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

function WorkItemPage({ surface, title, user, items, loading, error, scheduleEvents = [], scheduleLoading = false, scheduleError }: { surface: 'progress' | 'calendar'; title: string; user: AuthenticatedWorkspace; items: readonly WorkItem[]; loading: boolean; error?: string; scheduleEvents?: readonly ScheduleEvent[]; scheduleLoading?: boolean; scheduleError?: string }) {
  const calendar = surface === 'calendar'
  return <section className="workspace" data-testid={`${surface}-page`}><p className="eyebrow">{calendar ? '统一时间视图' : '统一工作项'}</p><h1>{title}</h1><p className="lead">{calendar ? '工作项时间与个人日程同屏展示，但始终保持两类独立记录。' : '与我的工作台使用同一份工作项来源。'}</p><section className={calendar ? 'calendar-source' : ''} data-testid={`work-items-${surface}`}>{calendar && <div className="section-heading"><p className="eyebrow">工作项时间</p><h2>截止与计划</h2></div>}<WorkItemQueue items={items} surface={surface} user={user} loading={loading} error={error} /></section>{calendar && <section className="work-items-section calendar-source calendar-source--schedule" data-testid="schedule-events-calendar"><div className="section-heading"><p className="eyebrow">个人日程</p><h2>会议、拜访与个人安排</h2></div><ScheduleEventList events={scheduleEvents} loading={scheduleLoading} error={scheduleError} /></section>}</section>
}

function AuthenticatedApp({ user, onSignOut }: { user: AuthenticatedWorkspace; onSignOut: () => Promise<void> }) {
  const [items, setItems] = useState<readonly WorkItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [itemsError, setItemsError] = useState<string>()
  const [scheduleEvents, setScheduleEvents] = useState<readonly ScheduleEvent[]>([])
  const [scheduleLoading, setScheduleLoading] = useState(true)
  const [scheduleError, setScheduleError] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    setItemsLoading(true); setItemsError(undefined)
    new SupabaseWorkItemReader().load({ companyId: user.companyId, assigneeId: user.userId, signal: controller.signal })
      .then(setItems)
      .catch((reason) => { if (!controller.signal.aborted) setItemsError(reason instanceof Error ? reason.message : 'WORK_ITEM_QUERY_FAILED') })
      .finally(() => { if (!controller.signal.aborted) setItemsLoading(false) })
    return () => controller.abort()
  }, [user.companyId, user.userId])
  useEffect(() => {
    const controller = new AbortController()
    setScheduleLoading(true); setScheduleError(undefined)
    new SupabaseScheduleEventReader().load({ companyId: user.companyId, ownerId: user.userId, signal: controller.signal })
      .then(setScheduleEvents)
      .catch(() => { if (!controller.signal.aborted) setScheduleError('SCHEDULE_EVENT_QUERY_FAILED') })
      .finally(() => { if (!controller.signal.aborted) setScheduleLoading(false) })
    return () => controller.abort()
  }, [user.companyId, user.userId])
  return (
    <div className="app-shell" data-testid="authenticated-app">
      <aside><div className="brand"><span>CW</span><div><strong>{user.companyName}</strong><small>Team OS 4.0</small></div></div><nav aria-label="岗位工作台"><NavLink to={workspacePath(user.primaryRole)}>{PRIMARY_ROLE_LABELS[user.primaryRole]}工作台</NavLink><NavLink to="/progress">推进中心</NavLink><NavLink to="/calendar">日历</NavLink>{(user.primaryRole === 'sales' || user.primaryRole === 'admin') && <><NavLink to="/leads">今日线索与商机</NavLink><NavLink to="/customers">客户与门店</NavLink></>}</nav><div className="environment ready" data-testid="environment-status"><span aria-hidden="true" />独立测试环境已连接</div></aside>
      <main><header><div><b>{user.displayName}</b><StatusBadge tone="success">{PRIMARY_ROLE_LABELS[user.primaryRole]}</StatusBadge></div><button className="ui-button ui-button--quiet" data-testid="sign-out" onClick={() => void onSignOut()}>退出登录</button></header><Routes><Route path="/" element={<Navigate to={workspacePath(user.primaryRole)} replace />} /><Route path="/workspace/:role" element={<Workspace user={user} items={items} loading={itemsLoading} error={itemsError} />} /><Route path="/progress" element={<WorkItemPage surface="progress" title="推进中心" user={user} items={items} loading={itemsLoading} error={itemsError} />} /><Route path="/calendar" element={<WorkItemPage surface="calendar" title="日历" user={user} items={items} loading={itemsLoading} error={itemsError} scheduleEvents={scheduleEvents} scheduleLoading={scheduleLoading} scheduleError={scheduleError} />} /><Route path="/leads" element={<SalesPipelinePage user={user} />} /><Route path="/customers" element={<CustomerDirectoryPage user={user} />} /><Route path="*" element={<Navigate to={workspacePath(user.primaryRole)} replace />} /></Routes></main>
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
