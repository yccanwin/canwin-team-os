import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const requiredPgVariables = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']

function redact(text) {
  return String(text ?? '')
    .replace(/(export\s+PGPASSWORD=)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, 'postgresql://[REDACTED]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, 'sb_[REDACTED]')
    .slice(0, 2000)
}

function run(command, args, options = {}) {
  const childEnvironment = options.env ?? process.env
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout ?? 60000,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    env: {
      ...childEnvironment,
      SUPABASE_TELEMETRY_DISABLED: '1',
      DO_NOT_TRACK: '1',
    },
    cwd: options.cwd,
    input: options.input,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  }
}

export function runExternal({ commandPath, args = [], timeout = 300000, env, cwd, input }) {
  const result = run(resolve(commandPath), args, { timeout, env, cwd, input })
  requireSuccess(resolve(commandPath).split(/[\\/]/).pop(), result)
  return result
}

function requireSuccess(label, result) {
  if (result.status === 0 && !result.error) return
  throw new Error(label + ' failed: ' + redact(result.stderr || result.stdout || result.error?.message))
}

function parseTemporaryPgEnvironment(text, projectRef) {
  const values = {}
  for (const name of requiredPgVariables) {
    const match = text.match(new RegExp(`^export\\s+${name}="([^"]+)"\\s*$`, 'm'))
    if (!match) throw new Error('temporary database credential output is missing ' + name)
    values[name] = match[1]
  }
  if (!values.PGHOST.includes(projectRef)) {
    throw new Error('temporary database credential host does not match the requested project')
  }
  return { ...values, PGSSLMODE: 'require', PGCLIENTENCODING: 'UTF8' }
}

function useSessionPooler(directEnvironment, poolerUrlText, projectRef) {
  const poolerUrl = new URL(poolerUrlText.trim())
  const allowedProtocol = poolerUrl.protocol === 'postgres:' || poolerUrl.protocol === 'postgresql:'
  const expectedPoolerUser = `postgres.${projectRef}`
  if (!allowedProtocol ||
      !/^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(poolerUrl.hostname) ||
      String(poolerUrl.port || '5432') !== '5432' ||
      decodeURIComponent(poolerUrl.username) !== expectedPoolerUser ||
      poolerUrl.password) {
    throw new Error('linked project Session Pooler metadata is not safe or does not match the requested project')
  }
  return {
    ...directEnvironment,
    PGHOST: poolerUrl.hostname,
    PGPORT: '5432',
    PGUSER: `${directEnvironment.PGUSER}.${projectRef}`,
    PGOPTIONS: '-c jit=true',
  }
}

export function getTemporaryDbEnvironment({ cliPath, projectRef, connectionMode = 'direct' }) {
  if (!['direct', 'session-pooler'].includes(connectionMode)) {
    throw new Error('unsupported temporary database connection mode')
  }
  const resolvedCli = resolve(cliPath)
  const workdir = mkdtempSync(join(tmpdir(), 'canwin-p0-db-access-'))
  try {
    requireSuccess('supabase init', run(resolvedCli, ['init', '--workdir', workdir, '--yes']))
    requireSuccess(
      'supabase link',
      run(resolvedCli, ['link', '--project-ref', projectRef, '--workdir', workdir, '--yes'], { timeout: 90000 }),
    )
    const dryRun = run(
      resolvedCli,
      ['db', 'dump', '--linked', '--dry-run', '--workdir', workdir],
      { timeout: 90000 },
    )
    const combined = dryRun.stdout + '\n' + dryRun.stderr
    const directEnvironment = parseTemporaryPgEnvironment(combined, projectRef)
    if (connectionMode === 'direct') return directEnvironment
    const poolerUrlText = readFileSync(resolve(workdir, 'supabase', '.temp', 'pooler-url'), 'utf8')
    return useSessionPooler(directEnvironment, poolerUrlText, projectRef)
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
}

export function runPsql({ psqlPath, pgEnvironment, sql, timeout = 60000 }) {
  if (/[^\x00-\x7F]/.test(sql)) {
    throw new Error('inline psql SQL must be ASCII-safe on Windows')
  }
  const result = run(
    resolve(psqlPath),
    ['--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--command', `set role postgres;\n${sql}`],
    { timeout, env: { ...process.env, ...pgEnvironment } },
  )
  requireSuccess('psql', result)
  return result.stdout.split(/\r?\n/).filter((line) => line.trim() !== 'SET').join('\n').trim()
}

export function runPgTool({ commandPath, pgEnvironment, args, timeout = 300000 }) {
  const result = run(resolve(commandPath), args, {
    timeout,
    env: { ...process.env, ...pgEnvironment },
  })
  requireSuccess(resolve(commandPath).split(/[\\/]/).pop(), result)
  return result
}

export function runSupabaseJson({ cliPath, args, timeout = 90000 }) {
  const result = run(resolve(cliPath), [...args, '--output', 'json'], { timeout })
  requireSuccess('supabase ' + args.join(' '), result)
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error('Supabase CLI returned invalid JSON without exposing its contents')
  }
}

export function loadRestoreRun(repoRoot) {
  return JSON.parse(readFileSync(resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'restore-run.p0-test.json'), 'utf8'))
}
