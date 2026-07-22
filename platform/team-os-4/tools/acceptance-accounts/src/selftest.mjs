import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ACCEPTANCE_IDENTITIES, provisionAcceptanceAccounts } from './orchestrator.mjs'
import { createSupabaseAcceptanceAdapter } from './supabase-adapter.mjs'
import {
  ANONYMOUS_NEGATIVE_STAGES,
  ENABLED_ACCOUNT_BOUNDARY_STAGES,
  ENABLED_ACCOUNT_POSITIVE_STAGES,
  createAcceptanceEvidenceRecord,
} from './evidence.mjs'

const PROJECT_REF = 'jgcrhoabvaowxnqksvkq'
const CODE_COMMIT = 'a'.repeat(40)
const RUNTIME_SCREENSHOT_STAGES = Object.freeze([
  'role-business-page-real-remote-request',
  'manual-cross-role-url-denied',
  'management-page-matches-role-policy',
])
const passedSteps = Object.freeze({
  signIn: 'passed', profileContext: 'passed', ownScopeApi: 'passed', roleBusinessRead: 'passed',
  crossReadPolicy: 'passed', crossWrite: 'denied', managementApi: 'passed',
  roleBusinessBoundary: 'passed', publicBootstrap: 'denied', privateBootstrap: 'denied',
  pageLogin: 'passed', autoRoute: 'passed', crossUrl: 'denied', managementPage: 'passed',
})
const acceptanceRecord = (context, role, identityKind, stage) => createAcceptanceEvidenceRecord({
  runId: context.runId,
  targetProjectRef: context.targetProjectRef,
  applicationCommit: context.applicationCommit,
  accountRole: role,
  identityKind,
  stage,
  startedAt: '2026-07-22T00:00:00.000Z',
  finishedAt: '2026-07-22T00:00:01.000Z',
  pageUrlOrApiSurface: `selftest:${role}:${stage}`,
  httpStatusOrPostgresCode: 'CHECK_OK',
  rowCountOrResultDigest: 0,
  pageTestIdOrTraceDigest: `trace:${role}:${stage}`,
  outcome: 'passed',
})
const acceptanceResult = (accounts, context) => ({
  global: { anonymousBootstrap: 'denied', browserLaunch: 'passed' },
  accounts: accounts.map((account) => ({ identityKey: account.key, steps: { ...passedSteps } })),
  runId: context.runId,
  applicationCommit: context.applicationCommit,
  evidenceRecords: [
    ...accounts.flatMap((account) => {
      const role = account.key === 'admin_supervisor' ? 'admin' : account.key
      return [...ENABLED_ACCOUNT_POSITIVE_STAGES, ...ENABLED_ACCOUNT_BOUNDARY_STAGES]
        .map((stage) => acceptanceRecord(context, role, 'enabled-account', stage))
    }),
    ...ANONYMOUS_NEGATIVE_STAGES.map((stage) => acceptanceRecord(context, 'anon', 'anonymous-attack', stage)),
  ],
  screenshotEvidence: accounts.flatMap((account) => {
    const role = account.key === 'admin_supervisor' ? 'admin' : account.key
    return RUNTIME_SCREENSHOT_STAGES.map((stage) => ({
      role,
      stage,
      screenshotPath: `C:\\team-os-4-g1-evidence\\${role}-${stage}.png`,
      screenshotSha256: 'b'.repeat(64),
      pageUrl: `https://example.invalid/#/workspace/${role}`,
    }))
  }),
})

assert.deepEqual(
  ACCEPTANCE_IDENTITIES.map(({ primaryRole, capability }) => [primaryRole, capability]),
  [['sales', null], ['implementation', 'warehouse'], ['operations', null], ['finance', null], ['admin', 'supervisor']],
)

