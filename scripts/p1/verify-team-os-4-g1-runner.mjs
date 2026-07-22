import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8')
const contract = JSON.parse(read('scripts/p1/team-os-4-g1-acceptance-contract.json'))
const runnerSource = read(contract.authoritativeRunner)
const orchestratorSource = read('platform/team-os-4/tools/acceptance-accounts/src/orchestrator.mjs')

const roles = ['sales', 'implementation', 'operations', 'finance', 'admin']
assert.equal(contract.schemaVersion, 2)
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
assert.deepEqual(contract.perAccountNegativeChecks, [
  'manual-cross-role-url-denied',
  'cross-identity-read-hidden-or-explicitly-denied',
  'cross-identity-write-denied',
  'unauthorized-management-page-denied',
  'unauthorized-management-api-denied',
  'unauthorized-role-business-api-denied',
  'bootstrap-public-entry-denied',
  'bootstrap-private-entry-denied',
])
assert.deepEqual(contract.anonymousAttackChecks, [
  'bootstrap-public-entry-denied', 'bootstrap-private-entry-denied', 'internal-table-read-denied',
  'rest-dml-denied', 'write-rpc-denied', 'private-storage-read-denied', 'storage-write-denied',
])
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
  simulatedOrFixtureEvidenceAllowed: false,
  firstFailureStopsRun: true,
  failedRunEvidencePreserved: true,
  targetMustBeIndependentTeamOs4Project: true,
})
assert.deepEqual(contract.expectedRuntimeEvidenceCount, {
  enabledAccountPositive: 35,
  enabledAccountNegative: 40,
  anonymousNegative: 7,
  minimumTotal: 82,
})

// The authoritative construction path must remain exactly five enabled role
// accounts. Anonymous is an attack client and is never provisioned as a user.
for (const key of ['sales', 'implementation', 'operations', 'finance', 'admin_supervisor']) {
  assert.ok(orchestratorSource.includes(`key: '${key}'`), `missing provisioned role identity ${key}`)
}
assert.ok(orchestratorSource.includes('accounts.length !== 5') || runnerSource.includes('accounts.length !== 5'))
assert.ok(runnerSource.includes("const expected = ['sales', 'implementation', 'operations', 'finance', 'admin_supervisor']"))
assert.ok(runnerSource.includes("stage('anon-rpc'"), 'anonymous attack client is missing')
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
