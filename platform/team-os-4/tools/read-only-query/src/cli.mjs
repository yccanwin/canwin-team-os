import { spawnSync } from 'node:child_process'
import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENT = 'team-os-4-read-only-query'
const TARGET_PROJECT_REF = 'jgcrhoabvaowxnqksvkq'
const NODE = 'C:\\Program Files\\nodejs\\node.exe'
const NPX_CLI = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js'
const scriptDir = dirname(fileURLToPath(import.meta.url))
const toolRoot = resolve(scriptDir, '..')
const teamOs4Root = resolve(toolRoot, '..', '..')
const repoRoot = resolve(teamOs4Root, '..', '..')
const auditRoot = resolve(repoRoot, '.codex-audit', 'team-os-4-g1')
const linkedRefFile = resolve(teamOs4Root, 'supabase', '.temp', 'project-ref')

const QUERIES = Object.freeze({
  'g1-acceptance-state': resolve(toolRoot, 'sql', 'g1-acceptance-state.sql'),
})

const redact = (value) => String(value ?? '')
  .replace(/\bbearer\s+[a-zA-Z0-9._-]+/giu, 'Bearer [REDACTED]')
  .replace(/\beyJ[a-zA-Z0-9_-]{8,}(?:\.[a-zA-Z0-9_-]+){1,2}\b/gu, '[REDACTED_JWT]')
  .replace(/\bsb_(?:secret|publishable)_[a-zA-Z0-9._-]+\b/gu, '[REDACTED_SUPABASE_KEY]')
  .replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gu, '[REDACTED_EMAIL]')
  .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/giu, '$1[REDACTED]@')
  .replace(/\b(password|passwd|authorization|access[_-]?token|refresh[_-]?token|service[_-]?role|api[_-]?key|secret)\s*[:=]\s*[^,}\s]+/giu, '$1=[REDACTED]')

const timestampForFile = (timestamp) => timestamp.replace(/[-:.TZ]/gu, '').slice(0, 14)

const auditFailure = ({ timestamp, sqlKey, sourceFile, inputParameters, stdout, stderr, exitCode }) => {
  mkdirSync(auditRoot, { recursive: true })
  const auditFile = resolve(
    auditRoot,
    `${timestampForFile(timestamp)}-${sqlKey}-readonly-query-failed.json`,
  )
  const record = {
    timestamp,
    agent: AGENT,
    sqlKey,
    inputParameters,
    stdout: redact(stdout),
    stderr: redact(stderr),
    exitCode,
    sourceFile,
  }
  writeFileSync(auditFile, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return auditFile
}

const withoutComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//gu, ' ')
  .replace(/--[^\r\n]*/gu, ' ')
  .trim()

export const validateReadOnlySql = (sql) => {
  const executable = withoutComments(sql)
  if (!executable) throw new Error('SQL input is empty after comments are removed')
  if (!/^(?:select|with)\b/iu.test(executable)) {
    throw new Error('SQL input must start with SELECT or WITH')
  }
  const withoutTrailingSemicolon = executable.replace(/;\s*$/u, '')
  if (withoutTrailingSemicolon.includes(';')) throw new Error('SQL input must contain exactly one statement')
  if (/\b(?:insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|comment|copy|call|do|vacuum|analyze|refresh|reindex|cluster|set|reset|execute|prepare|deallocate|listen|notify|lock)\b/iu.test(withoutTrailingSemicolon)) {
    throw new Error('SQL input contains a forbidden write or session-control statement')
  }
  return executable
}

if (process.argv.includes('--self-test')) {
  assert.throws(() => validateReadOnlySql(' -- comment only\n'), /SQL input is empty/u)
  assert.throws(() => validateReadOnlySql('delete from public.profiles;'), /must start/u)
  assert.throws(() => validateReadOnlySql('select 1; update public.profiles set is_active = false;'), /exactly one statement/u)
  assert.equal(validateReadOnlySql('select 1;'), 'select 1;')
  assert.ok(!redact('Bearer token-value person@example.com').includes('token-value'))
  assert.ok(!redact('Bearer token-value person@example.com').includes('person@example.com'))
  process.stdout.write('TEAM_OS_4_READONLY_QUERY_SELFTEST_OK emptySqlRejected=1 writesRejected=1 secretsRedacted=1 remoteCalls=0\n')
  process.exit(0)
}

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag)
  if (index === -1 || !process.argv[index + 1]) return null
  return process.argv[index + 1]
}

const sqlKey = valueAfter('--sql-key')
const validateOnly = process.argv.includes('--validate-only')
const timestamp = new Date().toISOString()
const sourcePath = QUERIES[sqlKey]
const sourceFile = sourcePath ? relative(repoRoot, sourcePath).replaceAll('\\', '/') : 'unresolved'
const inputParameters = Object.freeze({
  targetProjectRef: TARGET_PROJECT_REF,
  sqlKey: sqlKey ?? '[missing]',
  mode: 'linked-read-only',
  nodeExecutable: NODE,
  npxCli: NPX_CLI,
  workdir: relative(repoRoot, teamOs4Root).replaceAll('\\', '/'),
})

let stdout = ''
let stderr = ''
let exitCode = 1
try {
  if (!sourcePath) throw new Error('unknown or missing --sql-key')
  if (!existsSync(NODE)) throw new Error('fixed Node executable is missing')
  if (!existsSync(NPX_CLI)) throw new Error('fixed npx-cli.js is missing')
  const linkedRef = readFileSync(linkedRefFile, 'utf8').trim()
  if (linkedRef !== TARGET_PROJECT_REF) throw new Error('linked project ref is not the isolated Team OS 4.0 target')
  const sql = readFileSync(sourcePath, 'utf8')
  validateReadOnlySql(sql)

  if (validateOnly) {
    process.stdout.write(`TEAM_OS_4_READONLY_QUERY_VALID sqlKey=${sqlKey} remoteCalls=0\n`)
    process.exit(0)
  }

  const result = spawnSync(
    NODE,
    [NPX_CLI, 'supabase', 'db', 'query', '--linked', '--file', sourcePath],
    { cwd: teamOs4Root, encoding: 'utf8', windowsHide: true, shell: false },
  )
  stdout = result.stdout ?? ''
  stderr = result.stderr ?? ''
  if (result.error) throw result.error
  exitCode = Number.isInteger(result.status) ? result.status : 1
  if (exitCode !== 0) throw new Error(`Supabase CLI exited with code ${exitCode}`)
  process.stdout.write(redact(stdout))
  if (stderr) process.stderr.write(redact(stderr))
} catch (error) {
  stderr = `${stderr}${stderr ? '\n' : ''}${error instanceof Error ? error.stack ?? error.message : String(error)}`
  const auditFile = auditFailure({
    timestamp,
    sqlKey: sqlKey ?? 'missing-sql-key',
    sourceFile,
    inputParameters,
    stdout,
    stderr,
    exitCode,
  })
  process.stderr.write(`TEAM_OS_4_READONLY_QUERY_FAILED audit=${auditFile}\n`)
  process.exitCode = exitCode
}
