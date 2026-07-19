import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const runPath = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'restore-run.p0-test.json')
const projectContractPath = resolve(repoRoot, 'scripts', 'p0', 'project-ref-contract.json')
const checks = []
const check = (label, result) => checks.push([label, Boolean(result)])
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isIsoOrNull = (value) => {
  if (value === null) return true
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}
const isShaOrNull = (value) => value === null || /^[a-f0-9]{64}$/.test(value)

let run
let projects
try {
  run = JSON.parse(readFileSync(runPath, 'utf8'))
  projects = JSON.parse(readFileSync(projectContractPath, 'utf8'))
} catch (error) {
  console.error('[p0:restore-run] cannot read contract: ' + error.message)
  process.exit(1)
}

function exactKeys(label, value, expected) {
  check(label + ' is an object', isObject(value))
  if (!isObject(value)) return
  const actual = Object.keys(value).sort()
  check(label + ' has exact fields', JSON.stringify(actual) === JSON.stringify([...expected].sort()))
}

exactKeys('root', run, [
  'schemaVersion', 'manifestType', 'runId', 'state', 'progressGate', 'source',
  'target', 'dataPolicy', 'authorization', 'toolchain', 'artifacts', 'steps',
  'failurePolicy',
])
exactKeys('source', run.source, ['environment', 'projectRef', 'access', 'writeFreeze', 'snapshotAt'])
exactKeys('source.writeFreeze', run.source?.writeFreeze, [
  'authorization', 'status', 'startedAt', 'verifiedAt', 'verifiedBy', 'releaseOwner',
  'channels', 'sourceBeforeSha256', 'sourceAfterSha256',
])
exactKeys('source.writeFreeze.channels', run.source?.writeFreeze?.channels, [
  'frontend', 'directApi', 'authChanges', 'functions', 'webhooks', 'cronWorkers', 'manualAdmin',
])
exactKeys('target', run.target, [
  'environment', 'projectRef', 'projectName', 'health', 'previewBuildAllowed', 'writeAuthorized',
])
exactKeys('dataPolicy', run.dataPolicy, [
  'mode', 'g0EligibleMode', 'allowedModes', 'realAuthLoginAllowed',
  'externalDeliveryAllowed', 'retentionUntil',
])
exactKeys('authorization', run.authorization, [
  'productionBackupRead', 'productionWriteFreezeApproved', 'targetRestoreWrite',
  'formalAttemptId', 'formalAttemptStarted', 'maxAttempts', 'noAutomaticRetry',
])
exactKeys('toolchain', run.toolchain, ['supabaseCli', 'docker', 'psql', 'pgDump'])
exactKeys('artifacts', run.artifacts, [
  'backupPackageManifest', 'backupPackageManifestSha256', 'evidenceDirectory',
])
exactKeys('steps', run.steps, [
  'database', 'auth', 'storage', 'functions', 'cron', 'featureFlags', 'reconciliation',
])
exactKeys('failurePolicy', run.failurePolicy, [
  'stopOnFirstFailure', 'preserveTargetAndEvidence', 'databaseRestoreAtomic',
  'automaticCleanup', 'automaticRetry', 'newAuthorizationRequired',
])

check('schema version is supported', run.schemaVersion === 1)
check('manifest type is correct', run.manifestType === 'canwin-team-os-restore-run')
check('gate remains G0', run.progressGate === 'G0')
check('state is supported', [
  'preflight-blocked', 'preflight-ready', 'running', 'failed', 'succeeded',
].includes(run.state))
check('source is production read-only', run.source?.environment === 'production' && run.source?.access === 'read-only')
check('source ref matches project contract', run.source?.projectRef === projects.productionProjectRef)
check('source snapshot time is valid', isIsoOrNull(run.source?.snapshotAt))

const freeze = run.source?.writeFreeze
check('write freeze is owner-approved when scheduled', freeze?.authorization === 'approved-when-scheduled')
check('write freeze status is supported', ['not-started', 'active', 'verified', 'released'].includes(freeze?.status))
check('write freeze timestamps are valid', isIsoOrNull(freeze?.startedAt) && isIsoOrNull(freeze?.verifiedAt))
check('write freeze release owner is declared', freeze?.releaseOwner === 'project-owner')
check('write freeze baseline hashes are valid', isShaOrNull(freeze?.sourceBeforeSha256) && isShaOrNull(freeze?.sourceAfterSha256))
const freezeChannels = Object.values(freeze?.channels ?? {})
check('write freeze has seven channels', freezeChannels.length === 7)
check(
  'write freeze channel states are supported',
  freezeChannels.every((status) => ['not-started', 'disabled', 'verified', 'restored'].includes(status)),
)

