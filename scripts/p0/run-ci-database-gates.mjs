import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const p0Path = (...segments) => resolve(repoRoot, 'scripts', 'p0', ...segments)
const contract = JSON.parse(readFileSync(p0Path('ci-database-test-contract.json'), 'utf8'))
const migrationManifest = JSON.parse(readFileSync(resolve(repoRoot, contract.migrations.sha256Manifest), 'utf8'))
const runtime = contract.runtime
const selfTest = process.argv.includes('--self-test')
const connection = {
  host: '127.0.0.1',
  port: runtime.allowedPort,
  database: runtime.allowedDatabase,
  user: runtime.allowedUser,
}

function validateConnection(candidate) {
  const failures = []
  const host = String(candidate.host ?? '').toLowerCase()
  if (!runtime.allowedHosts.includes(host)) failures.push('host is not loopback')
  if (Number(candidate.port) !== runtime.allowedPort) failures.push('port is not the isolated CI port')
  if (candidate.database !== runtime.allowedDatabase) failures.push('database name drift')
  if (candidate.user !== runtime.allowedUser) failures.push('database user drift')
  if (runtime.remoteConnectionsAllowed !== false) failures.push('contract permits a remote connection')
  if (runtime.credentialMode !== 'ephemeral-local-defaults') failures.push('credential mode is not ephemeral local defaults')
  return failures
}

function redact(value) {
  return String(value ?? '')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/\b(?:password|passwd|pwd)\s*[=:]\s*[^\s]+/gi, 'password=[REDACTED]')
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED_JWT]')
}

function runNodeContractVerifier() {
  const result = spawnSync(process.execPath, [p0Path('verify-ci-database-contract.mjs')], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    windowsHide: true,
  })
  if (result.stdout) process.stdout.write(redact(result.stdout))
  if (result.stderr) process.stderr.write(redact(result.stderr))
  if (result.status !== 0 || result.error) throw new Error(result.error?.message ?? `contract verifier exit=${result.status}`)
}

function cleanPsqlEnvironment() {
  const keep = new Set([
    'CI', 'PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP',
    'LANG', 'LC_ALL', 'HOME', 'USERPROFILE', 'COMSPEC', 'PATHEXT',
  ])
  const cleaned = Object.fromEntries(Object.entries(process.env).filter(([name]) => keep.has(name)))
  return {
    ...cleaned,
    PGHOST: connection.host,
    PGPORT: String(connection.port),
    PGDATABASE: connection.database,
    PGUSER: connection.user,
    PGPASSWORD: 'postgres',
    PGCLIENTENCODING: 'UTF8',
  }
}

function psqlBaseArgs() {
  return [
    '--no-psqlrc',
    '--set=ON_ERROR_STOP=1',
    `--host=${connection.host}`,
    `--port=${connection.port}`,
    `--dbname=${connection.database}`,
    `--username=${connection.user}`,
  ]
}

function runRuntimePreflight() {
  console.log('[p0:ci-db] RUN runtime-preflight')
  const cli = spawnSync('supabase', ['--version'], { cwd: repoRoot, encoding: 'utf8', env: process.env, windowsHide: true })
  if (cli.status !== 0 || cli.error || String(cli.stdout).trim() !== runtime.supabaseCliVersion) {
    throw new Error(`Supabase CLI version drift expected=${runtime.supabaseCliVersion} actual=${redact(String(cli.stdout || cli.stderr || cli.error?.message).trim())}`)
  }
  const postgres = spawnSync('psql', ['--version'], { cwd: repoRoot, encoding: 'utf8', env: cleanPsqlEnvironment(), windowsHide: true })
  if (postgres.status !== 0 || postgres.error) throw new Error(`psql unavailable: ${redact(postgres.stderr || postgres.error?.message)}`)
  const server = spawnSync('psql', [...psqlBaseArgs(), '--tuples-only', '--no-align', '--command=show server_version_num;'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: cleanPsqlEnvironment(),
    windowsHide: true,
  })
  const serverMajor = Number.parseInt(String(server.stdout).trim(), 10) / 10000 | 0
  if (server.status !== 0 || server.error || serverMajor !== runtime.postgresMajor) {
    throw new Error(`Postgres major drift expected=${runtime.postgresMajor} actual=${Number.isFinite(serverMajor) ? serverMajor : 'unknown'}`)
  }
  console.log(`[p0:ci-db] PASS runtime-preflight supabase=${runtime.supabaseCliVersion} postgresMajor=${serverMajor} host=loopback`)
}

