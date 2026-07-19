import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const scriptRoot = resolve(repoRoot, 'scripts', 'p1')
const contract = JSON.parse(readFileSync(resolve(scriptRoot, 'isolated-runtime-contract.json'), 'utf8'))
const regression = contract.pendingTriggerRepair?.localPostgres
const mode = process.argv[2]
let runDeadline = Number.POSITIVE_INFINITY

function fail(message) {
  throw new Error(message)
}

function cleanEnvironment(extra = {}) {
  const keep = new Set([
    'PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP',
    'COMSPEC', 'PATHEXT',
  ])
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => keep.has(name))),
    LANG: 'C',
    LC_ALL: 'C',
    PGCLIENTENCODING: regression.clientEncoding,
    ...extra,
  }
}

function run(commandPath, args, options = {}) {
  const remaining = runDeadline - Date.now()
  if (!options.ignoreDeadline && remaining <= 0) {
    return { status: null, error: new Error('two-minute local Postgres hard limit exceeded'), stdout: '', stderr: '' }
  }
  const requestedTimeout = options.timeout ?? 120000
  const timeout = options.ignoreDeadline ? requestedTimeout : Math.max(1, Math.min(requestedTimeout, remaining))
  return spawnSync(commandPath, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? cleanEnvironment(),
    encoding: 'utf8',
    windowsHide: true,
    stdio: options.stdio ?? 'pipe',
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  })
}

function requireSuccess(label, result) {
  if (result.status === 0 && !result.error) return result
  fail(`${label} failed: ${String(result.stderr || result.stdout || result.error?.message).trim()}`)
}

function redactedLogTail(path) {
  if (!existsSync(path)) return '[server log unavailable]'
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .slice(-40)
    .join('\n')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[REDACTED]')
    .replace(/(?:password|passwd|pwd)\s*[=:]\s*[^\s]+/gi, 'password=[REDACTED]')
    .slice(-8000)
}

function requireServerStartSuccess(result, serverLog) {
  if (result.status === 0 && !result.error) return result
  fail(`pg_ctl start failed; serverLogTail=${redactedLogTail(serverLog)}`)
}

async function freeLoopbackPort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('loopback port allocation failed')))
        return
      }
      server.close((error) => error ? reject(error) : resolvePort(address.port))
    })
  })
}

function psqlEnvironment(port) {
  return cleanEnvironment({
    PGHOST: '127.0.0.1',
    PGPORT: String(port),
    PGDATABASE: 'postgres',
    PGUSER: regression.user,
  })
}

function runSql(psqlPath, port, sqlPath) {
  return run(psqlPath, [
    '--no-psqlrc',
    '--set=ON_ERROR_STOP=1',
    '--set=VERBOSITY=verbose',
    `--file=${sqlPath}`,
  ], { env: psqlEnvironment(port) })
}

function isAscii(value) {
  return typeof value === 'string' && value.length > 0 && /^[\x20-\x7e]+$/.test(value)
}

