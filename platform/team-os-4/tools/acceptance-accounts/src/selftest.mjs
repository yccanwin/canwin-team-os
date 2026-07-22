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

const PROJECT_REF = 'abcdefghijklmnopqrst'
const CODE_COMMIT = 'a'.repeat(40)
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
})

assert.deepEqual(
  ACCEPTANCE_IDENTITIES.map(({ primaryRole, capability }) => [primaryRole, capability]),
  [['sales', null], ['implementation', 'warehouse'], ['operations', null], ['finance', null], ['admin', 'supervisor']],
)

let calls = []
const adapter = {
  createAuthUser: async ({ email, password }) => {
    assert.ok(password.length >= 32)
    calls.push(`auth:${email}`)
    return { id: `id-${calls.filter((x) => x.startsWith('auth:')).length}` }
  },
  createProfile: async ({ userId, primaryRole, capability }) => {
    calls.push(`profile:${userId}:${primaryRole}:${capability}`)
    return { status: 'active' }
  },
  deleteProfile: async (id) => calls.push(`delete-profile:${id}`),
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
assert.equal(success.accounts.length, 5)
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
    && error.evidence.evidenceSealed === true && error.evidence.evidenceRecordsRejected === false,
)
assert.deepEqual(calls, [
  'profile:new-1', 'profile:new-2', 'profile:new-3',
  'delete-auth:new-3',
  'delete-profile:new-2', 'delete-auth:new-2',
  'delete-profile:new-1', 'delete-auth:new-1',
])
assert.ok(!calls.some((item) => item.includes('existing-admin')))

calls = []
authCount = 0
await assert.rejects(
  provisionAcceptanceAccounts({
    adapter: {
      ...adapter,
      createAuthUser: async () => ({ id: `stage-${++authCount}` }),
      createProfile: async ({ userId }) => { calls.push(`profile:${userId}`); return { status: 'active' } },
      deleteProfile: async (id) => calls.push(`delete-profile:${id}`),
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
      deleteProfile: async (id) => calls.push(`delete-profile:${id}`),
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
assert.deepEqual(calls.slice(-10), [
  'delete-profile:batch-5', 'delete-auth:batch-5',
  'delete-profile:batch-4', 'delete-auth:batch-4',
  'delete-profile:batch-3', 'delete-auth:batch-3',
  'delete-profile:batch-2', 'delete-auth:batch-2',
  'delete-profile:batch-1', 'delete-auth:batch-1',
])
assert.ok(!calls.some((item) => item.includes('existing-admin')))

const cliSource = readFileSync(fileURLToPath(new URL('./cli.mjs', import.meta.url)), 'utf8')
const adapterSource = readFileSync(fileURLToPath(new URL('./supabase-adapter.mjs', import.meta.url)), 'utf8')
assert.ok(cliSource.indexOf("runner must export runAcceptance") < cliSource.indexOf('createClient('))
assert.ok(cliSource.includes("url !== `https://${ref}.supabase.co`"))
assert.ok(cliSource.includes('delete process.env[secretName]'))
assert.ok(!cliSource.includes('writeFile'))
assert.ok(adapterSource.includes("await client.from('profiles').delete().eq('id', userId)"))

assert.equal(typeof createSupabaseAcceptanceAdapter, 'function')

process.stdout.write('TEAM_OS_4_ACCEPTANCE_ACCOUNTS_SELFTEST_OK enabledIdentities=5 anon=attack-only new=5 existingAdminDeleted=0 cleanup=reverse-5 overlayResidual=0 refUrlBound=1 runnerRequired=1 safeStageVisible=1 unsafeDetailHidden=1 secretsLogged=0 secretsWritten=0 success=sealed-not-deleted adapter=present\n')
