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
  'package.sourceSnapshotAt',
  'package.freezeStartedAt',
  'package.freezeEndedAt',
  'package.encrypted',
  'package.encryptionKeyReference',
  'package.retentionUntil',
  'database.rolesDump',
  'database.schemaDump',
  'database.dataDump',
  'database.migrationHistorySchemaDump',
  'database.migrationHistoryDataDump',
  'database.authStorageSchemaDiff',
  'database.schemaInventory',
  'auth.recoveryScope.managedAuthSchemaDataIncluded',
  'auth.recoveryScope.passwordHashesIncluded',
  'auth.recoveryScope.sessionsRestored',
  'auth.recoveryScope.sourceJwtSecretCopied',
  'auth.identitiesDump',
  'auth.identityRoleMapping',
  'auth.settingsManifest',
  'auth.counts.authUsers',
  'auth.counts.authIdentities',
  'auth.counts.profiles',
  'auth.counts.roleAssignments',
  'auth.counts.orphanProfiles',
  'auth.counts.orphanRoleAssignments',
  'storage.bucketsManifest',
  'storage.objectsManifest',
  'storage.objectsArchive',
  'storage.counts.buckets',
  'storage.counts.objects',
  'storage.counts.bytes',
  'functions.restoreSafety.deployEnabled',
  'functions.restoreSafety.externalDeliveryEnabled',
  'functions.restoreSafety.secretValuesIncluded',
  'functions.manifest',
  'functions.sourceArchive',
  'functions.count',
  'cron.restoreSafety.enabled',
  'cron.restoreSafety.cursorIncluded',
  'cron.restoreSafety.backfillConfigIncluded',
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
  'reconciliation.asOf',
  'reconciliation.querySha256',
  'reconciliation.decimalPrecision',
  'reconciliation.sourceBeforeSha256',
  'reconciliation.sourceAfterSha256',
  'reconciliation.targetAfterSha256',
  'reconciliation.tableRowCounts',
  'reconciliation.keyAmounts',
  'reconciliation.keyAmounts.currency',
  'reconciliation.keyAmounts.customerPayments',
  'reconciliation.keyAmounts.internalPayables',
  'reconciliation.keyAmounts.salesProfit',
  'reconciliation.keyAmounts.points',
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

const artifactFields = [
  'status',
  'path',
  'sha256',
  'bytes',
  'contentType',
  'format',
  'tool',
  'toolVersion',
  'createdAt',
  'encrypted',
  'encryptionKeyReference',
]

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
  package: [
    'packageId', 'createdAt', 'sourceEnvironment', 'sourceProjectRef', 'gitCommit',
    'sourceSnapshotAt', 'freezeStartedAt', 'freezeEndedAt', 'encrypted',
    'encryptionKeyReference', 'retentionUntil',
  ],
  database: [
    'rolesDump', 'schemaDump', 'dataDump', 'migrationHistorySchemaDump',
    'migrationHistoryDataDump', 'authStorageSchemaDiff', 'schemaInventory',
  ],
  'database.rolesDump': artifactFields,
  'database.schemaDump': artifactFields,
  'database.dataDump': artifactFields,
  'database.migrationHistorySchemaDump': artifactFields,
  'database.migrationHistoryDataDump': artifactFields,
  'database.authStorageSchemaDiff': artifactFields,
  'database.schemaInventory': artifactFields,
  auth: ['recoveryScope', 'identitiesDump', 'identityRoleMapping', 'settingsManifest', 'counts'],
  'auth.recoveryScope': [
    'managedAuthSchemaDataIncluded', 'passwordHashesIncluded', 'sessionsRestored',
    'sourceJwtSecretCopied',
  ],
  'auth.identitiesDump': artifactFields,
  'auth.identityRoleMapping': artifactFields,
  'auth.settingsManifest': artifactFields,
  'auth.counts': [
    'authUsers', 'authIdentities', 'profiles', 'roleAssignments',
    'orphanProfiles', 'orphanRoleAssignments',
  ],
  storage: ['bucketsManifest', 'objectsManifest', 'objectsArchive', 'counts'],
  'storage.bucketsManifest': artifactFields,
  'storage.objectsManifest': artifactFields,
  'storage.objectsArchive': artifactFields,
  'storage.counts': ['buckets', 'objects', 'bytes'],
  functions: ['restoreSafety', 'manifest', 'sourceArchive', 'count'],
  'functions.restoreSafety': ['deployEnabled', 'externalDeliveryEnabled', 'secretValuesIncluded'],
  'functions.manifest': artifactFields,
  'functions.sourceArchive': artifactFields,
  cron: ['restoreSafety', 'manifest', 'count', 'timezone'],
  'cron.restoreSafety': ['enabled', 'cursorIncluded', 'backfillConfigIncluded'],
  'cron.manifest': artifactFields,
  featureFlags: ['manifest', 'count'],
  'featureFlags.manifest': artifactFields,
  environment: ['variableNames', 'valuesIncluded'],
  release: ['gitCommit', 'frontendArtifact', 'buildToolVersion'],
  'release.frontendArtifact': artifactFields,
  reconciliation: [
    'asOf', 'querySha256', 'decimalPrecision', 'sourceBeforeSha256',
    'sourceAfterSha256', 'targetAfterSha256', 'tableRowCounts', 'keyAmounts', 'inventory',
  ],
  'reconciliation.tableRowCounts': artifactFields,
  'reconciliation.keyAmounts': [
    ...artifactFields,
    'currency',
    'customerPayments',
    'internalPayables',
    'salesProfit',
    'points',
    'laborEarnings',
  ],
  'reconciliation.inventory': [...artifactFields, 'onHand', 'reserved', 'shipped'],
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

