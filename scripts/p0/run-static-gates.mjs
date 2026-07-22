import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const gates = [
  ['greenfield-root-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-greenfield-root-contract.mjs')],
  ['team-os-4-foundation', resolve(repoRoot, 'platform', 'team-os-4', 'supabase', 'verify-foundation.mjs')],
  ['migration-manifest', resolve(repoRoot, 'scripts', 'p0', 'verify-migration-manifest.mjs')],
  ['project-ref-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-project-ref-contract.mjs')],
  ['core-business-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-core-business-contract.mjs')],
  ['core-physical-object-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-core-physical-object-contract.mjs')],
  ['role-migration-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-role-migration-contract.mjs')],
  ['p1-interface-freeze', resolve(repoRoot, 'scripts', 'p0', 'verify-p1-interface-freeze.mjs')],
  ['public-table-live-evidence', resolve(repoRoot, 'scripts', 'p0', 'verify-public-table-live-evidence.mjs')],
  ['public-routine-live-evidence', resolve(repoRoot, 'scripts', 'p0', 'verify-public-routine-live-evidence.mjs')],
  ['routine-caller-crosscheck', resolve(repoRoot, 'scripts', 'p0', 'verify-routine-caller-crosscheck.mjs')],
  ['advisor-risk-priority-evidence', resolve(repoRoot, 'scripts', 'p0', 'verify-advisor-risk-priority-evidence.mjs')],
  ['object-classification-freeze', resolve(repoRoot, 'scripts', 'p0', 'verify-object-classification-freeze.mjs')],
  ['backup-manifest-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-backup-manifest-contract.mjs')],
  ['restore-run-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-restore-run-contract.mjs')],
  ['sealed-recovery-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-sealed-recovery-contract.mjs')],
  ['ci-database-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-ci-database-contract.mjs')],
  ['p1-isolated-runtime-runner', resolve(repoRoot, 'scripts', 'p1', 'verify-isolated-runtime-runner.mjs')],
  ['p1-pending-trigger-postgres-selftest', resolve(repoRoot, 'scripts', 'p1', 'verify-pending-trigger-postgres.mjs'), '--self-test'],
  ['p1-real-account-fixture-selftest', resolve(repoRoot, 'scripts', 'p1', 'manage-real-page-accounts.mjs'), '--self-test'],
  ['p1-real-page-runner-selftest', resolve(repoRoot, 'scripts', 'p1', 'run-real-page-acceptance.mjs'), '--self-test'],
]

let run = 0
let passed = 0
let failed = 0
for (const [name, script, ...args] of gates) {
  run += 1
  console.log('[p0:static] RUN ' + name)
  const commands = [[script, args]]
  if (name === 'p1-isolated-runtime-runner') {
    commands.push([resolve(repoRoot, 'scripts', 'p1', 'verify-app-shell.mjs'), []])
    commands.push([
      '--experimental-strip-types',
      [resolve(repoRoot, 'scripts', 'p1', 'verify-access-admin-v1-write-chain.ts')],
    ])
  }
  let gatePassed = true
  let failedStatus = null
  for (const [commandScript, commandArgs] of commands) {
    const result = spawnSync(process.execPath, [commandScript, ...commandArgs], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
    })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.status !== 0) {
      gatePassed = false
      failedStatus = result.status
      break
    }
  }
  if (gatePassed) {
    passed += 1
    console.log('[p0:static] PASS ' + name)
  } else {
    failed = 1
    console.error('[p0:static] FAIL ' + name + ' exit=' + String(failedStatus))
    break
  }
}

console.log(
  '[p0:static] summary discovered=' + gates.length + ' run=' + run +
    ' passed=' + passed + ' failed=' + failed +
    ' skipped=' + (gates.length - run),
)
if (failed > 0) process.exit(1)
