import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const templatePath = resolve(
  repoRoot,
  'docs',
  'team-os-4.0',
  'p0',
  'backup-restore-manifest.template.json',
)

const checks = []
const check = (label, result) => checks.push({ label, result: Boolean(result) })
const hasOwn = (value, key) =>
  value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)

let manifest
try {
  manifest = JSON.parse(readFileSync(templatePath, 'utf8'))
} catch (error) {
  console.error('[p0:backup-contract] cannot read template: ' + error.message)
  console.error('[p0:backup-contract] summary discovered=1 run=1 passed=0 failed=1 skipped=0')
  process.exit(1)
}

const getPath = (path) => {
  let current = manifest
  for (const segment of path.split('.')) {
    if (!hasOwn(current, segment)) return { exists: false, value: undefined }
    current = current[segment]
  }
  return { exists: true, value: current }
}

const requiredPaths = [
  'schemaVersion',
  'manifestType',
  'template',
  'package.packageId',
  'package.createdAt',
  'package.sourceEnvironment',
  'package.sourceProjectRef',
  'package.gitCommit',
  'database.dump',
  'database.schemaInventory',
  'auth.identityRoleMapping',
  'auth.counts.authUsers',
  'auth.counts.profiles',
  'auth.counts.roleAssignments',
  'storage.bucketsManifest',
  'storage.objectsManifest',
  'storage.objectsArchive',
  'storage.counts.buckets',
  'storage.counts.objects',
  'storage.counts.bytes',
  'functions.manifest',
  'functions.sourceArchive',
  'functions.count',
  'cron.manifest',
  'cron.count',
  'cron.timezone',
  'featureFlags.manifest',
  'featureFlags.count',
  'environment.variableNames',
  'environment.valuesIncluded',
  'release.gitCommit',
  'release.frontendArtifact',
  'release.buildToolVersion',
  'reconciliation.tableRowCounts',
  'reconciliation.keyAmounts',
  'reconciliation.keyAmounts.currency',
  'reconciliation.keyAmounts.customerPayments',
  'reconciliation.keyAmounts.internalPayables',
  'reconciliation.keyAmounts.salesProfit',
  'reconciliation.keyAmounts.laborEarnings',
  'reconciliation.inventory',
  'reconciliation.inventory.onHand',
  'reconciliation.inventory.reserved',
  'reconciliation.inventory.shipped',
  'restoreEvidence.status',
  'restoreEvidence.targetEnvironment',
  'restoreEvidence.targetProjectRef',
  'restoreEvidence.startedAt',
  'restoreEvidence.finishedAt',
  'restoreEvidence.evidenceId',
  'restoreEvidence.componentResults',
]

for (const path of requiredPaths) {
  check('required path exists: ' + path, getPath(path).exists)
}

const allowedKeysByPath = new Map(Object.entries({
  '': [
    'schemaVersion',
    'manifestType',
    'template',
    'package',
    'database',
    'auth',
    'storage',
    'functions',
    'cron',
    'featureFlags',
    'environment',
    'release',
    'reconciliation',
    'restoreEvidence',
  ],
  package: ['packageId', 'createdAt', 'sourceEnvironment', 'sourceProjectRef', 'gitCommit'],
  database: ['dump', 'schemaInventory'],
  'database.dump': ['status', 'path', 'sha256', 'format', 'tool', 'toolVersion', 'createdAt'],
  'database.schemaInventory': ['status', 'path', 'sha256'],
  auth: ['identityRoleMapping', 'counts'],
  'auth.identityRoleMapping': ['status', 'path', 'sha256'],
  'auth.counts': ['authUsers', 'profiles', 'roleAssignments'],
  storage: ['bucketsManifest', 'objectsManifest', 'objectsArchive', 'counts'],
  'storage.bucketsManifest': ['status', 'path', 'sha256'],
  'storage.objectsManifest': ['status', 'path', 'sha256'],
  'storage.objectsArchive': ['status', 'path', 'sha256'],
  'storage.counts': ['buckets', 'objects', 'bytes'],
  functions: ['manifest', 'sourceArchive', 'count'],
  'functions.manifest': ['status', 'path', 'sha256'],
  'functions.sourceArchive': ['status', 'path', 'sha256'],
  cron: ['manifest', 'count', 'timezone'],
  'cron.manifest': ['status', 'path', 'sha256'],
  featureFlags: ['manifest', 'count'],
  'featureFlags.manifest': ['status', 'path', 'sha256'],
  environment: ['variableNames', 'valuesIncluded'],
  release: ['gitCommit', 'frontendArtifact', 'buildToolVersion'],
  'release.frontendArtifact': ['status', 'path', 'sha256'],
  reconciliation: ['tableRowCounts', 'keyAmounts', 'inventory'],
  'reconciliation.tableRowCounts': ['status', 'path', 'sha256'],
  'reconciliation.keyAmounts': [
    'status',
    'path',
    'sha256',
    'currency',
    'customerPayments',
    'internalPayables',
    'salesProfit',
    'laborEarnings',
  ],
  'reconciliation.inventory': ['status', 'path', 'sha256', 'onHand', 'reserved', 'shipped'],
  restoreEvidence: [
    'status',
    'targetEnvironment',
    'targetProjectRef',
    'startedAt',
    'finishedAt',
    'evidenceId',
    'componentResults',
  ],
  'restoreEvidence.componentResults': [
    'database',
    'auth',
    'storage',
    'functions',
    'cron',
    'featureFlags',
    'frontendArtifact',
    'reconciliation',
  ],
}))

