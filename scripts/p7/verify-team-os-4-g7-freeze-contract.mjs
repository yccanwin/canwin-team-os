import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p7/team-os-4-g7-freeze-acceptance-contract.json'), 'utf8'))

assert.equal(contract.schemaVersion, 1)
assert.equal(contract.phase, 'G7')
assert.equal(contract.acceptedProgressBefore, 80)
assert.deepEqual(contract.checkpoint, {
  progress: 85,
  status: 'pending',
  required: [
    'team-os-3-physical-read-only-freeze',
    'freeze-fingerprint-stability',
    'all-write-path-attacks-denied',
    'one-shot-migration-failure-sealed-without-retry',
  ],
})

const c = contract.contracts
assert.equal(c.sourceSystem, 'team-os-3')
assert.equal(c.targetSystem, 'team-os-4')
assert.equal(c.sourceFreezeMode, 'physical-read-only')
assert.deepEqual(c.sourceFreezeRequires, [
  'disable-login', 'disable-registration', 'disable-token-refresh',
  'deny-rest-dml', 'deny-rpc-dml', 'deny-storage-write',
  'disable-edge-functions', 'disable-cron', 'disable-webhooks', 'disable-notifications',
  'revoke-ordinary-dml', 'revoke-write-rpc', 'remove-online-high-privilege-credentials',
])
assert.deepEqual(c.forbiddenSourceOperations, [
  'insert', 'update', 'delete', 'truncate', 'ddl',
  'storage-upload', 'storage-update', 'storage-delete',
])
assert.equal(c.highPrivilegeCredentialRule, 'offline-only-short-lived-and-never-present-in-online-runtime')
assert.deepEqual(c.freezeFingerprintCategories, ['table-rows', 'money', 'inventory', 'auth', 'storage'])
assert.equal(c.freezeFingerprintRule, 'signed-before-and-after-fingerprints-must-be-identical-by-category')
assert.deepEqual(c.freezeAttackActors, ['anonymous', 'ordinary-user', 'old-session', 'direct-api-attacker'])
assert.deepEqual(c.freezeAttackSurfaces, [
  'auth-login', 'auth-register', 'auth-refresh', 'rest-dml', 'rpc-write',
  'storage-write', 'function', 'cron', 'webhook', 'notification',
])
assert.equal(c.attackSuccessAllowed, false)
assert.equal(c.migrationExecutionCount, 1)
assert.equal(c.migrationRetryAllowed, false)
assert.equal(c.migrationFailureAction, 'seal-entire-failed-run-and-preserve-evidence')
assert.equal(c.migrationFailureMayResume, false)
assert.deepEqual(c.failedRunMustRecord, [
  'run-id', 'source-snapshot-id', 'target-project-ref', 'code-commit', 'started-at',
  'failed-at', 'failure-stage', 'error-digest', 'reconciliation-state',
])
assert.equal(c.failedRunTargetRule, 'failed-target-is-forensic-only-and-must-never-be-promoted-or-reused')
assert.equal(c.failureEvidenceMutability, 'append-only')
assert.equal(c.silentSkipAllowed, false)
assert.equal(c.partialAcceptanceAllowed, false)

assert.deepEqual(contract.requiredRuntimeEvidence, {
  freezeControlPlane: 'provider-and-database-evidence-for-every-disabled-or-revoked-write-path',
  freezeFingerprint: 'signed-before-and-after-category-fingerprints-with-zero-difference',
  attackMatrix: 'anonymous-ordinary-old-session-and-direct-api-attacks-all-denied-on-every-surface',
  credentialInventory: 'zero-online-high-privilege-credentials',
  oneShotFailureDrill: 'failed-run-sealed-target-not-reused-and-no-retry-observed',
})
for (const field of [
  'freezeControlPlaneEvidence', 'freezeFingerprintEvidence', 'attackMatrixEvidence',
  'credentialInventoryEvidence', 'oneShotFailureDrillEvidence', 'runtimeEvidence',
]) assert.equal(contract[field], 'pending')
assert.equal(contract.g7FreezeAccepted, false)

// This verifier validates only the frozen acceptance contract. It deliberately
// cannot turn pending runtime evidence into an accepted G7 checkpoint.
console.log('Team OS 4.0 G7 freeze contract is structurally valid; all runtime evidence remains pending.')