function validateStaticContract(candidate) {
  const failures = []
  const fixedPaths = [
    ['initdbPath', 'initdb.exe'],
    ['pgCtlPath', 'pg_ctl.exe'],
    ['psqlPath', 'psql.exe'],
  ]
  if (candidate?.host !== '127.0.0.1' || candidate.database !== 'postgres' ||
      candidate.postgresMajor !== 18 || candidate.maxAttempts !== 1 ||
      candidate.remoteConnectionsAllowed !== false) failures.push('local-only boundary drift')
  if (candidate?.user !== 'p1_regression' || candidate.bootstrapUser !== 'p1_regression' ||
      !isAscii(candidate.user) || !isAscii(candidate.bootstrapUser)) failures.push('ASCII bootstrap user drift')
  if (candidate?.encoding !== 'UTF8' || candidate.clientEncoding !== 'UTF8') failures.push('UTF8 lock drift')
  if (candidate?.locale !== 'C') failures.push('locale lock drift')
  if (!isAscii(candidate?.temporaryRoot) || !isAbsolute(candidate.temporaryRoot) ||
      !/^D:[\\/][A-Za-z0-9._\\/-]+$/.test(candidate.temporaryRoot)) failures.push('ASCII D drive temporary root drift')
  if (!isAscii(candidate?.binaryRoot) || !isAbsolute(candidate.binaryRoot) ||
      !/^D:[\\/][A-Za-z0-9._\\/-]+$/.test(candidate.binaryRoot)) failures.push('ASCII fixed tool root drift')
  for (const [key, expectedName] of fixedPaths) {
    const path = candidate?.[key]
    if (!isAscii(path) || !isAbsolute(path) || !resolve(path).startsWith(resolve(candidate.binaryRoot) + '\\') ||
        basename(path).toLowerCase() !== expectedName) {
      failures.push('fixed absolute local Postgres tool path format drift')
    }
  }
  if (candidate?.toolVersion !== '18.4') failures.push('local Postgres tool version contract drift')
  const forbidden = candidate?.forbiddenInheritedEnvironment
  if (!Array.isArray(forbidden) || JSON.stringify([...forbidden].sort()) !==
      JSON.stringify(['HOME', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USERPROFILE'])) {
    failures.push('inherited Windows identity deny-list drift')
  }
  const start = candidate?.pgCtlStart
  if (JSON.stringify(start?.stdio) !== JSON.stringify(['ignore', 'ignore', 'ignore']) ||
      start.logFlag !== '-l' || start.waitFlag !== '-w' || start.timeoutFlag !== '-t' ||
      start.timeoutSeconds !== 30 || start.hardLimitSeconds !== 120) {
    failures.push('pg_ctl start no-pipe/wait/log/timeout lock drift')
  }
  return failures
}

function probeToolVersion(path) {
  const result = run(path, ['--version'], { timeout: 10000 })
  if (result.status !== 0 || result.error) return null
  return String(result.stdout || result.stderr).match(/\b(\d+\.\d+)\b/)?.[1] ?? null
}

function validateExecutionToolchain(candidate, dependencies = {}) {
  const pathExists = dependencies.pathExists ?? existsSync
  const versionProbe = dependencies.versionProbe ?? probeToolVersion
  const failures = [...validateStaticContract(candidate)]
  for (const path of [candidate.initdbPath, candidate.pgCtlPath, candidate.psqlPath]) {
    if (!pathExists(path)) {
      failures.push(`local Postgres tool missing: ${basename(path)}`)
      continue
    }
    const actualVersion = versionProbe(path)
    if (actualVersion !== candidate.toolVersion) {
      failures.push(`local Postgres tool version drift: ${basename(path)}`)
    }
  }
  return failures
}

function pgCtlStartInvocation(dataDirectory, serverLog, port) {
  return {
    commandPath: regression.pgCtlPath,
    args: [
      'start', '-D', dataDirectory, regression.pgCtlStart.logFlag, serverLog,
      '-o', `-h 127.0.0.1 -p ${port} -F`, regression.pgCtlStart.waitFlag,
      regression.pgCtlStart.timeoutFlag, String(regression.pgCtlStart.timeoutSeconds),
    ],
    options: {
      stdio: [...regression.pgCtlStart.stdio],
      timeout: (regression.pgCtlStart.timeoutSeconds + 5) * 1000,
    },
  }
}

function validateStartInvocation(invocation) {
  const failures = []
  const args = invocation?.args ?? []
  const logIndex = args.indexOf('-l')
  const waitIndex = args.indexOf('-w')
  const timeoutIndex = args.indexOf('-t')
  if (invocation?.commandPath !== regression.pgCtlPath || args[0] !== 'start') failures.push('pg_ctl start path/mode drift')
  if (JSON.stringify(invocation?.options?.stdio) !== JSON.stringify(['ignore', 'ignore', 'ignore'])) failures.push('pg_ctl start uses a Node pipe')
  if (logIndex < 0 || !isAscii(args[logIndex + 1]) || !isAbsolute(args[logIndex + 1]) || !args[logIndex + 1].endsWith('.log')) {
    failures.push('pg_ctl start lacks fixed ASCII -l log')
  }
  if (waitIndex < 0) failures.push('pg_ctl start lacks -w')
  if (timeoutIndex < 0 || args[timeoutIndex + 1] !== '30' || invocation?.options?.timeout !== 35000) {
    failures.push('pg_ctl start timeout drift')
  }
  return failures
}

function assertStaticContract() {
  const failures = validateStaticContract(regression)
  if (failures.length > 0) fail(`local Postgres regression contract refused: ${failures.join('; ')}`)
  const environment = cleanEnvironment()
  if (regression.forbiddenInheritedEnvironment.some((name) => Object.hasOwn(environment, name)) ||
      environment.PGCLIENTENCODING !== 'UTF8' || environment.LANG !== 'C' || environment.LC_ALL !== 'C') {
    fail('sanitized ASCII/UTF8 bootstrap environment drift')
  }
}

function assertExecutionToolchain() {
  const failures = validateExecutionToolchain(regression)
  if (failures.length > 0) fail(`local Postgres execution toolchain refused: ${failures.join('; ')}`)
}

function runStaticSelfTest() {
  assertStaticContract()
  const mutate = (changes) => ({ ...structuredClone(regression), ...changes })
  const negativeCases = [
    mutate({ temporaryRoot: 'C:/Users/non-ascii-\u7941/p1' }),
    mutate({ bootstrapUser: 'non_ascii_\u7941' }),
    mutate({ encoding: '' }),
    mutate({ clientEncoding: '' }),
    mutate({ locale: '' }),
    mutate({ initdbPath: 'initdb.exe' }),
    mutate({ pgCtlPath: 'pg_ctl.exe' }),
    mutate({ psqlPath: 'psql.exe' }),
    mutate({ binaryRoot: 'C:/Users/non-ascii-\u7941/postgres/bin' }),
    mutate({ forbiddenInheritedEnvironment: ['USERNAME'] }),
    mutate({ remoteConnectionsAllowed: true }),
  ]
  const negativePassed = negativeCases.filter((candidate) => validateStaticContract(candidate).length > 0).length
  if (negativePassed !== negativeCases.length) fail('ASCII/UTF8/locale static negative test failed')
  const missingRoot = 'D:/CanWinP1MissingTools/bin'
  const missingToolsStaticCandidate = mutate({
    binaryRoot: missingRoot,
    initdbPath: `${missingRoot}/initdb.exe`,
    pgCtlPath: `${missingRoot}/pg_ctl.exe`,
    psqlPath: `${missingRoot}/psql.exe`,
  })
  if (validateStaticContract(missingToolsStaticCandidate).length > 0) {
    fail('self-test incorrectly requires local Postgres files to exist')
  }
  const toolPaths = [regression.initdbPath, regression.pgCtlPath, regression.psqlPath]
  const executeMissingPassed = toolPaths.filter((missingPath) => validateExecutionToolchain(regression, {
    pathExists: (path) => path !== missingPath,
    versionProbe: () => regression.toolVersion,
  }).length > 0).length
  const executeVersionDriftPassed = validateExecutionToolchain(regression, {
    pathExists: () => true,
    versionProbe: () => '18.3',
  }).length > 0 ? 1 : 0
  if (executeMissingPassed !== toolPaths.length || executeVersionDriftPassed !== 1) {
    fail('execute tool existence/version negative test failed')
  }
  const positiveStart = pgCtlStartInvocation('D:\\CanWinP1LocalPgRuns\\selftest\\data', 'D:\\CanWinP1LocalPgRuns\\selftest\\postgres.log', 55432)
  const withoutPair = (args, flag) => {
    const index = args.indexOf(flag)
    return index < 0 ? [...args] : [...args.slice(0, index), ...args.slice(index + 2)]
  }
  const startNegativeCases = [
    { ...structuredClone(positiveStart), options: { ...positiveStart.options, stdio: 'pipe' } },
    { ...structuredClone(positiveStart), args: withoutPair(positiveStart.args, '-l') },
    { ...structuredClone(positiveStart), args: positiveStart.args.filter((arg) => arg !== '-w') },
    { ...structuredClone(positiveStart), args: positiveStart.args.map((arg, index) => positiveStart.args[index - 1] === '-t' ? '31' : arg) },
  ]
  const startNegativePassed = startNegativeCases.filter((candidate) => validateStartInvocation(candidate).length > 0).length
  if (validateStartInvocation(positiveStart).length > 0 || startNegativePassed !== startNegativeCases.length) {
    fail('pg_ctl no-pipe/log/wait/timeout static negative test failed')
  }
  console.log(`P1_PENDING_TRIGGER_POSTGRES_SELFTEST_OK positive=3 negative=${negativePassed + startNegativePassed + executeMissingPassed + executeVersionDriftPassed}/${negativeCases.length + startNegativeCases.length + toolPaths.length + 1} asciiRoot=1 asciiBootstrapUser=1 utf8=2 localeC=1 fixedPathFormats=3 selfTestMissingTools=allowed executeMissingTools=${executeMissingPassed}/${toolPaths.length} executeVersionDrift=${executeVersionDriftPassed}/1 inheritedIdentityDenied=5 pgCtlNoPipe=1 pgCtlStartNegative=${startNegativePassed}/${startNegativeCases.length} hardLimitSeconds=120 remoteConnections=0 databaseCalls=0`)
}

const fixtureSql = String.raw`
create schema canwin_p1_regression;
create table canwin_p1_regression.trigger_audit(fired_at timestamptz not null default clock_timestamp());
create table canwin_p1_regression.profile_access_roles(
  id integer primary key,
  assignment_kind text
);
create function canwin_p1_regression.audit_constraint_trigger()
returns trigger language plpgsql as $function$
begin
  insert into canwin_p1_regression.trigger_audit default values;
  return null;
end
$function$;
create constraint trigger profile_access_roles_last_admin
after update on canwin_p1_regression.profile_access_roles
deferrable initially deferred
for each row execute function canwin_p1_regression.audit_constraint_trigger();
insert into canwin_p1_regression.profile_access_roles(id, assignment_kind) values (1, null);
update canwin_p1_regression.profile_access_roles set assignment_kind = 'primary' where id = 1;
`

const negativeSql = String.raw`begin;
${fixtureSql}
alter table canwin_p1_regression.profile_access_roles
  alter column assignment_kind set not null;
`

const positiveSql = String.raw`begin;
${fixtureSql}
set constraints canwin_p1_regression.profile_access_roles_last_admin immediate;
do $assert_immediate$
begin
  if (select count(*) from canwin_p1_regression.trigger_audit) <> 1 then
    raise exception 'pending constraint trigger was not flushed';
  end if;
end
$assert_immediate$;
set constraints canwin_p1_regression.profile_access_roles_last_admin deferred;
alter table canwin_p1_regression.profile_access_roles
  alter column assignment_kind set not null;
update canwin_p1_regression.profile_access_roles set assignment_kind = 'primary' where id = 1;
do $assert_deferred$
begin
  if (select count(*) from canwin_p1_regression.trigger_audit) <> 1 then
    raise exception 'constraint trigger mode was not restored to deferred';
  end if;
end
$assert_deferred$;
set constraints canwin_p1_regression.profile_access_roles_last_admin immediate;
do $assert_second_flush$
begin
  if (select count(*) from canwin_p1_regression.trigger_audit) <> 2 then
    raise exception 'restored deferred trigger did not flush on demand';
  end if;
end
$assert_second_flush$;
rollback;
select case when to_regnamespace('canwin_p1_regression') is null then 'rollback-clean' else 'rollback-dirty' end;
`

async function main() {
  if (mode === '--self-test') return runStaticSelfTest()
  if (mode !== '--execute') fail('usage: --self-test or --execute')
  assertStaticContract()
  assertExecutionToolchain()
  runDeadline = Date.now() + regression.pgCtlStart.hardLimitSeconds * 1000
  mkdirSync(regression.temporaryRoot, { recursive: true })
  const runDirectory = mkdtempSync(join(resolve(regression.temporaryRoot), 'p1-pending-trigger-'))
  const dataDirectory = resolve(runDirectory, 'data')
  const serverLog = resolve(runDirectory, 'postgres.log')
  const negativePath = resolve(runDirectory, 'negative.sql')
  const positivePath = resolve(runDirectory, 'positive.sql')
  writeFileSync(negativePath, negativeSql, { encoding: 'utf8', flag: 'wx' })
  writeFileSync(positivePath, positiveSql, { encoding: 'utf8', flag: 'wx' })

  let serverStarted = false
  let passed = false
  try {
    requireSuccess('initdb', run(regression.initdbPath, [
      '--pgdata', dataDirectory,
      '--auth-host=trust',
      '--auth-local=trust',
      `--encoding=${regression.encoding}`,
      `--locale=${regression.locale}`,
      `--username=${regression.bootstrapUser}`,
      '--no-instructions',
    ], { timeout: 60000 }))
    console.log('[p1:local-pg] PASS initdb')
    const port = await freeLoopbackPort()
    const startInvocation = pgCtlStartInvocation(dataDirectory, serverLog, port)
    if (validateStartInvocation(startInvocation).length > 0) fail('pg_ctl start invocation refused')
    const started = run(startInvocation.commandPath, startInvocation.args, startInvocation.options)
    serverStarted = existsSync(resolve(dataDirectory, 'postmaster.pid'))
    requireServerStartSuccess(started, serverLog)
    serverStarted = true
    console.log('[p1:local-pg] PASS ready')

    const version = requireSuccess('server version', run(regression.psqlPath, [
      '--no-psqlrc', '--tuples-only', '--no-align', '--command=show server_version_num;',
    ], { env: psqlEnvironment(port), timeout: 15000 }))
    const serverMajor = Math.trunc(Number(String(version.stdout).trim()) / 10000)
    if (serverMajor !== regression.postgresMajor) fail(`Postgres major drift expected=${regression.postgresMajor} actual=${serverMajor}`)
    console.log(`[p1:local-pg] PASS version=${serverMajor}`)

    const negative = runSql(regression.psqlPath, port, negativePath)
    writeFileSync(resolve(runDirectory, 'negative.stdout.log'), String(negative.stdout), { flag: 'wx' })
    writeFileSync(resolve(runDirectory, 'negative.stderr.log'), String(negative.stderr), { flag: 'wx' })
    const negativeText = `${negative.stdout}\n${negative.stderr}`
    if (negative.status === 0 || !/55006/.test(negativeText) || !/pending trigger events/i.test(negativeText)) {
      fail('negative control did not reproduce SQLSTATE 55006 pending trigger events')
    }
    console.log('[p1:local-pg] PASS negative=55006')

    const positive = runSql(regression.psqlPath, port, positivePath)
    writeFileSync(resolve(runDirectory, 'positive.stdout.log'), String(positive.stdout), { flag: 'wx' })
    writeFileSync(resolve(runDirectory, 'positive.stderr.log'), String(positive.stderr), { flag: 'wx' })
    requireSuccess('repaired sequence', positive)
    if (!String(positive.stdout).includes('rollback-clean')) fail('positive regression did not roll back its fixture')
    console.log('[p1:local-pg] PASS positive=4/4 rollback=clean')

    writeFileSync(resolve(runDirectory, 'result.json'), JSON.stringify({
      schemaVersion: 1,
      status: 'passed',
      postgresMajor: serverMajor,
      bootstrapUser: regression.bootstrapUser,
      encoding: regression.encoding,
      locale: regression.locale,
      clientEncoding: regression.clientEncoding,
      negativeControl: { sqlstate55006: true, pendingTriggerEvents: true },
      positiveRepair: { targetedImmediate: true, restoredDeferred: true, alterPassed: true, rollbackClean: true },
      host: '127.0.0.1',
      remoteConnections: 0,
      attempts: 1,
    }, null, 2) + '\n', { flag: 'wx' })
    passed = true
    console.log(`P1_PENDING_TRIGGER_POSTGRES_OK postgresMajor=${serverMajor} negative=1/1 positive=4/4 attempts=1 remoteConnections=0 evidence=${runDirectory}`)
  } finally {
    if (serverStarted || existsSync(resolve(dataDirectory, 'postmaster.pid'))) {
      const stopped = run(regression.pgCtlPath, ['stop', '-D', dataDirectory, '-m', 'fast', '-w', '-t', '30'], {
        timeout: 35000,
        ignoreDeadline: true,
      })
      if (stopped.status !== 0 && passed) fail('temporary Postgres cleanup failed')
      if (stopped.status === 0) console.log('[p1:local-pg] PASS stop')
    }
    if (passed && resolve(dataDirectory).startsWith(resolve(runDirectory) + '\\')) {
      rmSync(dataDirectory, { recursive: true, force: true })
    }
    if (!passed) console.error(`P1_PENDING_TRIGGER_POSTGRES_FAILED_STOP evidence=${runDirectory}`)
  }
}

main().catch((error) => {
  console.error(`P1_PENDING_TRIGGER_POSTGRES_FAILED: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
})
