import { strict as assert } from 'node:assert'
import {
  RequestContractError,
  allowedCorsOrigin,
  authorizeCommand,
  parseBearer,
  parseCommand,
} from './contract.mjs'

const companyId = '11111111-1111-4111-8111-111111111111'
const workItemId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const base = { companyId, workItemId, idempotencyKey: 'g2:test:1' }
const profile = { id: userId, company_id: companyId, is_active: true }
const role = { company_id: companyId, role_key: 'sales', is_active: true }
const reminder = { id: workItemId, company_id: companyId, assignee_id: userId, kind: 'reminder' }

assert.equal(parseBearer('Bearer abc.def.ghi'), 'abc.def.ghi')
assert.throws(() => parseBearer('sb_publishable_example'), RequestContractError)

assert.deepEqual(parseCommand({ action: 'complete', ...base }), {
  action: 'complete', ...base, payload: {},
})
assert.deepEqual(parseCommand({
  action: 'transition', ...base, targetStatus: 'waiting', payload: { blocked_reason: ' vendor reply ' },
}), {
  action: 'transition', ...base, targetStatus: 'waiting', payload: { blocked_reason: 'vendor reply' },
})
assert.throws(() => parseCommand({
  action: 'transition', ...base, targetStatus: 'waiting', payload: {},
}), RequestContractError)
assert.throws(() => parseCommand({ action: 'complete', ...base, serviceKey: 'forbidden' }), RequestContractError)

assert.equal(allowedCorsOrigin('https://preview.example', 'https://preview.example'), 'https://preview.example')
assert.equal(allowedCorsOrigin('https://attacker.example', 'https://preview.example'), undefined)

assert.deepEqual(authorizeCommand({ command: { action: 'complete', ...base }, userId, profile, role, workItem: reminder }), {
  allowed: true,
})
assert.equal(authorizeCommand({
  command: { action: 'complete', ...base }, userId, profile, role,
  workItem: { ...reminder, kind: 'business_action' },
}).code, 'business_action_requires_owning_transaction')
assert.equal(authorizeCommand({
  command: { action: 'complete', ...base }, userId, profile, role,
  workItem: { ...reminder, assignee_id: '44444444-4444-4444-8444-444444444444' },
}).code, 'work_item_not_assigned')
assert.deepEqual(authorizeCommand({
  command: { action: 'complete', ...base }, userId, profile,
  role: { ...role, role_key: 'admin' },
  workItem: { ...reminder, assignee_id: '44444444-4444-4444-8444-444444444444' },
}), { allowed: true })

console.log('TEAM_OS_4_G2_WORK_ITEM_COMMAND_CONTRACT_OK cases=12 remoteCalls=0 secrets=0')