let calls = []
const adapter = {
  preflightAcceptance: async () => { calls.push('preflight'); return { status: 'ready' } },
  createAuthUser: async ({ email, password }) => {
    assert.ok(password.length >= 32)
    calls.push(`auth:${email}`)
    return { id: `id-${calls.filter((x) => x.startsWith('auth:')).length}` }
  },
  createProfile: async ({ userId, primaryRole, capability }) => {
    calls.push(`profile:${userId}:${primaryRole}:${capability}`)
    return { status: 'active' }
  },
  createRunFixtures: async () => {
    calls.push('fixtures')
    return {
      status: 'prepared', baseline_version: 1, enabled_accounts: 5,
      run_work_items: 5, run_business_rows: 4, persistent_baseline_ready: true,
    }
  },
  retainRun: async () => { calls.push('retain'); return { status: 'retained' } },
  cleanupRunDatabase: async () => { calls.push('cleanup-db'); return { status: 'confirmed-cleaned' } },
  deleteAcceptanceProfile: async ({ id, runId, identityKey }) => {
    assert.ok(runId)
    assert.ok(identityKey)
    calls.push(`delete-profile:${id}`)
    return { status: 'deleted' }
  },
  quarantineAccounts: async ({ accounts }) => {
    calls.push('quarantine')
    return {
      status: 'quarantined',
      profileDisabledIds: accounts.map((account) => account.id),
      authBannedIds: accounts.map((account) => account.id),
    }
  },
  deleteAuthUser: async (id) => calls.push(`delete-auth:${id}`),
}

const success = await provisionAcceptanceAccounts({
  adapter,
  emailFor: (key) => `${key}@example.invalid`,
  projectRef: PROJECT_REF,
  codeCommit: CODE_COMMIT,
  runAcceptance: async (accounts, context) => {
    assert.equal(accounts.length, 5)
    assert.ok(accounts.every((item) => item.password && item.email))
    calls.push('acceptance')
    return acceptanceResult(accounts, context)
  },
})
assert.equal(success.status, 'sealed-not-deleted')
assert.equal(success.evidenceSealed, true)
assert.equal(success.provisioningEvidence.status, 'retained')
assert.equal(success.provisioningEvidence.fixturesCountAsRuntimeEvidence, false)
assert.equal(success.accounts.length, 5)
assert.equal(success.screenshotEvidence.length, 15)
assert.ok(success.accounts.every((item) => item.projectRef === PROJECT_REF && item.codeCommit === CODE_COMMIT && item.profileStatus === 'active'))
assert.ok(success.accounts.every((item) => /^[a-f0-9]{64}$/.test(item.userIdSha256)))
assert.equal(calls.filter((x) => x.startsWith('delete-')).length, 0)

calls = []
let authCount = 0
await assert.rejects(
  provisionAcceptanceAccounts({
    adapter: {
      ...adapter,
      createAuthUser: async () => ({ id: `new-${++authCount}` }),
      createProfile: async ({ userId }) => {
        calls.push(`profile:${userId}`)
        if (userId === 'new-3') throw new Error('profile failure')
        return { status: 'active' }
      },
    },
    emailFor: (key) => `${key}@example.invalid`,
    projectRef: PROJECT_REF,
    codeCommit: CODE_COMMIT,
    runAcceptance: async () => assert.fail('must not run'),
  }),
  (error) => error.evidence?.status === 'failed-cleaned' && error.evidence.cleanedAccounts === 3
    && error.evidence.evidenceSealed === false && error.evidence.runtimeEvidenceStatus === 'not-started'
    && error.evidence.evidenceRecordsRejected === false,
)
assert.deepEqual(calls, [
  'preflight', 'profile:new-1', 'profile:new-2', 'profile:new-3',
  'delete-profile:new-3', 'delete-profile:new-2', 'delete-profile:new-1',
  'delete-auth:new-3', 'delete-auth:new-2', 'delete-auth:new-1',
])
assert.ok(!calls.some((item) => item.includes('existing-admin')))

calls = []
await assert.rejects(
  provisionAcceptanceAccounts({
    adapter,
    emailFor: (key) => `${key}@example.invalid`,
    projectRef: PROJECT_REF,
    codeCommit: CODE_COMMIT,
    runAcceptance: async (accounts, context) => {
      const result = acceptanceResult(accounts, context)
      return { ...result, screenshotEvidence: result.screenshotEvidence.slice(0, -1) }
    },
  }),
  (error) => error.evidence?.status === 'failed-cleaned'
    && error.evidence.evidenceRecordsRejected === true,
)

