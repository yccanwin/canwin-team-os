import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = resolve(repoRoot, 'scripts', 'p1')
const source = readFileSync(resolve(root, 'run-isolated-runtime.mjs'), 'utf8')
const contract = JSON.parse(readFileSync(resolve(root, 'isolated-runtime-contract.json'), 'utf8'))
const migration = readFileSync(resolve(repoRoot, contract.candidate.migrationPath), 'utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n')
const test = readFileSync(resolve(repoRoot, contract.candidate.testPath), 'utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n')
const postgresRegression = readFileSync(resolve(repoRoot, contract.scriptHardLocks.postgresRegressionPath), 'utf8')
const failures = []
let assertionCount = 0
const check = (condition, message) => { assertionCount += 1; if (!condition) failures.push(message) }
const sha256Lf = (path) => createHash('sha256')
  .update(readFileSync(path, 'utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n'))
  .digest('hex')
const occurrences = (text, needle) => text.split(needle).length - 1

check(contract.target.projectRef === 'zdmuaqokndhhbarudhtw', 'isolated target ref drift')
check(contract.forbiddenProductionProjectRef === 'agygfhmkazcbqaqwmljb', 'production deny ref drift')
check(source.includes("const TARGET_REF = 'zdmuaqokndhhbarudhtw'"), 'runner does not literal-lock target ref')
check(source.includes("const PRODUCTION_REF = 'agygfhmkazcbqaqwmljb'"), 'runner does not literal-deny production ref')
check(source.includes("mkdtempSync(join(tmpdir(), 'canwin-p1-runtime-'))"), 'runner lacks independent temporary workdir')
check(source.includes("'link', '--project-ref', TARGET_REF, '--workdir', workdir"), 'temporary link is not explicit')
check(source.includes("'db', 'push', '--linked', '--dry-run', '--workdir', channel.workdir"), 'dry-run is not temporary-workdir locked')
check(source.includes("'db', 'push', '--linked', '--workdir', channel.workdir"), 'formal push is not temporary-workdir locked')
check(!source.includes("resolve(repoRoot, 'supabase', '.temp', 'project-ref')"), 'runner reads workspace linked state')
check(source.includes('verifyTemporaryLink(channel.workdir)'), 'runner does not recheck temporary ref')
check(source.includes('parseTemporaryPgEnvironment'), 'runner does not use the controlled temporary credential channel')
check(source.includes("credentialProbe.stdout = ''") && source.includes("credentialProbe.stderr = ''"), 'credential probe is not cleared')
check(source.includes('function rotateTemporaryCredential(') && source.includes('clearDbEnvironment(oldEnvironment)'), 'old temporary credential is not invalidated before rotation')
check(source.includes('fresh === oldEnvironment') && source.includes('new temporary credential acquisition failed'), 'credential reuse/acquisition failure is not fail-closed')
check(source.includes('requireFreshCredentialGeneration(channel, beforeGeneration)'), 'dry-run post-snapshot does not require a new credential generation')
check(source.includes('requireFreshCredentialGeneration(channel, beforeFormalCredentialGeneration)'), 'formal post-push validation does not require a new credential generation')
check(source.includes("secretsPrinted: 0") && source.includes("secretsWritten: 0"), 'evidence secrecy markers missing')
check(source.includes('assertPreflight(before)') && source.includes('runPushDryRun(channel, before)'), 'formal preflight/dry-run sequence missing')
check(source.indexOf('runPushDryRun(channel, before)') < source.indexOf("if (mode === '--execute') executeFormal"), 'formal execution can precede dry-run')
check(source.includes('function proveMigrationSets(') && source.includes('localMinusRemote') && source.includes('remoteMinusLocal'), 'machine migration-set proof missing')
check(source.includes("status !== 'applied'") && source.includes('migration order proof failed'), 'migration status/order proof missing')
check(source.includes('JSON.stringify(canonicalize(after)) !== JSON.stringify(canonicalize(before))'), 'dry-run before/after equality proof missing')
check(!source.includes("output.match(/\\b\\d{14}\\b/g)"), 'dry-run safety still depends on CLI human output')
check(source.includes('attempt.formalAttemptStarted = true') && source.includes('attempt.attempts = 1'), 'single formal attempt marker missing')
check(source.includes('retryPerformed: false') && source.includes('remoteCleanupPerformed: false'), 'first-failure stop evidence missing')
check(source.includes('for (const test of databaseContract.tests)'), 'complete SQL test inventory is not executed')
check(source.includes('team_os_4_p1_access_shell_ok'), 'six-identity runtime marker is not required')
check(source.includes('assertCatalog(catalog)') && source.includes('assertReconciliation(before, after)'), 'catalog/full reconciliation missing')
check(source.includes('webLoginAccountsCreated: 0'), 'web-login account prohibition missing')
check(source.includes('rmSync(channel.workdir, { recursive: true, force: true })'), 'temporary channel cleanup missing')
check(contract.candidate.remoteExecutionAllowed === false && contract.referenceSync.remoteExecutionRequires === 'synchronized-and-qualified', 'offline repair candidate can enter a remote channel')
check(source.includes("P1_REMOTE_EXECUTION_REFUSED: offline repair candidate is not reference-synchronized and qualified"), 'remote execution does not fail closed while QA hash sync is pending')

