import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p6/team-os-4-g6-acceptance-contract.json'), 'utf8'))

assert.equal(contract.schemaVersion, 1)
assert.equal(contract.phase, 'G6')
assert.equal(contract.acceptedProgressBefore, 70)
assert.deepEqual(contract.checkpoints.map(({ progress, status }) => [progress, status]), [[75, 'pending'], [80, 'pending']])
assert.deepEqual(contract.checkpoints[0].required, [
  'sales-core-day', 'implementation-core-day', 'operations-core-day', 'finance-core-day', 'admin-core-day',
])
assert.deepEqual(contract.checkpoints[1].required, [
  'mobile-core-actions',
  'case-customer-display-authorization',
  'case-admin-review',
  'authorization-revocation-unpublishes-case',
  'case-image-slot-policy',
])
assert.deepEqual(contract.contracts.coreDayRoles, ['sales', 'implementation', 'operations', 'finance', 'admin'])
assert.deepEqual(contract.contracts.mobileActions, ['today-work', 'progress', 'calendar', 'role-business', 'profile'])
assert.deepEqual(contract.contracts.casePublicationRequires, ['customer-display-authorization', 'admin-review'])
assert.deepEqual(contract.contracts.authorizationRecords, ['source', 'scope', 'valid_from', 'valid_until', 'revoked_at', 'revoked_by', 'reason'])
assert.equal(contract.contracts.authorizationRevocation, 'immediate-unpublish-and-public-projection-removal')
assert.equal(contract.contracts.publicWebsiteSource, 'desensitized-published-case-projection-only')
assert.deepEqual(contract.contracts.allowedImageSlots, ['logo', 'display_code'])
assert.equal(contract.contracts.maxImagesPerCase, 2)
assert.equal(contract.contracts.thirdImageRejected, true)
assert.deepEqual(contract.contracts.imageMimeAllowlist, ['image/png', 'image/jpeg', 'image/webp'])
assert.deepEqual(contract.contracts.maxImageBytesBySlot, { logo: 204800, display_code: 307200 })
assert.equal(contract.contracts.allOtherUploadsAllowed, false)
assert.equal(contract.contracts.rlsAndStoragePoliciesRequired, true)
assert.equal(contract.contracts.fixturesMocksOrDemoDataAllowed, false)
for (const field of ['runtimeEvidence', 'mobileEvidence', 'caseAuthorizationEvidence', 'storageEvidence']) assert.equal(contract[field], 'pending')
assert.equal(contract.g6Accepted, false)

console.log('TEAM_OS_4_G6_CONTRACT_OK checkpoints=75,80 roles=5 imageSlots=2 thirdImage=denied authorizationRevocation=unpublish runtime=pending mobile=pending case=pending storage=pending gateIntegrated=0')
