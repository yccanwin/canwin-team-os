import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEncryptedArtifact, readProtectedKey } from './sealed-recovery-lib.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const productionProjectRef = 'agygfhmkazcbqaqwmljb'
const isolatedTestProjectRef = 'adzerzckgxxibadxkhcr'
const requiredApplicationPrivateRoutines = [
  'refresh_order_performance_state_core',
  'refresh_performance_after_payment',
  'refresh_performance_after_reversal',
  'refresh_performance_after_cancellation',
]
const forbiddenTableTriggerTogglePattern = /^ALTER TABLE(?: ONLY)? .+ (?:DISABLE|ENABLE) TRIGGER ALL;$/m
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

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/p0/verify-backup-package-runtime.mjs --manifest <path>')
  process.exit(0)
}

const manifestFlag = process.argv.indexOf('--manifest')
const manifestArgument = manifestFlag >= 0 ? process.argv[manifestFlag + 1] : null
if (!manifestArgument) {
  console.error('[p0:backup-runtime] BLOCKED --manifest <path> is required')
  process.exit(1)
}

const manifestPath = resolve(process.cwd(), manifestArgument)
const packageDirectory = dirname(manifestPath)
const checks = []
const check = (label, result) => checks.push({ label, result: Boolean(result) })
const getPath = (source, path) => {
  let value = source
  for (const segment of path.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, segment)) {
      return undefined
    }
    value = value[segment]
  }
  return value
}
const isIso = (value) => {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}
const isSha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const isNonnegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isFiniteNonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0

let raw
let manifest
try {
  raw = readFileSync(manifestPath, 'utf8')
  manifest = JSON.parse(raw)
} catch (error) {
  console.error('[p0:backup-runtime] BLOCKED cannot read manifest: ' + error.message)
  process.exit(1)
}

const repoRelativeManifest = relative(repoRoot, manifestPath)
check(
  'runtime backup manifest is outside the source repository',
  repoRelativeManifest.startsWith('..') || isAbsolute(repoRelativeManifest),
)
check('schemaVersion is 2', manifest.schemaVersion === 2)
check('manifest type is correct', manifest.manifestType === 'canwin-team-os-backup-restore')
check('manifest is a filled runtime instance', manifest.template === false)
check('source environment is production', manifest.package?.sourceEnvironment === 'production')
check('source project is the registered production project', manifest.package?.sourceProjectRef === productionProjectRef)
check('package id is present', typeof manifest.package?.packageId === 'string' && /^[A-Za-z0-9._-]{8,100}$/.test(manifest.package.packageId))
check('package git commit is immutable', typeof manifest.package?.gitCommit === 'string' && /^[a-f0-9]{40}$/.test(manifest.package.gitCommit))
check('package is encrypted', manifest.package?.encrypted === true)
check(
  'package encryption key is an external reference, not a value',
  typeof manifest.package?.encryptionKeyReference === 'string' &&
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[A-Za-z0-9._/@:-]{6,200}$/.test(manifest.package.encryptionKeyReference),
)

for (const path of [
  'package.createdAt',
  'package.sourceSnapshotAt',
  'package.freezeStartedAt',
  'package.freezeEndedAt',
  'package.retentionUntil',
  'reconciliation.asOf',
]) {
  check(path + ' is an exact ISO timestamp', isIso(getPath(manifest, path)))
}
if ([
  manifest.package?.createdAt,
  manifest.package?.sourceSnapshotAt,
  manifest.package?.freezeStartedAt,
  manifest.package?.freezeEndedAt,
  manifest.package?.retentionUntil,
].every(isIso)) {
  const created = Date.parse(manifest.package.createdAt)
  const snapshot = Date.parse(manifest.package.sourceSnapshotAt)
  const freezeStart = Date.parse(manifest.package.freezeStartedAt)
  const freezeEnd = Date.parse(manifest.package.freezeEndedAt)
  const retention = Date.parse(manifest.package.retentionUntil)
  check('snapshot was taken during the verified write freeze', freezeStart <= snapshot && snapshot <= freezeEnd)
  check('package was completed after the write freeze evidence', freezeEnd <= created)
  check('retention extends beyond package creation', retention > created)
}

check('managed Auth data is included', manifest.auth?.recoveryScope?.managedAuthSchemaDataIncluded === true)
check('Auth password hashes are included', manifest.auth?.recoveryScope?.passwordHashesIncluded === true)
check('Auth sessions are excluded', manifest.auth?.recoveryScope?.sessionsRestored === false)
check('production JWT secret is excluded', manifest.auth?.recoveryScope?.sourceJwtSecretCopied === false)
check('environment values are excluded', manifest.environment?.valuesIncluded === false)
check('Functions deployment is disabled', manifest.functions?.restoreSafety?.deployEnabled === false)
check('Functions external delivery is disabled', manifest.functions?.restoreSafety?.externalDeliveryEnabled === false)
check('Function secret values are excluded', manifest.functions?.restoreSafety?.secretValuesIncluded === false)
check('Cron execution is disabled', manifest.cron?.restoreSafety?.enabled === false)
check('Cron cursor is included', manifest.cron?.restoreSafety?.cursorIncluded === true)
check('Cron backfill configuration is included', manifest.cron?.restoreSafety?.backfillConfigIncluded === true)

