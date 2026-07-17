import { useMemo, useState } from 'react'
import {
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  FilePlus2,
  LayoutDashboard,
  ListTodo,
  MessageSquareText,
  Phone,
  Target,
  UserRound,
} from 'lucide-react'
import type { LeadFollowupContext } from './dataSource'
import type { FollowUpDraft, SalesLead, WorkbenchSummary } from './types'

export type CommandActionBucket = 'overdue' | 'today' | 'week'

export interface CommandCenterAction {
  id: string
  entityId: string
  title: string
  label: string
  reason: string
  dueAt?: string
  owner?: string
  bucket: CommandActionBucket
  tone: 'critical' | 'high' | 'medium' | 'normal'
  entityType: 'lead' | 'renewal' | 'delivery_exception'
}

interface CrmCommandCenterProps {
  summary: WorkbenchSummary
  deliveryExceptions: number
  actions: CommandCenterAction[]
  leads: SalesLead[]
  selected?: SalesLead
  loading: boolean
  error: string
  historyLoading: boolean
  followupContext: LeadFollowupContext | null
  draft: FollowUpDraft
  canRecordFollowup: boolean
  canContactLead: boolean
  showAttemptOutcomes: boolean
  onDraftChange: (draft: FollowUpDraft) => void
  onSelectLead: (id: string) => void
  onOpenAction: (action: CommandCenterAction) => void
  onOpenLeadWorkspace: (id: string) => void
  onContactReached: () => void
  onContactMissed: () => void
  onContactUnreachable: () => void
  onSaveFollowup: () => void
}

const stageNames = ['线索', '商机']

