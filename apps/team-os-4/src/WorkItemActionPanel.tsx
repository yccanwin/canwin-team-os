import { useState, type FormEvent } from 'react'
import { NavLink } from 'react-router-dom'
import type { WorkItem } from './domain/work-item'
import {
  WorkItemCommandGateway,
  businessActionRoute,
  type WorkItemTransitionTarget,
} from './domain/work-item-command'

function availableTransitions(item: WorkItem): readonly WorkItemTransitionTarget[] {
  if (item.status === 'pending') return ['in_progress', 'cancelled']
  if (item.status === 'in_progress') return ['waiting', 'cancelled']
  if (item.status === 'waiting') return ['in_progress', 'cancelled']
  return []
}

export function WorkItemActionPanel({
  item,
  gateway,
  onChanged,
}: {
  item: WorkItem
  gateway: WorkItemCommandGateway
  onChanged: () => void
}) {
  const [waitingOpen, setWaitingOpen] = useState(false)
  const [waitingReason, setWaitingReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(undefined)
    try { await action(); onChanged(); return true } catch (reason) { setError(reason instanceof Error ? reason.message : 'WORK_ITEM_COMMAND_FAILED'); return false }
    finally { setBusy(false) }
  }
  const wait = async (event: FormEvent) => {
    event.preventDefault()
    if (await run(() => gateway.transition(item, 'waiting', waitingReason))) { setWaitingOpen(false); setWaitingReason('') }
  }
  const transitions = availableTransitions(item)

  return <div className="work-item-actions" data-testid={`work-item-actions-${item.id}`}>
    {transitions.includes('in_progress') && <button className="ui-button ui-button--quiet" disabled={busy} onClick={() => void run(() => gateway.transition(item, 'in_progress'))}>{item.status === 'waiting' ? '继续处理' : '开始处理'}</button>}
    {transitions.includes('waiting') && <button className="ui-button ui-button--quiet" disabled={busy} onClick={() => setWaitingOpen(true)}>标记等待</button>}
    {item.kind === 'reminder' && item.status !== 'completed' && item.status !== 'cancelled' && <button className="ui-button auth-submit" data-testid="complete-reminder" disabled={busy} onClick={() => void run(() => gateway.completeReminder(item))}>完成提醒</button>}
    {item.kind === 'business_action' && <NavLink className="ui-button auth-submit" data-testid="open-business-action" to={businessActionRoute(item.sourceBusiness)}>进入业务办理</NavLink>}
    {transitions.includes('cancelled') && <button className="ui-button ui-button--quiet" disabled={busy} onClick={() => void run(() => gateway.transition(item, 'cancelled'))}>取消事项</button>}
    {waitingOpen && <form className="work-item-waiting-form" onSubmit={(event) => void wait(event)}><label>等待原因<input data-testid="work-item-waiting-reason" required maxLength={500} value={waitingReason} onChange={(event) => setWaitingReason(event.target.value)} /></label><button className="ui-button auth-submit" disabled={busy || !waitingReason.trim()}>确认等待</button><button className="ui-button ui-button--quiet" type="button" onClick={() => setWaitingOpen(false)}>返回</button></form>}
    {item.kind === 'business_action' && <small className="work-item-action-boundary">业务事项只能在对应业务流程完成，不能在推进中心直接关闭。</small>}
    {error && <p className="work-item-command-error" role="alert">操作失败：{error}</p>}
  </div>
}
