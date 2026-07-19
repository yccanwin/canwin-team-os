import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseTemporaryPgEnvironment,
  runPgTool,
  runPsql,
  useSessionPooler,
} from '../p0/temporary-db-access.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const scriptRoot = resolve(repoRoot, 'scripts', 'p1')
const contract = JSON.parse(readFileSync(resolve(scriptRoot, 'isolated-runtime-contract.json'), 'utf8'))
const databaseContract = JSON.parse(readFileSync(resolve(repoRoot, contract.databaseContractPath), 'utf8'))
const migrationManifest = JSON.parse(readFileSync(resolve(repoRoot, contract.migrationManifestPath), 'utf8'))
const restoreRun = JSON.parse(readFileSync(resolve(repoRoot, contract.restoreRunPath), 'utf8'))

const TARGET_REF = 'zdmuaqokndhhbarudhtw'
const PRODUCTION_REF = 'agygfhmkazcbqaqwmljb'
const P1_VERSION = '20260719130910'
const mode = process.argv[2]
const allowedModes = new Set(['--self-test', '--dry-run', '--execute'])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sha256Lf(path) {
  return sha256(readFileSync(path, 'utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n'))
}

function redact(value) {
  return String(value ?? '')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, 'postgresql://[REDACTED]')
    .replace(/(PGPASSWORD=)[^\s]+/gi, '$1[REDACTED]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, 'sb_[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    .slice(0, 4000)
}

function run(commandPath, args, { cwd = repoRoot, env = process.env, timeout = 180000 } = {}) {
  return spawnSync(commandPath, args, {
    cwd,
    env: { ...env, SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  })
}

function requireSuccess(label, result) {
  if (result.status === 0 && !result.error) return result
  throw new Error(label + ' failed: ' + redact(result.stderr || result.stdout || result.error?.message))
}

function validateBoundary({ targetRef, linkedRef, workdir, workspaceLinkUsed }) {
  const failures = []
  if (targetRef !== TARGET_REF) failures.push('target ref is not the frozen isolated project')
  if (targetRef === PRODUCTION_REF || linkedRef === PRODUCTION_REF) failures.push('production ref is forbidden')
  if (linkedRef !== TARGET_REF) failures.push('temporary linked ref mismatch')
  if (workspaceLinkUsed) failures.push('workspace linked state must not be used')
  if (!workdir || resolve(workdir) === repoRoot || !resolve(workdir).startsWith(resolve(tmpdir()))) {
    failures.push('workdir is not an independent system temporary directory')
  }
  return failures
}

function requireBoundary(candidate) {
  const failures = validateBoundary(candidate)
  if (failures.length > 0) throw new Error('P1_TARGET_BOUNDARY_REFUSED: ' + failures.join('; '))
}

function signedLocalMigrations() {
  const directory = resolve(repoRoot, 'supabase', 'migrations')
  const files = readdirSync(directory).filter((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file)).sort()
  if (files.length !== contract.expected.postMigrationRows || files.length !== migrationManifest.entries.length) {
    throw new Error('signed local migration file count drift')
  }
  return migrationManifest.entries.map((entry, index) => {
    const file = files[index]
    const version = file.slice(0, 14)
    const hash = sha256Lf(resolve(directory, file))
    const expectedHash = version === P1_VERSION ? contract.candidate.migrationSha256Lf : entry.sha256
    const referenceHashAccepted = version !== P1_VERSION || [
      contract.candidate.migrationSha256Lf,
      contract.referenceSync.previousMigrationSha256Lf,
    ].includes(entry.sha256)
    if (entry.version !== version || entry.file !== file || hash !== expectedHash || !referenceHashAccepted) {
      throw new Error('signed local migration inventory drift at ' + version)
    }
    return { version, status: 'signed', sha256Lf: hash }
  })
}

function referenceSyncState() {
  const manifestEntry = migrationManifest.entries.find((entry) => entry.version === P1_VERSION)
  const p1Test = databaseContract.tests.find((entry) => entry.path === contract.candidate.testPath)
  const synchronized = manifestEntry?.sha256 === contract.candidate.migrationSha256Lf &&
    p1Test?.sha256Lf === contract.candidate.testSha256Lf
  const qaPending = manifestEntry?.sha256 === contract.referenceSync.previousMigrationSha256Lf &&
    p1Test?.sha256Lf === contract.referenceSync.previousTestSha256Lf
  if (synchronized === qaPending) {
    throw new Error('P1 reference sync is mixed, unknown, or ambiguous')
  }
  return synchronized ? 'synchronized' : 'qa-sync-pending'
}

function proveMigrationSets(localMigrations, remoteHistory, expectedPendingVersions) {
  if (!Array.isArray(localMigrations) || !Array.isArray(remoteHistory) || !Array.isArray(expectedPendingVersions)) {
    throw new Error('migration set proof input is invalid')
  }
  const localVersions = localMigrations.map((entry) => entry.version)
  const remoteVersions = remoteHistory.map((entry) => entry.version)
  const uniqueLocal = new Set(localVersions)
  const uniqueRemote = new Set(remoteVersions)
  if (uniqueLocal.size !== localVersions.length || uniqueRemote.size !== remoteVersions.length) {
    throw new Error('migration set contains a duplicate version')
  }
  if (localMigrations.some((entry) => entry.status !== 'signed' || !/^[a-f0-9]{64}$/.test(entry.sha256Lf)) ||
      remoteHistory.some((entry) => entry.status !== 'applied')) {
    throw new Error('migration status proof is not signed/applied')
  }
  if (JSON.stringify([...localVersions].sort()) !== JSON.stringify(localVersions) ||
      JSON.stringify([...remoteVersions].sort()) !== JSON.stringify(remoteVersions)) {
    throw new Error('migration order proof failed')
  }
  const localMinusRemote = localVersions.filter((version) => !uniqueRemote.has(version))
  const remoteMinusLocal = remoteVersions.filter((version) => !uniqueLocal.has(version))
  const commonLocalOrder = localVersions.filter((version) => uniqueRemote.has(version))
  if (JSON.stringify(localMinusRemote) !== JSON.stringify(expectedPendingVersions) ||
      remoteMinusLocal.length !== 0 ||
      JSON.stringify(commonLocalOrder) !== JSON.stringify(remoteVersions)) {
    throw new Error('local/remote migration set difference is not the frozen candidate')
  }
  return {
    localCount: localVersions.length,
    remoteCount: remoteVersions.length,
    commonCount: remoteVersions.length,
    localMinusRemote,
    remoteMinusLocal,
    commonStatus: 'applied',
    orderMatched: true,
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

function assertFrozenContract() {
  if (!allowedModes.has(mode)) throw new Error('usage: --self-test, --dry-run or --execute')
  if (contract.target?.projectRef !== TARGET_REF || contract.forbiddenProductionProjectRef !== PRODUCTION_REF ||
      contract.candidate?.migrationVersion !== P1_VERSION) {
    throw new Error('P1 isolated runtime contract ref/version drift')
  }
  if (restoreRun.target?.projectRef !== TARGET_REF || restoreRun.source?.projectRef !== PRODUCTION_REF ||
      restoreRun.target?.environment !== 'isolated-test' || restoreRun.target?.previewBuildAllowed !== false ||
      restoreRun.state !== 'succeeded') {
    throw new Error('accepted isolated restore contract is unavailable')
  }
  if (databaseContract.expectedCounts?.total !== contract.expected.tests ||
      databaseContract.expectedCounts?.database !== contract.expected.databaseTests ||
      databaseContract.expectedCounts?.permission !== contract.expected.permissionTests ||
      databaseContract.expectedCounts?.business !== contract.expected.businessTests ||
      databaseContract.acceptanceBoundary?.p1ActualGithubRunEvidence !== 'passed') {
    throw new Error('CI database acceptance contract is not the signed P1 candidate')
  }
  const migrationPath = resolve(repoRoot, contract.candidate.migrationPath)
  const testPath = resolve(repoRoot, contract.candidate.testPath)
  if (sha256Lf(migrationPath) !== contract.candidate.migrationSha256Lf ||
      sha256Lf(testPath) !== contract.candidate.testSha256Lf) {
    throw new Error('P1 candidate hash drift')
  }
  if (migrationManifest.entries.length !== contract.expected.postMigrationRows ||
      migrationManifest.entries.at(-1)?.version !== P1_VERSION) {
    throw new Error('P1 migration manifest is not an exact 69+1 chain')
  }
  signedLocalMigrations()
  const p1Test = databaseContract.tests.find((entry) => entry.path === contract.candidate.testPath)
  if (databaseContract.tests.length !== contract.expected.tests ||
      p1Test?.category !== 'permission') {
    throw new Error('P1 test inventory drift')
  }
  const syncState = referenceSyncState()
  const signedCiRun = databaseContract.formalAttemptHistory.find((entry) => (
    entry.headSha === contract.candidate.signedCiHeadSha && entry.conclusion === 'success' &&
    entry.migrationsPassed === contract.expected.postMigrationRows &&
    entry.sqlTestsPassed === contract.expected.tests && entry.catalogAssertionsPassed === 4
  ))
  if (!signedCiRun) throw new Error('signed P1 CI success evidence is missing')
  const head = requireSuccess('git head', run('git', ['rev-parse', 'HEAD'])).stdout.trim()
  requireSuccess('signed CI ancestry', run('git', [
    'merge-base', '--is-ancestor', contract.candidate.signedCiHeadSha, head,
  ]))
  requireSuccess('supervision evidence ancestry', run('git', [
    'merge-base', '--is-ancestor', contract.candidate.requiredAncestorSha, head,
  ]))
  return syncState
}

function runSelfTest() {
  assertFrozenContract()
  const temp = resolve(tmpdir(), 'canwin-p1-self-test')
  const positive = validateBoundary({ targetRef: TARGET_REF, linkedRef: TARGET_REF, workdir: temp, workspaceLinkUsed: false })
  const negativeCases = [
    { targetRef: 'wrongprojectref00000000', linkedRef: 'wrongprojectref00000000', workdir: temp, workspaceLinkUsed: false },
    { targetRef: PRODUCTION_REF, linkedRef: PRODUCTION_REF, workdir: temp, workspaceLinkUsed: false },
    { targetRef: TARGET_REF, linkedRef: PRODUCTION_REF, workdir: repoRoot, workspaceLinkUsed: true },
  ]
  const negativePassed = negativeCases.filter((candidate) => validateBoundary(candidate).length > 0).length
  const local = signedLocalMigrations()
  const remote = local.slice(0, -1).map((entry) => ({ version: entry.version, status: 'applied' }))
  proveMigrationSets(local, remote, [P1_VERSION])
  const migrationNegativeCases = [
    () => proveMigrationSets(local.slice(0, -1), remote, [P1_VERSION]),
    () => proveMigrationSets([...local, { version: '20990101000000', status: 'signed', sha256Lf: 'a'.repeat(64) }], remote, [P1_VERSION]),
    () => proveMigrationSets(local, remote.slice(0, -1), [P1_VERSION]),
    () => proveMigrationSets(local, [...remote, { version: '20990101000000', status: 'applied' }], [P1_VERSION]),
    () => proveMigrationSets(local, [...remote].reverse(), [P1_VERSION]),
    () => proveMigrationSets(local, remote.map((entry, index) => index === 0 ? { ...entry, status: 'pending' } : entry), [P1_VERSION]),
  ]
  let migrationNegativePassed = 0
  for (const test of migrationNegativeCases) {
    try { test() } catch { migrationNegativePassed += 1 }
  }
  if (positive.length !== 0 || negativePassed !== negativeCases.length ||
      migrationNegativePassed !== migrationNegativeCases.length) {
    throw new Error('P1 runner negative self-test failed')
  }
  const fakeEnvironment = (suffix) => ({
    PGHOST: 'pooler-' + suffix,
    PGPORT: '5432',
    PGUSER: 'user-' + suffix,
    PGPASSWORD: 'password-' + suffix,
    PGDATABASE: 'postgres',
  })
  const positiveCredentialChannel = {
    workdir: temp, cliPath: 'supabase', dbEnvironment: fakeEnvironment('old'), credentialGeneration: 1,
  }
  const positiveGeneration = rotateTemporaryCredential(positiveCredentialChannel, () => fakeEnvironment('new'))
  if (positiveGeneration !== 2) throw new Error('fresh credential generation positive test failed')
  requireFreshCredentialGeneration(positiveCredentialChannel, 1)
  clearDbEnvironment(positiveCredentialChannel.dbEnvironment)
  const credentialNegativeCases = [
    () => {
      const old = fakeEnvironment('reuse')
      rotateTemporaryCredential({ workdir: temp, cliPath: 'supabase', dbEnvironment: old, credentialGeneration: 1 }, () => old)
    },
    () => rotateTemporaryCredential({
      workdir: temp, cliPath: 'supabase', dbEnvironment: fakeEnvironment('failure'), credentialGeneration: 1,
    }, () => { throw new Error('synthetic acquisition failure') }),
    () => requireFreshCredentialGeneration({
      dbEnvironment: fakeEnvironment('stale'), credentialGeneration: 1,
    }, 1),
  ]
  let credentialNegativePassed = 0
  for (const test of credentialNegativeCases) {
    try { test() } catch { credentialNegativePassed += 1 }
  }
  if (credentialNegativePassed !== credentialNegativeCases.length) {
    throw new Error('P1 credential rotation negative self-test failed')
  }
  console.log('P1_ISOLATED_RUNTIME_SELFTEST_OK targetPositive=1 targetNegative=3/3 migrationPositive=1 migrationNegative=6/6 credentialPositive=1 credentialNegative=3/3 wrongRefDenied=1 productionDenied=1 workspaceLinkPollutionDenied=1 databaseCalls=0')
}

function verifyTemporaryLink(workdir) {
  const refPath = resolve(workdir, 'supabase', '.temp', 'project-ref')
  if (!existsSync(refPath)) throw new Error('temporary linked project ref is missing')
  const linkedRef = readFileSync(refPath, 'utf8').trim()
  requireBoundary({ targetRef: TARGET_REF, linkedRef, workdir, workspaceLinkUsed: false })
  return linkedRef
}

function clearDbEnvironment(environment) {
  if (!environment || typeof environment !== 'object') return
  for (const key of Object.keys(environment)) environment[key] = ''
}

function validateDbEnvironment(environment) {
  return environment && ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']
    .every((key) => typeof environment[key] === 'string' && environment[key].length > 0)
}

function acquireTemporaryDbEnvironment(workdir, cliPath) {
  verifyTemporaryLink(workdir)
  const credentialProbe = requireSuccess('temporary credential preflight', run(cliPath, [
    'db', 'dump', '--linked', '--dry-run', '--workdir', workdir,
  ], { timeout: 120000 }))
  try {
    const direct = parseTemporaryPgEnvironment(
      credentialProbe.stdout + '\n' + credentialProbe.stderr,
      TARGET_REF,
      { requireHostMatch: false },
    )
    const poolerUrl = readFileSync(resolve(workdir, 'supabase', '.temp', 'pooler-url'), 'utf8')
    const environment = useSessionPooler(direct, poolerUrl, TARGET_REF)
    clearDbEnvironment(direct)
    if (!validateDbEnvironment(environment)) throw new Error('new temporary database credential is incomplete')
    verifyTemporaryLink(workdir)
    return environment
  } finally {
    credentialProbe.stdout = ''
    credentialProbe.stderr = ''
  }
}

function rotateTemporaryCredential(channel, acquire = acquireTemporaryDbEnvironment) {
  if (!channel?.dbEnvironment || !Number.isInteger(channel.credentialGeneration)) {
    throw new Error('old temporary credential generation is unavailable')
  }
  const oldEnvironment = channel.dbEnvironment
  const previousGeneration = channel.credentialGeneration
  clearDbEnvironment(oldEnvironment)
  channel.dbEnvironment = null
  let fresh
  try {
    fresh = acquire(channel.workdir, channel.cliPath)
  } catch (error) {
    clearDbEnvironment(fresh)
    throw new Error('new temporary credential acquisition failed: ' + redact(error instanceof Error ? error.message : error))
  }
  if (fresh === oldEnvironment || !validateDbEnvironment(fresh)) {
    clearDbEnvironment(fresh)
    throw new Error('old temporary credential was reused or the new credential is invalid')
  }
  channel.dbEnvironment = fresh
  channel.credentialGeneration = previousGeneration + 1
  return channel.credentialGeneration
}

function requireFreshCredentialGeneration(channel, previousGeneration) {
  if (!validateDbEnvironment(channel?.dbEnvironment) ||
      !Number.isInteger(channel.credentialGeneration) || channel.credentialGeneration <= previousGeneration) {
    throw new Error('post-CLI snapshot requires a newly acquired credential generation')
  }
}

function prepareTemporaryChannel() {
  const workdir = mkdtempSync(join(tmpdir(), 'canwin-p1-runtime-'))
  const cliPath = restoreRun.toolchain.supabaseCli.path
  try {
    requireSuccess('temporary supabase init', run(cliPath, ['init', '--workdir', workdir, '--yes']))
    const sourceMigrations = resolve(repoRoot, 'supabase', 'migrations')
    const targetMigrations = resolve(workdir, 'supabase', 'migrations')
    mkdirSync(targetMigrations, { recursive: true })
    for (const file of readdirSync(sourceMigrations)) {
      cpSync(resolve(sourceMigrations, file), resolve(targetMigrations, file), { force: false })
    }
    requireSuccess('temporary supabase link', run(cliPath, [
      'link', '--project-ref', TARGET_REF, '--workdir', workdir, '--yes',
    ], { timeout: 120000 }))
    verifyTemporaryLink(workdir)
    const dbEnvironment = acquireTemporaryDbEnvironment(workdir, cliPath)
    verifyTemporaryLink(workdir)
    return { workdir, cliPath, dbEnvironment, credentialGeneration: 1 }
  } catch (error) {
    rmSync(workdir, { recursive: true, force: true })
    throw error
  }
}

function snapshot(dbEnvironment) {
  const value = runPsql({
    psqlPath: restoreRun.toolchain.psql.path,
    pgEnvironment: dbEnvironment,
    retryReadOnlySessionPooler: true,
    timeout: 180000,
    sql: `
select jsonb_build_object(
  'reachable',true,
  'migrationVersions',(select coalesce(jsonb_agg(version order by version),'[]'::jsonb) from supabase_migrations.schema_migrations),
  'migrationHistory',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'status','applied') order by version),'[]'::jsonb) from supabase_migrations.schema_migrations),
  'p1MigrationApplied',(select exists(select 1 from supabase_migrations.schema_migrations where version='20260719130910')),
  'p1ColumnPresent',(select exists(select 1 from information_schema.columns where table_schema='public' and table_name='profile_access_roles' and column_name='assignment_kind')),
  'p1PublicFunctions',(select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('get_app_context_v1','get_navigation_manifest_v1','resolve_responsible_profile_v1','admin_apply_member_access_v1','admin_set_supervisor_system_v1','admin_replace_supervisor_scope_v1')),
  'authUsers',(select count(*) from auth.users),
  'p1AuthFixtureUsers',(select count(*) from auth.users where lower(coalesce(email,'')) like 'p1-%@example.invalid'),
  'p1ProfileFixtureRows',(select count(*) from public.profiles where id::text like 'd4000000-0000-4000-8000-00000000000%'),
  'p1RegionFixtureRows',(select count(*) from public.sales_regions where id='d4100000-0000-4000-8000-000000000001'::uuid),
  'p1RequestFixtureRows',(select count(*) from public.access_admin_requests where idempotency_key::text like 'd42%' or idempotency_key::text like 'd43%'),
  'idleInTransactionSessions',(select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and state like 'idle in transaction%'),
  'teams',(select count(*) from public.teams),
  'p1FeatureFlags',(select count(*) from public.feature_flags where key='team_os_4_supervisor'),
  'teamsMissingP1Flag',(select count(*) from public.teams t where not exists(select 1 from public.feature_flags f where f.team_id=t.id and f.key='team_os_4_supervisor')),
  'storageBuckets',(select count(*) from storage.buckets),
  'storageObjects',(select count(*) from storage.objects),
  'publicRowCounts',(select coalesce(jsonb_object_agg(x.table_name,x.row_count order by x.table_name),'{}'::jsonb) from (
    select c.relname table_name,(xpath('/row/c/text()',query_to_xml(format('select count(*) c from public.%I',c.relname),false,true,'')))[1]::text::bigint row_count
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in('r','p')
  ) x)
)::text;`,
  })
  return JSON.parse(value)
}

function assertPreflight(value) {
  const proof = proveMigrationSets(signedLocalMigrations(), value.migrationHistory, [P1_VERSION])
  if (!value.reachable || proof.localCount !== contract.expected.postMigrationRows ||
      proof.remoteCount !== contract.expected.preMigrationRows || proof.commonCount !== contract.expected.preMigrationRows ||
      value.migrationVersions.length !== contract.expected.preMigrationRows || value.p1MigrationApplied ||
      value.p1ColumnPresent || Number(value.p1PublicFunctions) !== 0 ||
      Number(value.authUsers) !== contract.expected.authUsers || Number(value.p1AuthFixtureUsers) !== 0 ||
      Number(value.p1ProfileFixtureRows) !== 0 || Number(value.p1RegionFixtureRows) !== 0 ||
      Number(value.p1RequestFixtureRows) !== 0 || Number(value.idleInTransactionSessions) !== 0 ||
      Number(value.p1FeatureFlags) !== 0 || Number(value.teamsMissingP1Flag) !== Number(value.teams)) {
    throw new Error('isolated target is not at the exact clean 69-migration P1 baseline')
  }
  return proof
}

function runPushDryRun(channel, before) {
  verifyTemporaryLink(channel.workdir)
  const beforeGeneration = channel.credentialGeneration
  const result = requireSuccess('P1 migration dry-run', run(channel.cliPath, [
    'db', 'push', '--linked', '--dry-run', '--workdir', channel.workdir, '--yes',
  ], { timeout: 180000 }))
  result.stdout = ''
  result.stderr = ''
  rotateTemporaryCredential(channel)
  requireFreshCredentialGeneration(channel, beforeGeneration)
  const after = snapshot(channel.dbEnvironment)
  const proof = assertPreflight(after)
  if (JSON.stringify(canonicalize(after)) !== JSON.stringify(canonicalize(before))) {
    throw new Error('dry-run changed remote history, objects, rows, residual fixtures or transaction baseline')
  }
  return { migrations: 1, version: P1_VERSION, proof }
}

function runLocalVerifiers() {
  const checks = [
    ['P1 runner verifier', resolve(scriptRoot, 'verify-isolated-runtime-runner.mjs')],
    ['migration manifest verifier', resolve(repoRoot, 'scripts', 'p0', 'verify-migration-manifest.mjs')],
    ['CI database contract verifier', resolve(repoRoot, 'scripts', 'p0', 'verify-ci-database-contract.mjs')],
    ['P1 app shell verifier', resolve(scriptRoot, 'verify-app-shell.mjs')],
  ]
  for (const [label, path] of checks) requireSuccess(label, run(process.execPath, [path], { timeout: 180000 }))
}

function runTestFile(dbEnvironment, test) {
  const args = ['--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1']
  if (test.executionMode === 'read_only') args.push('--single-transaction')
  args.push('--command', 'set role postgres;', '--file', resolve(repoRoot, test.path))
  return runPgTool({
    commandPath: restoreRun.toolchain.psql.path,
    pgEnvironment: dbEnvironment,
    args,
    timeout: 180000,
  })
}

function catalogSnapshot(dbEnvironment) {
  return JSON.parse(runPsql({
    psqlPath: restoreRun.toolchain.psql.path,
    pgEnvironment: dbEnvironment,
    retryReadOnlySessionPooler: true,
    sql: `select jsonb_build_object(
      'publicTables',(select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p')),
      'publicRoutines',(select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in('f','p')),
      'publicViews',(select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('v','m')),
      'storageBuckets',(select count(*) from storage.buckets)
    )::text;`,
  }))
}

function assertCatalog(actual) {
  for (const [name, expected] of Object.entries(contract.expected.catalog)) {
    if (Number(actual[name]) !== expected) throw new Error(`catalog drift ${name} expected=${expected} actual=${actual[name]}`)
  }
}

function assertReconciliation(before, after) {
  const proof = proveMigrationSets(signedLocalMigrations(), after.migrationHistory, [])
  if (proof.localCount !== contract.expected.postMigrationRows || proof.remoteCount !== contract.expected.postMigrationRows ||
      after.migrationVersions.length !== contract.expected.postMigrationRows || !after.p1MigrationApplied ||
      !after.p1ColumnPresent || Number(after.p1PublicFunctions) !== 6 ||
      Number(after.authUsers) !== Number(before.authUsers) || Number(after.p1AuthFixtureUsers) !== 0 ||
      Number(after.p1ProfileFixtureRows) !== 0 || Number(after.p1RegionFixtureRows) !== 0 ||
      Number(after.p1RequestFixtureRows) !== 0 || Number(after.idleInTransactionSessions) !== 0 ||
      Number(after.p1FeatureFlags) !== Number(after.teams) || Number(after.teamsMissingP1Flag) !== 0 ||
      Number(after.storageBuckets) !== Number(before.storageBuckets) || Number(after.storageObjects) !== Number(before.storageObjects)) {
    throw new Error('post-P1 migration/auth/storage/fixture reconciliation failed')
  }
  const beforeRows = before.publicRowCounts
  const afterRows = after.publicRowCounts
  if (JSON.stringify(Object.keys(beforeRows)) !== JSON.stringify(Object.keys(afterRows))) {
    throw new Error('public table inventory changed outside the signed catalog contract')
  }
  for (const table of Object.keys(beforeRows)) {
    const expected = Number(beforeRows[table]) + (table === 'feature_flags' ? Number(before.teamsMissingP1Flag) : 0)
    if (Number(afterRows[table]) !== expected) {
      throw new Error(`public row reconciliation failed for ${table} expected=${expected} actual=${afterRows[table]}`)
    }
  }
}

function safeEvidence(value) {
  const text = JSON.stringify(value, null, 2) + '\n'
  if (/PGPASSWORD|postgres(?:ql)?:\/\/|sb_(?:secret|publishable)_|eyJ[A-Za-z0-9_-]+\./i.test(text)) {
    throw new Error('evidence contains a forbidden secret marker')
  }
  return text
}

function executeFormal(channel, before) {
  const head = requireSuccess('git head', run('git', ['rev-parse', 'HEAD'])).stdout.trim()
  const signedHead = contract.candidate.signedCiHeadSha
  const runId = `p1-isolated-${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${signedHead.slice(0, 10)}`
  const evidenceDirectory = resolve(contract.evidenceRoot, runId)
  mkdirSync(contract.evidenceRoot, { recursive: true })
  mkdirSync(evidenceDirectory, { recursive: false })
  const attempt = {
    schemaVersion: 1,
    runId,
    targetProjectRef: TARGET_REF,
    targetProjectName: contract.target.projectName,
    candidateHeadSha: signedHead,
    supervisionHeadSha: head,
    migrationVersion: P1_VERSION,
    migrationSha256Lf: contract.candidate.migrationSha256Lf,
    testSha256Lf: contract.candidate.testSha256Lf,
    formalAttemptStarted: false,
    attempts: 0,
    startedAt: new Date().toISOString(),
    testsPassed: [],
    secretsPrinted: 0,
    secretsWritten: 0,
    productionReads: 0,
    productionWrites: 0,
  }
  writeFileSync(resolve(evidenceDirectory, 'preflight.json'), safeEvidence({ ...attempt, status: 'ready', before }), { flag: 'wx' })
  try {
    verifyTemporaryLink(channel.workdir)
    attempt.formalAttemptStarted = true
    attempt.attempts = 1
    attempt.currentStep = 'apply-signed-p1-migration'
    const beforeFormalCredentialGeneration = channel.credentialGeneration
    const pushed = requireSuccess('formal P1 migration', run(channel.cliPath, [
      'db', 'push', '--linked', '--workdir', channel.workdir, '--yes',
    ], { timeout: 300000 }))
    pushed.stdout = ''
    pushed.stderr = ''
    rotateTemporaryCredential(channel)
    requireFreshCredentialGeneration(channel, beforeFormalCredentialGeneration)

    const afterMigration = snapshot(channel.dbEnvironment)
    const afterMigrationProof = proveMigrationSets(signedLocalMigrations(), afterMigration.migrationHistory, [])
    if (!afterMigration.p1MigrationApplied || afterMigration.migrationVersions.length !== contract.expected.postMigrationRows ||
        afterMigrationProof.remoteCount !== contract.expected.postMigrationRows) {
      throw new Error('formal migration did not produce the exact 70-version history')
    }

    let p1MarkerSeen = false
    for (const test of databaseContract.tests) {
      attempt.currentStep = `test:${test.category}:${test.path}`
      const result = runTestFile(channel.dbEnvironment, test)
      if (test.path === contract.candidate.testPath) {
        p1MarkerSeen = result.stdout.includes('team_os_4_p1_access_shell_ok')
        if (!p1MarkerSeen) throw new Error('P1 six-identity runtime marker is missing')
      }
      result.stdout = ''
      result.stderr = ''
      attempt.testsPassed.push(test.path)
    }
    if (!p1MarkerSeen || attempt.testsPassed.length !== contract.expected.tests) {
      throw new Error('six-identity/database/permission/business test totals are incomplete')
    }

    attempt.currentStep = 'catalog'
    const catalog = catalogSnapshot(channel.dbEnvironment)
    assertCatalog(catalog)
    attempt.currentStep = 'full-reconciliation'
    const after = snapshot(channel.dbEnvironment)
    assertReconciliation(before, after)
    verifyTemporaryLink(channel.workdir)

    const completed = {
      ...attempt,
      status: 'succeeded',
      currentStep: 'completed',
      completedAt: new Date().toISOString(),
      sixIdentitiesPassed: true,
      databaseTestsPassed: contract.expected.databaseTests,
      permissionTestsPassed: contract.expected.permissionTests,
      businessTestsPassed: contract.expected.businessTests,
      catalogAssertionsPassed: Object.keys(contract.expected.catalog).length,
      webLoginAccountsCreated: 0,
      catalog,
      reconciliation: {
        migrationRowsBefore: before.migrationVersions.length,
        migrationRowsAfter: after.migrationVersions.length,
        publicTablesReconciled: Object.keys(after.publicRowCounts).length,
        authUsersBefore: before.authUsers,
        authUsersAfter: after.authUsers,
        storageBuckets: after.storageBuckets,
        storageObjects: after.storageObjects,
        fixtureRowsRemaining: 0,
        idleInTransactionSessions: after.idleInTransactionSessions,
      },
    }
    const evidencePath = resolve(evidenceDirectory, 'success.json')
    writeFileSync(evidencePath, safeEvidence(completed), { flag: 'wx' })
    console.log(`P1_ISOLATED_RUNTIME_OK target=${TARGET_REF} migration=1/1 tests=27/27 database=7 permission=11 business=9 catalog=4 fixtureRows=0 webLoginAccounts=0 attempts=1`)
    console.log(`P1_ISOLATED_RUNTIME_EVIDENCE path=${evidencePath} sha256=${sha256(readFileSync(evidencePath))} secretsPrinted=0 productionReads=0 productionWrites=0`)
    return
  } catch (error) {
    const failure = {
      ...attempt,
      status: 'failed-stop-preserved',
      failedAt: new Date().toISOString(),
      message: redact(error instanceof Error ? error.message : error),
      targetPreserved: true,
      retryPerformed: false,
      remoteCleanupPerformed: false,
    }
    writeFileSync(resolve(evidenceDirectory, 'failure.json'), safeEvidence(failure), { flag: 'wx' })
    throw error
  }
}

async function main() {
  if (mode === '--self-test') return runSelfTest()
  const syncState = assertFrozenContract()
  if (syncState !== 'synchronized' || contract.candidate.remoteExecutionAllowed !== true) {
    throw new Error('P1_REMOTE_EXECUTION_REFUSED: offline repair candidate is not reference-synchronized and qualified')
  }
  runLocalVerifiers()
  const channel = prepareTemporaryChannel()
  try {
    const before = snapshot(channel.dbEnvironment)
    assertPreflight(before)
    const dryRun = runPushDryRun(channel, before)
    console.log(`P1_ISOLATED_RUNTIME_DRY_RUN_OK target=${TARGET_REF} local=${dryRun.proof.localCount} remote=${dryRun.proof.remoteCount} common=${dryRun.proof.commonCount} localMinusRemote=${dryRun.proof.localMinusRemote.join(',')} remoteMinusLocal=0 orderMatched=1 cliExit=0 beforeAfterEqual=1 fixtureRows=0 idleTransactions=0 secretsPrinted=0 productionReads=0 productionWrites=0`)
    if (mode === '--execute') executeFormal(channel, before)
  } finally {
    clearDbEnvironment(channel.dbEnvironment)
    channel.dbEnvironment = null
    rmSync(channel.workdir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('P1_ISOLATED_RUNTIME_FAILED: ' + redact(error instanceof Error ? error.message : error))
  process.exitCode = 1
})