calls = []
authCount = 0
await assert.rejects(
  provisionAcceptanceAccounts({
    adapter: {
      ...adapter,
      createAuthUser: async () => ({ id: `stage-${++authCount}` }),
      createProfile: async ({ userId }) => { calls.push(`profile:${userId}`); return { status: 'active' } },
      deleteAuthUser: async (id) => calls.push(`delete-auth:${id}`),
    },
    emailFor: (key) => `${key}@example.invalid`,
    projectRef: PROJECT_REF,
    codeCommit: CODE_COMMIT,
    runAcceptance: async () => { throw new Error('G1_STAGE_FAIL auto-route:sales') },
  }),
  (error) => error.evidence?.safeStage === 'G1_STAGE_FAIL auto-route:sales'
    && error.evidence.evidenceSealed === false && error.evidence.evidenceRecordsRejected === true,
)
assert.equal(calls.filter((item) => item.startsWith('delete-auth:')).length, 5)

calls = []
authCount = 0
await assert.rejects(
  provisionAcceptanceAccounts({
    adapter: {
      ...adapter,
      createAuthUser: async () => ({ id: `batch-${++authCount}` }),
      createProfile: async ({ userId }) => { calls.push(`profile:${userId}`); return { status: 'active' } },
      deleteAuthUser: async (id) => calls.push(`delete-auth:${id}`),
    },
    emailFor: (key) => `${key}@example.invalid`,
    projectRef: PROJECT_REF,
    codeCommit: CODE_COMMIT,
    runAcceptance: async () => { throw new Error('runner failed with must-not-log-secret') },
  }),
  (error) => !error.message.includes('must-not-log-secret') && error.evidence?.safeStage === 'G1_STAGE_FAIL concealed'
    && error.evidence.evidenceSealed === false && error.evidence.evidenceRecordsRejected === true,
)
assert.deepEqual(calls.filter((item) => item.startsWith('delete-auth:')), [
  'delete-auth:batch-5', 'delete-auth:batch-4', 'delete-auth:batch-3',
  'delete-auth:batch-2', 'delete-auth:batch-1',
])
assert.ok(!calls.some((item) => item.includes('existing-admin')))

calls = []
await assert.rejects(
  provisionAcceptanceAccounts({
    adapter: { ...adapter, preflightAcceptance: async () => { throw new Error('residual acceptance run') } },
    emailFor: (key) => `${key}@example.invalid`, projectRef: PROJECT_REF, codeCommit: CODE_COMMIT,
    runAcceptance: async () => assert.fail('must not run'),
  }),
  (error) => error.evidence?.createdAccounts === 0
    && error.evidence.databaseCleanupStatus === 'not-required'
    && error.evidence.runtimeEvidenceStatus === 'not-started',
)

calls = []
authCount = 0
await assert.rejects(
  provisionAcceptanceAccounts({
    adapter: {
      ...adapter,
      createAuthUser: async () => ({ id: `fixture-${++authCount}` }),
      createProfile: async () => ({ status: 'active' }),
      createRunFixtures: async () => { throw new Error('fixture response lost') },
      cleanupRunDatabase: async () => ({ status: 'not-found' }),
    },
    emailFor: (key) => `${key}@example.invalid`, projectRef: PROJECT_REF, codeCommit: CODE_COMMIT,
    runAcceptance: async () => assert.fail('must not run'),
  }),
  (error) => error.evidence?.fixturePreparationState === 'indeterminate'
    && error.evidence.databaseCleanupStatus === 'confirmed-not-prepared'
    && error.evidence.runtimeEvidenceStatus === 'not-started',
)