const repair = contract.pendingTriggerRepair
const backfillIndex = migration.indexOf(repair.backfillStatement)
const immediateIndex = migration.indexOf(repair.immediateStatement, backfillIndex)
const deferredIndex = migration.indexOf(repair.deferredStatement, immediateIndex)
const alterIndex = migration.indexOf(repair.alterStatement, deferredIndex)
check(repair.constraintName === 'public.profile_access_roles_last_admin', 'pending-trigger constraint name drift')
check(backfillIndex >= 0 && backfillIndex < immediateIndex && immediateIndex < deferredIndex && deferredIndex < alterIndex,
  'pending-trigger repair order must be backfill -> targeted immediate -> restore deferred -> alter')
check(occurrences(migration, repair.immediateStatement) === 1 && occurrences(migration, repair.deferredStatement) === 1,
  'pending-trigger repair statements must each occur exactly once')
check(repair.forbidAllConstraintsFlush === true && !/set\s+constraints\s+all\s+immediate/i.test(migration),
  'migration uses an over-broad SET CONSTRAINTS ALL flush')
check(test.includes("tgname = 'profile_access_roles_last_admin'") && test.includes('tgdeferrable') && test.includes('tginitdeferred'),
  'P1 SQL test does not preserve the existing last-admin trigger mode')
check(postgresRegression.includes("negative control did not reproduce SQLSTATE 55006 pending trigger events") &&
  postgresRegression.includes('set constraints canwin_p1_regression.profile_access_roles_last_admin immediate;') &&
  postgresRegression.includes('set constraints canwin_p1_regression.profile_access_roles_last_admin deferred;'),
  'real temporary Postgres regression lacks the 55006 control or repaired sequence')
check(postgresRegression.includes("PGHOST: '127.0.0.1'") && postgresRegression.includes('remoteConnectionsAllowed !== false'),
  'temporary Postgres regression is not loopback-only and fail-closed')
const localPostgres = repair.localPostgres
check(localPostgres.temporaryRoot === 'D:/CanWinP1LocalPgRuns' && /^[\x20-\x7e]+$/.test(localPostgres.temporaryRoot),
  'temporary Postgres root is not fixed to a pure-ASCII D drive path')
check(localPostgres.binaryRoot === 'D:/CanWinP1Postgres18/bin' &&
  [localPostgres.initdbPath, localPostgres.pgCtlPath, localPostgres.psqlPath]
    .every((path) => path.startsWith(localPostgres.binaryRoot + '/') && /^[\x20-\x7e]+$/.test(path)),
  'local Postgres tools are not fixed absolute ASCII paths')
check(localPostgres.user === 'p1_regression' && localPostgres.bootstrapUser === 'p1_regression' &&
  localPostgres.encoding === 'UTF8' && localPostgres.clientEncoding === 'UTF8' && localPostgres.locale === 'C',
  'ASCII bootstrap user, UTF8, or locale C lock drift')
