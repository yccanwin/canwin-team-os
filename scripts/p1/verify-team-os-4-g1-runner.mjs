import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ANONYMOUS_NEGATIVE_STAGES,
  ENABLED_ACCOUNT_BOUNDARY_STAGES,
  ENABLED_ACCOUNT_POSITIVE_STAGES,
} from '../../platform/team-os-4/tools/acceptance-accounts/src/evidence.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8')
const contract = JSON.parse(read('scripts/p1/team-os-4-g1-acceptance-contract.json'))
const runnerSource = read(contract.authoritativeRunner)
const orchestratorSource = read('platform/team-os-4/tools/acceptance-accounts/src/orchestrator.mjs')
const adapterSource = read('platform/team-os-4/tools/acceptance-accounts/src/supabase-adapter.mjs')
const cliSource = read('platform/team-os-4/tools/acceptance-accounts/src/cli.mjs')
const migrationSource = read('platform/team-os-4/supabase/migrations/20260722175000_add_g1_acceptance_fixture.sql')

const roles = ['sales', 'implementation', 'operations', 'finance', 'admin']
assert.equal(contract.schemaVersion, 3)
assert.equal(contract.phase, 'G1')
assert.equal(contract.realEnabledAccounts, 5)
assert.deepEqual(contract.realEnabledAccountRoles, roles)
assert.deepEqual(contract.attackIdentities, ['anon'])
assert.equal(contract.disabledAccountRequired, false)
assert.deepEqual(contract.capabilitiesNotSeparateIdentities, ['warehouse', 'supervisor'])
for (const role of roles) assert.equal(contract.workspaceRoutes[role], `/workspace/${role}`)
assert.equal(contract.authoritativeProvisioner, 'platform/team-os-4/tools/acceptance-accounts')
assert.equal(contract.authoritativeRunner, 'scripts/p1/run-team-os-4-g1-acceptance.mjs')
assert.deepEqual(contract.retiredNonAuthoritativeHarnesses, [
  'scripts/p1/run-real-page-acceptance.mjs',
  'scripts/p1/manage-real-page-accounts.mjs',
])
assert.equal(contract.retiredHarnessRule, 'must-not-contribute-runtime-evidence-or-target-a-team-os-4-project')

