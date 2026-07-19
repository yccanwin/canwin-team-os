import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const gates = [
  ['migration-manifest', resolve(repoRoot, 'scripts', 'p0', 'verify-migration-manifest.mjs')],
  ['project-ref-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-project-ref-contract.mjs')],
  ['core-business-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-core-business-contract.mjs')],
  ['role-migration-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-role-migration-contract.mjs')],
  ['public-table-live-evidence', resolve(repoRoot, 'scripts', 'p0', 'verify-public-table-live-evidence.mjs')],
  ['public-routine-live-evidence', resolve(repoRoot, 'scripts', 'p0', 'verify-public-routine-live-evidence.mjs')],
  ['routine-caller-crosscheck', resolve(repoRoot, 'scripts', 'p0', 'verify-routine-caller-crosscheck.mjs')],
  ['advisor-risk-priority-evidence', resolve(repoRoot, 'scripts', 'p0', 'verify-advisor-risk-priority-evidence.mjs')],
  ['backup-manifest-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-backup-manifest-contract.mjs')],
  ['restore-run-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-restore-run-contract.mjs')],
]

let run = 0
let passed = 0
let failed = 0
for (const [name, script] of gates) {
  run += 1
  console.log('[p0:static] RUN ' + name)
  const result = spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status === 0) {
    passed += 1
    console.log('[p0:static] PASS ' + name)
  } else {
    failed = 1
    console.error('[p0:static] FAIL ' + name + ' exit=' + String(result.status))
    break
  }
}

console.log(
  '[p0:static] summary discovered=' + gates.length + ' run=' + run +
    ' passed=' + passed + ' failed=' + failed +
    ' skipped=' + (gates.length - run),
)
if (failed > 0) process.exit(1)