const inspectShape = (value, path = '') => {
  if (Array.isArray(value)) {
    check('array is allowed only for environment.variableNames: ' + path, path === 'environment.variableNames')
    return
  }
  if (value === null || typeof value !== 'object') return
  const allowedKeys = allowedKeysByPath.get(path)
  check('object path is declared by the contract: ' + (path || '<root>'), Boolean(allowedKeys))
  if (!allowedKeys) return
  for (const [key, child] of Object.entries(value)) {
    check('allowed field: ' + (path ? path + '.' : '') + key, allowedKeys.includes(key))
    inspectShape(child, path ? path + '.' + key : key)
  }
}

inspectShape(manifest)

check('schemaVersion is 1', manifest.schemaVersion === 1)
check('manifestType is correct', manifest.manifestType === 'canwin-team-os-backup-restore')
check('file is explicitly a template', manifest.template === true)
check('source environment is production', manifest.package?.sourceEnvironment === 'production')
check('environment values are excluded', manifest.environment?.valuesIncluded === false)
check('cron timezone is Asia/Shanghai', manifest.cron?.timezone === 'Asia/Shanghai')
check('key amount currency is CNY', manifest.reconciliation?.keyAmounts?.currency === 'CNY')

const nullPlaceholderPaths = [
  'package.packageId',
  'package.createdAt',
  'package.sourceProjectRef',
  'package.gitCommit',
  'database.dump.path',
  'database.dump.sha256',
  'database.dump.format',
  'database.dump.tool',
  'database.dump.toolVersion',
  'database.dump.createdAt',
  'auth.counts.authUsers',
  'auth.counts.profiles',
  'auth.counts.roleAssignments',
  'storage.counts.buckets',
  'storage.counts.objects',
  'storage.counts.bytes',
  'functions.count',
  'cron.count',
  'featureFlags.count',
  'release.gitCommit',
  'release.buildToolVersion',
  'reconciliation.keyAmounts.customerPayments',
  'reconciliation.keyAmounts.internalPayables',
  'reconciliation.keyAmounts.salesProfit',
  'reconciliation.keyAmounts.laborEarnings',
  'reconciliation.inventory.onHand',
  'reconciliation.inventory.reserved',
  'reconciliation.inventory.shipped',
  'restoreEvidence.targetProjectRef',
  'restoreEvidence.startedAt',
  'restoreEvidence.finishedAt',
  'restoreEvidence.evidenceId',
]
for (const path of nullPlaceholderPaths) {
  check('template placeholder is null: ' + path, getPath(path).value === null)
}

