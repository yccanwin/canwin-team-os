import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contractPath = resolve(repoRoot, 'scripts', 'p0', 'ci-database-test-contract.json')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const contract = readJson(contractPath)
const clone = (value) => structuredClone(value)
const normalizeLf = (value) => value.replace(/\r\n?/g, '\n')
const sha256Lf = (path) => createHash('sha256').update(normalizeLf(readFileSync(path, 'utf8')), 'utf8').digest('hex')
const exactSet = (actual, expected) =>
  Array.isArray(actual) && actual.length === new Set(actual).size &&
  JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())

const expectedCategories = { database: 7, permission: 10, business: 9 }
const expectedCatalog = { publicTables: 103, publicRoutines: 162, publicViews: 11, storageBuckets: 1 }
const expectedRollbackFixtures = new Set([
  'supabase/tests/customer_import_behavior.sql',
  'supabase/tests/hardware_inventory_behavior.sql',
  'supabase/tests/hardware_shipping_chain_behavior.sql',
])
const allowedModes = new Set(['read_only', 'rollback_fixture'])
const forbiddenSqlBoundary = /(?:^|\W)(?:dblink_connect|postgres_fdw|postgresql_fdw|http_get|http_post|net\.http_)(?:\W|$)/i

function validate(candidate) {
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const counts = candidate.expectedCounts ?? {}
  const tests = candidate.tests ?? []
  const runtime = candidate.runtime ?? {}
  const boundary = candidate.acceptanceBoundary ?? {}

  check(candidate.schemaVersion === 1, 'schema version must be 1')
  check(candidate.manifestType === 'canwin-team-os-p0-ci-database-tests', 'manifest type drift')
  check(candidate.contractStatus === 'p0_candidate_requires_actual_github_run', 'contract status drift')

  check(candidate.baseline?.path === 'supabase/schema.sql', 'baseline path drift')
  check(candidate.baseline?.sha256Lf === sha256Lf(resolve(repoRoot, 'supabase', 'schema.sql')), 'baseline hash drift')
  check(candidate.migrations?.directory === 'supabase/migrations', 'migration directory drift')
  check(candidate.migrations?.sha256Manifest === 'docs/team-os-4.0/p0/migration-sha256-manifest.json', 'migration manifest path drift')
  check(candidate.migrations?.expectedCount === 69, 'migration expected count drift')

  const manifest = readJson(resolve(repoRoot, candidate.migrations?.sha256Manifest ?? 'missing'))
  const migrationFiles = readdirSync(resolve(repoRoot, candidate.migrations?.directory ?? 'missing'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  check(manifest.expectedCount === 69 && manifest.entries?.length === 69, 'migration manifest count drift')
  check(migrationFiles.length === 69, 'migration directory count drift')
  check(exactSet(migrationFiles, (manifest.entries ?? []).map((entry) => entry.file)), 'migration file set drift')
  for (const entry of manifest.entries ?? []) {
    check(entry.sha256 === sha256Lf(resolve(repoRoot, candidate.migrations.directory, entry.file)), `migration hash drift ${entry.file}`)
  }

  check(counts.database === expectedCategories.database, 'database expected count drift')
  check(counts.permission === expectedCategories.permission, 'permission expected count drift')
  check(counts.business === expectedCategories.business, 'business expected count drift')
  check(counts.total === 26, 'total expected count drift')
  check(counts.postInstallCatalogAssertions === 4, 'catalog assertion count drift')
  check(tests.length === counts.total, 'test entry count drift')
  check(exactSet(tests.map((entry) => entry.path), tests.map((entry) => entry.path)), 'duplicate test path')

  const discoveredTests = readdirSync(resolve(repoRoot, 'supabase', 'tests'))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => `supabase/tests/${name}`)
  check(exactSet(tests.map((entry) => entry.path), discoveredTests), 'test file set drift')
  for (const [category, expected] of Object.entries(expectedCategories)) {
    check(tests.filter((entry) => entry.category === category).length === expected, `${category} category count drift`)
  }
  check(tests.every((entry) => Object.hasOwn(expectedCategories, entry.category)), 'unknown test category')
  check(tests.every((entry) => allowedModes.has(entry.executionMode)), 'unknown execution mode')
  check(exactSet(
    tests.filter((entry) => entry.executionMode === 'rollback_fixture').map((entry) => entry.path),
    [...expectedRollbackFixtures],
  ), 'rollback fixture set drift')

  for (const entry of tests) {
    const absolutePath = resolve(repoRoot, entry.path)
    const sql = normalizeLf(readFileSync(absolutePath, 'utf8'))
    check(entry.sha256Lf === sha256Lf(absolutePath), `test hash drift ${entry.path}`)
    check(!/^\s*\\/m.test(sql), `psql meta-command forbidden ${entry.path}`)
    check(!forbiddenSqlBoundary.test(sql), `remote SQL boundary forbidden ${entry.path}`)
    if (entry.executionMode === 'rollback_fixture') {
      check(/^\s*(?:--[^\n]*\n\s*)*begin\s*;/i.test(sql), `fixture must begin a transaction ${entry.path}`)
      check(/rollback\s*;\s*$/i.test(sql), `fixture must end with rollback ${entry.path}`)
    } else {
      check(!/^\s*(?:begin|commit|rollback)\s*;/im.test(sql), `read-only test contains transaction control ${entry.path}`)
    }
  }

  check(JSON.stringify(candidate.postInstallCatalog) === JSON.stringify(expectedCatalog), 'post-install catalog contract drift')
  check(runtime.engine === 'supabase-cli-local-postgres', 'runtime engine drift')
  check(runtime.supabaseCliVersion === '2.109.1', 'Supabase CLI pin drift')
  check(runtime.postgresMajor === 17, 'Postgres major drift')
  check(runtime.startup === 'supabase db start', 'database-only startup command drift')
  check(runtime.workdir === 'scripts/p0/ci-runtime', 'CI workdir drift')
  check(runtime.projectId === 'canwin-team-os-4-ci', 'CI project id drift')
  check(exactSet(runtime.allowedHosts, ['127.0.0.1', 'localhost']), 'allowed host boundary drift')
  check(runtime.allowedPort === 54322, 'allowed port drift')
  check(runtime.allowedDatabase === 'postgres', 'allowed database drift')
  check(runtime.allowedUser === 'postgres', 'allowed user drift')
  check(runtime.remoteConnectionsAllowed === false, 'remote connections must remain disabled')
  check(runtime.credentialMode === 'ephemeral-local-defaults', 'credential mode drift')
  check(runtime.testData === 'synthetic-only', 'test data boundary drift')
  check(runtime.cleanup === 'supabase stop --no-backup', 'cleanup contract drift')

  const config = normalizeLf(readFileSync(resolve(repoRoot, runtime.workdir ?? 'missing', 'supabase', 'config.toml'), 'utf8')).trim()
  const expectedConfig = [
    `project_id = "${runtime.projectId}"`,
    '',
    '[db]',
    `port = ${runtime.allowedPort}`,
    'shadow_port = 54320',
    `major_version = ${runtime.postgresMajor}`,
    '',
    '[db.seed]',
    'enabled = false',
  ].join('\n')
  check(config === expectedConfig, 'isolated Supabase config drift')

  const workflow = normalizeLf(readFileSync(resolve(repoRoot, '.github', 'workflows', 'p0-static.yml'), 'utf8'))
  check(workflow.includes('p0-database:'), 'isolated database CI job missing')
  check(workflow.includes('uses: supabase/setup-cli@v1'), 'official Supabase CLI setup action missing')
  check(workflow.includes(`version: ${runtime.supabaseCliVersion}`), 'workflow Supabase CLI pin drift')
  check(workflow.includes(`${runtime.startup} --workdir ${runtime.workdir} --yes`), 'database-only start step missing')
  check(!workflow.includes('--exclude'), 'full-stack container exclusion list is forbidden')
  check(workflow.includes(`--workdir ${runtime.workdir}`), 'isolated workdir missing from workflow')
  check(workflow.includes('node scripts/p0/run-ci-database-gates.mjs'), 'database gate runner missing from workflow')
  check(workflow.includes(`supabase stop --no-backup --workdir ${runtime.workdir} --yes`), 'destructive isolated cleanup step missing')
  check(!/\bsecrets\s*\./i.test(workflow), 'repository secret reference forbidden')
  check(!/--linked\b|supabase\.co|pooler/i.test(workflow), 'remote Supabase boundary forbidden')

  check(boundary.contractAccepted === true, 'CI database contract not accepted')
  check(boundary.actualGithubRunEvidence === 'pending', 'actual GitHub run must remain pending before evidence')
  check(boundary.g0OverallClaim === false, 'G0 must not be claimed')
  check(boundary.productionReadPerformed === false, 'production read must remain false')
  check(boundary.productionWritePerformed === false, 'production write must remain false')
  check(boundary.repositorySecretsRequired === false, 'repository secrets must not be required')

  const attempts = candidate.formalAttemptHistory ?? []
  check(attempts.length === 1, 'formal attempt history count drift')
  const failedAttempt = attempts[0] ?? {}
  check(failedAttempt.runId === '29680934378', 'failed run id drift')
  check(failedAttempt.jobId === '88176860842', 'failed job id drift')
  check(failedAttempt.headSha === '9d3b0d2a0c2569367dcfcfb0b41e696b4886d185', 'failed head SHA drift')
  check(failedAttempt.conclusion === 'failure', 'failed attempt conclusion drift')
  check(failedAttempt.failedStep === 'Start isolated local Postgres', 'failed step drift')
  check(failedAttempt.rootCauseCode === 'full_stack_exclusion_name_drift', 'failed root cause drift')
  check(failedAttempt.sqlTestsStarted === false, 'failed attempt must not claim SQL execution')
  check(failedAttempt.cleanupPassed === true, 'failed attempt cleanup evidence missing')
  check(failedAttempt.productionReadPerformed === false, 'failed attempt production read must remain false')
  check(failedAttempt.productionWritePerformed === false, 'failed attempt production write must remain false')
  check(failedAttempt.rerunOfFailedRun === false, 'failed run must not be represented as rerun')
  return failures
}

const failures = validate(contract)
const negativeCases = [
  ['schema version', (value) => { value.schemaVersion = 2 }],
  ['baseline hash', (value) => { value.baseline.sha256Lf = '0'.repeat(64) }],
  ['missing test', (value) => { value.tests.pop() }],
  ['test hash', (value) => { value.tests[0].sha256Lf = '0'.repeat(64) }],
  ['test category', (value) => { value.tests[0].category = 'unknown' }],
  ['fixture mode', (value) => { value.tests[0].executionMode = 'rollback_fixture' }],
  ['remote connection', (value) => { value.runtime.remoteConnectionsAllowed = true }],
  ['remote host', (value) => { value.runtime.allowedHosts = ['db.example.com'] }],
  ['remote port', (value) => { value.runtime.allowedPort = 6543 }],
  ['Postgres major', (value) => { value.runtime.postgresMajor = 15 }],
  ['CLI unpinned', (value) => { value.runtime.supabaseCliVersion = 'latest' }],
  ['full stack startup', (value) => { value.runtime.startup = 'supabase start' }],
  ['repository secret', (value) => { value.acceptanceBoundary.repositorySecretsRequired = true }],
  ['production write', (value) => { value.acceptanceBoundary.productionWritePerformed = true }],
  ['G0 falsely claimed', (value) => { value.acceptanceBoundary.g0OverallClaim = true }],
  ['failed evidence erased', (value) => { value.formalAttemptHistory = [] }],
]
let negativePassed = 0
for (const [name, mutate] of negativeCases) {
  const candidate = clone(contract)
  mutate(candidate)
  if (validate(candidate).length > 0) negativePassed += 1
  else failures.push(`negative self-test did not fail: ${name}`)
}

if (failures.length > 0) {
  console.error('P0_CI_DATABASE_CONTRACT_DRIFT')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `P0_CI_DATABASE_CONTRACT_OK baseline=1 migrations=69 tests=${contract.tests.length} database=7 permission=10 business=9 catalog=4 negative=${negativePassed}/${negativeCases.length} localOnly=true repositorySecrets=0 productionReads=0 productionWrites=0 actualGithubRun=pending`,
)
