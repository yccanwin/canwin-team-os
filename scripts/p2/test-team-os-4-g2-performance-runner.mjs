import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GREENFIELD_PROJECT_REF,
  GREENFIELD_URL,
  assertNoSecretValues,
  percentile,
  resolveEvidencePath,
  validateRawEvidence,
} from './run-team-os-4-g2-scale-acceptance.mjs'
import { G2_PERFORMANCE_ADAPTER_CONTRACT, assertAdapterContext } from './run-team-os-4-g2-performance-adapter.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const adapterSource = readFileSync(resolve(repoRoot, 'scripts/p2/run-team-os-4-g2-performance-adapter.mjs'), 'utf8')
const runnerSource = readFileSync(resolve(repoRoot, 'scripts/p2/run-team-os-4-g2-scale-acceptance.mjs'), 'utf8')
assert.equal(G2_PERFORMANCE_ADAPTER_CONTRACT.targetRef, GREENFIELD_PROJECT_REF)
assert.equal(G2_PERFORMANCE_ADAPTER_CONTRACT.targetUrl, GREENFIELD_URL)
assert.equal(G2_PERFORMANCE_ADAPTER_CONTRACT.concurrency, 30)
assert.equal(G2_PERFORMANCE_ADAPTER_CONTRACT.waves, 3)
assert.ok(adapterSource.includes("auth.admin.createUser"))
assert.ok(adapterSource.includes("auth.admin.deleteUser"))
assert.ok(adapterSource.includes("'--linked'"))
assert.ok(adapterSource.includes('setup_g2_performance_fixture_v1'))
assert.ok(adapterSource.includes('cleanup_g2_performance_fixture_v1'))
assert.ok(!/insert\s+into\s+auth\.users/iu.test(adapterSource))
assert.ok(runnerSource.includes("from './run-team-os-4-g2-performance-adapter.mjs'"))
assert.ok(!runnerSource.includes("requiredValue(arguments_, 'adapter')"))
assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5)
assert.throws(() => assertNoSecretValues({ nested: 'prefix-super-secret-value-suffix' }, new Set(['super-secret-value'])), /secret value/)
assert.equal(resolveEvidencePath(repoRoot, '.codex-audit/team-os-4/g2/g2-selftest.json', 'g2-selftest'), resolve(repoRoot, '.codex-audit/team-os-4/g2/g2-selftest.json'))
assert.throws(() => resolveEvidencePath(repoRoot, 'outside.json', 'g2-selftest'), /evidence-out/)

const context = {
  projectRef: GREENFIELD_PROJECT_REF, supabaseUrl: GREENFIELD_URL,
  commit: 'a'.repeat(40), runId: 'g2-selftest', businessDate: '2026-07-23',
  companyId: 'd4200000-0000-4000-8000-000000000001', firstFailureStops: true,
  attempts: 1, concurrency: 30, waves: 3,
  credentials: { serviceRoleKey: 's'.repeat(24), anonKey: 'a'.repeat(24) },
}
assert.doesNotThrow(() => assertAdapterContext(context))
assert.throws(() => assertAdapterContext({ ...context, projectRef: 'agygfhmkazcbqaqwmljb' }))

const samples = []
for (const scenario of G2_PERFORMANCE_ADAPTER_CONTRACT.scenarios) {
  for (let wave = 1; wave <= 3; wave += 1) {
    for (let userOrdinal = 1; userOrdinal <= 30; userOrdinal += 1) {
      samples.push({ scenario, wave, userOrdinal, startedAtMs: wave * 1000 + userOrdinal, endedAtMs: wave * 1000 + 100, durationMs: 100 - userOrdinal, ok: true, rowCount: 10 })
    }
  }
}
const indexes = G2_PERFORMANCE_ADAPTER_CONTRACT.requiredIndexes
const queryPlans = Array.from({ length: 8 }, (_, index) => ({
  id: `plan-${index}`,
  explain: [{ Plan: { 'Node Type': 'Index Scan', 'Index Name': indexes[index % indexes.length], 'Actual Total Time': 1 }, 'Planning Time': 0.1, 'Execution Time': 1.1 }],
}))
const raw = {
  schemaVersion: 1, projectRef: GREENFIELD_PROJECT_REF, supabaseUrl: GREENFIELD_URL,
  commit: context.commit, runId: context.runId, businessDate: context.businessDate,
  attempts: 1, failurePolicy: 'first-failure-stop',
  dbIdentity: { targetProjectRef: GREENFIELD_PROJECT_REF },
  setup: { target_project_ref: GREENFIELD_PROJECT_REF, work_item_count: 100000, active_profile_count: 30 },
  dataset: { workItemCount: 100000, activeProfileCount: 30 },
  migrationVersions: ['20260722180000', '20260722181000', '20260722182000'],
  samples, queryPlans,
  proofs: {
    missingTaskRollback: { sqlstate: 'P0002', residueCount: 0 },
    waitingPreflight: { invalidRows: 0 },
    stableCursor: { usersChecked: 30, overlapCount: 0, businessDateMismatchCount: 0 },
    crossDayCursor: { sqlstate: '22023', rejected: true },
    rls: { crossAssigneeVisible: 0 },
  },
  cleanup: {
    database: { deleted_work_items: 100000, deleted_profiles: 30 },
    databaseRepeat: { idempotent: true },
    remaining: { workItems: 0, profiles: 0, authUsers: 0 },
    authDeleted: 30, manifestStatus: 'cleaned',
  },
}
const recomputed = validateRawEvidence(raw, { commit: context.commit, businessDate: context.businessDate, runId: context.runId })
assert.equal(recomputed.performance.length, 5)
assert.ok(recomputed.performance.every(({ sampleCount }) => sampleCount === 90))
console.log('TEAM_OS_4_G2_PERFORMANCE_RUNNER_SELFTEST_OK remoteCalls=0 auditWrites=0')