assert.deepEqual(contract.perAccountPositiveChecks, [
  'auth-real-password-login',
  'app-context-exact-primary-role-and-capabilities',
  'navigation-manifest-exact-role-boundary',
  'workspace-auto-route-and-visible-content',
  'role-business-page-real-remote-request',
  'own-scope-direct-api-read',
  'role-business-direct-api-read',
])
assert.deepEqual(contract.perAccountPositiveChecks, [...ENABLED_ACCOUNT_POSITIVE_STAGES])
assert.deepEqual(contract.perAccountBoundaryChecks, [
  'manual-cross-role-url-denied',
  'cross-identity-read-matches-role-policy',
  'cross-identity-write-denied',
  'management-page-matches-role-policy',
  'management-api-matches-role-policy',
  'role-business-api-matches-role-policy',
  'bootstrap-public-entry-denied',
  'bootstrap-private-entry-denied',
])
assert.deepEqual(contract.perAccountBoundaryChecks, [...ENABLED_ACCOUNT_BOUNDARY_STAGES])
assert.deepEqual(contract.anonymousAttackChecks, [
  'bootstrap-public-entry-denied', 'bootstrap-private-entry-denied', 'internal-table-read-denied',
  'rest-dml-denied', 'write-rpc-denied', 'private-storage-read-denied', 'storage-write-denied',
])
assert.deepEqual(contract.anonymousAttackChecks, [...ANONYMOUS_NEGATIVE_STAGES])
for (const stage of [...ENABLED_ACCOUNT_POSITIVE_STAGES, ...ENABLED_ACCOUNT_BOUNDARY_STAGES, ...ANONYMOUS_NEGATIVE_STAGES]) {
  assert.ok(
    runnerSource.includes(`evidenceStage: '${stage}'`) || runnerSource.includes(`stage: '${stage}'`),
    `runner evidence stage missing: ${stage}`,
  )
}
assert.deepEqual(contract.requiredEvidenceFields, [
  'run_id', 'target_project_ref', 'application_commit', 'account_role', 'identity_kind',
  'stage', 'started_at', 'finished_at', 'page_url_or_api_surface',
  'http_status_or_postgres_code', 'row_count_or_result_digest',
  'page_test_id_or_trace_digest', 'outcome', 'evidence_sha256',
])
assert.deepEqual(contract.evidenceRules, {
  oneRecordPerAccountPerCheck: true,
  aggregateOnlySummaryAllowed: false,
  credentialsOrTokensAllowed: false,
  realNetworkRequired: true,
  realPageRequired: true,
  simulatedEvidenceAllowed: false,
  fixtureRowsMaySupportRealRemoteChecks: true,
  fixtureProvisioningCountsAsRuntimeEvidence: false,
  firstFailureStopsRun: true,
  failedRunEvidencePreserved: true,
  targetMustBeIndependentTeamOs4Project: true,
})
assert.deepEqual(contract.expectedRuntimeEvidenceCount, {
  enabledAccountPositive: 35,
  enabledAccountBoundary: 40,
  anonymousNegative: 7,
  exactTotal: 82,
})
assert.deepEqual(contract.lifecycle, {
  successOrder: [
    'preflight', 'create-five-acceptance-identities', 'prepare-acceptance-only-fixtures',
    'run-real-page-and-api-acceptance', 'seal-82-runtime-records',
    'persist-evidence-and-retain-baseline',
  ],
  failureOrder: [
    'preserve-runner-evidence-if-started',
    'attempt-database-cleanup-once-if-fixture-may-exist',
    'remove-or-disable-acceptance-profiles',
    'delete-or-ban-acceptance-auth-identities',
  ],
  runnerNotStartedEvidenceStatus: 'not-started',
  retentionFailureEvidenceStatus: 'sealed-passed-retention-indeterminate',
  databaseCleanupStates: ['not-required', 'confirmed-cleaned', 'confirmed-not-prepared', 'indeterminate'],
  fixturePreparationStates: ['not-started', 'indeterminate', 'confirmed-prepared', 'confirmed-retained'],
  retainedAccountsArePermanentAcceptanceBaseline: true,
  acceptanceAccountsMustRemainSeparatedFromOperatingData: true,
})
for (const marker of [
  "fixturePreparationState = 'indeterminate'",
  "runtimeEvidenceStatus = 'not-started'",
  "databaseCleanupStatus = fixturePreparationState === 'not-started'",
  'await adapter.cleanupRunDatabase({ runId })',
  'await adapter.deleteAuthUser(item.id)',
  'await adapter.quarantineAccounts({ runId, accounts: remainingAccounts })',
]) assert.ok(orchestratorSource.includes(marker), `lifecycle marker missing: ${marker}`)
assert.ok(
  orchestratorSource.includes('await adapter.deleteAcceptanceProfile(item.id)') ||
    /await adapter\.deleteAcceptanceProfile\(\s*\{\s*id: item\.id,\s*runId,\s*identityKey: item\.key,\s*\}\s*\)/u.test(orchestratorSource),
  'lifecycle marker missing: deleteAcceptanceProfile',
)
for (const marker of [
  'G1 ACCEPTANCE ${primaryRole}',
  "system: 'team-os-4-acceptance'",
  "acceptance_state: 'retained'",
  "metadata?.run_id !== runId",
]) assert.ok(adapterSource.includes(marker), `acceptance identity marker missing: ${marker}`)
for (const marker of [
  "evidenceSealed: false",
  "runtimeEvidenceStatus: 'not-started'",
  "databaseCleanupStatus: 'not-required'",
  "fixturePreparationState: 'not-started'",
  'runtimeEvidence: null',
]) assert.ok(cliSource.includes(marker), `pre-provisioning fallback marker missing: ${marker}`)
for (const marker of [
  "data_class text not null default 'acceptance-only'",
  "p_target_project_ref <> 'jgcrhoabvaowxnqksvkq'",
  'and migration_mode and not business_writes_enabled',
  'runtime_evidence jsonb',
  "is distinct from 'passed'",
  "is distinct from 'number'",
  'is distinct from 82',
]) assert.ok(migrationSource.includes(marker), `acceptance baseline marker missing: ${marker}`)

// The authoritative construction path must remain exactly five enabled role
// accounts. Anonymous is an attack client and is never provisioned as a user.
for (const key of ['sales', 'implementation', 'operations', 'finance', 'admin_supervisor']) {
  assert.ok(orchestratorSource.includes(`key: '${key}'`), `missing provisioned role identity ${key}`)
}
assert.ok(orchestratorSource.includes('accounts.length !== 5') || runnerSource.includes('accounts.length !== 5'))
assert.ok(runnerSource.includes("const expected = ['sales', 'implementation', 'operations', 'finance', 'admin_supervisor']"))
for (const label of [
  'anon-bootstrap-public', 'anon-bootstrap-private', 'anon-internal-read',
  'anon-rest-dml', 'anon-write-rpc', 'anon-storage-read', 'anon-storage-write',
]) assert.ok(runnerSource.includes(`runStage('${label}'`), `anonymous attack stage ${label} is missing`)
assert.ok(runnerSource.includes("getByTestId('authenticated-app')"), 'real authenticated page check is missing')
assert.ok(runnerSource.includes('getByTestId(`workspace-${role}`)'), 'exact role workspace check is missing')
assert.ok(runnerSource.includes("getByTestId('access-denied')"), 'cross-role page denial is missing')

for (const field of [
  'accountProvisioningEvidence', 'pageEvidence', 'directApiEvidence',
  'anonymousAttackEvidence', 'runtimeStatus',
]) assert.equal(contract[field], 'pending')
assert.equal(contract.g1AccountsAccepted, false)

// Static validation never promotes real network, page or API evidence.
console.log('TEAM_OS_4_G1_ACCOUNT_CONTRACT_OK realEnabledAccounts=5 attackIdentities=anon runtime=pending accepted=0')
