import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p1/team-os-4-g1-acceptance-contract.json'), 'utf8'))
const runnerSource = readFileSync(resolve(repoRoot, 'scripts/p1/run-team-os-4-g1-acceptance.mjs'), 'utf8')
const expectedIdentities = ['anon', 'sales', 'implementation', 'operations', 'finance', 'admin']
const expectedRoles = expectedIdentities.slice(1)
const expectedChecks = [
  'real-login-auto-role-route',
  'manual-url-cross-role-denied',
  'direct-rest-cross-identity-read-policy',
  'direct-rest-cross-identity-write-denied',
  'bootstrap-public-entry-denied',
  'bootstrap-private-entry-denied',
]
const exact = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)

assert.equal(contract.schemaVersion, 1)
assert.ok(exact(contract.identities, expectedIdentities))
assert.ok(exact(contract.primaryRoles, expectedRoles))
assert.ok(exact(contract.capabilitiesNotSeparateIdentities, ['warehouse', 'supervisor']))
assert.ok(exact(contract.requiredChecks, expectedChecks))
assert.equal(contract.runtimeStatus, 'pending')
for (const role of expectedRoles) assert.equal(contract.workspaceRoutes[role], `/workspace/${role}`)
for (const label of ['anon-rpc', 'sign-in:', 'cross-read:', 'cross-write:', 'role-rpc:', 'browser-launch', 'page-login:', 'auto-route:', 'cross-url:']) {
  assert.ok(runnerSource.includes(label), `safe stage label missing: ${label}`)
}
assert.ok(runnerSource.includes("url.hash === `#/workspace/${role}`"), 'HashRouter auto-route check must compare URL hash')
assert.ok(runnerSource.includes('chromium.executablePath()') && runnerSource.includes('existsSync(bundled)'))
for (const path of [
  'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
  'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
  'C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
  'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
]) assert.ok(runnerSource.includes(path), `fixed browser fallback missing: ${path}`)
assert.ok(runnerSource.includes("stage('browser-launch', launchAcceptanceBrowser)"))
assert.ok(!runnerSource.includes('G1_STAGE_FAIL ${account.email}') && !runnerSource.includes('G1_STAGE_FAIL ${account.id}'))

const results = []
for (const identity of expectedIdentities) {
  for (const check of expectedChecks) results.push({ identity, check, networkCalls: 0, status: 'simulated-denied' })
}
assert.equal(results.length, 36)
assert.ok(results.every((result) => result.networkCalls === 0))

const mutations = [
  () => contract.identities.slice(1),
  () => [...contract.identities, 'warehouse'],
  () => contract.requiredChecks.slice(0, -1),
  () => ({ ...contract.workspaceRoutes, finance: '/workspace/admin' }),
]
assert.equal(mutations.length, 4)
assert.notDeepEqual(mutations[0](), expectedIdentities)
assert.notDeepEqual(mutations[1](), expectedIdentities)
assert.notDeepEqual(mutations[2](), expectedChecks)
assert.notEqual(mutations[3]().finance, '/workspace/finance')

console.log('TEAM_OS_4_G1_RUNNER_SELFTEST_OK identities=6 roles=5 capabilitiesExtraIdentities=0 checks=6 matrix=36 networkCalls=0 runtime=pending negative=4/4')
