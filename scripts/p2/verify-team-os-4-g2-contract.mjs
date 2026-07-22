import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p2/team-os-4-g2-acceptance-contract.json'), 'utf8'))

assert.equal(contract.schemaVersion, 1)
assert.equal(contract.phase, 'G2')
assert.equal(contract.acceptedProgressBefore, 30)
assert.deepEqual(contract.checkpoints.map(({ progress, status }) => [progress, status]), [[35, 'pending'], [40, 'pending']])
assert.deepEqual(contract.checkpoints[0].required, [
  'work-item-unique-generation-key',
  'work-item-state-machine',
  'business-completion-idempotency',
])
assert.deepEqual(contract.checkpoints[1].required, [
  'workspace-progress-calendar-single-source',
  'mobile-workspace-progress-calendar-acceptance',
])
assert.deepEqual(contract.contracts.stateMachine, ['pending', 'in_progress', 'waiting', 'completed', 'cancelled'])
assert.equal(contract.contracts.uniqueGenerationKey, 'company_id+source_business+source_id+generation_rule')
assert.equal(contract.contracts.assigneeReassignment, 'updates-existing-work-item-without-generating-duplicate')
assert.ok(!contract.contracts.uniqueGenerationKey.includes('assignee'))
assert.deepEqual(contract.contracts.singleSourceEntrypoints, ['workspace', 'progress-center', 'calendar'])
assert.equal(contract.contracts.mobileRequired, true)
assert.equal(contract.runtimeEvidence, 'pending')
assert.equal(contract.g2Accepted, false)

console.log('TEAM_OS_4_G2_CONTRACT_OK checkpoints=35,40 status=pending runtimeEvidence=pending gateIntegrated=0')
