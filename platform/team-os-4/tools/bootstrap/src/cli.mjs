import { createClient } from '@supabase/supabase-js'
import { runBootstrap } from './orchestrator.mjs'

const dryRun = process.argv.includes('--dry-run')
const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const credentialNames = [
  'TEAM_OS_4_SUPABASE_SERVICE_ROLE_KEY',
  'TEAM_OS_4_ADMIN_TEMP_PASSWORD',
]

let client
const adapter = dryRun ? null : {
  async createAdminUser({ email, password }) {
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { system: 'team-os-4' },
    })
    if (error) throw error
    if (!data.user?.id) throw new Error('Auth createUser returned no user id')
    return { id: data.user.id }
  },
  async bootstrapDatabase(args) {
    const { data, error } = await client.rpc('bootstrap_team_os_4_deployment', args)
    if (error) throw error
    return data
  },
  async deleteAdminUser(id) {
    const { error } = await client.auth.admin.deleteUser(id, false)
    if (error) throw error
  },
}

try {
  const input = {
    targetProjectRef: required('TEAM_OS_4_TARGET_PROJECT_REF'),
    supabaseUrl: required('TEAM_OS_4_SUPABASE_URL'),
    companyName: required('TEAM_OS_4_COMPANY_NAME'),
    companyStableKey: required('TEAM_OS_4_COMPANY_STABLE_KEY'),
    adminEmail: required('TEAM_OS_4_ADMIN_EMAIL'),
    adminDisplayName: required('TEAM_OS_4_ADMIN_DISPLAY_NAME'),
    adminTemporaryPassword: dryRun ? undefined : required('TEAM_OS_4_ADMIN_TEMP_PASSWORD'),
    actorLabel: required('TEAM_OS_4_BOOTSTRAP_ACTOR'),
    bootstrapVersion: required('TEAM_OS_4_BOOTSTRAP_VERSION'),
  }
  if (!dryRun) {
    client = createClient(input.supabaseUrl, required('TEAM_OS_4_SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
  }
  const result = await runBootstrap({ input, adapter, dryRun })
  process.stdout.write(`TEAM_OS_4_BOOTSTRAP_OK status=${result.status ?? 'sealed'}\n`)
} catch (error) {
  process.stderr.write(`TEAM_OS_4_BOOTSTRAP_FAIL ${error.message}\n`)
  process.exitCode = 1
} finally {
  client = undefined
  for (const name of credentialNames) delete process.env[name]
}