for (const path of artifactPaths) {
  const artifact = getPath(manifest, path)
  check(path + ' is completed', artifact?.status === 'completed')
  check(path + ' has a relative path', typeof artifact?.path === 'string' && artifact.path.length > 0 && !isAbsolute(artifact.path))
  check(path + ' has SHA256', isSha256(artifact?.sha256))
  check(path + ' has a positive byte count', Number.isSafeInteger(artifact?.bytes) && artifact.bytes > 0)
  check(path + ' has content type', typeof artifact?.contentType === 'string' && artifact.contentType.length > 2)
  check(path + ' has format', typeof artifact?.format === 'string' && artifact.format.length > 0)
  check(path + ' records its tool', typeof artifact?.tool === 'string' && artifact.tool.length > 0)
  check(path + ' records its tool version', typeof artifact?.toolVersion === 'string' && artifact.toolVersion.length > 0)
  check(path + ' has an ISO creation time', isIso(artifact?.createdAt))
  check(path + ' is encrypted', artifact?.encrypted === true)
  check(
    path + ' uses the package encryption key reference',
    artifact?.encryptionKeyReference === manifest.package?.encryptionKeyReference,
  )

  if (typeof artifact?.path !== 'string' || isAbsolute(artifact.path)) continue
  const artifactPath = resolve(packageDirectory, artifact.path)
  const packageRelativeArtifact = relative(packageDirectory, artifactPath)
  const contained = packageRelativeArtifact !== '' &&
    !packageRelativeArtifact.startsWith('..') &&
    !isAbsolute(packageRelativeArtifact)
  check(path + ' stays inside the backup package directory', contained)
  if (!contained) continue
  check(path + ' file exists', existsSync(artifactPath))
  if (!existsSync(artifactPath)) continue
  const stats = statSync(artifactPath)
  check(path + ' path is a regular file', stats.isFile())
  check(path + ' byte count matches the file', stats.size === artifact.bytes)
  if (!stats.isFile()) continue
  const actualSha256 = createHash('sha256').update(readFileSync(artifactPath)).digest('hex')
  check(path + ' SHA256 matches the file', actualSha256 === artifact.sha256)
}

let packageKey = null
let dataDumpsOmitProtectedTriggerToggles = false
let applicationSchemaIsComplete = false
let applicationSchemaInventoryIsSafe = false
let platformDefaultPrivilegeBaselineIsSafe = false
let managedCustomizationDependenciesAreQualified = false
try {
  packageKey = readProtectedKey({
    repoRoot,
    keyPath: resolve('E:\\CanWin-Team-OS-4.0-Recovery-Keys', `${manifest.package?.packageId}.dpapi`),
  })
  const authDump = readEncryptedArtifact({
    packageDirectory,
    artifact: manifest.auth?.identitiesDump,
    key: packageKey,
  }).toString('utf8')
  const publicDataDump = readEncryptedArtifact({
    packageDirectory,
    artifact: manifest.database?.dataDump,
    key: packageKey,
  }).toString('utf8')
  const migrationDataDump = readEncryptedArtifact({
    packageDirectory,
    artifact: manifest.database?.migrationHistoryDataDump,
    key: packageKey,
  }).toString('utf8')
  dataDumpsOmitProtectedTriggerToggles = [authDump, publicDataDump, migrationDataDump]
    .every((sql) => !forbiddenTableTriggerTogglePattern.test(sql))
  const applicationSchemaDump = readEncryptedArtifact({
    packageDirectory,
    artifact: manifest.database?.schemaDump,
    key: packageKey,
  }).toString('utf8')
  applicationSchemaIsComplete =
    (applicationSchemaDump.match(/CREATE SCHEMA sales_os_private;/g) ?? []).length === 1 &&
    requiredApplicationPrivateRoutines.every((name) => applicationSchemaDump.includes(`CREATE FUNCTION sales_os_private.${name}(`)) &&
    !/^CREATE (?:TABLE|SEQUENCE|MATERIALIZED VIEW) sales_os_private\./m.test(applicationSchemaDump) &&
    !/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin /m.test(applicationSchemaDump)
  const schemaInventory = JSON.parse(readEncryptedArtifact({
    packageDirectory,
    artifact: manifest.database?.schemaInventory,
    key: packageKey,
  }).toString('utf8'))
  applicationSchemaInventoryIsSafe =
    Number(schemaInventory.salesOsPrivateDataRelations) === 0 &&
    Number(schemaInventory.salesOsPrivateRoutines) >= requiredApplicationPrivateRoutines.length &&
    Number(schemaInventory.salesOsPrivatePublicTriggerFunctions) === 3
  platformDefaultPrivilegeBaselineIsSafe =
    Number.isSafeInteger(Number(schemaInventory.supabaseAdminPublicDefaultPrivilegeRows)) &&
    Number(schemaInventory.supabaseAdminPublicDefaultPrivilegeRows) > 0 &&
    /^[a-f0-9]{32}$/.test(schemaInventory.supabaseAdminPublicDefaultPrivilegesMd5 ?? '')
  const managedCustomizationSql = readEncryptedArtifact({
    packageDirectory,
    artifact: manifest.database?.authStorageSchemaDiff,
    key: packageKey,
  }).toString('utf8')
  managedCustomizationDependenciesAreQualified =
    managedCustomizationSql.includes('FROM public.profiles') &&
    !managedCustomizationSql.includes('FROM profiles') &&
    managedCustomizationSql.includes('public.has_permission(') &&
    managedCustomizationSql.includes('public.current_profile_role(') &&
    managedCustomizationSql.includes('EXECUTE FUNCTION public.handle_new_user()')
} catch {
  dataDumpsOmitProtectedTriggerToggles = false
  applicationSchemaIsComplete = false
  applicationSchemaInventoryIsSafe = false
  platformDefaultPrivilegeBaselineIsSafe = false
  managedCustomizationDependenciesAreQualified = false
} finally {
  if (packageKey) packageKey.fill(0)
}
check('all data dumps omit protected table trigger toggles', dataDumpsOmitProtectedTriggerToggles)
check('application private schema dump is complete and function-only', applicationSchemaIsComplete)
check('application private schema inventory has no unsealed data relations', applicationSchemaInventoryIsSafe)
check('Supabase platform default privileges are baseline-only and sealed by fingerprint', platformDefaultPrivilegeBaselineIsSafe)
check('managed customization dependencies are schema-qualified', managedCustomizationDependenciesAreQualified)

