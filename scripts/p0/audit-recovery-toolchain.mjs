import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const runPath = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'restore-run.p0-test.json')
const whereExe = 'C:\\Windows\\System32\\where.exe'
const definitions = {
  supabaseCli: { command: 'supabase', versionArgs: ['--version'] },
  docker: { command: 'docker', versionArgs: ['version', '--format', '{{.Client.Version}}|{{.Server.Version}}'] },
  psql: { command: 'psql', versionArgs: ['--version'] },
  pgDump: { command: 'pg_dump', versionArgs: ['--version'] },
}

let run
try {
  run = JSON.parse(readFileSync(runPath, 'utf8'))
} catch (error) {
  console.error('[p0:toolchain] cannot read restore run: ' + error.message)
  process.exit(1)
}

if (process.platform !== 'win32' || !existsSync(whereExe)) {
  console.error('[p0:toolchain] BLOCKED this audit requires Windows where.exe')
  process.exit(1)
}

const checks = []
const check = (label, result) => checks.push([label, Boolean(result)])
const findings = []

for (const [name, definition] of Object.entries(definitions)) {
  const declared = run.toolchain?.[name]
  check(name + ' declaration exists', declared !== null && typeof declared === 'object')
  check(name + ' declared status is supported', ['missing', 'ready'].includes(declared?.status))

  const located = spawnSync(whereExe, [definition.command], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  const paths = located.status === 0
    ? located.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
    : []
  const actualPath = paths[0] ?? null
  let actualStatus = 'missing'
  let actualVersion = null

  if (actualPath) {
    const version = spawnSync(actualPath, definition.versionArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    })
    actualVersion = `${version.stdout ?? ''}\n${version.stderr ?? ''}`.trim() || null
    actualStatus = version.status === 0 && actualVersion ? 'ready' : 'unusable'
  }

  findings.push({ name, declared: declared?.status, actualStatus, actualPath, actualVersion })
  if (declared?.status === 'missing') {
    check(name + ' is truly missing', actualStatus === 'missing')
    check(name + ' missing declaration has no path or version', declared.path === null && declared.version === null)
  } else {
    check(name + ' executable exists', actualStatus === 'ready')
    check(name + ' declared path exists', typeof declared.path === 'string' && existsSync(declared.path))
    check(
      name + ' declared path matches the executable',
      typeof declared.path === 'string' && actualPath !== null &&
        resolve(declared.path).toLowerCase() === resolve(actualPath).toLowerCase(),
    )
    check(
      name + ' declared version matches current output',
      typeof declared.version === 'string' && actualVersion?.includes(declared.version),
    )
  }
}

let passed = 0
for (const [label, result] of checks) {
  if (result) passed += 1
  else console.error('[p0:toolchain] FAIL ' + label)
}
for (const finding of findings) {
  console.log(
    '[p0:toolchain] ' + finding.name +
      ' declared=' + finding.declared +
      ' actual=' + finding.actualStatus +
      ' path=' + (finding.actualPath ?? '<none>'),
  )
}
const ready = findings.every((finding) => finding.actualStatus === 'ready')
console.log(
  '[p0:toolchain] summary discovered=' + checks.length +
    ' run=' + checks.length + ' passed=' + passed +
    ' failed=' + (checks.length - passed) + ' skipped=0',
)
console.log('[p0:toolchain] readiness=' + (ready ? 'READY' : 'BLOCKED reason=missing-or-unusable-tools'))
if (passed !== checks.length) process.exit(1)