function formatDue(value?: string) {
  if (!value) return '待安排'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function currentStageIndex(lead: SalesLead) {
  if (lead.stage === 'opportunity') return 1
  return 0
}

export function CrmCommandCenter({
  summary,
  deliveryExceptions,
  actions,
  leads,
  selected,
  loading,
  error,
  historyLoading,
  followupContext,
  draft,
  canRecordFollowup,
  canContactLead,
  showAttemptOutcomes,
  onDraftChange,
  onSelectLead,
  onOpenAction,
  onOpenLeadWorkspace,
  onContactReached,
  onContactMissed,
  onContactUnreachable,
  onSaveFollowup,
}: CrmCommandCenterProps) {
  const [view, setView] = useState<'actions' | 'pipeline'>('actions')
  const [activeBucket, setActiveBucket] = useState<CommandActionBucket>('overdue')
  const [actionFilter, setActionFilter] = useState<'all' | 'delivery'>('all')
  const bucketCounts = useMemo(() => ({
    overdue: actions.filter((action) => action.bucket === 'overdue').length,
    today: actions.filter((action) => action.bucket === 'today').length,
    week: actions.filter((action) => action.bucket === 'week').length,
  }), [actions])
  const visibleActions = actions.filter((action) => action.bucket === activeBucket && (actionFilter === 'all' || action.entityType === 'delivery_exception'))
  const pipeline = useMemo(() => ({
    new: leads.filter((lead) => lead.stage === 'new'),
    contacted: leads.filter((lead) => lead.stage === 'contacted'),
    qualified: leads.filter((lead) => lead.stage === 'qualified'),
    opportunity: leads.filter((lead) => lead.stage === 'opportunity'),
  }), [leads])
  const canSave = Boolean(canRecordFollowup && (draft.fact.trim() || draft.commitment.trim()) && draft.nextActionAt)
  const timeline = followupContext?.activities ?? []
  const revealCustomer = () => window.requestAnimationFrame(() => document.getElementById('crm-customer-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  const chooseLead = (id: string) => { onSelectLead(id); revealCustomer() }
  const chooseAction = (action: CommandCenterAction) => { onOpenAction(action); if (action.entityType === 'lead') revealCustomer() }

  return (
    <section className="crm-command-center" aria-label="客如云中心行动工作台">
      <header className="crm-command-toolbar">
        <div><strong>客户推进工作台</strong><span>从今天必须做的事开始，不必按页面顺序逐关填写。</span></div>
        <button disabled={!selected} onClick={() => { revealCustomer(); window.requestAnimationFrame(() => document.getElementById('crm-followup-composer')?.focus()) }}><MessageSquareText size={18} />记录跟进</button>
      </header>
      <div className="crm-command-metrics" aria-label="销售行动概览">
        <Metric icon={Phone} label="待联系" value={summary.newLeads} tone="blue" onClick={() => { setView('pipeline'); setActionFilter('all') }} />
        <Metric icon={CalendarClock} label="今日跟进" value={summary.appointments} tone="cyan" onClick={() => { setView('actions'); setActiveBucket('today'); setActionFilter('all') }} />
        <Metric icon={Target} label="临门商机" value={pipeline.opportunity.length} tone="green" onClick={() => { setView('pipeline'); setActionFilter('all') }} />
        <Metric icon={CircleAlert} label="交付异常" value={deliveryExceptions} tone="orange" onClick={() => { setView('actions'); setActionFilter('delivery'); setActiveBucket(actions.some((action) => action.entityType === 'delivery_exception' && action.bucket === 'overdue') ? 'overdue' : 'today') }} />
      </div>

      <div className="crm-command-layout">
        <section className="crm-action-panel" id="crm-action-panel" aria-label="行动队列">
          <div className="crm-action-tabs" role="tablist" aria-label="工作视图">
            <button id="crm-actions-tab" aria-controls="crm-actions-panel" className={view === 'actions' ? 'is-active' : ''} onClick={() => { setView('actions'); setActionFilter('all') }} role="tab" aria-selected={view === 'actions'}><ListTodo size={17} />行动队列</button>
            <button id="crm-pipeline-tab" aria-controls="crm-pipeline-panel" className={view === 'pipeline' ? 'is-active' : ''} onClick={() => { setView('pipeline'); setActionFilter('all') }} role="tab" aria-selected={view === 'pipeline'}><LayoutDashboard size={17} />成交看板</button>
          </div>

          {error && <div className="crm-command-error" role="alert">{error}</div>}
          {loading && <div className="crm-command-loading" role="status">正在同步最新行动…</div>}

          {view === 'actions' ? <div id="crm-actions-panel" role="tabpanel" aria-labelledby="crm-actions-tab">
            <div className="crm-action-groups" aria-label="行动时间范围">
              <button aria-pressed={activeBucket === 'overdue'} className={activeBucket === 'overdue' ? 'is-active is-overdue' : ''} onClick={() => { setActiveBucket('overdue'); setActionFilter('all') }}>逾期 <span>{bucketCounts.overdue}</span></button>
              <button aria-pressed={activeBucket === 'today'} className={activeBucket === 'today' ? 'is-active' : ''} onClick={() => { setActiveBucket('today'); setActionFilter('all') }}>今天 <span>{bucketCounts.today}</span></button>
              <button aria-pressed={activeBucket === 'week'} className={activeBucket === 'week' ? 'is-active' : ''} onClick={() => { setActiveBucket('week'); setActionFilter('all') }}>本周 <span>{bucketCounts.week}</span></button>
            </div>
            <div className="crm-action-list">
              {visibleActions.map((action) => (
                <button key={action.id} className={`crm-action-row is-${action.tone} ${selected?.id === action.entityId ? 'is-selected' : ''}`} onClick={() => chooseAction(action)}>
                  <span className="crm-action-indicator" />
                  <span className="crm-action-copy"><strong>{action.title}</strong><small>{action.label} · {action.reason}</small></span>
                  <span className="crm-action-meta"><time>{formatDue(action.dueAt)}</time>{action.owner && <small>{action.owner}</small>}</span>
                  <ChevronRight size={17} />
                </button>
              ))}
              {!loading && visibleActions.length === 0 && <div className="crm-command-empty"><CheckCircle2 size={30} /><strong>{actionFilter === 'delivery' ? '当前没有交付异常' : '这一组已经处理完'}</strong><span>可以切换其他时间范围，或查看成交看板。</span></div>}
            </div>
          </div> : <div className="crm-deal-board" id="crm-pipeline-panel" role="tabpanel" aria-labelledby="crm-pipeline-tab">
            <PipelineColumn title="待联系" leads={pipeline.new} selectedId={selected?.id} onSelect={chooseLead} />
            <PipelineColumn title="沟通中" leads={pipeline.contacted} selectedId={selected?.id} onSelect={chooseLead} />
            <PipelineColumn title="待转商机" leads={pipeline.qualified} selectedId={selected?.id} onSelect={chooseLead} />
            <PipelineColumn title="商机推进" leads={pipeline.opportunity} selectedId={selected?.id} onSelect={chooseLead} />
          </div>}
        </section>

        <section className="crm-customer-panel" id="crm-customer-panel" aria-label="客户推进区">
          {!selected ? <div className="crm-customer-empty"><UserRound size={36} /><h2>选择一个客户开始推进</h2><p>左侧会按时间和紧急程度整理需要处理的事项。</p></div> : <>
            <header className="crm-customer-header">
              <div className="crm-customer-avatar"><UserRound size={25} /></div>
              <div><div className="crm-customer-title"><h2>{selected.storeName}</h2><span>{selected.stage === 'opportunity' ? '重点商机' : '跟进中'}</span></div><p>{selected.businessType || '业态待补充'} · {selected.district || '区域待补充'} · 负责人：{selected.ownerDisplayName || '我'}</p></div>
              <div className="crm-customer-header-actions"><button className="crm-mobile-back" onClick={() => document.getElementById('crm-action-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>返回行动队列</button><button onClick={() => onOpenLeadWorkspace(selected.id)}>完整档案 <ChevronRight size={16} /></button></div>
            </header>

            <ol className="crm-stage-track" aria-label="成交阶段">
              {stageNames.map((stage, index) => <li key={stage} className={index < currentStageIndex(selected) ? 'is-done' : index === currentStageIndex(selected) ? 'is-current' : ''}><span>{index < currentStageIndex(selected) ? '✓' : index + 1}</span><small>{stage}</small></li>)}
            </ol>
            <p className="crm-stage-note">报价、定金和订单在对应业务页面继续推进，本页只展示当前可由线索数据确认的阶段。</p>

            <section className="crm-next-action">
              <div><span><Clock3 size={17} />下一步</span><strong>{selected.nextActionAt ? `${formatDue(selected.nextActionAt)} 推进沟通` : selected.stage === 'new' ? '尽快完成首次联系' : '补充下一步时间'}</strong><p>{selected.facts[0] || '围绕客户当前需求记录新事实，让下一次沟通更有准备。'}</p></div>
              <em>{selected.recycleRisk && selected.recycleRisk !== 'none' ? '注意回收风险' : '进行中'}</em>
            </section>

            <div className="crm-quick-actions" aria-label="客户快捷操作">
              <button disabled={!canContactLead} onClick={onContactReached}><Phone size={19} /><span>电话接通</span></button>
              <button onClick={() => document.getElementById('crm-followup-composer')?.focus()}><MessageSquareText size={19} /><span>记录跟进</span></button>
              {selected.stage === 'opportunity' && selected.opportunityId
                ? <a href={`#/quotes-v3?opportunity=${encodeURIComponent(selected.opportunityId)}`}><FilePlus2 size={19} /><span>创建报价</span></a>
                : <button onClick={() => onOpenLeadWorkspace(selected.id)}><Target size={19} /><span>推进商机</span></button>}
              <button onClick={() => document.getElementById('crm-next-action-at')?.focus()}><BellRing size={19} /><span>安排提醒</span></button>
            </div>

            <div className="crm-timeline-heading"><strong>沟通动态</strong><span>{historyLoading ? '加载中…' : `${timeline.length + selected.facts.length} 条记录`}</span></div>
            <div className="crm-timeline">
              {timeline.slice(0, 5).map((item) => <article key={`${item.activityType}-${item.id}`}><span className={item.activityType === 'effective_followup' ? 'is-followup' : 'is-phone'}>{item.activityType === 'effective_followup' ? <MessageSquareText size={16} /> : <Phone size={16} />}</span><div><strong>{item.activityType === 'effective_followup' ? '有效跟进' : item.outcome === 'reached' ? '电话已接通' : item.outcome === 'no_answer' ? '电话未接' : '联系尝试'}</strong><p>{item.businessFact || item.customerCommitment || '已记录本次联系结果'}</p></div><time>{formatDue(item.occurredAt)}</time></article>)}
              {timeline.length === 0 && selected.facts.slice(0, 3).map((fact, index) => <article key={`${fact}-${index}`}><span className="is-followup"><MessageSquareText size={16} /></span><div><strong>跟进事实</strong><p>{fact}</p></div></article>)}
              {!historyLoading && timeline.length === 0 && selected.facts.length === 0 && <div className="crm-timeline-empty">还没有沟通记录，完成首次联系后会在这里形成客户时间轴。</div>}
            </div>

            <div className="crm-followup-composer">
              {!canRecordFollowup && <p className="crm-composer-hint">先记录一次电话接通，再填写有效跟进。</p>}
              <textarea id="crm-followup-composer" disabled={!canRecordFollowup} value={draft.fact} onChange={(event) => onDraftChange({ ...draft, fact: event.target.value })} placeholder="记录新事实、客户反馈或本次沟通结果…" />
              <input disabled={!canRecordFollowup} value={draft.commitment} onChange={(event) => onDraftChange({ ...draft, commitment: event.target.value })} placeholder="客户承诺（选填）" />
              <div><input id="crm-next-action-at" disabled={!canRecordFollowup} type="datetime-local" value={draft.nextActionAt} onChange={(event) => onDraftChange({ ...draft, nextActionAt: event.target.value })} /><span className="crm-composer-spacer" />{showAttemptOutcomes && <><button type="button" disabled={!canContactLead} onClick={onContactMissed}>未接</button><button type="button" disabled={!canContactLead} onClick={onContactUnreachable}>无法联系</button></>}<button className="is-primary" disabled={!canSave} onClick={onSaveFollowup}>保存跟进</button></div>
            </div>

            <details className="crm-secondary-tools"><summary>更多客户资料与资格信息</summary><div><p>资格、联系人、品牌与门店资料继续保留在完整客户工作区，不再占用今日首页。</p><button onClick={() => onOpenLeadWorkspace(selected.id)}>进入资料与资格维护</button></div></details>
          </>}
        </section>
      </div>
    </section>
  )
}

function Metric({ icon: Icon, label, value, tone, onClick }: { icon: typeof Phone; label: string; value: number; tone: string; onClick: () => void }) {
  return <article className={`crm-command-metric is-${tone}`} role="button" tabIndex={0} aria-label={`${label} ${value}，点击筛选`} onClick={onClick} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick() } }}><span><Icon size={21} /></span><div><small>{label}</small><strong>{value}</strong></div></article>
}

function PipelineColumn({ title, leads, selectedId, onSelect }: { title: string; leads: SalesLead[]; selectedId?: string; onSelect: (id: string) => void }) {
  return <section><header><strong>{title}</strong><span>{leads.length}</span></header><div>{leads.map((lead) => <button key={lead.id} className={lead.id === selectedId ? 'is-selected' : ''} onClick={() => onSelect(lead.id)}><strong>{lead.storeName}</strong><small>{lead.nextActionAt ? formatDue(lead.nextActionAt) : lead.contactName || '联系人待补充'}</small></button>)}{leads.length === 0 && <p>暂无客户</p>}</div></section>
}
