import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p8/team-os-4-rollback-package-contract.json'), 'utf8'))
const c = contract.contracts

assert.equal(contract.schemaVersion, 1)
assert.equal(contract.phase, 'P8')
assert.equal(contract.artifactKind, 'team-os-4-rollback-package')
assert.equal(contract.status, 'pending')
assert.equal(c.beforeCutoverFailureAction, 'do-not-cut-over')
assert.equal(c.beforeCutoverSource3State, 'physical-read-only')
assert.equal(c.beforeCutoverTarget4CandidateAction, 'seal-failed-candidate')
assert.equal(c.afterCutoverFirstAction, 'disable-all-team-os-4-writes')
assert.deepEqual(c.afterCutoverWriteDisableSurfaces, [
  'auth-login-register-refresh', 'rest-dml', 'rpc-write', 'storage-write',
  'edge-functions', 'cron', 'webhooks', 'notifications', 'online-high-privilege-credentials',
])
assert.equal(c.target4BackupRequiredBeforeRecovery, true)
assert.deepEqual(c.target4BackupKinds, ['database', 'auth', 'storage', 'configuration', 'audit-evidence'])
assert.equal(c.target4RecoveryRule, 'restore-to-new-isolated-candidate-and-verify-before-any-routing-change')
assert.equal(c.source3DefaultRollbackState, 'physical-read-only')
assert.equal(c.source3WriteReopenByDefault, false)
assert.equal(c.source3WriteReopenRequiresSeparateBusinessAuthorization, true)
assert.equal(c.newWritesAfterCutoverRule, 'reverse-incremental-migration-and-full-reconciliation-required-before-source3-write-reopen')
assert.deepEqual(c.reverseIncrementalScope, [
  'business-tables', 'money', 'inventory', 'auth-identities', 'storage-objects',
  'immutable-ledgers', 'audit-events',
])
assert.deepEqual(c.reverseIncrementalRules, [
  'signed-snapshot', 'stable-source-id-mapping', 'insert-only-or-explicit-compensation',
  'no-silent-skip', 'no-overwrite', 'single-transaction-per-batch', 'failure-rolls-back-entire-batch',
])
assert.deepEqual(c.fullReconciliationCategories, ['table-rows', 'money', 'inventory', 'auth', 'storage'])
assert.equal(c.reconciliationTolerance, 'zero-unexplained-difference')
assert.equal(c.routingChangeAllowedBeforeReconciliation, false)
assert.equal(c.failedCandidateAction, 'seal-and-preserve-forensics')
assert.equal(c.failedCandidateReusable, false)
assert.equal(c.failedCandidateRetryable, false)
assert.equal(c.failedCandidateEvidenceMutability, 'append-only')
assert.equal(c.partialRollbackAccepted, false)

assert.deepEqual(contract.requiredStaticEvidence, [
  'pre-cutover-stop-procedure', 'team-os-4-write-freeze-procedure',
  'team-os-4-backup-and-isolated-restore-procedure', 'team-os-3-read-only-preservation-procedure',
  'reverse-incremental-migration-plan', 'full-reconciliation-plan', 'failed-candidate-sealing-procedure',
])
assert.deepEqual(contract.requiredRuntimeEvidence, {
  preCutoverStopDrill: 'failure-does-not-change-routing',
  target4WriteFreezeDrill: 'all-write-surfaces-and-old-sessions-denied',
  target4RecoveryDrill: 'backup-restored-to-new-isolated-candidate-and-reconciled',
  source3ReadOnlyDrill: 'rollback-does-not-reopen-any-source3-write-path',
  reverseIncrementalDrill: 'new-target4-writes-replayed-with-zero-unexplained-difference',
  failedCandidateDrill: 'candidate-sealed-not-reused-and-evidence-remains-append-only',
})
for (const field of [
  'staticEvidence', 'preCutoverStopEvidence', 'target4WriteFreezeEvidence',
  'target4RecoveryEvidence', 'source3ReadOnlyEvidence', 'reverseIncrementalEvidence',
  'fullReconciliationEvidence', 'failedCandidateEvidence', 'runtimeEvidence',
]) assert.equal(contract[field], 'pending')
assert.equal(contract.rollbackPackageAccepted, false)

// Contract construction is not a rollback drill. Runtime evidence remains
// pending until isolated recovery, reverse migration and reconciliation run.
console.log('Team OS 4.0 rollback-package contract is structurally valid; all execution evidence remains pending.')
