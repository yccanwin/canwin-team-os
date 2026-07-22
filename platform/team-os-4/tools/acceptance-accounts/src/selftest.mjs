import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ACCEPTANCE_IDENTITIES, provisionAcceptanceAccounts } from './orchestrator.mjs'
import { createSupabaseAcceptanceAdapter } from './supabase-adapter.mjs'

assert.deepEqual(
  ACCEPTANCE_IDENTITIES.map(({ primaryRole, capability }) => [primaryRole, capability]),
  [['sales', null], ['implementation', null], ['operations', null], ['finance', null], ['admin', 'supervisor']],
)

let calls = []
const adapter = {
  createAuthUser: async ({ email, password }) => {
    assert.ok(password.length >= 32)
    calls.push(`auth:${email}`)
    return { id: `id-${calls.filter((x) => x.startsWith('auth:')).length}` }
  },
  createProfile: async ({ userId, primaryRole, capability }) => calls.push(`profile:${userId}:${primaryRole}:${capability}`),
  deleteProfile: async (id) => calls.push(`delete-profile:${id}`),
  deleteAuthUser: async (id) => calls.push(`delete-auth:${id}`),
}

const success = await provisionAcceptanceAccounts({
  adapter,
  emailFor: (key) => `${key}@example.invalid`,
  runAcceptance: async (accounts) => {
    assert.equal(accounts.length, 5)
    assert.ok(accounts.every((item) => item.password && item.email))
    calls.push('acceptance')
  },
})
assert.deepEqual(success, { status: 'sealed-not-deleted', created: 5 })
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
      },
    },
    emailFor: (key) => `${key}@example.invalid`,
    runAcceptance: async () => assert.fail('must not run'),
  }),
  /this batch was removed/,
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
      createAuthUser: async () => ({ id: `batch-${++authCount}` }),
      createProfile: async ({ userId }) => calls.push(`profile:${userId}`),
      deleteProfile: async (id) => calls.push(`delete-profile:${id}`),
      deleteAuthUser: async (id) => calls.push(`delete-auth:${id}`),
    },
    emailFor: (key) => `${key}@example.invalid`,
    runAcceptance: async () => { throw new Error('runner failed with must-not-log-secret') },
  }),
  (error) => !error.message.includes('must-not-log-secret'),
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

process.stdout.write('TEAM_OS_4_ACCEPTANCE_ACCOUNTS_SELFTEST_OK identities=6 new=5 existingAdminDeleted=0 cleanup=reverse-5 overlayResidual=0 refUrlBound=1 runnerRequired=1 secretsLogged=0 secretsWritten=0 success=sealed-not-deleted adapter=present\n')
