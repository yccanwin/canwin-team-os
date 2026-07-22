import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runBootstrap, validateBootstrapInput } from './orchestrator.mjs'

const cliSource = readFileSync(fileURLToPath(new URL('./cli.mjs', import.meta.url)), 'utf8')
assert.ok(cliSource.indexOf('try {') < cliSource.indexOf("targetProjectRef: required('TEAM_OS_4_TARGET_PROJECT_REF')"))
assert.ok(cliSource.includes('for (const name of credentialNames) delete process.env[name]'))

const input = {
  targetProjectRef: 'abcdefghijklmnopqrst',
  supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  companyName: 'Example Company',
  companyStableKey: 'example_company',
  adminEmail: 'admin@example.invalid',
  adminDisplayName: 'Administrator',
  adminTemporaryPassword: 'not-a-real-secret',
  actorLabel: 'deployment-tool',
  bootstrapVersion: 'selftest',
}

assert.doesNotThrow(() => validateBootstrapInput(input))
assert.throws(
  () => validateBootstrapInput({ ...input, supabaseUrl: 'https://wrong.supabase.co' }),
  /does not match/,
)
assert.throws(
  () => validateBootstrapInput({ ...input, adminTemporaryPassword: undefined }),
  /temporary administrator password is required/,
)

let calls = []
const dryRun = await runBootstrap({
  input,
  dryRun: true,
  adapter: {
    createAdminUser: async () => calls.push('unexpected'),
  },
})
assert.deepEqual(dryRun, { status: 'dry-run-valid', remoteCalls: 0 })
assert.deepEqual(calls, [])

calls = []
await assert.rejects(
  runBootstrap({
    input,
    adapter: {
      createAdminUser: async () => { calls.push('create'); throw new Error('already exists') },
      bootstrapDatabase: async () => { calls.push('unexpected-database') },
      deleteAdminUser: async () => { calls.push('unexpected-delete') },
    },
  }),
  /stopped before database bootstrap/,
)
assert.deepEqual(calls, ['create'])

calls = []
await assert.rejects(
  runBootstrap({
    input,
    adapter: {
      createAdminUser: async () => { calls.push('create'); return { id: 'user-1' } },
      bootstrapDatabase: async () => { calls.push('database'); throw new Error('database failed') },
      deleteAdminUser: async (id) => { calls.push(`delete:${id}`) },
    },
  }),
  /newly created Auth user was deleted/,
)
assert.deepEqual(calls, ['create', 'database', 'delete:user-1'])

const secret = 'must-never-appear-in-log'
await assert.rejects(
  runBootstrap({
    input: { ...input, adminTemporaryPassword: secret },
    adapter: {
      createAdminUser: async () => { throw new Error(secret) },
    },
  }),
  (error) => !String(error.message).includes(secret),
)

calls = []
const success = await runBootstrap({
  input,
  adapter: {
    createAdminUser: async () => { calls.push('create'); return { id: 'user-2' } },
    bootstrapDatabase: async () => { calls.push('database'); return { status: 'sealed' } },
    deleteAdminUser: async () => { calls.push('unexpected-delete') },
  },
})
assert.deepEqual(success, { status: 'sealed' })
assert.deepEqual(calls, ['create', 'database'])

process.stdout.write('TEAM_OS_4_BOOTSTRAP_SELFTEST_OK checks=9 remoteCalls=0 secretsLogged=0 localCredentialReferencesCleared=passed\n')