check('target is isolated test', run.target?.environment === 'isolated-test')
check('target ref matches project contract', run.target?.projectRef === projects.testProjectRef)
check('source and target refs differ', run.source?.projectRef !== run.target?.projectRef)
check('target health is recorded', ['ACTIVE_HEALTHY', 'ISOLATED_FAILED'].includes(run.target?.health))
check('preview remains disabled during restore', run.target?.previewBuildAllowed === false)
check('target write flag matches authorization', run.target?.writeAuthorized === run.authorization?.targetRestoreWrite)

check(
  'data policy modes are frozen',
  JSON.stringify(run.dataPolicy?.allowedModes) === JSON.stringify([
    'encrypted-full-recovery-rehearsal',
    'approved-desensitized-rehearsal',
  ]),
)
check('only full encrypted recovery can satisfy G0', run.dataPolicy?.g0EligibleMode === 'encrypted-full-recovery-rehearsal')
check(
  'selected data mode is supported',
  run.dataPolicy?.mode === 'decision-pending' || run.dataPolicy?.allowedModes?.includes(run.dataPolicy?.mode),
)
check('real recovered users cannot log in', run.dataPolicy?.realAuthLoginAllowed === false)
check('external delivery remains disabled', run.dataPolicy?.externalDeliveryAllowed === false)
check('retention time is valid', isIsoOrNull(run.dataPolicy?.retentionUntil))

check('production write freeze is authorized', run.authorization?.productionWriteFreezeApproved === true)
check('formal attempt maximum is one', run.authorization?.maxAttempts === 1)
check('automatic retry is forbidden', run.authorization?.noAutomaticRetry === true)
check(
  'formal attempt identity is consistent',
  run.authorization?.formalAttemptStarted
    ? typeof run.authorization.formalAttemptId === 'string' && run.authorization.formalAttemptId.length > 0 && run.runId === run.authorization.formalAttemptId
    : run.authorization?.formalAttemptId === null && run.runId === null,
)

const tools = ['supabaseCli', 'docker', 'psql', 'pgDump']
for (const tool of tools) {
  const value = run.toolchain?.[tool]
  exactKeys('toolchain.' + tool, value, ['status', 'path', 'version'])
  check(tool + ' status is supported', ['missing', 'ready'].includes(value?.status))
  check(
    tool + ' evidence matches status',
    value?.status === 'missing'
      ? value.path === null && value.version === null
      : typeof value.path === 'string' && /^[A-Za-z]:\\/.test(value.path) && typeof value.version === 'string' && value.version.length > 0,
  )
}

check(
  'backup package reference is paired',
  run.artifacts?.backupPackageManifest === null
    ? run.artifacts?.backupPackageManifestSha256 === null
    : typeof run.artifacts.backupPackageManifest === 'string' &&
      /^[a-f0-9]{64}$/.test(run.artifacts.backupPackageManifestSha256),
)
check(
  'evidence directory is absent or absolute',
  run.artifacts?.evidenceDirectory === null || /^[A-Za-z]:\\/.test(run.artifacts.evidenceDirectory),
)

const stepNames = ['database', 'auth', 'storage', 'functions', 'cron', 'featureFlags', 'reconciliation']
const stepStatuses = []
for (const step of stepNames) {
  const item = run.steps?.[step]
  exactKeys('steps.' + step, item, [
    'status', 'attempts', 'startedAt', 'finishedAt', 'exitCode', 'logPath', 'logSha256',
  ])
  check(step + ' status is supported', ['not-run', 'running', 'succeeded', 'failed', 'skipped'].includes(item?.status))
  check(step + ' attempt count is zero or one', item?.attempts === 0 || item?.attempts === 1)
  check(step + ' timestamps are valid', isIsoOrNull(item?.startedAt) && isIsoOrNull(item?.finishedAt))
  check(step + ' log hash is valid', isShaOrNull(item?.logSha256))
  check(
    step + ' evidence matches status',
    ['not-run', 'skipped'].includes(item?.status)
      ? item.attempts === 0 && item.startedAt === null && item.finishedAt === null && item.exitCode === null && item.logPath === null && item.logSha256 === null
      : item.attempts === 1 && item.startedAt !== null &&
        (item.status === 'running'
          ? item.finishedAt === null && item.exitCode === null
          : item.finishedAt !== null && Number.isInteger(item.exitCode) && typeof item.logPath === 'string' && /^[a-f0-9]{64}$/.test(item.logSha256 ?? '')),
  )
  if (item?.status === 'succeeded') check(step + ' succeeded with exit 0', item.exitCode === 0)
  if (item?.status === 'failed') check(step + ' failed with nonzero exit', item.exitCode !== 0)
  stepStatuses.push(item?.status)
}