for (const path of [
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
]) {
  check(path + ' is a nonnegative integer', isNonnegativeInteger(getPath(manifest, path)))
}
for (const path of [
  'reconciliation.keyAmounts.customerPayments',
  'reconciliation.keyAmounts.internalPayables',
  'reconciliation.keyAmounts.salesProfit',
  'reconciliation.keyAmounts.points',
  'reconciliation.keyAmounts.laborEarnings',
]) {
  check(path + ' is a finite number', isFiniteNumber(getPath(manifest, path)))
}
for (const path of [
  'reconciliation.inventory.onHand',
  'reconciliation.inventory.reserved',
  'reconciliation.inventory.shipped',
]) {
  check(path + ' is a finite nonnegative number', isFiniteNonnegative(getPath(manifest, path)))
}

check('reconciliation query is versioned by SHA256', isSha256(manifest.reconciliation?.querySha256))
check('source-before reconciliation has SHA256', isSha256(manifest.reconciliation?.sourceBeforeSha256))
check('source-after reconciliation has SHA256', isSha256(manifest.reconciliation?.sourceAfterSha256))
check('target reconciliation remains pending before restore', manifest.reconciliation?.targetAfterSha256 === null)
check(
  'source did not change during the backup window',
  manifest.reconciliation?.sourceBeforeSha256 === manifest.reconciliation?.sourceAfterSha256,
)
check('reconciliation precision is 2', manifest.reconciliation?.decimalPrecision === 2)
check('reconciliation currency is CNY', manifest.reconciliation?.keyAmounts?.currency === 'CNY')
check('restore evidence remains in the separate restore run', manifest.restoreEvidence?.status === 'not-run')
check('restore target is isolated-test', manifest.restoreEvidence?.targetEnvironment === 'isolated-test')
check('restore target is the registered test project', manifest.restoreEvidence?.targetProjectRef === isolatedTestProjectRef)

const forbiddenLiterals = [
  ['JWT-like value', /eyJhbGciOi[A-Za-z0-9_-]{8,}/],
  ['Supabase secret value', /sb_secret_[A-Za-z0-9_-]{8,}/],
  ['GitHub token value', /(?:ghp_|github_pat_)[A-Za-z0-9_]{8,}/],
  ['OpenAI-style key value', /sk-[A-Za-z0-9_-]{16,}/],
  ['private key material', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['credential-bearing database URL', /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/i],
  ['credential-bearing WeCom URL', /qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=/i],
]
for (const [label, pattern] of forbiddenLiterals) {
  check(label + ' is absent from the runtime manifest', !pattern.test(raw))
}

let passed = 0
for (const item of checks) {
  if (item.result) passed += 1
  else console.error('[p0:backup-runtime] FAIL ' + item.label)
}
console.log(
  '[p0:backup-runtime] artifacts=' + artifactPaths.length +
    ' manifest_sha256=' + createHash('sha256').update(raw).digest('hex'),
)
console.log(
  '[p0:backup-runtime] summary discovered=' + checks.length +
    ' run=' + checks.length + ' passed=' + passed +
    ' failed=' + (checks.length - passed) + ' skipped=0',
)
if (passed !== checks.length) process.exit(1)
