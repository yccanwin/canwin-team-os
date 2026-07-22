import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const cmdExe = 'C:\\Windows\\System32\\cmd.exe'
const npmCmd = 'C:\\Program Files\\nodejs\\npm.cmd'

const steps = [
  {
    name: 'foundation-prefix-contract',
    command: process.execPath,
    args: [resolve(repoRoot, 'platform/team-os-4/supabase/verify-foundation.mjs')],
  },
  {
    name: 'g2-static-contract',
    command: process.execPath,
    args: [resolve(repoRoot, 'scripts/p2/verify-team-os-4-g2-contract.mjs')],
  },
  {
    name: 'g2-performance-runner-selftest',
    command: process.execPath,
    args: [resolve(repoRoot, 'scripts/p2/test-team-os-4-g2-performance-runner.mjs')],
  },
  {
    name: 'work-item-runtime-contract',
    command: cmdExe,
    args: ['/d', '/c', npmCmd, 'run', 'test:work-item-contract', '--prefix', resolve(repoRoot, 'apps/team-os-4')],
  },
  {
    name: 'work-item-view-and-command-contract',
    command: cmdExe,
    args: ['/d', '/c', npmCmd, 'run', 'test:work-item-view', '--prefix', resolve(repoRoot, 'apps/team-os-4')],
  },
  {
    name: 'work-item-edge-command-contract',
    command: process.execPath,
    args: [resolve(repoRoot, 'platform/team-os-4/supabase/functions/work-item-command/contract.test.mjs')],
  },
  {
    name: 'domain-typecheck',
    command: cmdExe,
    args: ['/d', '/c', npmCmd, 'run', 'typecheck', '--prefix', resolve(repoRoot, 'packages/team-os-4-domain')],
  },
  {
    name: 'app-build',
    command: cmdExe,
    args: ['/d', '/c', npmCmd, 'run', 'build', '--prefix', resolve(repoRoot, 'apps/team-os-4')],
  },
]

let passed = 0
for (const step of steps) {
  console.log(`[g2:local] RUN ${step.name}`)
  const result = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    env: { ...process.env, CI: '1' },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error || result.status !== 0) {
    console.error(`[g2:local] FAIL ${step.name} ${result.error?.message ?? `exit=${result.status}`}`)
    console.error(`[g2:local] summary run=${passed + 1} passed=${passed} failed=1 skipped=${steps.length - passed - 1}`)
    process.exit(1)
  }
  passed += 1
  console.log(`[g2:local] PASS ${step.name}`)
}

console.log(`[g2:local] summary run=${steps.length} passed=${passed} failed=0 skipped=0 remoteCalls=0`)
