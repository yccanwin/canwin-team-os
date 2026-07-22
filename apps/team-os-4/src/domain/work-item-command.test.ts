import { strict as assert } from 'node:assert'
import type { WorkItem } from './work-item.ts'
import {
  WorkItemCommandGateway,
  businessActionRoute,
  type WorkItemCommandBody,
  type WorkItemCommandTransport,
} from './work-item-command.ts'

const calls: WorkItemCommandBody[] = []
const transport: WorkItemCommandTransport = { async invoke(body) { calls.push(body); return { ok: true } } }
const gateway = new WorkItemCommandGateway(transport, () => 'fixed-idempotency-key')
const reminder: WorkItem = {
  id: 'work-item', companyId: 'company', sourceBusiness: 'manual_reminder', sourceRecordId: 'source', role: 'sales', assigneeId: 'user', kind: 'reminder', title: '跟进', priority: 'normal', status: 'in_progress', plannedAt: null, dueAt: null, nextStep: '联系客户', blockedReason: null, generationRule: 'manual', completedAt: null,
}

await gateway.transition(reminder, 'waiting', '等待客户确认')
assert.deepEqual(calls[0], { action: 'transition', companyId: 'company', workItemId: 'work-item', idempotencyKey: 'fixed-idempotency-key', targetStatus: 'waiting', blockedReason: '等待客户确认' })
await assert.rejects(() => gateway.transition(reminder, 'waiting', '  '), /WAITING_REASON_REQUIRED/)
await gateway.completeReminder(reminder)
assert.equal(calls[1]?.action, 'complete')

const businessAction: WorkItem = { ...reminder, kind: 'business_action', sourceBusiness: 'lead', generationRule: 'claim_lead_v1' }
await assert.rejects(() => gateway.completeReminder(businessAction), /OWNING_TRANSACTION/)
assert.equal(calls.length, 2, 'business action must never reach generic completion transport')
assert.equal(businessActionRoute('lead_claim'), '/leads')
assert.equal(businessActionRoute('order_payment'), '/orders')

console.log('TEAM_OS_4_WORK_ITEM_COMMAND_OK waitingReason=required reminderCompletion=trusted-boundary businessCompletion=denied')