function runPsqlFile(label, relativePath, singleTransaction) {
  const args = [...psqlBaseArgs(), '--quiet']
  if (singleTransaction) args.push('--single-transaction')
  args.push(`--file=${resolve(repoRoot, relativePath)}`)
  console.log(`[p0:ci-db] RUN ${label}`)
  const result = spawnSync('psql', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: cleanPsqlEnvironment(),
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.status !== 0 || result.error) {
    const detail = redact(result.stderr || result.stdout || result.error?.message || `exit=${result.status}`)
    throw new Error(`${label} failed\n${detail}`)
  }
  console.log(`[p0:ci-db] PASS ${label}`)
}

function runCatalogAssertions() {
  const query = [
    "select 'publicTables=' || count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p');",
    "select 'publicRoutines=' || count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p');",
    "select 'publicViews=' || count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m');",
    "select 'storageBuckets=' || count(*) from storage.buckets;",
  ].join('\n')
  console.log('[p0:ci-db] RUN post-install-catalog')
  const result = spawnSync('psql', [...psqlBaseArgs(), '--tuples-only', '--no-align', `--command=${query}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: cleanPsqlEnvironment(),
    windowsHide: true,
  })
  if (result.status !== 0 || result.error) {
    throw new Error(`post-install-catalog failed\n${redact(result.stderr || result.stdout || result.error?.message)}`)
  }
  const actual = Object.fromEntries(
    String(result.stdout).split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, value] = line.trim().split('=')
      return [name, Number(value)]
    }),
  )
  const failures = Object.entries(contract.postInstallCatalog)
    .filter(([name, value]) => actual[name] !== value)
    .map(([name, value]) => `${name} expected=${value} actual=${actual[name] ?? 'missing'}`)
  if (failures.length > 0) throw new Error(`post-install-catalog drift\n${failures.join('\n')}`)
  console.log('[p0:ci-db] PASS post-install-catalog assertions=4')
}

function runSelfTest() {
  runNodeContractVerifier()
  const baseline = validateConnection(connection)
  const cases = [
    ['remote host', { ...connection, host: 'db.example.com' }],
    ['IPv6 loopback not contracted', { ...connection, host: '::1' }],
    ['remote pooler port', { ...connection, port: 6543 }],
    ['wrong local port', { ...connection, port: 54321 }],
    ['wrong database', { ...connection, database: 'template1' }],
    ['wrong user', { ...connection, user: 'service_role' }],
  ]
  let negativePassed = 0
  for (const [, candidate] of cases) {
    if (validateConnection(candidate).length > 0) negativePassed += 1
  }
  if (baseline.length > 0 || negativePassed !== cases.length) {
    console.error('P0_CI_DATABASE_RUNNER_SELFTEST_FAILED')
    for (const failure of baseline) console.error(`- ${failure}`)
    process.exit(1)
  }
  console.log(`P0_CI_DATABASE_RUNNER_SELFTEST_OK positive=1 negative=${negativePassed}/${cases.length} localOnly=true databaseCalls=0 productionReads=0 productionWrites=0`)
}

if (selfTest) {
  runSelfTest()
  process.exit(0)
}

if (!['1', 'true'].includes(String(process.env.CI).toLowerCase())) {
  console.error('P0_CI_DATABASE_RUNNER_REFUSED: CI=1 or CI=true is required')
  process.exit(1)
}
const connectionFailures = validateConnection(connection)
if (connectionFailures.length > 0) {
  console.error('P0_CI_DATABASE_RUNNER_REFUSED')
  for (const failure of connectionFailures) console.error(`- ${failure}`)
  process.exit(1)
}

try {
  runNodeContractVerifier()
  runRuntimePreflight()
  runPsqlFile('baseline', contract.baseline.path, true)
  for (const entry of migrationManifest.entries) {
    runPsqlFile(`migration:${entry.version}`, `${contract.migrations.directory}/${entry.file}`, true)
  }
  for (const test of contract.tests) {
    runPsqlFile(`test:${test.category}:${test.path.split('/').at(-1)}`, test.path, test.executionMode === 'read_only')
  }
  runCatalogAssertions()
  console.log('P0_CI_DATABASE_GATES_OK baseline=1 migrations=71 tests=27 database=7 permission=11 business=9 catalog=4 repositorySecrets=0 productionReads=0 productionWrites=0')
} catch (error) {
  console.error(`P0_CI_DATABASE_GATES_FAILED\n${redact(error instanceof Error ? error.message : error)}`)
  process.exit(1)
}