const artifactPaths = [
  'database.dump',
  'database.schemaInventory',
  'auth.identityRoleMapping',
  'storage.bucketsManifest',
  'storage.objectsManifest',
  'storage.objectsArchive',
  'functions.manifest',
  'functions.sourceArchive',
  'cron.manifest',
  'featureFlags.manifest',
  'release.frontendArtifact',
  'reconciliation.tableRowCounts',
  'reconciliation.keyAmounts',
  'reconciliation.inventory',
]

for (const path of artifactPaths) {
  const artifact = getPath(path).value
  check(path + ' is an object', artifact !== null && typeof artifact === 'object' && !Array.isArray(artifact))
  check(path + ' status is pending', artifact?.status === 'pending')
  check(path + ' path placeholder is null', hasOwn(artifact, 'path') && artifact.path === null)
  check(path + ' sha256 placeholder is null', hasOwn(artifact, 'sha256') && artifact.sha256 === null)
}

check(
  'database dump and Storage archive are separate objects',
  manifest.database?.dump !== manifest.storage?.objectsArchive,
)
check(
  'database and Storage use distinct contract paths',
  artifactPaths.includes('database.dump') && artifactPaths.includes('storage.objectsArchive'),
)

const requiredVariableNames = [
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_URL',
  'WECOM_WEBHOOK_URL',
]
const variableNames = Array.isArray(manifest.environment?.variableNames)
  ? manifest.environment.variableNames
  : []
check('environment variableNames is an array', Array.isArray(manifest.environment?.variableNames))
check('environment variable names are unique', new Set(variableNames).size === variableNames.length)
check('environment variable names have valid syntax', variableNames.every((name) => /^[A-Z][A-Z0-9_]*$/.test(name)))
check(
  'environment variable name inventory is complete',
  JSON.stringify([...variableNames].sort()) === JSON.stringify([...requiredVariableNames].sort()),
)

const restoreComponents = [
  'database',
  'auth',
  'storage',
  'functions',
  'cron',
  'featureFlags',
  'frontendArtifact',
  'reconciliation',
]
check('restore status is not-run', manifest.restoreEvidence?.status === 'not-run')
check('restore target is not provisioned', manifest.restoreEvidence?.targetEnvironment === 'not-provisioned')
check('restore target ref is null', manifest.restoreEvidence?.targetProjectRef === null)
for (const component of restoreComponents) {
  check(
    'restore component is not-run: ' + component,
    manifest.restoreEvidence?.componentResults?.[component] === 'not-run',
  )
}

const sensitiveKeyPattern = /(?:secret|credential|service_?role|password|access_?token|refresh_?token|api_?key|webhook_?url|connection_?string|database_?url)/i
const literalPatterns = [
  ['JWT-like value', /eyJhbGciOi[A-Za-z0-9_-]{8,}/],
  ['Supabase secret value', /sb_secret_[A-Za-z0-9_-]{8,}/],
  ['GitHub token value', /(?:ghp_|github_pat_)[A-Za-z0-9_]{8,}/],
  ['OpenAI-style key value', /sk-[A-Za-z0-9_-]{16,}/],
  ['private key material', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['credential-bearing database URL', /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/i],
  ['credential-bearing WeCom URL', /qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=/i],
]

const walk = (value, path = []) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, [...path, String(index)]))
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...path, key]
      if (sensitiveKeyPattern.test(key)) {
        check(
          'sensitive field has no value: ' + childPath.join('.'),
          child === null || child === false,
        )
      }
      walk(child, childPath)
    }
    return
  }
  if (typeof value !== 'string') return
  for (const [label, pattern] of literalPatterns) {
    check(label + ' absent at ' + path.join('.'), !pattern.test(value))
  }
}

walk(manifest)

let passed = 0
for (const item of checks) {
  if (item.result) {
    passed += 1
  } else {
    console.error('[p0:backup-contract] FAIL ' + item.label)
  }
}

console.log(
  '[p0:backup-contract] artifacts=' + artifactPaths.length +
    ' variable_names=' + variableNames.length +
    ' restore_evidence=' + manifest.restoreEvidence?.status,
)
console.log(
  '[p0:backup-contract] summary discovered=' + checks.length +
    ' run=' + checks.length + ' passed=' + passed +
    ' failed=' + (checks.length - passed) + ' skipped=0',
)
if (passed !== checks.length) process.exit(1)