check('schemaVersion is 2', manifest.schemaVersion === 2)
check('manifestType is correct', manifest.manifestType === 'canwin-team-os-backup-restore')
check('file is explicitly a template', manifest.template === true)
check('source environment is production', manifest.package?.sourceEnvironment === 'production')
check('backup package is encrypted', manifest.package?.encrypted === true)
check('managed Auth schema data is included', manifest.auth?.recoveryScope?.managedAuthSchemaDataIncluded === true)
check('Auth password hashes are included for G0 recovery', manifest.auth?.recoveryScope?.passwordHashesIncluded === true)
check('Auth sessions are not restored', manifest.auth?.recoveryScope?.sessionsRestored === false)
check('source JWT secret is not copied', manifest.auth?.recoveryScope?.sourceJwtSecretCopied === false)
check('environment values are excluded', manifest.environment?.valuesIncluded === false)
check('cron timezone is Asia/Shanghai', manifest.cron?.timezone === 'Asia/Shanghai')
check('Functions deploy stays disabled in restored target', manifest.functions?.restoreSafety?.deployEnabled === false)
check('Functions external delivery stays disabled', manifest.functions?.restoreSafety?.externalDeliveryEnabled === false)
check('Function secret values are excluded', manifest.functions?.restoreSafety?.secretValuesIncluded === false)
check('Cron stays disabled in restored target', manifest.cron?.restoreSafety?.enabled === false)
check('Cron cursor is included', manifest.cron?.restoreSafety?.cursorIncluded === true)
check('Cron backfill configuration is included', manifest.cron?.restoreSafety?.backfillConfigIncluded === true)
check('reconciliation decimal precision is 2', manifest.reconciliation?.decimalPrecision === 2)
check('key amount currency is CNY', manifest.reconciliation?.keyAmounts?.currency === 'CNY')

const nullPlaceholderPaths = [
  'package.packageId',
  'package.createdAt',
  'package.sourceProjectRef',
  'package.gitCommit',
  'package.sourceSnapshotAt',
  'package.freezeStartedAt',
  'package.freezeEndedAt',
  'package.encryptionKeyReference',
  'package.retentionUntil',
  'database.rolesDump.path',
  'database.rolesDump.sha256',
  'database.rolesDump.format',
  'database.rolesDump.tool',
  'database.rolesDump.toolVersion',
  'database.rolesDump.createdAt',
  'auth.counts.authUsers',
  'auth.counts.authIdentities',
  'auth.counts.profiles',
  'auth.counts.roleAssignments',
  'auth.counts.orphanProfiles',
  'auth.counts.orphanRoleAssignments',
  'storage.counts.buckets',
  'storage.counts.objects',
  'storage.counts.bytes',
  'functions.count',
  'cron.count',
  'featureFlags.count',
  'release.gitCommit',
  'release.buildToolVersion',
  'reconciliation.asOf',
  'reconciliation.querySha256',
  'reconciliation.sourceBeforeSha256',
  'reconciliation.sourceAfterSha256',
  'reconciliation.targetAfterSha256',
  'reconciliation.keyAmounts.customerPayments',
  'reconciliation.keyAmounts.internalPayables',
  'reconciliation.keyAmounts.salesProfit',
  'reconciliation.keyAmounts.points',
  'reconciliation.keyAmounts.laborEarnings',
  'reconciliation.inventory.onHand',
  'reconciliation.inventory.reserved',
  'reconciliation.inventory.shipped',
  'restoreEvidence.startedAt',
  'restoreEvidence.finishedAt',
  'restoreEvidence.evidenceId',
]
for (const path of nullPlaceholderPaths) {
  check('template placeholder is null: ' + path, getPath(path).value === null)
}

const artifactPaths = [
  'database.rolesDump',
  'database.schemaDump',
  'database.dataDump',
  'database.migrationHistorySchemaDump',
  'database.migrationHistoryDataDump',
  'database.authStorageSchemaDiff',
  'database.schemaInventory',
  'auth.identitiesDump',
  'auth.identityRoleMapping',
  'auth.settingsManifest',
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
  for (const field of [
    'path',
    'sha256',
    'bytes',
    'contentType',
    'format',
    'tool',
    'toolVersion',
    'createdAt',
    'encryptionKeyReference',
  ]) {
    check(path + ' ' + field + ' placeholder is null', hasOwn(artifact, field) && artifact[field] === null)
  }
  check(path + ' is marked encrypted', artifact?.encrypted === true)
}

check(
  'database dump and Storage archive are separate objects',
  manifest.database?.dataDump !== manifest.storage?.objectsArchive,
)
check(
  'database and Storage use distinct contract paths',
  artifactPaths.includes('database.dataDump') && artifactPaths.includes('storage.objectsArchive'),
)

const requiredVariableNames = [
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_URL',
  'VITE_EXPECTED_SUPABASE_PROJECT_REF',
  'CANWIN_BUILD_TARGET',
  'WECOM_WEBHOOK_URL',
  'SITE_URL',
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
check('restore target is the isolated test environment', manifest.restoreEvidence?.targetEnvironment === 'isolated-test')
check(
  'restore target ref is the declared isolated project',
  manifest.restoreEvidence?.targetProjectRef === 'adzerzckgxxibadxkhcr',
)
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
      if (sensitiveKeyPattern.test(key) && key !== 'passwordHashesIncluded') {
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
