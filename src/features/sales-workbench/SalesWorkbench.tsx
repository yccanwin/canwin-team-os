import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  ClipboardList,
  Clock3,
  ContactRound,
  House,
  Plus,
  Phone,
  PackageCheck,
  RotateCcw,
  Settings2,
  Sparkles,
  UsersRound,
} from 'lucide-react'
import { mockCustomers, mockLeads, mockPersonalWorkspace, mockSummary } from './mockData'
import type { ContactAttemptResult, LeadFollowupContext, LeadReadScope, SalesTodayAction, SalesWorkbenchDataSource } from './dataSource'
import type { CustomerBrandSummary, FollowUpDraft, LeadStage, OpportunityQualification, OrderActionSignal, PersonalSalesWorkspace, SalesLead, WorkbenchTab } from './types'
import { prioritizeLead } from './actionPriority'
import { CrmEntityEditor } from './CrmEntityEditor'
import { QualificationEvidenceEditor } from './QualificationEvidenceEditor'
import { QuickLeadForm } from './QuickLeadForm'
import { LeadConversionForm } from './LeadConversionForm'
import { CrmCommandCenter } from './CrmCommandCenter'
import type { CommandActionBucket, CommandCenterAction } from './CrmCommandCenter'
import './sales-workbench.css'

const tabs: Array<{ id: WorkbenchTab; label: string; icon: typeof House }> = [
  { id: 'today', label: '今日', icon: House },
  { id: 'leads', label: '线索', icon: ClipboardList },
  { id: 'customers', label: '客户', icon: UsersRound },
  { id: 'orders', label: '订单', icon: BriefcaseBusiness },
  { id: 'profile', label: '我的', icon: CircleUserRound },
]

const tabDescriptions: Record<WorkbenchTab, string> = {
  today: '先处理今天，再推进成交',
  leads: '联系、跟进并推进有效商机',
  customers: '查看品牌、门店与联系人档案',
  orders: '进入报价、订单与交付流程',
  profile: '查看个人目标与销售结果',
}

const stageLabel: Record<LeadStage, string> = {
  new: '待联系',
  contacted: '已联系',
  qualified: '有效跟进',
  opportunity: '已转商机',
}

const blankDraft: FollowUpDraft = { fact: '', commitment: '', nextActionAt: '' }
const blankQualification: OpportunityQualification = {
  isRealStore: false,
  grade: '',
  fitsAnnualProduct: false,
  keyPersonReached: false,
}

export interface SalesWorkbenchProps {
  initialLeads?: SalesLead[]
  salespersonName?: string
  onLeadChange?: (lead: SalesLead) => void
  demoMode?: boolean
  dataSource?: SalesWorkbenchDataSource
  leadScope?: LeadReadScope
  orderSignals?: OrderActionSignal[]
  initialTab?: WorkbenchTab
}