calls = []
authCount = 0
await assert.rejects(
  provisionAcceptanceAccounts({
    adapter: {
      ...adapter,
      createAuthUser: async () => ({ id: `quarantine-${++authCount}` }),
      createProfile: async () => ({ status: 'active' }),
      cleanupRunDatabase: async () => { throw new Error('cleanup failed') },
      quarantineAccounts: async ({ accounts }) => ({
        status: 'quarantine-incomplete',
        profileDisabledIds: accounts.slice(0, 3).map((item) => item.id),
        authBannedIds: accounts.slice(0, 2).map((item) => item.id),
      }),
    },
    emailFor: (key) => `${key}@example.invalid`, projectRef: PROJECT_REF, codeCommit: CODE_COMMIT,
    runAcceptance: async () => { throw new Error('G1_STAGE_FAIL auto-route:sales') },
  }),
  (error) => error.evidence?.status === 'failed-cleanup-incomplete'
    && error.evidence.databaseCleanupStatus === 'indeterminate'
    && error.evidence.authBannedAccounts === 2
    && error.evidence.remainingUserIdHashes.length === 5,
)

calls = []
authCount = 0
await assert.rejects(
  provisionAcceptanceAccounts({
    adapter: {
      ...adapter,
      createAuthUser: async () => ({ id: `partial-delete-${++authCount}` }),
      createProfile: async () => ({ status: 'active' }),
      deleteAuthUser: async (id) => {
        if (id === 'partial-delete-3') throw new Error('one auth delete failed')
      },
    },
    emailFor: (key) => `${key}@example.invalid`, projectRef: PROJECT_REF, codeCommit: CODE_COMMIT,
    runAcceptance: async () => { throw new Error('G1_STAGE_FAIL auto-route:sales') },
  }),
  (error) => error.evidence?.status === 'failed-quarantined'
    && error.evidence.cleanedAccounts === 4
    && error.evidence.authBannedAccounts === 1
    && error.evidence.remainingUserIdHashes.length === 1,
)

calls = []
authCount = 0
await assert.rejects(
  provisionAcceptanceAccounts({
    adapter: {
      ...adapter,
      createAuthUser: async () => ({ id: `retain-${++authCount}` }),
      createProfile: async () => ({ status: 'active' }),
      retainRun: async () => { throw new Error('retention response lost') },
    },
    emailFor: (key) => `${key}@example.invalid`, projectRef: PROJECT_REF, codeCommit: CODE_COMMIT,
    runAcceptance: acceptanceResult,
  }),
  (error) => error.evidence?.evidenceRecordsRejected === false
    && error.evidence.runtimeEvidenceStatus === 'sealed-passed-retention-indeterminate'
    && error.evidence.runtimeEvidence?.current_run_counts?.total === 82,
)

const cliSource = readFileSync(fileURLToPath(new URL('./cli.mjs', import.meta.url)), 'utf8')
const adapterSource = readFileSync(fileURLToPath(new URL('./supabase-adapter.mjs', import.meta.url)), 'utf8')
assert.ok(cliSource.indexOf("runner must export runAcceptance") < cliSource.indexOf('createClient('))
assert.ok(cliSource.includes("url !== `https://${ref}.supabase.co`"))
assert.ok(cliSource.includes("GREENFIELD_TEST_PROJECT_REF = 'jgcrhoabvaowxnqksvkq'"))
assert.ok(cliSource.includes("evidenceSealed: false"))
assert.ok(cliSource.includes("runtimeEvidenceStatus: 'not-started'"))
assert.ok(cliSource.includes("databaseCleanupStatus: 'not-required'"))
assert.ok(cliSource.includes("fixturePreparationState: 'not-started'"))
assert.ok(cliSource.includes('runtimeEvidence: null'))
assert.ok(cliSource.includes('delete process.env[secretName]'))
assert.ok(!cliSource.includes('writeFile'))
assert.ok(adapterSource.includes("client.rpc('create_g1_acceptance_run_v1'"))
assert.ok(adapterSource.includes("client.rpc('cleanup_g1_acceptance_run_v1'"))
assert.ok(adapterSource.includes("acceptance_state: 'quarantined'"))

assert.equal(typeof createSupabaseAcceptanceAdapter, 'function')

process.stdout.write('TEAM_OS_4_ACCEPTANCE_ACCOUNTS_SELFTEST_OK enabledIdentities=5 anon=attack-only new=5 fixture=real-remote cleanup=database-first retention=sealed-not-deleted quarantine=present existingAdminDeleted=0 secretsLogged=0 secretsWritten=0 adapter=present\n')
