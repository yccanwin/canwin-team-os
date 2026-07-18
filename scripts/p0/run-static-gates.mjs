import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const gates = [
  ['migration-manifest', resolve(repoRoot, 'scripts', 'p0', 'verify-migration-manifest.mjs')],
  ['project-ref-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-project-ref-contract.mjs')],
  ['backup-manifest-contract', resolve(repoRoot, 'scripts', 'p0', 'verify-backup-manifest-contract.mjs')],
]

let run = 0
let passed = 0
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
    console.error('[p0:static] FAIL ' + name + ' exit=' + String(result.status))
  }
}

console.log(
  '[p0:static] summary discovered=' + gates.length + ' run=' + run +
    ' passed=' + passed + ' failed=' + (run - passed) +
    ' skipped=' + (gates.length - run),
)
if (passed !== gates.length) process.exit(1)
