import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const cmdExe = 'C:\\Windows\\System32\\cmd.exe'
const powershellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const p0Script = (...segments) => resolve(repoRoot, 'scripts', 'p0', ...segments)
const projectContract = JSON.parse(readFileSync(p0Script('project-ref-contract.json'), 'utf8'))
const staticProjectRef = projectContract.testProjectRef
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const staticAnonKey = [
  encode({ alg: 'HS256', typ: 'JWT' }),
  encode({ iss: 'supabase', ref: staticProjectRef, role: 'anon' }),
  'static-signature',
].join('.')
const staticBuildEnvironment = {
  CANWIN_BUILD_TARGET: 'test-preview',
  VITE_EXPECTED_SUPABASE_PROJECT_REF: staticProjectRef,
  VITE_SUPABASE_URL: `https://${staticProjectRef}.supabase.co`,
  VITE_SUPABASE_ANON_KEY: staticAnonKey,
}

const greenfieldSteps = [
  {
    name: 'static-gates',
    command: cmdExe,
    args: ['/d', '/c', 'npm.cmd', 'run', 'test:p0:static'],
  },
  {
    name: 'team-os-4-app-build',
    command: cmdExe,
    args: ['/d', '/c', 'npm.cmd', 'run', 'build:team-os-4'],
  },
  {
    name: 'team-os-4-domain-typecheck',
    command: cmdExe,
    args: ['/d', '/c', 'npm.cmd', 'run', 'typecheck:team-os-4-domain'],
  },
  {
    name: 'team-os-4-migration-tool-selftest',
    command: cmdExe,
    args: ['/d', '/c', 'npm.cmd', 'run', 'test:team-os-4-migration-tool'],
  },
]
const legacySteps = [
  {
    name: 'legacy-static-gates',
    command: cmdExe,
    args: ['/d', '/c', 'npm.cmd', 'run', 'test:p0:static:legacy'],
  },
  {
    name: 'ci-database-runner-selftest',
    command: process.execPath,
    args: [p0Script('run-ci-database-gates.mjs'), '--self-test'],
  },
  {
    name: 'frontend-inventory',
    command: process.execPath,
    args: [p0Script('verify-frontend-inventory.mjs')],
  },
  {
    name: 'p1-navigation-contract',
    command: process.execPath,
    args: [p0Script('verify-p1-app-navigation-contract.mjs')],
  },
  {
    name: 'p1-app-shell',
    command: process.execPath,
    args: [resolve(repoRoot, 'scripts', 'p1', 'verify-app-shell.mjs')],
  },
  {
    name: 'catalog-readonly-selftest',
    command: powershellExe,
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      p0Script('validate-catalog-snapshot-readonly.ps1'),
      '-SelfTest',
    ],
  },
  {
    name: 'security-invoker-candidate',
    command: powershellExe,
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      p0Script('validate-security-invoker-view-candidate.ps1'),
    ],
  },
  {
    name: 'table-classification-register',
    command: process.execPath,
    args: [p0Script('verify-table-classification-register.mjs')],
  },
  {
    name: 'frontend-disposition-crosscheck',
    command: process.execPath,
    args: [p0Script('verify-frontend-disposition-crosscheck.mjs')],
  },
  {
    name: 'build-target-selftest',
    command: process.execPath,
    args: [p0Script('verify-build-target.mjs'), '--self-test'],
  },
  {
    name: 'frontend-build',
    command: cmdExe,
    args: ['/d', '/c', 'npm.cmd', 'run', 'build:p0-static'],
    env: staticBuildEnvironment,
  },
  {
    name: 'frontend-artifact-static',
    command: process.execPath,
    args: [p0Script('verify-build-target.mjs'), '--artifact-compile-only', 'dist-p0-static'],
    env: staticBuildEnvironment,
  },
]
const steps = process.argv.includes('--legacy') ? legacySteps : greenfieldSteps

let run = 0
let passed = 0
let failed = 0

function printSummary() {
  console.log(
    '[p0:local] summary discovered=' + steps.length +
      ' run=' + run +
      ' passed=' + passed +
      ' failed=' + failed +
      ' skipped=' + (steps.length - run),
  )
}

for (const step of steps) {
  run += 1
  console.log('[p0:local] RUN ' + step.name)
  const cleanEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('VITE_') && !name.startsWith('CANWIN_')),
  )
  const result = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    env: { ...cleanEnvironment, CI: '1', ...(step.env ?? {}) },
    stdio: 'inherit',
    windowsHide: true,
  })

  if (result.status === 0 && !result.error) {
    passed += 1
    console.log('[p0:local] PASS ' + step.name)
    continue
  }

  failed = 1
  const detail = result.error?.message ??
    (result.signal ? 'signal=' + result.signal : 'exit=' + String(result.status))
  console.error('[p0:local] FAIL ' + step.name + ' ' + detail)
  printSummary()
  process.exit(1)
}

printSummary()