check('first failure stops the run', run.failurePolicy?.stopOnFirstFailure === true)
check('target and evidence are preserved', run.failurePolicy?.preserveTargetAndEvidence === true)
check('database restore is atomic', run.failurePolicy?.databaseRestoreAtomic === true)
check('automatic cleanup is forbidden', run.failurePolicy?.automaticCleanup === false)
check('failure retry is forbidden', run.failurePolicy?.automaticRetry === false)
check('new authorization is required after failure', run.failurePolicy?.newAuthorizationRequired === true)

const blockers = []
if (run.dataPolicy?.mode !== run.dataPolicy?.g0EligibleMode) blockers.push('g0-data-policy')
if (run.authorization?.productionBackupRead !== true) blockers.push('production-backup-read-authorization')
if (run.authorization?.targetRestoreWrite !== true) blockers.push('target-restore-write-authorization')
if (freeze?.status !== 'verified' || freezeChannels.some((status) => status !== 'verified')) blockers.push('write-freeze-verification')
if (tools.some((tool) => run.toolchain?.[tool]?.status !== 'ready')) blockers.push('toolchain')
if (!run.artifacts?.backupPackageManifest || !run.artifacts?.backupPackageManifestSha256 || !run.artifacts?.evidenceDirectory) blockers.push('backup-artifacts')

const allNotRun = stepStatuses.every((status) => status === 'not-run')
if (run.state === 'preflight-blocked') {
  check('blocked state has blockers', blockers.length > 0)
  check('blocked state has not started formal attempt', run.authorization?.formalAttemptStarted === false)
  check('blocked state has no executed steps', allNotRun)
}
if (run.state === 'preflight-ready') {
  check('ready state has no blockers', blockers.length === 0)
  check('ready state has not started formal attempt', run.authorization?.formalAttemptStarted === false)
  check('ready state has no executed steps', allNotRun)
}
if (run.state === 'running') {
  const runningIndex = stepStatuses.indexOf('running')
  check('running state has no blockers', blockers.length === 0)
  check('running state has one running step', runningIndex >= 0 && stepStatuses.lastIndexOf('running') === runningIndex)
  check('steps before running succeeded', stepStatuses.slice(0, runningIndex).every((status) => status === 'succeeded'))
  check('steps after running have not run', stepStatuses.slice(runningIndex + 1).every((status) => status === 'not-run'))
}
if (run.state === 'failed') {
  const failedIndex = stepStatuses.indexOf('failed')
  check('failed state has one failed step', failedIndex >= 0 && stepStatuses.lastIndexOf('failed') === failedIndex)
  check('steps before failure succeeded', stepStatuses.slice(0, failedIndex).every((status) => status === 'succeeded'))
  check('steps after failure are skipped', stepStatuses.slice(failedIndex + 1).every((status) => status === 'skipped'))
  check('failed target is isolated', run.target?.health === 'ISOLATED_FAILED')
}
if (run.state === 'succeeded') {
  check('succeeded state has no blockers', blockers.length === 0)
  check('all restore steps succeeded', stepStatuses.every((status) => status === 'succeeded'))
  check('G0 data mode was used', run.dataPolicy?.mode === run.dataPolicy?.g0EligibleMode)
}

const serialized = JSON.stringify(run)
const forbiddenPatterns = [
  /eyJhbGciOi[A-Za-z0-9_-]{8,}/,
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/,
  /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=/i,
]
check('no sensitive values are embedded', forbiddenPatterns.every((pattern) => !pattern.test(serialized)))

let passed = 0
for (const [label, result] of checks) {
  if (result) passed += 1
  else console.error('[p0:restore-run] FAIL ' + label)
}
console.log(
  '[p0:restore-run] source=' + run.source?.projectRef +
    ' target=' + run.target?.projectRef + ' state=' + run.state +
    ' blockers=' + blockers.length,
)
console.log(
  '[p0:restore-run] summary discovered=' + checks.length +
    ' run=' + checks.length + ' passed=' + passed +
    ' failed=' + (checks.length - passed) + ' skipped=0',
)
console.log(
  '[p0:restore-run] readiness=' + (blockers.length === 0 ? 'READY' : 'BLOCKED') +
    (blockers.length ? ' reasons=' + blockers.join(',') : ''),
)
if (passed !== checks.length) process.exit(1)
