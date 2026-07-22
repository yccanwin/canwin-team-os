import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { AcceptanceProvisioningError, provisionAcceptanceAccounts } from './orchestrator.mjs'
import { createSupabaseAcceptanceAdapter } from './supabase-adapter.mjs'

const dryRun = process.argv.includes('--dry-run')
const preflightOnly = process.argv.includes('--preflight-only')
if (dryRun && preflightOnly) throw new Error('choose exactly one of --dry-run or --preflight-only')
const required = (name) => process.env[name] || (() => { throw new Error(`${name} is required`) })()
const ref = required('TEAM_OS_4_TARGET_PROJECT_REF')
const url = required('TEAM_OS_4_SUPABASE_URL')
const GREENFIELD_TEST_PROJECT_REF = 'jgcrhoabvaowxnqksvkq'
if (ref !== GREENFIELD_TEST_PROJECT_REF || url !== `https://${ref}.supabase.co`) {
  throw new Error('target ref and Supabase URL mismatch')
}
const secretName = 'TEAM_OS_4_SUPABASE_SERVICE_ROLE_KEY'
const loadAcceptanceRunner = async () => {
  const runnerPath = resolve(required('TEAM_OS_4_ACCEPTANCE_RUNNER_MODULE'))
  const runner = await import(pathToFileURL(runnerPath).href)
  if (typeof runner.runAcceptance !== 'function' || typeof runner.runPreflightOnly !== 'function') {
    throw new Error('runner must export runAcceptance and runPreflightOnly')
  }
  return runner
}
const printSafePreflight = (result) => {
  const safe = {
    previewRepository: result.previewRepository,
    previewCommit: result.previewCommit,
    pagesUrl: result.pagesUrl,
    screenshotPath: result.screenshotPath,
    screenshotSha256: result.screenshotSha256,
    databaseReady: result.databaseReady,
    existingAcceptanceAccounts: result.existingAcceptanceAccounts,
  }
  process.stdout.write(`TEAM_OS_4_PREVIEW_PREFLIGHT_OK ${JSON.stringify(safe)}\n`)
}

if (preflightOnly) {
  let preflightClient
  let preflightServiceKey
  let exitCode = 1
  try {
    const runner = await loadAcceptanceRunner()
    const preview = await runner.runPreflightOnly()
    preflightServiceKey = required(secretName)
    preflightClient = createClient(url, preflightServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
    const database = await createSupabaseAcceptanceAdapter(preflightClient).preflightAcceptance({ projectRef: ref })
    printSafePreflight({
      ...preview,
      databaseReady: database.status === 'ready',
      existingAcceptanceAccounts: 0,
    })
    exitCode = 0
  } catch {
    process.stderr.write('TEAM_OS_4_PREVIEW_PREFLIGHT_FAIL\n')
  } finally {
    preflightClient = undefined
    preflightServiceKey = undefined
    delete process.env[secretName]
  }
  process.exit(exitCode)
}

if (dryRun) {
  process.stdout.write('TEAM_OS_4_ACCEPTANCE_ACCOUNTS_DRY_RUN_OK remoteCalls=0\n')
  process.exit(0)
}

let client
try {
  const codeCommit = required('TEAM_OS_4_ACCEPTANCE_CODE_COMMIT')
  const runner = await loadAcceptanceRunner()
  printSafePreflight(await runner.runPreflightOnly())
  client = createClient(url, required(secretName), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const domain = required('TEAM_OS_4_ACCEPTANCE_EMAIL_DOMAIN')
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