export function SalesWorkbench({
  initialLeads = mockLeads,
  salespersonName = '销售演示账号',
  onLeadChange,
  demoMode = true,
  dataSource,
  leadScope = 'mine',
  orderSignals = [],
  initialTab = 'today',
}: SalesWorkbenchProps) {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>(initialTab)
  const [leads, setLeads] = useState(() => demoMode ? initialLeads : [])
  const [selectedId, setSelectedId] = useState(() => demoMode ? (initialLeads[0]?.id ?? '') : '')
  const [draft, setDraft] = useState<FollowUpDraft>(blankDraft)
  const [qualification, setQualification] = useState<OpportunityQualification>(blankQualification)
  const [dataError, setDataError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [contactedForForm, setContactedForForm] = useState<string[]>([])
  const [customers, setCustomers] = useState<CustomerBrandSummary[]>(() => demoMode ? mockCustomers : [])
  const [selectedBrandId, setSelectedBrandId] = useState(() => demoMode ? (mockCustomers[0]?.id ?? '') : '')
  const [customerError, setCustomerError] = useState('')
  const [recapStartedAt, setRecapStartedAt] = useState<number | null>(null)
  const [recapSeconds, setRecapSeconds] = useState(60)
  const [recapIsFirst, setRecapIsFirst] = useState(true)
  const [personalWorkspace, setPersonalWorkspace] = useState<PersonalSalesWorkspace | null>(() => demoMode ? mockPersonalWorkspace : null)
  const [assessmentError, setAssessmentError] = useState('')
  const [assessmentLoading, setAssessmentLoading] = useState(false)
  const [currentLeadScope, setCurrentLeadScope] = useState<LeadReadScope>(leadScope)
  const [showCustomerEditor, setShowCustomerEditor] = useState(false)
  const [followupContext, setFollowupContext] = useState<LeadFollowupContext | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [serverTodayActions, setServerTodayActions] = useState<SalesTodayAction[]>([])
  const [todayError, setTodayError] = useState('')
  const [mobileLeadDetailOpen, setMobileLeadDetailOpen] = useState(false)
  const selected = leads.find((lead) => lead.id === selectedId)
  const activeTabConfig = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) setActiveTab(initialTab)
    })
    return () => { active = false }
  }, [initialTab])

  const activateTab = (tab: WorkbenchTab) => {
    setActiveTab(tab)
    if (tab === 'today' && currentLeadScope !== 'mine') setCurrentLeadScope('mine')
    if (tab === 'leads') setMobileLeadDetailOpen(false)
    if (tab !== 'customers') setShowCustomerEditor(false)
  }

  const todayTasks = useMemo(() => leads.filter((lead) => lead.stage !== 'opportunity').map((lead) => prioritizeLead(lead)).sort((a, b) => a.rank - b.rank), [leads])
  const workbenchSummary = useMemo(() => {
    if (demoMode) return mockSummary
    return {
      appointments: serverTodayActions.filter((task) => task.actionType === 'upcoming_appointment').length,
      overdue: serverTodayActions.filter((task) => task.label.includes('逾期') || task.supervisorException).length,
      newLeads: serverTodayActions.filter((task) => task.actionType === 'new_lead').length,
      recycleRisks: serverTodayActions.filter((task) => task.actionType === 'recycle_24h' || task.actionType === 'recycle_48h').length,
    }
  }, [demoMode, serverTodayActions])
  const commandActions = useMemo<CommandCenterAction[]>(() => {
    if (!demoMode) return serverTodayActions.map((action) => ({
      id: action.id,
      entityId: action.entityId,
      entityType: action.entityType,
      title: action.title,
      label: action.label,
      reason: action.reason,
      dueAt: action.dueAt,
      owner: action.entityType === 'lead' ? salespersonName : undefined,
      bucket: actionBucket(action.dueAt, action.supervisorException || action.label.includes('逾期')),
      tone: action.priorityTone,
    }))
    return todayTasks.map(({ lead, priority, label }) => {
      const overdue = priority === 'overdue_appointment' || priority === 'recycle_risk'
      const tone: CommandCenterAction['tone'] = overdue ? 'critical' : priority === 'upcoming_appointment' ? 'high' : priority === 'today_followup' ? 'medium' : 'normal'
      return {
        id: `demo-${lead.id}`,
        entityId: lead.id,
        entityType: 'lead',
        title: lead.storeName,
        label,
        reason: lead.nextActionAt ? '按计划继续推进客户' : '尽快完成首次联系',
        dueAt: lead.nextActionAt,
        owner: lead.ownerDisplayName || salespersonName,
        bucket: actionBucket(lead.nextActionAt, overdue),
        tone,
      }
    })
  }, [demoMode, salespersonName, serverTodayActions, todayTasks])

  useEffect(() => {
    if (demoMode || !dataSource || activeTab !== 'today') return
    let active = true
    dataSource.listTodayActions().then(items => { if (active) { setServerTodayActions(items); setTodayError('') } })
      .catch(error => { if (active) { setServerTodayActions([]); setTodayError(error instanceof Error ? error.message : '读取今日行动队列失败') } })
    return () => { active = false }
  }, [activeTab, dataSource, demoMode])

  useEffect(() => {
    if (recapStartedAt === null) return
    const timer = window.setInterval(() => setRecapSeconds(Math.max(0, 60 - Math.floor((Date.now() - recapStartedAt) / 1000))), 1000)
    return () => window.clearInterval(timer)
  }, [recapStartedAt])

  useEffect(() => {
    if (demoMode) return
    if (!dataSource) {
      queueMicrotask(() => { setLeads([]); setDataError('真实模式未配置数据源，已停止加载；不会回退演示数据。') })
      return
    }
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setIsLoading(true)
      setDataError('')
    })
    dataSource.listLeads(currentLeadScope).then((items) => {
      if (!active) return
      setLeads(items)
      setSelectedId(items[0]?.id ?? '')
      setMobileLeadDetailOpen(false)
    }).catch((error: unknown) => {
      if (!active) return
      setLeads([])
      setSelectedId('')
      setDataError(error instanceof Error ? error.message : '读取线索失败')
    }).finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [dataSource, demoMode, currentLeadScope])

  useEffect(() => {
    if (demoMode || !dataSource || !selectedId || currentLeadScope !== 'mine') { queueMicrotask(() => setFollowupContext(null)); return }
    let active = true
    queueMicrotask(() => setHistoryLoading(true))
    dataSource.getLeadFollowupContext(selectedId).then((context) => { if (active) setFollowupContext(context) })
      .catch((error: unknown) => { if (active) setDataError(error instanceof Error ? error.message : '读取跟进历史失败') })
      .finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [currentLeadScope, dataSource, demoMode, selectedId])

  useEffect(() => {
    if (demoMode) return
    if (!dataSource) {
      queueMicrotask(() => { setCustomers([]); setCustomerError('真实模式未配置客户数据源；不会回退演示客户。') })
      return
    }
    let active = true
    queueMicrotask(() => { if (active) setCustomerError('') })
    dataSource.listCustomers().then((items) => {
      if (!active) return
      setCustomers(items)
      setSelectedBrandId(items[0]?.id ?? '')
    }).catch((error: unknown) => {
      if (!active) return
      setCustomers([])
      setSelectedBrandId('')
      setCustomerError(error instanceof Error ? error.message : '读取客户档案失败')
    })
    return () => { active = false }
  }, [dataSource, demoMode])

  useEffect(() => {
    if (demoMode) return
    if (!dataSource) {
      queueMicrotask(() => { setPersonalWorkspace(null); setAssessmentError('真实模式未配置目标数据源；不会回退演示目标。') })
      return
    }
    let active = true
    queueMicrotask(() => { if (active) { setAssessmentError(''); setAssessmentLoading(true) } })
    dataSource.getMySalesWorkspace().then((workspace) => { if (active) setPersonalWorkspace(workspace) }).catch((error: unknown) => {
      if (!active) return
      setPersonalWorkspace(null)
      setAssessmentError(error instanceof Error ? error.message : '读取我的目标失败')
    }).finally(() => { if (active) setAssessmentLoading(false) })
    return () => { active = false }
  }, [dataSource, demoMode])

  const updateLead = (id: string, update: Partial<SalesLead>) => {
    setLeads((current) => current.map((lead) => {
      if (lead.id !== id) return lead
      const next = { ...lead, ...update }
      onLeadChange?.(next)
      return next
    }))
  }

  const markContacted = (isFirst = true) => {
    if (!selected) return
    setRecapStartedAt(null)
    setRecapSeconds(60)
    setRecapIsFirst(isFirst)
    if (!demoMode) {
      setContactedForForm((current) => current.includes(selected.id) ? current : [...current, selected.id])
      return
    }
    updateLead(selected.id, { stage: 'contacted' })
  }

  const recordContactAttempt = async (result: ContactAttemptResult) => {
    if (!selected || demoMode || !dataSource || currentLeadScope !== 'mine') return
    setIsLoading(true); setDataError('')
    try {
      const isFirstReached = !followupContext?.activities.some((item) => item.outcome === 'reached' || item.activityType === 'effective_followup')
      await dataSource.recordContactAttempt(selected.id, result)
      setFollowupContext(await dataSource.getLeadFollowupContext(selected.id))
      if (result === 'reached') markContacted(isFirstReached)
    } catch (error) { setDataError(error instanceof Error ? error.message : '记录联系尝试失败') }
    finally { setIsLoading(false) }
  }

  const saveQualifiedFollowUp = async () => {
    if (!selected || (!draft.fact.trim() && !draft.commitment.trim()) || !draft.nextActionAt) return
    if (!demoMode) {
      if (!dataSource) return
      setIsLoading(true)
      setDataError('')
      try {
        const updated = await dataSource.createFollowUp(selected.id, draft)
        setLeads((current) => current.map((lead) => lead.id === updated.id ? updated : lead))
        onLeadChange?.(updated)
        setDraft(blankDraft)
        setFollowupContext(await dataSource.getLeadFollowupContext(selected.id))
      } catch (error) {
        setDataError(error instanceof Error ? error.message : '保存跟进失败')
      } finally {
        setIsLoading(false)
      }
      return
    }
    const fact = [
      draft.fact.trim() && `新业务事实：${draft.fact.trim()}`,
      draft.commitment.trim() && `客户承诺：${draft.commitment.trim()}`,
    ].filter(Boolean).join('；')
    updateLead(selected.id, {
      stage: 'qualified',
      facts: [...selected.facts, fact],
      nextActionAt: draft.nextActionAt,
    })
  }

  const claimSelectedLead = async () => {
    if (!selected || demoMode || !dataSource || !selected.claimable) return
    setIsLoading(true)
    setDataError('')
    try {
      const claimed = await dataSource.claimLead(selected.id)
      onLeadChange?.(claimed)
      setCurrentLeadScope('mine')
    } catch (error) {
      setDataError(error instanceof Error ? error.message : '领取线索失败')
    } finally {
      setIsLoading(false)
    }
  }
  const refreshCrm = async () => {
    if (!dataSource) return
    const [customerRows, leadRows] = await Promise.all([dataSource.listCustomers(), dataSource.listLeads(currentLeadScope)])
    setCustomers(customerRows); setLeads(leadRows)
    setSelectedBrandId(customerRows[0]?.id ?? ''); setSelectedId(leadRows[0]?.id ?? '')
  }
  const handleQuickLeadCreated = async (leadId: string) => {
    if (!dataSource) return
    const mine = await dataSource.listLeads('mine')
    setCurrentLeadScope('mine'); setLeads(mine); setSelectedId(leadId); setMobileLeadDetailOpen(true)
  }
  const openTodayAction = async (action: SalesTodayAction) => {
    if (action.entityType !== 'lead') { window.location.assign(action.route); return }
    if (!dataSource) return
    setIsLoading(true); setDataError('')
    try {
      const mine = await dataSource.listLeads('mine')
      setCurrentLeadScope('mine'); setLeads(mine); setSelectedId(action.entityId); activateTab('leads'); setMobileLeadDetailOpen(true)
    } catch (error) { setDataError(error instanceof Error ? error.message : '打开行动对象失败') }
    finally { setIsLoading(false) }
  }

  const convertOpportunity = async () => {
    const qualificationPassed = qualification.isRealStore
      && ['A', 'B', 'C'].includes(qualification.grade)
      && qualification.fitsAnnualProduct
      && qualification.keyPersonReached
    if (!selected || selected.stage !== 'qualified' || !qualificationPassed) return
    if (!demoMode) {
      if (!dataSource || qualification.grade === '' || qualification.grade === 'D') return
      setIsLoading(true); setDataError('')
      try {
        await dataSource.qualifyLead(selected.id)
        const mine = await dataSource.listLeads('mine')
        setLeads(mine); setSelectedId(selected.id)
      } catch (error) { setDataError(error instanceof Error ? error.message : '转有效商机失败') }
      finally { setIsLoading(false) }
      return
    }
    updateLead(selected.id, { stage: 'opportunity' })
  }

  const qualificationPassed = qualification.isRealStore
    && ['A', 'B', 'C'].includes(qualification.grade)
    && qualification.fitsAnnualProduct
    && qualification.keyPersonReached
  const leadAllowsActivity = demoMode || Boolean(followupContext && !['nurturing', 'supervisor_review'].includes(followupContext.leadStatus))

  return (
    <section className="sales-workbench" aria-label={`CanWin 3.0 销售工作台${demoMode ? '演示' : ''}`}>
      <aside className="sw-desktop-nav" aria-label="销售工作台一级导航">
        <div className="sw-brand-mark"><span>CANWIN</span><strong>销售工作台</strong></div>
        <div className="sw-desktop-nav-items">
          {tabs.map(({ id, label, icon: Icon }) => <button key={id} className={activeTab === id ? 'is-active' : ''} onClick={() => activateTab(id)}><Icon size={19} /><span>{label}</span></button>)}
        </div>
        <div className="sw-account-card"><div className="sw-avatar" title={salespersonName}>销</div><span><strong>{salespersonName}</strong><small>{demoMode ? '演示模式' : '真实数据'}</small></span></div>
      </aside>

      <div className="sw-workspace">
        <header className="sw-header">
          <div>
            <span className="sw-eyebrow">销售工作台 / {activeTabConfig.label}</span>
            <h1>{activeTab === 'today' ? '客如云中心' : activeTabConfig.label}</h1>
            <p>{tabDescriptions[activeTab]}</p>
          </div>
          <div className="sw-mobile-account"><div className="sw-avatar" title={salespersonName}>销</div></div>
        </header>

        <main className="sw-main">
        {dataError && <div className="sw-data-error" role="alert">{dataError}</div>}
        {isLoading && activeTab !== 'today' && <div className="sw-loading" role="status">正在处理，请稍候…</div>}
        {activeTab === 'today' && (
          <CrmCommandCenter
            summary={workbenchSummary}
            deliveryExceptions={demoMode
              ? orderSignals.find((signal) => signal.kind === 'delivery_exception')?.count ?? 0
              : serverTodayActions.filter((action) => action.entityType === 'delivery_exception').length}
            actions={commandActions}
            leads={leads}
            selected={selected}
            loading={isLoading}
            error={todayError}
            historyLoading={historyLoading}
            followupContext={followupContext}
            draft={draft}
            canRecordFollowup={Boolean(selected && leadAllowsActivity)}
            canContactLead={leadAllowsActivity}
            showAttemptOutcomes={!demoMode}
            onDraftChange={setDraft}
            onSelectLead={(id) => { setSelectedId(id); setDraft(blankDraft) }}
            onOpenAction={(action) => {
              if (action.entityType === 'lead') { setSelectedId(action.entityId); setDraft(blankDraft); return }
              const serverAction = serverTodayActions.find((item) => item.id === action.id)
              if (serverAction) void openTodayAction(serverAction)
            }}
            onOpenLeadWorkspace={(id) => { setSelectedId(id); activateTab('leads'); setMobileLeadDetailOpen(true) }}
            onContactReached={() => {
              if (!selected) return
              if (demoMode) markContacted()
              else void recordContactAttempt('reached')
            }}
            onContactMissed={() => { if (!demoMode) void recordContactAttempt('no_answer') }}
            onContactUnreachable={() => { if (!demoMode) void recordContactAttempt('unreachable') }}
            onSaveFollowup={() => void saveQualifiedFollowUp()}
          />
        )}

        {activeTab === 'leads' && (
          <><div className="sw-lead-actions">{!demoMode && dataSource && <QuickLeadForm dataSource={dataSource} onCreated={handleQuickLeadCreated} />}</div><div className={`sw-lead-layout ${mobileLeadDetailOpen ? 'is-mobile-detail' : ''}`}>
            <aside className="sw-lead-list-panel">
              {!demoMode && <><div className="sw-scope-switch"><button className={currentLeadScope === 'mine' ? 'is-active' : ''} onClick={() => { setCurrentLeadScope('mine'); setMobileLeadDetailOpen(false) }}>我的线索</button><button className={currentLeadScope === 'region' ? 'is-active' : ''} onClick={() => { setCurrentLeadScope('region'); setMobileLeadDetailOpen(false) }}>区域公海</button></div><p className="sw-scope-note">{currentLeadScope === 'mine' ? '仅显示由我负责、可以继续跟进的线索' : '可领取线索由服务端确认；已占用线索仅显示负责人'}</p></>}
              <div className="sw-lead-list">
              {leads.map((lead) => (
                <button key={lead.id} className={`${lead.id === selectedId ? 'is-selected ' : ''}${currentLeadScope === 'region' && !lead.claimable ? 'is-occupied' : ''}`} onClick={() => { setSelectedId(lead.id); setDraft(blankDraft); setMobileLeadDetailOpen(true) }}>
                  {currentLeadScope === 'region' && !lead.claimable
                    ? <><span><strong>已占用线索</strong><small>业务信息不可查看</small></span><em>负责人：{lead.ownerDisplayName ?? '未显示'}</em></>
                    : <><span><strong>{lead.storeName}</strong><small>{lead.contactName} · {lead.businessType}</small>{currentLeadScope === 'mine' && <LeadRiskBadge lead={lead} />}</span><em>{currentLeadScope === 'region' ? '可领取' : stageLabel[lead.stage]}</em></>}
                </button>
              ))}
              {!isLoading && leads.length === 0 && <div className="sw-scope-empty">{currentLeadScope === 'mine' ? '暂无我的线索' : '当前区域公海暂无可见线索'}</div>}
              </div>
            </aside>
            {selected && currentLeadScope === 'region' && !selected.claimable && <article className="sw-lead-detail sw-occupied-detail"><button className="sw-mobile-detail-back" onClick={() => setMobileLeadDetailOpen(false)}><ArrowLeft size={18} />返回线索列表</button><ContactRound size={30} /><h2>该线索已有负责人</h2><p>负责人：{selected.ownerDisplayName ?? '未显示'}</p><span>为保护客户信息，公海列表不展示已占用线索的业务详情，也不可领取。</span></article>}
            {selected && !(currentLeadScope === 'region' && !selected.claimable) && (
              <article className="sw-lead-detail">
                <button className="sw-mobile-detail-back" onClick={() => setMobileLeadDetailOpen(false)}><ArrowLeft size={18} />返回线索列表</button>
                <div className="sw-detail-heading">
                  <div><span className="sw-status">{stageLabel[selected.stage]}</span><h2>{selected.storeName}</h2><p>{selected.contactName} · {selected.phone} · {selected.district}</p></div>
                  <ContactRound size={28} />
                </div>
                <dl className="sw-facts"><div><dt>业态</dt><dd>{selected.businessType}</dd></div><div><dt>来源</dt><dd>{selected.source}</dd></div><div><dt>创建</dt><dd>{selected.createdAt}</dd></div></dl>
                {currentLeadScope === 'mine' && <div className="sw-risk-panel"><LeadRiskBadge lead={selected} /><span>{selected.recyclePaused ? '服务端已暂停自动回收' : selected.recycleDueAt ? `服务端回收节点：${new Date(selected.recycleDueAt).toLocaleString('zh-CN')}` : '当前没有回收风险'}</span></div>}

                {selected.facts.length > 0 && <div className="sw-known-facts"><strong>已获得的新事实</strong>{selected.facts.map((fact) => <p key={fact}><CheckCircle2 size={15} />{fact}</p>)}</div>}
                {!demoMode && currentLeadScope === 'mine' && dataSource && selected.facts.length > 0 && <div id="lead-customer-profile"><LeadConversionForm leadId={selected.id} defaultContactName={selected.contactName} dataSource={dataSource} onConverted={refreshCrm} /></div>}

                <SalesJourney completedThrough={selected.stage === 'opportunity' ? 2 : 0} />
                {selected.stage === 'new' && <div className="sw-next-step"><strong>下一步：先联系客户</strong><span>普通线索不能直接创建订单。电话接通并保存有效跟进后，才能完善客户档案和资格。</span></div>}
                {selected.stage === 'contacted' && <div className="sw-next-step"><strong>下一步：保存有效跟进</strong><span>至少记录一项新业务事实或客户承诺，并设置下一步时间。</span><button onClick={() => document.getElementById('lead-followup-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>去填写跟进</button></div>}
                {selected.stage === 'qualified' && <div className="sw-next-step"><strong>下一步：完善客户并转商机</strong><span>先创建或关联品牌、门店和联系人，再补齐真实门店、价值等级、年费与关键人资格。</span><div><button onClick={() => document.getElementById('lead-customer-profile')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>去完善客户</button><button onClick={() => document.getElementById('lead-qualification')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>去转商机</button></div></div>}

                {!demoMode && currentLeadScope === 'region' && selected.claimable && <button className="sw-secondary" disabled={isLoading} onClick={claimSelectedLead}>通过 RPC 领取该线索</button>}
                {!demoMode && currentLeadScope === 'region' && !selected.claimable && <div className="sw-owner-notice">已占用 · 负责人：{selected.ownerDisplayName ?? '未显示'} · 不可领取</div>}

                {(demoMode ? selected.stage === 'new' : currentLeadScope === 'mine' && followupContext && !['nurturing', 'supervisor_review'].includes(followupContext.leadStatus)) && <section className="sw-followup-stage"><header><span>01</span><div><strong>联系情况</strong><small>先记录本次电话结果</small></div></header><div className="sw-attempt-actions">
                  <button className="sw-primary" disabled={isLoading} onClick={() => demoMode ? markContacted() : void recordContactAttempt('reached')}><Phone size={18} />电话已接通</button>
                  {!demoMode && <><button className="sw-secondary" disabled={isLoading} onClick={() => void recordContactAttempt('no_answer')}>未接电话</button><button className="sw-secondary" disabled={isLoading} onClick={() => void recordContactAttempt('unreachable')}>无法联系</button></>}
                </div></section>}
                {(selected.stage === 'contacted' || contactedForForm.includes(selected.id)) && (
                  <div className="sw-followup-form" id="lead-followup-form">
                    <section className="sw-followup-stage"><header><span>02</span><div><strong>{recapIsFirst ? '60 秒复盘' : '本次沟通记录'}</strong><small>{recapIsFirst ? (recapSeconds > 0 ? `建议剩余 ${recapSeconds} 秒` : '可继续填写，内容完整优先') : '记录新的业务事实或客户承诺'}</small></div></header><p className="sw-either-hint">新业务事实 / 客户承诺：二选一至少填写一项</p><label>获得的新业务事实（二选一）<textarea value={draft.fact} onChange={(event) => setDraft({ ...draft, fact: event.target.value })} placeholder="例如：新店计划8月18日开业，目前使用竞品收银系统" /></label><label>客户承诺（二选一）<input value={draft.commitment} onChange={(event) => setDraft({ ...draft, commitment: event.target.value })} placeholder="例如：周五安排老板参加演示" /></label></section>
                    <section className="sw-followup-stage"><header><span>03</span><div><strong>下一步</strong><small>明确下一次推进时间</small></div></header><label>下一步时间（必填）<input type="datetime-local" value={draft.nextActionAt} onChange={(event) => setDraft({ ...draft, nextActionAt: event.target.value })} /></label></section>
                    <div className="sw-followup-save"><button className="sw-primary" disabled={(!draft.fact.trim() && !draft.commitment.trim()) || !draft.nextActionAt} onClick={saveQualifiedFollowUp}><CheckCircle2 size={18} />保存有效跟进</button></div>
                  </div>
                )}
                {!demoMode && currentLeadScope === 'mine' && <LeadFollowupHistory context={followupContext} loading={historyLoading} />}
                {selected.stage === 'qualified' && demoMode && (
                  <div className="sw-qualification">
                    <div className="sw-qualification-heading"><strong>有效商机资格门</strong><span>{qualificationPassed ? '4/4 已通过' : '需全部通过'}</span></div>
                    <label><input type="checkbox" checked={qualification.isRealStore} onChange={(event) => setQualification({ ...qualification, isRealStore: event.target.checked })} /><span><strong>真实门店</strong><small>已确认门店真实存在</small></span></label>
                    <label className="sw-grade-field"><span><strong>业务价值等级</strong><small>D级禁止进入有效商机</small></span><select value={qualification.grade} onChange={(event) => setQualification({ ...qualification, grade: event.target.value as OpportunityQualification['grade'] })}><option value="">请选择</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D（退出漏斗）</option></select></label>
                    <label><input type="checkbox" checked={qualification.fitsAnnualProduct} onChange={(event) => setQualification({ ...qualification, fitsAnnualProduct: event.target.checked })} /><span><strong>适合年费产品</strong><small>年费产品可以继续谈</small></span></label>
                    <label><input type="checkbox" checked={qualification.keyPersonReached} onChange={(event) => setQualification({ ...qualification, keyPersonReached: event.target.checked })} /><span><strong>关键人已建立联系</strong><small>已接触或明确约到关键人</small></span></label>
                    {qualification.grade === 'D' && <p className="sw-block-message">D级或纯外卖店退出有效漏斗，不能转为商机。</p>}
                    <button className="sw-primary" disabled={!qualificationPassed} onClick={convertOpportunity}><Sparkles size={18} />转为有效商机</button>
                  </div>
                )}
                {selected.stage === 'opportunity' && <div className="sw-success"><CheckCircle2 /><div><strong>已转为有效商机</strong><span>资格证据已由服务端确认，可进入报价流程。</span>{selected.opportunityId && <a className="sw-primary" href={`#/quotes-v3?opportunity=${encodeURIComponent(selected.opportunityId)}`}>进入报价</a>}</div></div>}
                {demoMode && selected.stage !== 'new' && <button className="sw-reset" onClick={() => { setDraft(blankDraft); setQualification(blankQualification); setRecapStartedAt(null); setRecapSeconds(60); updateLead(selected.id, { stage: 'new', facts: [], nextActionAt: undefined }) }}><RotateCcw size={15} />重置演示</button>}
              </article>
            )}
          </div></>
        )}

        {activeTab === 'customers' && (
          <div className="sw-customer-page">
            <div className="sw-page-actions">
              <div><strong>{showCustomerEditor ? '维护客户资料' : '客户档案'}</strong><span>{showCustomerEditor ? '品牌、门店与联系人资料维护；新线索请在线索页创建' : `${customers.length} 个可见品牌客户`}</span></div>
              {!demoMode && dataSource && <button className="sw-compact-action" onClick={() => setShowCustomerEditor((current) => !current)}>{showCustomerEditor ? <><UsersRound size={17} />返回客户列表</> : <><Plus size={17} />新建或维护</>}</button>}
            </div>
            {showCustomerEditor && !demoMode && dataSource
              ? <div className="sw-editor-page"><div className="sw-editor-note"><Settings2 size={18} /><span>资料维护是独立操作区，保存后会自动返回最新真实数据。</span></div><CrmEntityEditor dataSource={dataSource} onSaved={refreshCrm} /></div>
              : <CustomerDirectory customers={customers} selectedBrandId={selectedBrandId} onSelectBrand={setSelectedBrandId} error={customerError} />}
          </div>
        )}
        {activeTab === 'orders' && <OrderEntry />}
        {activeTab === 'profile' && <MySalesWorkspace name={salespersonName} workspace={personalWorkspace} error={assessmentError} loading={assessmentLoading} />}
        {activeTab === 'leads' && selected && ['contacted', 'qualified'].includes(selected.stage) && !demoMode && dataSource && (
          <div className={`sw-floating-evidence ${mobileLeadDetailOpen ? '' : 'is-mobile-hidden'}`} id="lead-qualification">
            <QualificationEvidenceEditor
              leadId={selected.id}
              dataSource={dataSource}
              onQualified={async () => {
                const mine = await dataSource.listLeads('mine')
                setLeads(mine)
                setSelectedId(selected.id)
              }}
            />
          </div>
        )}
        </main>
      </div>

      <nav className="sw-bottom-nav" aria-label="销售工作台导航">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} className={activeTab === id ? 'is-active' : ''} onClick={() => activateTab(id)}><Icon size={21} /><span>{label}</span></button>)}
      </nav>
    </section>
  )
}

function FlowStep({ done, label }: { done: boolean; label: string }) {
  return <div className={done ? 'is-done' : ''}><span>{done ? '✓' : ''}</span><small>{label}</small></div>
}

function actionBucket(dueAt?: string, isOverdue = false): CommandActionBucket {
  if (isOverdue) return 'overdue'
  if (!dueAt) return 'today'
  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return 'today'
  const now = new Date()
  if (due.getTime() < now.getTime()) return 'overdue'
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)
  return due.getTime() <= endOfToday.getTime() ? 'today' : 'week'
}

const salesJourneySteps = ['线索', '客户档案与资格', '商机', '报价', '定金', '订单']

function SalesJourney({ completedThrough }: { completedThrough: number }) {
  return <div className="sw-journey" aria-label="销售成交链路">{salesJourneySteps.map((label, index) => <FlowStep key={label} done={index <= completedThrough} label={label} />)}</div>
}

function LeadFollowupHistory({ context, loading }: { context: LeadFollowupContext | null; loading: boolean }) {
  if (loading) return <div className="sw-history"><strong>跟进历史</strong><p>正在读取服务端记录…</p></div>
  if (!context) return null
  const attemptLabels: Record<string, string> = { reached: '电话已接通', no_answer: '未接电话', unreachable: '无法联系', workbench_follow_up: '有效跟进' }
  return <section className="sw-history">
    <header><strong>跟进历史</strong><span>{context.activities.length} 条真实记录</span></header>
    {context.leadStatus === 'nurturing' && <div className="sw-nurture-notice"><strong>已进入首轮30天培育</strong><span>{context.nurtureUntil ? `服务端培育至 ${context.nurtureUntil}` : '培育期限由服务端管理'}</span></div>}
    {context.leadStatus === 'supervisor_review' && <div className="sw-nurture-notice"><strong>首轮培育已结束，等待主管审核</strong><span>阶段由服务端管理，销售端不可修改</span></div>}
    {context.unreachableDays >= 3 && context.leadStatus !== 'nurturing' && <div className="sw-nurture-notice is-pending"><strong>已有 {context.unreachableDays} 个不同日期联系不到</strong><span>等待服务端批处理进入培育，浏览器不会修改阶段</span></div>}
    <div className="sw-history-list">{context.activities.map((item) => <article key={`${item.activityType}-${item.id}`}>
      <div><strong>{item.activityType === 'effective_followup' ? '有效跟进' : attemptLabels[item.outcome] ?? item.outcome}</strong><time>{new Date(item.occurredAt).toLocaleString('zh-CN')}</time></div>
      {item.businessFact && <p>新业务事实：{item.businessFact}</p>}
      {item.customerCommitment && <p>客户承诺：{item.customerCommitment}</p>}
      {item.nextActionAt && <small>下一步：{new Date(item.nextActionAt).toLocaleString('zh-CN')}</small>}
    </article>)}</div>
    {context.activities.length === 0 && <p className="sw-empty-line">暂无联系或有效跟进记录</p>}
  </section>
}

function LeadRiskBadge({ lead }: { lead: SalesLead }) {
  if (lead.recyclePaused) return <small className="sw-risk-badge is-paused">回收已暂停</small>
  if (lead.recycleRisk === 'uncontacted_24h') return <small className="sw-risk-badge is-warning">24小时未联系</small>
  if (lead.recycleRisk === 'uncontacted_48h') return <small className="sw-risk-badge is-danger">48小时回收风险</small>
  if (lead.recycleRisk === 'inactive_15d') return <small className="sw-risk-badge is-danger">15天无有效跟进</small>
  return <small className="sw-risk-badge is-safe">正常</small>
}

function Placeholder({ icon: Icon, title, text }: { icon: typeof Clock3; title: string; text: string }) {
  return <div className="sw-placeholder"><Icon size={34} /><h2>{title}</h2><p>{text}</p></div>
}

function CustomerDirectory({ customers, selectedBrandId, onSelectBrand, error }: { customers: CustomerBrandSummary[]; selectedBrandId: string; onSelectBrand: (id: string) => void; error: string }) {
  const selected = customers.find((brand) => brand.id === selectedBrandId)
  if (error) return <div className="sw-data-error" role="alert">{error}</div>
  if (customers.length === 0) return <Placeholder icon={UsersRound} title="暂无可见客户" text="当前账号权限范围内没有品牌客户。" />
  return <div className="sw-customer-layout">
    <aside className="sw-customer-brands">{customers.map((brand) => <button key={brand.id} className={brand.id === selectedBrandId ? 'is-selected' : ''} onClick={() => onSelectBrand(brand.id)}><strong>{brand.name}</strong><span>{brand.stores.length} 家门店</span></button>)}</aside>
    {selected && <section className="sw-customer-detail"><div className="sw-detail-heading"><div><span className="sw-status">品牌客户</span><h2>{selected.name}</h2><p>只读档案 · {selected.stores.length} 家门店</p></div><UsersRound size={28} /></div><div className="sw-store-list">{selected.stores.map((store) => <article key={store.id}><div><strong>{store.name}</strong><span>{store.district} · {store.businessType}</span></div><div className="sw-contact-list">{store.contacts.length ? store.contacts.map((contact) => <span key={contact.id}>{contact.name} · {contact.role}</span>) : <span>暂无公开联系人</span>}</div></article>)}</div></section>}
  </div>
}

function MySalesWorkspace({ name, workspace, error, loading }: { name: string; workspace: PersonalSalesWorkspace | null; error: string; loading: boolean }) {
  const money = (value: number) => `¥${value.toLocaleString('zh-CN')}`
  if (error) return <div className="sw-data-error" role="alert">{error}</div>
  if (loading) return <div className="sw-profile-targets"><p className="sw-empty-line">正在读取本季度个人目标…</p></div>
  if (!workspace) return <div className="sw-profile-targets"><p className="sw-empty-line">当前无法读取个人工作台。</p></div>
  const displayName = workspace.displayName || name
  return <div className="sw-profile-targets">
    <div className="sw-detail-heading"><div><span className="sw-status">仅本人可见</span><h2>{displayName}</h2><p>{workspace.quarterLabel} · {workspace.quarterStart} 至 {workspace.quarterEnd}</p></div><CircleUserRound size={30} /></div>
    {!workspace.target ? <div className="sw-profile-empty"><strong>本季度尚未设置个人目标</strong><p>请联系主管设置积分、新签 GMV 与续费 GMV 目标。设置后会自动显示在这里。</p></div> : <>
      <section className="sw-point-ledgers" aria-label="积分双口径">
        <div className="is-estimated"><span>预计积分</span><strong>{workspace.target.estimatedPoints.toLocaleString('zh-CN')}</strong><small>销售过程口径 · 目标 {workspace.target.pointTarget.toLocaleString('zh-CN')}</small></div>
        <div className="is-official"><span>官方确认积分</span><strong>{workspace.target.officialPoints.toLocaleString('zh-CN')}</strong><small>财务确认口径 · 只读</small></div>
      </section>
      <article className="sw-quarter-targets"><header><strong>本季度 GMV</strong><span>按月观察</span></header><div className="sw-target-grid"><MetricPair label="新签 GMV" target={money(workspace.target.newGmvTarget)} actual={money(workspace.target.newGmvActual)} /><MetricPair label="续费 GMV" target={money(workspace.target.renewalGmvTarget)} actual={money(workspace.target.renewalGmvActual)} /></div></article>
      <section className="sw-monthly-observations"><h3>月度确认进展</h3>{workspace.monthlyObservations.map((month) => <article key={month.monthStart}><strong>{month.monthLabel}</strong><div><span>新签<em>{money(month.newGmv)}</em></span><span>续费<em>{money(month.renewalGmv)}</em></span><span>确认积分<em>{month.officialPoints.toLocaleString('zh-CN')}</em></span></div></article>)}</section>
    </>}
  </div>
}

function MetricPair({ label, target, actual }: { label: string; target: string; actual?: string }) {
  return <div><span>{label}</span><strong>{target}</strong><small>{actual === undefined ? '季度目标' : `实际 ${actual}`}</small></div>
}

function OrderEntry() {
  return <div className="sw-order-hub">
    <section className="sw-order-guide"><strong>订单从哪里来</strong><SalesJourney completedThrough={-1} /><p>普通线索不能直接创建订单。请先完成客户档案与资格、转为有效商机、生成报价；财务确认定金后，系统才会生成订单。</p><a href="#/sales-v3?tab=leads">去完善客户或转商机</a></section>
    <a href="#/quotes-v3"><BriefcaseBusiness size={30} /><span><strong>报价与定金</strong><small>新建报价、查看报价状态与定金进度</small></span><ChevronRight size={20} /></a>
    <a href="#/orders-v3"><PackageCheck size={30} /><span><strong>订单与履约</strong><small>查看软件、硬件履约、交付异常和续费进度</small></span><ChevronRight size={20} /></a>
  </div>
}

export default SalesWorkbench

