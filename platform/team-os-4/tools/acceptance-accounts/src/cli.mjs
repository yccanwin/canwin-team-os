import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { AcceptanceProvisioningError, provisionAcceptanceAccounts } from './orchestrator.mjs'
import { createSupabaseAcceptanceAdapter } from './supabase-adapter.mjs'

const dryRun = process.argv.includes('--dry-run')
const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`) })()
const ref = required('TEAM_OS_4_TARGET_PROJECT_REF')
const url = required('TEAM_OS_4_SUPABASE_URL')
const GREENFIELD_TEST_PROJECT_REF = 'jgcrhoabvaowxnqksvkq'
if (ref !== GREENFIELD_TEST_PROJECT_REF || url !== `https://${ref}.supabase.co`) {
  throw new Error('target ref and Supabase URL mismatch')
}

if (dryRun) {
  process.stdout.write('TEAM_OS_4_ACCEPTANCE_ACCOUNTS_DRY_RUN_OK remoteCalls=0\n')
  process.exit(0)
}

const secretName = 'TEAM_OS_4_SUPABASE_SERVICE_ROLE_KEY'
let client
try {
  const runnerPath = resolve(required('TEAM_OS_4_ACCEPTANCE_RUNNER_MODULE'))
  const runner = await import(pathToFileURL(runnerPath).href)
  if (typeof runner.runAcceptance !== 'function') throw new Error('runner must export runAcceptance')
  client = createClient(url, required(secretName), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const domain = required('TEAM_OS_4_ACCEPTANCE_EMAIL_DOMAIN')
  const codeCommit = required('TEAM_OS_4_ACCEPTANCE_CODE_COMMIT')
  const nonce = Date.now().toString(36)
  const result = await provisionAcceptanceAccounts({
    adapter: createSupabaseAcceptanceAdapter(client),
    emailFor: (key) => `g1-${nonce}-${key}@${domain}`,
    runAcceptance: runner.runAcceptance,
    projectRef: ref,
    codeCommit,
  })
  process.stdout.write(`TEAM_OS_4_ACCEPTANCE_ACCOUNTS_OK ${JSON.stringify(result)}\n`)
} catch (error) {
  const evidence = error instanceof AcceptanceProvisioningError
    ? error.evidence
    : {
        schemaVersion: 1, status: 'failed-before-provisioning', evidenceSealed: false,
        runtimeEvidenceStatus: 'not-started', databaseCleanupStatus: 'not-required',
        fixturePreparationState: 'not-started', runtimeEvidence: null,
        safeStage: 'G1_STAGE_FAIL concealed', createdAccounts: 0, cleanedAccounts: 0,
        credentialsExposed: false,
      }
  process.stderr.write(`TEAM_OS_4_ACCEPTANCE_ACCOUNTS_FAIL ${JSON.stringify(evidence)}\n`)
  process.exitCode = 1
} finally {
  client = undefined
  delete process.env[secretName]
}
