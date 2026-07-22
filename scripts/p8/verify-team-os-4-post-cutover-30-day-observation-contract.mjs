import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p8/team-os-4-post-cutover-30-day-observation-contract.json'), 'utf8'))
const c = contract.contracts

assert.equal(contract.schemaVersion, 1)
assert.equal(contract.phase, 'P8')
assert.equal(contract.artifactKind, 'team-os-4-post-cutover-observation-evidence')
assert.equal(contract.status, 'pending')
assert.equal(c.observationTimeZone, 'Asia/Shanghai')
assert.equal(c.observationStarts, 'first-calendar-day-after-successful-cutover')
assert.equal(c.observationDayCount, 30)
assert.equal(c.calendarDaysMustBeContinuous, true)
assert.equal(c.missingDayAllowed, false)
assert.equal(c.lateBackfillWithoutSourceEvidenceAllowed, false)
assert.deepEqual(c.dailyBusinessCategories, [
  'receipts', 'internal-payables', 'profit', 'inventory', 'points', 'employee-earnings',
])
assert.deepEqual(c.dailyOperationalCategories, [
  'failed-jobs', 'authorization-denials', 'slow-queries',
  'supervisor-fallbacks', 'disabled-entry-access-attempts',
])
assert.deepEqual(c.dailyBusinessEvidenceFields, [
  'date', 'category', 'record-count', 'signed-amount-or-quantity',
  'source-fingerprint', 'target-fingerprint', 'difference', 'reviewer', 'reviewed-at',
])
assert.deepEqual(c.dailyOperationalEvidenceFields, [
  'date', 'category', 'event-count', 'severity-counts', 'oldest-opened-at',
  'oldest-unresolved-at', 'resolution-state', 'evidence-reference', 'reviewer', 'reviewed-at',
])
assert.equal(c.businessDifferenceTolerance, 'zero-unexplained-difference-per-day-per-category')
assert.equal(c.aggregateOnlyEvidenceAllowed, false)
assert.equal(c.monthlyTotalMayMaskCategoryDifference, false)
assert.equal(c.crossDayNettingAllowed, false)
assert.equal(c.crossCategoryNettingAllowed, false)
assert.equal(c.zeroEventDayStillRequiresEvidence, true)
assert.equal(c.failedJobRule, 'every-failure-classified-owned-and-resolved-or-explicitly-open')
assert.equal(c.authorizationDenialRule, 'every-denial-preserved-and-reviewed-for-attack-or-policy-error')
assert.equal(c.slowQueryRule, 'record-query-fingerprint-duration-role-and-remediation-state')
assert.equal(c.supervisorFallbackRule, 'record-trigger-original-owner-supervisor-action-and-final-owner')
assert.equal(c.disabledEntryAccessRule, 'record-role-entry-route-denial-and-source-of-stale-access')
assert.equal(c.dailySignoffRequired, true)
assert.equal(c.finalSignoffRequiresAllThirtyDailySignoffs, true)
assert.equal(c.observationFailureAction, 'do-not-declare-complete-and-preserve-open-evidence')

assert.deepEqual(contract.requiredRuntimeEvidence, {
  dailyBusinessReconciliation: 'thirty-continuous-days-times-six-categories',
  dailyOperationalReview: 'thirty-continuous-days-times-five-categories-including-zero-event-days',
  dailySignoffs: 'thirty-date-bound-reviewer-signatures',
  finalReconciliation: 'category-preserving-summary-derived-from-complete-daily-evidence',
})
for (const field of [
  'dailyBusinessReconciliationEvidence', 'dailyOperationalReviewEvidence',
  'dailySignoffEvidence', 'finalReconciliationEvidence', 'runtimeEvidence',
]) assert.equal(contract[field], 'pending')
assert.equal(contract.observationAccepted, false)

// A contract cannot substitute for thirty continuous days of signed runtime
// evidence. Acceptance deliberately remains false until the observation ends.
console.log('Team OS 4.0 30-day observation contract is structurally valid; all runtime evidence remains pending.')