check(JSON.stringify([...localPostgres.forbiddenInheritedEnvironment].sort()) ===
  JSON.stringify(['HOME', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USERPROFILE']),
  'Windows identity inheritance deny-list drift')
check(!JSON.stringify(localPostgres).includes('NUL'), 'NUL device is allowed by local Postgres contract')
check(postgresRegression.includes('function runStaticSelfTest()') &&
  postgresRegression.includes('ASCII/UTF8/locale static negative test failed') &&
  postgresRegression.includes('P1_PENDING_TRIGGER_POSTGRES_SELFTEST_OK'),
  'ASCII/UTF8/locale negative self-test is missing')
check(JSON.stringify(localPostgres.pgCtlStart?.stdio) === JSON.stringify(['ignore', 'ignore', 'ignore']) &&
  localPostgres.pgCtlStart?.logFlag === '-l' && localPostgres.pgCtlStart?.waitFlag === '-w' &&
  localPostgres.pgCtlStart?.timeoutFlag === '-t' && localPostgres.pgCtlStart?.timeoutSeconds === 30 &&
  localPostgres.pgCtlStart?.hardLimitSeconds === 120,
  'pg_ctl no-pipe/log/wait/timeout contract drift')
check(postgresRegression.includes("stdio: options.stdio ?? 'pipe'") &&
  postgresRegression.includes('function validateStartInvocation(') &&
  postgresRegression.includes("stdio: [...regression.pgCtlStart.stdio]") &&
  postgresRegression.includes('pg_ctl start uses a Node pipe'),
  'pg_ctl start no-pipe implementation or negative guard missing')
check(postgresRegression.includes('requireServerStartSuccess(started, serverLog)') &&
  postgresRegression.includes('redactedLogTail(serverLog)') &&
  postgresRegression.includes('regression.pgCtlStart.logFlag') &&
  postgresRegression.includes('regression.pgCtlStart.waitFlag') &&
  postgresRegression.includes('regression.pgCtlStart.timeoutFlag'),
  'pg_ctl start does not use ASCII server log plus wait/timeout locks')
check(postgresRegression.includes('if (serverStarted || existsSync(resolve(dataDirectory, \'postmaster.pid\')))') &&
  postgresRegression.includes('ignoreDeadline: true') &&
  postgresRegression.includes("['stop', '-D', dataDirectory, '-m', 'fast', '-w', '-t', '30']"),
  'temporary Postgres finally-stop guarantee missing')
check(postgresRegression.includes('pgCtlStartNegative=${startNegativePassed}/${startNegativeCases.length}') &&
  postgresRegression.includes('two-minute local Postgres hard limit exceeded'),
  'pg_ctl pipe/log/wait/timeout negatives or hard limit missing')

check(sha256Lf(resolve(repoRoot, contract.candidate.migrationPath)) === contract.candidate.migrationSha256Lf,
  'P1 migration LF hash drift')
check(sha256Lf(resolve(repoRoot, contract.candidate.testPath)) === contract.candidate.testSha256Lf,
  'P1 SQL test LF hash drift')
check(sha256Lf(resolve(repoRoot, contract.scriptHardLocks.runnerPath)) === contract.scriptHardLocks.runnerSha256Lf,
  'P1 runner LF hash drift')
check(sha256Lf(resolve(repoRoot, contract.scriptHardLocks.validatorPath)) === contract.scriptHardLocks.validatorSha256Lf,
  'P1 validator LF hash drift')
check(sha256Lf(resolve(repoRoot, contract.scriptHardLocks.postgresRegressionPath)) === contract.scriptHardLocks.postgresRegressionSha256Lf,
  'P1 local Postgres regression LF hash drift')

if (failures.length > 0) {
  console.error('P1_ISOLATED_RUNTIME_RUNNER_DRIFT')
  for (const failure of failures) console.error('- ' + failure)
  process.exit(1)
}
console.log(`P1_ISOLATED_RUNTIME_RUNNER_OK assertions=${assertionCount} targetLocked=1 productionDenied=1 migrationSetProof=1 dryRunSnapshotProof=1 credentialRotation=1 pendingTriggerOrder=1 postgresRegression=1 temporaryChannel=1 singleAttempt=1 secretsPersisted=0`)
