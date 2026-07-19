import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseTemporaryPgEnvironment,
  runPgTool,
  runPsql,
  useSessionPooler,
} from '../p0/temporary-db-access.mjs'
import {
  collectStorageArchive,
  createServerClient,
  getServerKey,
  readEncryptedArtifact,
  readProtectedKey,
  storageSummary,
} from '../p0/sealed-recovery-lib.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const scriptRoot = resolve(repoRoot, 'scripts', 'p1')
const contract = JSON.parse(readFileSync(resolve(scriptRoot, 'isolated-runtime-contract.json'), 'utf8'))
const databaseContract = JSON.parse(readFileSync(resolve(repoRoot, contract.databaseContractPath), 'utf8'))
const migrationManifest = JSON.parse(readFileSync(resolve(repoRoot, contract.migrationManifestPath), 'utf8'))
const restoreRun = JSON.parse(readFileSync(resolve(repoRoot, contract.restoreRunPath), 'utf8'))

const TARGET_REF = 'zdmuaqokndhhbarudhtw'
const PRODUCTION_REF = 'agygfhmkazcbqaqwmljb'
const P1_VERSION = '20260719130910'
const mode = process.argv[2]
const allowedModes = new Set(['--self-test', '--resume-post-apply'])
const fullReconciliationKeys = [
  'schemaVersion', 'publicTables', 'publicTableContentMd5', 'auth', 'storageMetadata',
  'migrationHistory', 'schemaSecurity', 'keyAmounts', 'rawLedgers', 'inventory',
]
const schemaSecurityKeys = [
  'publicColumnsMd5', 'publicConstraintsMd5', 'publicIndexesMd5', 'publicTableAclMd5',
  'publicRoutines', 'publicRoutinesMd5', 'salesOsPrivateSchemaAclMd5',
  'salesOsPrivateDataRelations', 'salesOsPrivateRoutines', 'salesOsPrivateRoutinesMd5',
  'publicPoliciesMd5', 'publicTriggersMd5', 'managedCustomizationsMd5', 'defaultPrivilegesMd5',
]
const authFixtureEmailPatterns = ['p1-%@example.invalid', 'access-%@example.invalid']
const profileFixtureIdPatterns = [
  'd4000000-0000-4000-8000-00000000000%',
  'd5100000-0000-4000-8000-00000000000%',
]

function validateMode(candidateMode) {
  return allowedModes.has(candidateMode)
}

function validateResumeRemoteGate(candidateMode, syncState, resume) {
  return candidateMode === '--resume-post-apply' && syncState === 'synchronized' &&
    resume?.resumeOnly === true && resume?.remoteExecutionAllowed === true &&
    resume?.dbPushAllowed === false && /^[a-f0-9]{40}$/.test(resume?.signedCiHeadSha ?? '')
}

function assertResumeSignedCiQualification() {
  const resumeHead = contract.postApplyResume.signedCiHeadSha
  const signedRun = databaseContract.formalAttemptHistory.find((entry) => (
    entry.headSha === resumeHead && entry.conclusion === 'success' && entry.windowsLocalGatePassed === true &&
    entry.migrationsPassed === contract.expected.postMigrationRows &&
    entry.sqlTestsPassed === contract.expected.tests && entry.catalogAssertionsPassed === 4 &&
    entry.productionReadPerformed === false && entry.productionWritePerformed === false
  ))
  if (!signedRun) throw new Error('post-apply resume independent CI success evidence is missing')
  const head = requireSuccess('git head', run('git', ['rev-parse', 'HEAD'])).stdout.trim()
  requireSuccess('post-apply resume signed CI ancestry', run('git', [
    'merge-base', '--is-ancestor', resumeHead, head,
  ]))
  return signedRun
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sha256Lf(path) {
  return sha256(readFileSync(path, 'utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n'))
}

function redact(value) {
  return String(value ?? '')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, 'postgresql://[REDACTED]')
    .replace(/(PGPASSWORD=)[^\s]+/gi, '$1[REDACTED]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, 'sb_[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    .slice(0, 4000)
}

function run(commandPath, args, { cwd = repoRoot, env = process.env, timeout = 180000 } = {}) {
  return spawnSync(commandPath, args, {
    cwd,
    env: { ...env, SUPABASE_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  })
}

function requireSuccess(label, result) {
  if (result.status === 0 && !result.error) return result
  throw new Error(label + ' failed: ' + redact(result.stderr || result.stdout || result.error?.message))
}

function validateBoundary({ targetRef, linkedRef, workdir, workspaceLinkUsed }) {
  const failures = []
  if (targetRef !== TARGET_REF) failures.push('target ref is not the frozen isolated project')
  if (targetRef === PRODUCTION_REF || linkedRef === PRODUCTION_REF) failures.push('production ref is forbidden')
  if (linkedRef !== TARGET_REF) failures.push('temporary linked ref mismatch')
  if (workspaceLinkUsed) failures.push('workspace linked state must not be used')
  if (!workdir || resolve(workdir) === repoRoot || !resolve(workdir).startsWith(resolve(tmpdir()))) {
    failures.push('workdir is not an independent system temporary directory')
  }
  return failures
}

function requireBoundary(candidate) {
  const failures = validateBoundary(candidate)
  if (failures.length > 0) throw new Error('P1_TARGET_BOUNDARY_REFUSED: ' + failures.join('; '))
}

function signedLocalMigrations() {
  const directory = resolve(repoRoot, 'supabase', 'migrations')
  const files = readdirSync(directory).filter((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file)).sort()
  if (files.length !== contract.expected.postMigrationRows || files.length !== migrationManifest.entries.length) {
    throw new Error('signed local migration file count drift')
  }
  return migrationManifest.entries.map((entry, index) => {
    const file = files[index]
    const version = file.slice(0, 14)
    const hash = sha256Lf(resolve(directory, file))
    const expectedHash = version === P1_VERSION ? contract.candidate.migrationSha256Lf : entry.sha256
    const referenceHashAccepted = version !== P1_VERSION || [
      contract.candidate.migrationSha256Lf,
      contract.referenceSync.previousMigrationSha256Lf,
    ].includes(entry.sha256)
    if (entry.version !== version || entry.file !== file || hash !== expectedHash || !referenceHashAccepted) {
      throw new Error('signed local migration inventory drift at ' + version)
    }
    return { version, status: 'signed', sha256Lf: hash }
  })
}

function referenceSyncState() {
  const manifestEntry = migrationManifest.entries.find((entry) => entry.version === P1_VERSION)
  const p1Test = databaseContract.tests.find((entry) => entry.path === contract.candidate.testPath)
  const synchronized = manifestEntry?.sha256 === contract.candidate.migrationSha256Lf &&
    p1Test?.sha256Lf === contract.candidate.testSha256Lf
  const qaPending = manifestEntry?.sha256 === contract.referenceSync.previousMigrationSha256Lf &&
    p1Test?.sha256Lf === contract.referenceSync.previousTestSha256Lf
  if (synchronized === qaPending) {
    throw new Error('P1 reference sync is mixed, unknown, or ambiguous')
  }
  return synchronized ? 'synchronized' : 'qa-sync-pending'
}

function proveMigrationSets(localMigrations, remoteHistory, expectedPendingVersions) {
  if (!Array.isArray(localMigrations) || !Array.isArray(remoteHistory) || !Array.isArray(expectedPendingVersions)) {
    throw new Error('migration set proof input is invalid')
  }
  const localVersions = localMigrations.map((entry) => entry.version)
  const remoteVersions = remoteHistory.map((entry) => entry.version)
  const uniqueLocal = new Set(localVersions)
  const uniqueRemote = new Set(remoteVersions)
  if (uniqueLocal.size !== localVersions.length || uniqueRemote.size !== remoteVersions.length) {
    throw new Error('migration set contains a duplicate version')
  }
  if (localMigrations.some((entry) => entry.status !== 'signed' || !/^[a-f0-9]{64}$/.test(entry.sha256Lf)) ||
      remoteHistory.some((entry) => entry.status !== 'applied')) {
    throw new Error('migration status proof is not signed/applied')
  }
  if (JSON.stringify([...localVersions].sort()) !== JSON.stringify(localVersions) ||
      JSON.stringify([...remoteVersions].sort()) !== JSON.stringify(remoteVersions)) {
    throw new Error('migration order proof failed')
  }
  const localMinusRemote = localVersions.filter((version) => !uniqueRemote.has(version))
  const remoteMinusLocal = remoteVersions.filter((version) => !uniqueLocal.has(version))
  const commonLocalOrder = localVersions.filter((version) => uniqueRemote.has(version))
  if (JSON.stringify(localMinusRemote) !== JSON.stringify(expectedPendingVersions) ||
      remoteMinusLocal.length !== 0 ||
      JSON.stringify(commonLocalOrder) !== JSON.stringify(remoteVersions)) {
    throw new Error('local/remote migration set difference is not the frozen candidate')
  }
  return {
    localCount: localVersions.length,
    remoteCount: remoteVersions.length,
    commonCount: remoteVersions.length,
    localMinusRemote,
    remoteMinusLocal,
    commonStatus: 'applied',
    orderMatched: true,
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

function parseEvidenceBytes(bytes, expectedSha256, label) {
  if (sha256(bytes) !== expectedSha256) throw new Error(`${label} SHA256 drift`)
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON`)
  }
}

function parseSignedEvidence(path, expectedSha256, label) {
  return parseEvidenceBytes(readFileSync(path), expectedSha256, label)
}

function canonicalSha256(value) {
  return sha256(JSON.stringify(canonicalize(value)))
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expectedKeys].sort())) {
    throw new Error(`${label} key inventory drift`)
  }
}

function selectKeys(value, keys) {
  return Object.fromEntries(keys.map((key) => [key, value[key]]))
}

function signedArtifactInventory(full = contract.fullReconciliation) {
  return {
    tableRowCounts: full.signedArtifacts?.tableRowCounts,
    keyAmounts: full.signedArtifacts?.keyAmounts,
    inventory: full.signedArtifacts?.inventory,
    storageBucketsManifest: full.signedArtifacts?.storageBucketsManifest,
    storageObjectsManifest: full.signedArtifacts?.storageObjectsManifest,
    storageObjectsArchive: full.signedArtifacts?.storageObjectsArchive,
  }
}

function assertSignedArtifact(actual, expected, label, keyReference) {
  assertExactKeys(expected, ['path', 'sha256'], `${label} contract`)
  if (actual?.status !== 'completed' || actual?.path !== expected.path || actual?.sha256 !== expected.sha256 ||
      actual?.encrypted !== true || actual?.encryptionKeyReference !== keyReference ||
      !/^[a-f0-9]{64}$/.test(expected.sha256)) {
    throw new Error(`${label} signed artifact binding drift`)
  }
}

function extractSignedReconciliationBaseline(manifest, restoreEvidence, decryptedKeyAmountsArtifact) {
  const full = contract.fullReconciliation
  const expected = full.expected
  const keyAmountsSource = manifest?.reconciliation?.keyAmounts
  const inventorySource = manifest?.reconciliation?.inventory
  const authCounts = manifest?.auth?.counts
  const storageCounts = manifest?.storage?.counts
  const signedArtifacts = signedArtifactInventory(full)
  const manifestArtifacts = {
    tableRowCounts: manifest?.reconciliation?.tableRowCounts,
    keyAmounts: manifest?.reconciliation?.keyAmounts,
    inventory: manifest?.reconciliation?.inventory,
    storageBucketsManifest: manifest?.storage?.bucketsManifest,
    storageObjectsManifest: manifest?.storage?.objectsManifest,
    storageObjectsArchive: manifest?.storage?.objectsArchive,
  }
  for (const name of Object.keys(signedArtifacts)) {
    assertSignedArtifact(manifestArtifacts[name], signedArtifacts[name], name, full.dpapiKeyReference)
  }
  const storageEvent = restoreEvidence?.events?.find((entry) => entry.stage === 'storage' && entry.status === 'completed')
  const databaseEvent = restoreEvidence?.events?.find((entry) => entry.stage === 'database' && entry.status === 'completed')
  const roleEvent = restoreEvidence?.events?.find((entry) => entry.stage === 'owner-role-overlay' && entry.status === 'completed')
  const finalEvent = restoreEvidence?.events?.find((entry) => entry.stage === 'final-reconciliation' && entry.status === 'completed')
  if (manifest?.package?.packageId !== full.backupPackageId ||
      manifest?.package?.sourceProjectRef !== PRODUCTION_REF ||
      manifest?.reconciliation?.querySha256 !== full.sealedSqlSha256Lf ||
      manifest?.reconciliation?.targetAfterSha256 !== null ||
      keyAmountsSource?.status !== 'completed' || inventorySource?.status !== 'completed' ||
      keyAmountsSource?.path !== full.reconciliationKeyAmountsArtifactPath ||
      keyAmountsSource?.sha256 !== full.reconciliationKeyAmountsArtifactSha256 ||
      keyAmountsSource?.encryptionKeyReference !== full.dpapiKeyReference ||
      manifest?.package?.encryptionKeyReference !== full.dpapiKeyReference ||
      manifest?.auth?.recoveryScope?.sessionsRestored !== false ||
      manifest?.auth?.recoveryScope?.sourceJwtSecretCopied !== false ||
      restoreEvidence?.packageId !== full.backupPackageId || restoreEvidence?.sourceProjectRef !== PRODUCTION_REF ||
      restoreEvidence?.targetProjectRef !== TARGET_REF || restoreEvidence?.status !== 'completed' ||
      restoreEvidence?.attempts !== 1 || restoreEvidence?.noAutomaticRetry !== true ||
      restoreEvidence?.acceptance?.productionWrites !== 0 ||
      restoreEvidence?.acceptance?.targetBaseMatchesSealedSource !== true ||
      restoreEvidence?.acceptance?.authorizedRoleAssignmentsApplied !== expected.auth.authorizedRoleAssignmentsApplied ||
      databaseEvent?.realUsersBanned !== expected.auth.bannedUsers ||
      roleEvent?.decisionsApplied !== expected.auth.authorizedRoleAssignmentsApplied ||
      roleEvent?.productionRoleWrites !== 0 || finalEvent?.authorizedRoleDelta !== expected.auth.authorizedRoleAssignmentsApplied ||
      finalEvent?.bannedUsers !== expected.auth.bannedUsers) {
    throw new Error('signed recovery reconciliation evidence boundary drift')
  }
  const keyAmounts = selectKeys(keyAmountsSource, expected.keyAmountKeys)
  const inventory = selectKeys(inventorySource, expected.inventoryKeys)
  const decryptedKeyAmounts = decryptedKeyAmountsArtifact?.keyAmounts
  const rawLedgers = decryptedKeyAmountsArtifact?.rawLedgers
  assertExactKeys(keyAmounts, expected.keyAmountKeys, 'signed key amounts')
  assertExactKeys(decryptedKeyAmounts, expected.keyAmountKeys, 'decrypted signed key amounts')
  assertExactKeys(inventory, expected.inventoryKeys, 'signed inventory')
  assertExactKeys(rawLedgers, expected.rawLedgerKeys, 'decrypted signed raw ledgers')
  if (expected.keyAmountKeys.filter((key) => key !== 'currency').some((key) => !Number.isFinite(Number(keyAmounts[key]))) ||
      keyAmounts.currency !== 'CNY' ||
      canonicalSha256(decryptedKeyAmounts) !== canonicalSha256(keyAmounts) ||
      expected.inventoryKeys.some((key) => !Number.isFinite(Number(inventory[key]))) ||
      expected.rawLedgerKeys.some((key) => !Number.isFinite(Number(rawLedgers[key]))) ||
      Number(authCounts?.authUsers) !== expected.auth.users ||
      Number(authCounts?.authIdentities) !== expected.auth.identities ||
      Number(authCounts?.profiles) !== expected.auth.profiles ||
      Number(authCounts?.roleAssignments) !== expected.auth.sourceRoleAssignments ||
      Number(authCounts?.orphanProfiles) !== expected.auth.orphanProfiles ||
      Number(authCounts?.orphanRoleAssignments) !== expected.auth.orphanRoleAssignments ||
      Number(storageCounts?.buckets) !== expected.storage.buckets ||
      Number(storageCounts?.objects) !== expected.storage.objects || Number(storageCounts?.bytes) !== expected.storage.bytes ||
      Number(storageEvent?.buckets) !== expected.storage.buckets || Number(storageEvent?.objects) !== expected.storage.objects ||
      Number(storageEvent?.bytes) !== expected.storage.bytes || storageEvent?.aggregateSha256 !== expected.storage.aggregateSha256) {
    throw new Error('signed recovery plaintext totals drift')
  }
  return {
    keyAmounts,
    rawLedgers,
    inventory,
    auth: { ...expected.auth },
    storage: { ...expected.storage },
    keyAmountsSha256: canonicalSha256(keyAmounts),
    rawLedgersSha256: canonicalSha256(rawLedgers),
    inventorySha256: canonicalSha256(inventory),
    signedEvidence: {
      backupPackageManifestSha256: full.backupPackageManifestSha256,
      restoreEvidenceSha256: full.restoreEvidenceSha256,
      sealedSqlSha256Lf: full.sealedSqlSha256Lf,
      artifactSha256: Object.fromEntries(Object.entries(signedArtifacts).map(([name, artifact]) => [name, artifact.sha256])),
      sourceP0CountsOnly: true,
      currentP1ContentFingerprintsRequired: true,
    },
  }
}

function loadSignedReconciliationBaseline() {
  const full = contract.fullReconciliation
  const manifest = parseSignedEvidence(
    full.backupPackageManifestPath,
    full.backupPackageManifestSha256,
    'signed backup package manifest',
  )
  const restoreEvidence = parseSignedEvidence(
    full.restoreEvidencePath,
    full.restoreEvidenceSha256,
    'signed restore reconciliation evidence',
  )
  let key = null
  let plaintext = null
  try {
    key = readProtectedKey({ repoRoot, keyPath: full.dpapiKeyPath })
    plaintext = readEncryptedArtifact({
      packageDirectory: dirname(full.backupPackageManifestPath),
      artifact: manifest.reconciliation.keyAmounts,
      key,
    })
    const decrypted = JSON.parse(plaintext.toString('utf8'))
    return extractSignedReconciliationBaseline(manifest, restoreEvidence, decrypted)
  } catch (error) {
    throw new Error('signed reconciliation artifact could not be verified in memory: ' + redact(error instanceof Error ? error.message : error))
  } finally {
    if (Buffer.isBuffer(plaintext)) plaintext.fill(0)
    if (Buffer.isBuffer(key)) key.fill(0)
  }
}

function loadResumeEvidence() {
  const resume = contract.postApplyResume
  const preflight = parseSignedEvidence(resume.preflightPath, resume.preflightSha256, 'resume source preflight')
  const failure = parseSignedEvidence(resume.failurePath, resume.failureSha256, 'resume source failure')
  if (preflight.runId !== resume.sourceRunId || failure.runId !== resume.sourceRunId ||
      preflight.targetProjectRef !== TARGET_REF || failure.targetProjectRef !== TARGET_REF ||
      preflight.status !== 'ready' || preflight.formalAttemptStarted !== false ||
      failure.status !== 'failed-stop-preserved' || failure.formalAttemptStarted !== true ||
      failure.attempts !== 1 || failure.currentStep !== 'test:database:supabase/tests/access_control_foundation.sql' ||
      failure.retryPerformed !== false || failure.remoteCleanupPerformed !== false ||
      failure.productionReads !== 0 || failure.productionWrites !== 0) {
    throw new Error('resume source evidence boundary drift')
  }
  assertPreflight(preflight.before)
  return { preflight, failure }
}

function assertPostApplyBaseline(sourceBefore, current) {
  const proof = proveMigrationSets(signedLocalMigrations(), current.migrationHistory, [])
  if (!current.reachable || proof.localCount !== contract.expected.postMigrationRows ||
      proof.remoteCount !== contract.expected.postMigrationRows ||
      current.migrationVersions.length !== contract.expected.postMigrationRows || !current.p1MigrationApplied ||
      !current.p1ColumnPresent || Number(current.p1PublicFunctions) !== 6 ||
      Number(current.authUsers) !== Number(sourceBefore.authUsers) || Number(current.p1AuthFixtureUsers) !== 0 ||
      Number(current.authIdentities) !== contract.fullReconciliation.expected.auth.identities ||
      Number(current.bannedAuthUsers) !== contract.fullReconciliation.expected.auth.bannedUsers ||
      Number(current.p1ProfileFixtureRows) !== 0 || Number(current.p1RegionFixtureRows) !== 0 ||
      Number(current.p1RequestFixtureRows) !== 0 || Number(current.idleInTransactionSessions) !== 0 ||
      Number(current.p1FeatureFlags) !== Number(current.teams) || Number(current.teamsMissingP1Flag) !== 0 ||
      Number(current.storageBuckets) !== Number(sourceBefore.storageBuckets) ||
      Number(current.storageObjects) !== Number(sourceBefore.storageObjects)) {
    throw new Error('resume target is not the exact clean post-P1 70-migration baseline')
  }
  const sourceRows = sourceBefore.publicRowCounts
  const currentRows = current.publicRowCounts
  if (JSON.stringify(Object.keys(sourceRows)) !== JSON.stringify(Object.keys(currentRows))) {
    throw new Error('resume public table inventory drift')
  }
  for (const table of Object.keys(sourceRows)) {
    const expected = Number(sourceRows[table]) + (table === 'feature_flags' ? Number(sourceBefore.teamsMissingP1Flag) : 0)
    if (Number(currentRows[table]) !== expected) {
      throw new Error(`resume public row drift for ${table} expected=${expected} actual=${currentRows[table]}`)
    }
  }
  return proof
}

function assertResumeStable(sourceBefore, before, after) {
  assertPostApplyBaseline(sourceBefore, after)
  if (JSON.stringify(canonicalize(after)) !== JSON.stringify(canonicalize(before))) {
    throw new Error('resume verification left a migration, auth, storage, fixture, transaction, or public-row residue')
  }
}

function assertMd5(value, label) {
  if (!/^[a-f0-9]{32}$/.test(String(value ?? ''))) throw new Error(`${label} is not an MD5 content fingerprint`)
}

function assertSealedFullReconciliation(baseline, lightSnapshot, fullSnapshot) {
  const full = contract.fullReconciliation
  assertExactKeys(fullSnapshot, fullReconciliationKeys, 'sealed full reconciliation')
  assertExactKeys(fullSnapshot.publicTables, Object.keys(lightSnapshot.publicRowCounts), 'sealed public tables')
  assertExactKeys(fullSnapshot.publicTableContentMd5, Object.keys(lightSnapshot.publicRowCounts), 'sealed public content')
  assertExactKeys(fullSnapshot.keyAmounts, full.expected.keyAmountKeys, 'sealed key amounts')
  assertExactKeys(fullSnapshot.inventory, full.expected.inventoryKeys, 'sealed inventory')
  assertExactKeys(fullSnapshot.rawLedgers, full.expected.rawLedgerKeys, 'sealed raw ledgers')
  assertExactKeys(fullSnapshot.schemaSecurity, schemaSecurityKeys, 'sealed schema security')
  assertExactKeys(fullSnapshot.auth, [
    'users', 'identities', 'profiles', 'roleAssignments', 'orphanProfiles', 'orphanRoleAssignments',
    'usersContentMd5', 'identitiesContentMd5',
  ], 'sealed auth')
  assertExactKeys(fullSnapshot.storageMetadata, ['buckets', 'objects'], 'sealed Storage metadata')
  assertExactKeys(fullSnapshot.migrationHistory, ['schemaMigrations'], 'sealed migration history')
  if (Number(fullSnapshot.schemaVersion) !== 1 ||
      canonicalSha256(fullSnapshot.publicTables) !== canonicalSha256(lightSnapshot.publicRowCounts) ||
      canonicalSha256(fullSnapshot.keyAmounts) !== baseline.keyAmountsSha256 ||
      canonicalSha256(fullSnapshot.rawLedgers) !== baseline.rawLedgersSha256 ||
      canonicalSha256(fullSnapshot.inventory) !== baseline.inventorySha256 ||
      full.expected.rawLedgerKeys.some((key) => !Number.isFinite(Number(fullSnapshot.rawLedgers[key]))) ||
      Number(fullSnapshot.auth?.users) !== baseline.auth.users ||
      Number(fullSnapshot.auth?.identities) !== baseline.auth.identities ||
      Number(fullSnapshot.auth?.profiles) !== baseline.auth.profiles ||
      Number(fullSnapshot.auth?.roleAssignments) !== baseline.auth.postOverlayRoleAssignments ||
      Number(fullSnapshot.auth?.orphanProfiles) !== baseline.auth.orphanProfiles ||
      Number(fullSnapshot.auth?.orphanRoleAssignments) !== baseline.auth.orphanRoleAssignments ||
      Number(lightSnapshot.authUsers) !== baseline.auth.users ||
      Number(lightSnapshot.authIdentities) !== baseline.auth.identities ||
      Number(lightSnapshot.bannedAuthUsers) !== baseline.auth.bannedUsers ||
      Number(lightSnapshot.publicRowCounts.profile_access_roles) !== baseline.auth.postOverlayRoleAssignments ||
      Number(fullSnapshot.storageMetadata?.buckets) !== baseline.storage.buckets ||
      Number(fullSnapshot.storageMetadata?.objects) !== baseline.storage.objects ||
      Number(fullSnapshot.migrationHistory?.schemaMigrations) !== full.expected.migrationRows ||
      Object.keys(fullSnapshot.publicTables).length !== contract.expected.catalog.publicTables) {
    throw new Error('sealed full reconciliation signed totals drift')
  }
  for (const [table, value] of Object.entries(fullSnapshot.publicTableContentMd5)) assertMd5(value, `public.${table}`)
  assertMd5(fullSnapshot.auth.usersContentMd5, 'auth.users content')
  assertMd5(fullSnapshot.auth.identitiesContentMd5, 'auth.identities content')
  for (const key of schemaSecurityKeys.filter((key) => key.endsWith('Md5'))) {
    assertMd5(fullSnapshot.schemaSecurity[key], `schema security ${key}`)
  }
  for (const key of ['publicRoutines', 'salesOsPrivateDataRelations', 'salesOsPrivateRoutines']) {
    if (!Number.isInteger(Number(fullSnapshot.schemaSecurity[key])) || Number(fullSnapshot.schemaSecurity[key]) < 0) {
      throw new Error(`schema security ${key} count drift`)
    }
  }
  return {
    canonicalSha256: canonicalSha256(fullSnapshot),
    publicTableInventorySha256: canonicalSha256(Object.keys(fullSnapshot.publicTables)),
    publicRowCountsSha256: canonicalSha256(fullSnapshot.publicTables),
    publicTableContentSha256: canonicalSha256(fullSnapshot.publicTableContentMd5),
    authContentSha256: canonicalSha256({
      usersContentMd5: fullSnapshot.auth.usersContentMd5,
      identitiesContentMd5: fullSnapshot.auth.identitiesContentMd5,
    }),
    schemaSecuritySha256: canonicalSha256(fullSnapshot.schemaSecurity),
    keyAmountsSha256: canonicalSha256(fullSnapshot.keyAmounts),
    rawLedgersSha256: canonicalSha256(fullSnapshot.rawLedgers),
    inventorySha256: canonicalSha256(fullSnapshot.inventory),
    publicTables: Object.keys(fullSnapshot.publicTables).length,
    authUsers: Number(fullSnapshot.auth.users),
    authIdentities: Number(fullSnapshot.auth.identities),
    profiles: Number(fullSnapshot.auth.profiles),
    roleAssignments: Number(fullSnapshot.auth.roleAssignments),
    bannedUsers: Number(lightSnapshot.bannedAuthUsers),
    storageBuckets: Number(fullSnapshot.storageMetadata.buckets),
    storageObjects: Number(fullSnapshot.storageMetadata.objects),
    migrationRows: Number(fullSnapshot.migrationHistory.schemaMigrations),
  }
}

function assertFullReconciliationStable(beforeSummary, afterSummary) {
  if (afterSummary.canonicalSha256 !== beforeSummary.canonicalSha256) {
    throw new Error('sealed full reconciliation canonical content drift')
  }
}

function assertSignedStorageSummary(baseline, summary) {
  assertExactKeys(summary, ['buckets', 'objects', 'bytes', 'aggregateSha256'], 'Storage archive summary')
  if (Number(summary.buckets) !== baseline.storage.buckets || Number(summary.objects) !== baseline.storage.objects ||
      Number(summary.bytes) !== baseline.storage.bytes || summary.aggregateSha256 !== baseline.storage.aggregateSha256) {
    throw new Error('Storage archive content drift')
  }
  return { ...summary, canonicalSha256: canonicalSha256(summary) }
}

function assertFrozenContract() {
  if (!validateMode(mode)) throw new Error('usage: --self-test or --resume-post-apply')
  if (contract.target?.projectRef !== TARGET_REF || contract.forbiddenProductionProjectRef !== PRODUCTION_REF ||
      contract.candidate?.migrationVersion !== P1_VERSION) {
    throw new Error('P1 isolated runtime contract ref/version drift')
  }
  const resumeCiQualificationConsistent = contract.postApplyResume?.remoteExecutionAllowed === false
    ? contract.postApplyResume?.signedCiHeadSha === null
    : /^[a-f0-9]{40}$/.test(contract.postApplyResume?.signedCiHeadSha ?? '')
  if (contract.candidate.remoteExecutionAllowed !== false || contract.postApplyResume?.resumeOnly !== true ||
      typeof contract.postApplyResume?.remoteExecutionAllowed !== 'boolean' ||
      contract.postApplyResume?.mode !== '--resume-post-apply' || contract.postApplyResume?.dbPushAllowed !== false ||
      contract.postApplyResume?.expectedPersistentRemoteWrites !== 0 ||
      contract.postApplyResume?.perTestSnapshotRequired !== true || !resumeCiQualificationConsistent) {
    throw new Error('P1 post-apply resume candidate must remain offline, resume-only and zero-persistent-write')
  }
  if (restoreRun.target?.projectRef !== TARGET_REF || restoreRun.source?.projectRef !== PRODUCTION_REF ||
      restoreRun.target?.environment !== 'isolated-test' || restoreRun.target?.previewBuildAllowed !== false ||
      restoreRun.state !== 'succeeded') {
    throw new Error('accepted isolated restore contract is unavailable')
  }
  const full = contract.fullReconciliation
  const allowedDifferences = [
    {
      table: 'profile_access_roles',
      effect: 'authorized-role-overlay-plus-assignment-kind-backfill',
      rowDeltaFromSignedManifest: 2,
    },
    {
      table: 'feature_flags',
      effect: 'one-team-os-4-supervisor-row-per-missing-team',
      rowDeltaFromSignedPreflight: 1,
    },
  ]
  const expectedSignedArtifacts = {
    tableRowCounts: {
      path: 'artifacts/reconciliation-table-row-counts.json.enc',
      sha256: 'a265e0f91466b66f0c73b29a830946255c432a281b353d4a6d5e8b42ef3f5383',
    },
    keyAmounts: {
      path: 'artifacts/reconciliation-key-amounts.json.enc',
      sha256: '3aa6776edfd889e45ce8de518e1138d7dbb40ef6e96378ce424ffc64f09a50a9',
    },
    inventory: {
      path: 'artifacts/reconciliation-inventory.json.enc',
      sha256: '9632ed09ffd2fa7e385f3f17820ac1f1444258470d9a55dfbd8b75138e2346f6',
    },
    storageBucketsManifest: {
      path: 'artifacts/storage-buckets.json.enc',
      sha256: 'bbaa045db117922054e9b0a671561b434a9344303abcddffec86492cf55bd172',
    },
    storageObjectsManifest: {
      path: 'artifacts/storage-objects.json.enc',
      sha256: 'a2e3310005a67b9ea473b0054f28e44898c79d01524c0df60271dc969e2bfff8',
    },
    storageObjectsArchive: {
      path: 'artifacts/storage-objects-archive.json.enc',
      sha256: 'daa9262cd9d1bb84772610219db2e849ace6cb0d3afdd153ac37d3d0216e7e0a',
    },
  }
  if (!full || resolve(full.backupPackageManifestPath) !== resolve(restoreRun.artifacts?.backupPackageManifest ?? '') ||
      full.backupPackageManifestSha256 !== restoreRun.artifacts?.backupPackageManifestSha256 ||
      resolve(full.restoreEvidencePath) !== resolve(restoreRun.steps?.reconciliation?.logPath ?? '') ||
      full.restoreEvidenceSha256 !== restoreRun.steps?.reconciliation?.logSha256 ||
      full.sealedSqlPath !== 'scripts/p0/sealed-reconciliation.sql' ||
      sha256Lf(resolve(repoRoot, full.sealedSqlPath)) !== full.sealedSqlSha256Lf ||
      full.sealedSqlSha256Lf !== 'ff1d1e457e5427eb6f0a911df275057b86da93eae6c3ea2528cd00457273595e' ||
      full.reconciliationKeyAmountsArtifactPath !== 'artifacts/reconciliation-key-amounts.json.enc' ||
      !/^[a-f0-9]{64}$/.test(full.reconciliationKeyAmountsArtifactSha256 ?? '') ||
      JSON.stringify(signedArtifactInventory(full)) !== JSON.stringify(expectedSignedArtifacts) ||
      full.reconciliationKeyAmountsArtifactPath !== full.signedArtifacts?.keyAmounts?.path ||
      full.reconciliationKeyAmountsArtifactSha256 !== full.signedArtifacts?.keyAmounts?.sha256 ||
      full.dpapiKeyReference !== `dpapi-file:///E:/CanWin-Team-OS-4.0-Recovery-Keys/${full.backupPackageId}.dpapi` ||
      resolve(full.dpapiKeyPath) !== resolve(`E:/CanWin-Team-OS-4.0-Recovery-Keys/${full.backupPackageId}.dpapi`) ||
      full.expected?.auth?.sourceRoleAssignments + full.expected?.auth?.authorizedRoleAssignmentsApplied !==
        full.expected?.auth?.postOverlayRoleAssignments ||
      full.expected?.migrationRows !== contract.expected.postMigrationRows ||
      JSON.stringify(full.expected?.keyAmountKeys) !== JSON.stringify(['currency', 'customerPayments', 'internalPayables', 'salesProfit', 'points', 'laborEarnings']) ||
      JSON.stringify(full.expected?.inventoryKeys) !== JSON.stringify(['onHand', 'reserved', 'shipped']) ||
      JSON.stringify(full.expected?.rawLedgerKeys) !== JSON.stringify(['customerPaymentGross', 'customerPaymentReversals', 'internalDue', 'internalPaid', 'internalSettlements', 'procurementPayments', 'salesExpenses', 'quarterlyRebates', 'companyExpenses']) ||
      full.execution?.initialFullAfterLightSnapshot !== true || full.execution?.fullAfterEverySqlTest !== true ||
      full.execution?.perTestFullSnapshots !== contract.expected.tests ||
      full.execution?.finalFullAfterFreshCredential !== true ||
      full.execution?.beforeAfterCanonicalShaMustMatch !== true ||
      full.execution?.storageArchiveAtInitialAndFinal !== true ||
      full.execution?.temporarySessionOnly !== true || full.execution?.persistentDatabaseWrites !== false ||
      full.execution?.sessionClosedDropsTemp !== true ||
      JSON.stringify(full.allowedPersistentContentDifferencesFromSealedSource) !== JSON.stringify(allowedDifferences) ||
      full.expectedSchemaAndHistoryDifference !== 'exact-signed-P1-migration-only' ||
      full.unknownDifferencesAllowed !== false || full.evidenceMode !== 'summary-hash-counts-only' ||
      full.sourceArtifactBoundary?.signedP0TableRowCountsAreCountsOnly !== true ||
      full.sourceArtifactBoundary?.signedP0TargetAfterSha256IsNull !== true ||
      full.sourceArtifactBoundary?.p1InitialAndFinalContentFingerprintsRequired !== true) {
    throw new Error('sealed full reconciliation contract drift')
  }
  if (databaseContract.expectedCounts?.total !== contract.expected.tests ||
      databaseContract.expectedCounts?.database !== contract.expected.databaseTests ||
      databaseContract.expectedCounts?.permission !== contract.expected.permissionTests ||
      databaseContract.expectedCounts?.business !== contract.expected.businessTests ||
      databaseContract.acceptanceBoundary?.p1ActualGithubRunEvidence !== 'passed') {
    throw new Error('CI database acceptance contract is not the signed P1 candidate')
  }
  const migrationPath = resolve(repoRoot, contract.candidate.migrationPath)
  const testPath = resolve(repoRoot, contract.candidate.testPath)
  const resumeTestPath = resolve(repoRoot, contract.postApplyResume.accessControlTestPath)
  if (sha256Lf(migrationPath) !== contract.candidate.migrationSha256Lf ||
      sha256Lf(testPath) !== contract.candidate.testSha256Lf ||
      sha256Lf(resumeTestPath) !== contract.postApplyResume.accessControlTestSha256Lf) {
    throw new Error('P1 candidate hash drift')
  }
  if (migrationManifest.entries.length !== contract.expected.postMigrationRows ||
      migrationManifest.entries.at(-1)?.version !== P1_VERSION) {
    throw new Error('P1 migration manifest is not an exact 69+1 chain')
  }
  signedLocalMigrations()
  const p1Test = databaseContract.tests.find((entry) => entry.path === contract.candidate.testPath)
  const accessControlTest = databaseContract.tests.find((entry) => entry.path === contract.postApplyResume.accessControlTestPath)
  if (databaseContract.tests.length !== contract.expected.tests ||
      p1Test?.category !== 'permission' || accessControlTest?.category !== 'database' ||
      accessControlTest?.executionMode !== 'rollback_fixture' ||
      accessControlTest?.sha256Lf !== contract.postApplyResume.accessControlTestSha256Lf) {
    throw new Error('P1 test inventory drift')
  }
  const syncState = referenceSyncState()
  const signedCiRun = databaseContract.formalAttemptHistory.find((entry) => (
    entry.headSha === contract.candidate.signedCiHeadSha && entry.conclusion === 'success' &&
    entry.migrationsPassed === contract.expected.postMigrationRows &&
    entry.sqlTestsPassed === contract.expected.tests && entry.catalogAssertionsPassed === 4
  ))
  if (!signedCiRun) throw new Error('signed P1 CI success evidence is missing')
  const head = requireSuccess('git head', run('git', ['rev-parse', 'HEAD'])).stdout.trim()
  requireSuccess('signed CI ancestry', run('git', [
    'merge-base', '--is-ancestor', contract.candidate.signedCiHeadSha, head,
  ]))
  requireSuccess('supervision evidence ancestry', run('git', [
    'merge-base', '--is-ancestor', contract.candidate.requiredAncestorSha, head,
  ]))
  return syncState
}

function runSelfTest() {
  assertFrozenContract()
  const temp = resolve(tmpdir(), 'canwin-p1-self-test')
  const positive = validateBoundary({ targetRef: TARGET_REF, linkedRef: TARGET_REF, workdir: temp, workspaceLinkUsed: false })
  const negativeCases = [
    { targetRef: 'wrongprojectref00000000', linkedRef: 'wrongprojectref00000000', workdir: temp, workspaceLinkUsed: false },
    { targetRef: PRODUCTION_REF, linkedRef: PRODUCTION_REF, workdir: temp, workspaceLinkUsed: false },
    { targetRef: TARGET_REF, linkedRef: PRODUCTION_REF, workdir: repoRoot, workspaceLinkUsed: true },
  ]
  const negativePassed = negativeCases.filter((candidate) => validateBoundary(candidate).length > 0).length
  const local = signedLocalMigrations()
  const remote = local.slice(0, -1).map((entry) => ({ version: entry.version, status: 'applied' }))
  proveMigrationSets(local, remote, [P1_VERSION])
  const migrationNegativeCases = [
    () => proveMigrationSets(local.slice(0, -1), remote, [P1_VERSION]),
    () => proveMigrationSets([...local, { version: '20990101000000', status: 'signed', sha256Lf: 'a'.repeat(64) }], remote, [P1_VERSION]),
    () => proveMigrationSets(local, remote.slice(0, -1), [P1_VERSION]),
    () => proveMigrationSets(local, [...remote, { version: '20990101000000', status: 'applied' }], [P1_VERSION]),
    () => proveMigrationSets(local, [...remote].reverse(), [P1_VERSION]),
    () => proveMigrationSets(local, remote.map((entry, index) => index === 0 ? { ...entry, status: 'pending' } : entry), [P1_VERSION]),
  ]
  let migrationNegativePassed = 0
  for (const test of migrationNegativeCases) {
    try { test() } catch { migrationNegativePassed += 1 }
  }
  if (positive.length !== 0 || negativePassed !== negativeCases.length ||
      migrationNegativePassed !== migrationNegativeCases.length) {
    throw new Error('P1 runner negative self-test failed')
  }
  const fakeEnvironment = (suffix) => ({
    PGHOST: 'pooler-' + suffix,
    PGPORT: '5432',
    PGUSER: 'user-' + suffix,
    PGPASSWORD: 'password-' + suffix,
    PGDATABASE: 'postgres',
  })
  const positiveCredentialChannel = {
    workdir: temp, cliPath: 'supabase', dbEnvironment: fakeEnvironment('old'), credentialGeneration: 1,
  }
  const positiveGeneration = rotateTemporaryCredential(positiveCredentialChannel, () => fakeEnvironment('new'))
  if (positiveGeneration !== 2) throw new Error('fresh credential generation positive test failed')
  requireFreshCredentialGeneration(positiveCredentialChannel, 1)
  clearDbEnvironment(positiveCredentialChannel.dbEnvironment)
  const credentialNegativeCases = [
    () => {
      const old = fakeEnvironment('reuse')
      rotateTemporaryCredential({ workdir: temp, cliPath: 'supabase', dbEnvironment: old, credentialGeneration: 1 }, () => old)
    },
    () => rotateTemporaryCredential({
      workdir: temp, cliPath: 'supabase', dbEnvironment: fakeEnvironment('failure'), credentialGeneration: 1,
    }, () => { throw new Error('synthetic acquisition failure') }),
    () => requireFreshCredentialGeneration({
      dbEnvironment: fakeEnvironment('stale'), credentialGeneration: 1,
    }, 1),
  ]
  let credentialNegativePassed = 0
  for (const test of credentialNegativeCases) {
    try { test() } catch { credentialNegativePassed += 1 }
  }
  if (credentialNegativePassed !== credentialNegativeCases.length) {
    throw new Error('P1 credential rotation negative self-test failed')
  }

  const sourceBefore = {
    reachable: true,
    migrationVersions: remote.map((entry) => entry.version),
    migrationHistory: remote,
    p1MigrationApplied: false,
    p1ColumnPresent: false,
    p1PublicFunctions: 0,
    authUsers: contract.expected.authUsers,
    authIdentities: contract.fullReconciliation.expected.auth.identities,
    bannedAuthUsers: contract.fullReconciliation.expected.auth.bannedUsers,
    p1AuthFixtureUsers: 0,
    p1ProfileFixtureRows: 0,
    p1RegionFixtureRows: 0,
    p1RequestFixtureRows: 0,
    idleInTransactionSessions: 0,
    teams: 1,
    p1FeatureFlags: 0,
    teamsMissingP1Flag: 1,
    storageBuckets: 1,
    storageObjects: 32,
    publicRowCounts: { feature_flags: 1, profile_access_roles: 10, profiles: 7, teams: 1 },
  }
  const postHistory = local.map((entry) => ({ version: entry.version, status: 'applied' }))
  const cleanPostApply = {
    ...sourceBefore,
    migrationVersions: postHistory.map((entry) => entry.version),
    migrationHistory: postHistory,
    p1MigrationApplied: true,
    p1ColumnPresent: true,
    p1PublicFunctions: 6,
    p1FeatureFlags: 1,
    teamsMissingP1Flag: 0,
    publicRowCounts: { feature_flags: 2, profile_access_roles: 10, profiles: 7, teams: 1 },
  }
  assertPreflight(sourceBefore)
  assertPostApplyBaseline(sourceBefore, cleanPostApply)
  assertResumeStable(sourceBefore, cleanPostApply, JSON.parse(JSON.stringify(cleanPostApply)))
  const resumeNegativeCases = [
    () => assertPostApplyBaseline(sourceBefore, sourceBefore),
    () => assertPostApplyBaseline(sourceBefore, {
      ...cleanPostApply,
      publicRowCounts: { ...cleanPostApply.publicRowCounts, profiles: 8 },
    }),
    () => assertResumeStable(sourceBefore, cleanPostApply, {
      ...cleanPostApply,
      authUsers: cleanPostApply.authUsers + 1,
    }),
  ]
  let resumeNegativePassed = 0
  for (const test of resumeNegativeCases) {
    try { test() } catch { resumeNegativePassed += 1 }
  }

  const artifact = (name) => ({
    status: 'completed',
    ...contract.fullReconciliation.signedArtifacts[name],
    encrypted: true,
    encryptionKeyReference: contract.fullReconciliation.dpapiKeyReference,
  })
  const syntheticKeyAmounts = {
    currency: 'CNY',
    customerPayments: 500,
    internalPayables: 1116.5,
    salesProfit: 500,
    points: 0,
    laborEarnings: 13498,
  }
  const syntheticInventory = { onHand: 0, reserved: 0, shipped: 0 }
  const syntheticRawLedgers = {
    customerPaymentGross: 500,
    customerPaymentReversals: 0,
    internalDue: 1116.5,
    internalPaid: 0,
    internalSettlements: 0,
    procurementPayments: 0,
    salesExpenses: 0,
    quarterlyRebates: 0,
    companyExpenses: 0,
  }
  const syntheticManifest = {
    package: {
      packageId: contract.fullReconciliation.backupPackageId,
      sourceProjectRef: PRODUCTION_REF,
      encryptionKeyReference: contract.fullReconciliation.dpapiKeyReference,
    },
    reconciliation: {
      querySha256: contract.fullReconciliation.sealedSqlSha256Lf,
      targetAfterSha256: null,
      tableRowCounts: artifact('tableRowCounts'),
      keyAmounts: { ...artifact('keyAmounts'), ...syntheticKeyAmounts },
      inventory: { ...artifact('inventory'), ...syntheticInventory },
    },
    auth: {
      counts: {
        authUsers: 7,
        authIdentities: 7,
        profiles: 7,
        roleAssignments: 8,
        orphanProfiles: 0,
        orphanRoleAssignments: 0,
      },
      recoveryScope: { sessionsRestored: false, sourceJwtSecretCopied: false },
    },
    storage: {
      counts: { buckets: 1, objects: 32, bytes: 1700978 },
      bucketsManifest: artifact('storageBucketsManifest'),
      objectsManifest: artifact('storageObjectsManifest'),
      objectsArchive: artifact('storageObjectsArchive'),
    },
  }
  const syntheticRestoreEvidence = {
    packageId: contract.fullReconciliation.backupPackageId,
    sourceProjectRef: PRODUCTION_REF,
    targetProjectRef: TARGET_REF,
    status: 'completed',
    attempts: 1,
    noAutomaticRetry: true,
    acceptance: {
      productionWrites: 0,
      targetBaseMatchesSealedSource: true,
      authorizedRoleAssignmentsApplied: 2,
    },
    events: [
      { stage: 'database', status: 'completed', realUsersBanned: 7 },
      { stage: 'owner-role-overlay', status: 'completed', decisionsApplied: 2, productionRoleWrites: 0 },
      {
        stage: 'storage', status: 'completed', buckets: 1, objects: 32, bytes: 1700978,
        aggregateSha256: contract.fullReconciliation.expected.storage.aggregateSha256,
      },
      { stage: 'final-reconciliation', status: 'completed', authorizedRoleDelta: 2, bannedUsers: 7 },
    ],
  }
  const baseline = extractSignedReconciliationBaseline(
    syntheticManifest,
    syntheticRestoreEvidence,
    { keyAmounts: syntheticKeyAmounts, rawLedgers: syntheticRawLedgers },
  )
  const syntheticPublicRows = { ...cleanPostApply.publicRowCounts }
  for (let index = 0; index < 99; index += 1) syntheticPublicRows[`synthetic_table_${String(index).padStart(3, '0')}`] = 0
  const syntheticLightSnapshot = { ...cleanPostApply, publicRowCounts: syntheticPublicRows }
  const syntheticSchemaSecurity = Object.fromEntries(schemaSecurityKeys.map((key) => [
    key,
    key.endsWith('Md5') ? 'a'.repeat(32) : 0,
  ]))
  const syntheticFullSnapshot = {
    schemaVersion: 1,
    publicTables: syntheticPublicRows,
    publicTableContentMd5: Object.fromEntries(Object.keys(syntheticPublicRows).map((table) => [table, 'a'.repeat(32)])),
    auth: {
      users: 7,
      identities: 7,
      profiles: 7,
      roleAssignments: 10,
      orphanProfiles: 0,
      orphanRoleAssignments: 0,
      usersContentMd5: 'a'.repeat(32),
      identitiesContentMd5: 'a'.repeat(32),
    },
    storageMetadata: { buckets: 1, objects: 32 },
    migrationHistory: { schemaMigrations: 70 },
    schemaSecurity: syntheticSchemaSecurity,
    keyAmounts: syntheticKeyAmounts,
    rawLedgers: syntheticRawLedgers,
    inventory: syntheticInventory,
  }
  const syntheticFullSummary = assertSealedFullReconciliation(baseline, syntheticLightSnapshot, syntheticFullSnapshot)
  assertFullReconciliationStable(syntheticFullSummary, { ...syntheticFullSummary })
  assertSignedStorageSummary(baseline, contract.fullReconciliation.expected.storage)
  const reconciliationNegativeCases = [
    () => assertSealedFullReconciliation(baseline, syntheticLightSnapshot, {
      ...syntheticFullSnapshot,
      keyAmounts: { ...syntheticKeyAmounts, customerPayments: 501 },
    }),
    () => assertSealedFullReconciliation(baseline, syntheticLightSnapshot, {
      ...syntheticFullSnapshot,
      inventory: { ...syntheticInventory, onHand: 1 },
    }),
    () => assertSealedFullReconciliation(baseline, syntheticLightSnapshot, {
      ...syntheticFullSnapshot,
      rawLedgers: { ...syntheticRawLedgers, companyExpenses: 1 },
    }),
    () => {
      const changed = {
        ...syntheticFullSnapshot,
        publicTableContentMd5: { ...syntheticFullSnapshot.publicTableContentMd5, feature_flags: 'b'.repeat(32) },
      }
      assertFullReconciliationStable(
        syntheticFullSummary,
        assertSealedFullReconciliation(baseline, syntheticLightSnapshot, changed),
      )
    },
    () => extractSignedReconciliationBaseline({
      ...syntheticManifest,
      reconciliation: {
        ...syntheticManifest.reconciliation,
        tableRowCounts: { ...syntheticManifest.reconciliation.tableRowCounts, sha256: '0'.repeat(64) },
      },
    }, syntheticRestoreEvidence, { keyAmounts: syntheticKeyAmounts, rawLedgers: syntheticRawLedgers }),
    () => extractSignedReconciliationBaseline(
      syntheticManifest,
      { ...syntheticRestoreEvidence, status: 'succeeded' },
      { keyAmounts: syntheticKeyAmounts, rawLedgers: syntheticRawLedgers },
    ),
    () => assertSignedStorageSummary(baseline, {
      ...contract.fullReconciliation.expected.storage,
      bytes: contract.fullReconciliation.expected.storage.bytes + 1,
    }),
  ]
  let reconciliationNegativePassed = 0
  for (const test of reconciliationNegativeCases) {
    try { test() } catch { reconciliationNegativePassed += 1 }
  }

  const evidenceBytes = Buffer.from(JSON.stringify({ runId: 'synthetic-resume-evidence' }), 'utf8')
  parseEvidenceBytes(evidenceBytes, sha256(evidenceBytes), 'synthetic evidence')
  const syntheticManifestBytes = Buffer.from(JSON.stringify(syntheticManifest), 'utf8')
  const syntheticRestoreEvidenceBytes = Buffer.from(JSON.stringify(syntheticRestoreEvidence), 'utf8')
  const evidenceNegativeCases = [
    () => parseEvidenceBytes(evidenceBytes, '0'.repeat(64), 'synthetic evidence'),
    () => parseEvidenceBytes(Buffer.from('{', 'utf8'), sha256(Buffer.from('{', 'utf8')), 'synthetic evidence'),
    () => safeEvidence({ marker: 'PGPASSWORD=must-not-survive' }),
    () => parseEvidenceBytes(syntheticManifestBytes, '0'.repeat(64), 'synthetic manifest'),
    () => parseEvidenceBytes(syntheticRestoreEvidenceBytes, '0'.repeat(64), 'synthetic restore evidence'),
  ]
  let evidenceNegativePassed = 0
  for (const test of evidenceNegativeCases) {
    try { test() } catch { evidenceNegativePassed += 1 }
  }

  const oldModesDenied = ['--execute', '--dry-run'].filter((candidateMode) => !validateMode(candidateMode)).length
  const qualifiedResume = {
    ...contract.postApplyResume,
    remoteExecutionAllowed: true,
    signedCiHeadSha: 'a'.repeat(40),
  }
  const resumeGateNegativeCases = [
    () => validateResumeRemoteGate('--resume-post-apply', 'synchronized', contract.postApplyResume),
    () => validateResumeRemoteGate('--resume-post-apply', 'qa-sync-pending', qualifiedResume),
    () => validateResumeRemoteGate('--execute', 'synchronized', qualifiedResume),
  ]
  const resumeGateNegativePassed = resumeGateNegativeCases.filter((test) => test() === false).length
  if (!validateResumeRemoteGate('--resume-post-apply', 'synchronized', qualifiedResume)) {
    throw new Error('qualified post-apply resume gate positive self-test failed')
  }

  let followingSyntheticTestRan = false
  let syntheticFailureStopped = false
  try {
    for (const syntheticResult of [
      { status: 1, error: null, stdout: '', stderr: 'synthetic first SQL failure' },
      { status: 0, error: null, stdout: 'must not run', stderr: '' },
    ]) {
      requireSuccess('synthetic SQL test', syntheticResult)
      followingSyntheticTestRan = true
    }
  } catch {
    syntheticFailureStopped = true
  }
  if (resumeNegativePassed !== resumeNegativeCases.length ||
      evidenceNegativePassed !== evidenceNegativeCases.length || oldModesDenied !== 2 ||
      reconciliationNegativePassed !== reconciliationNegativeCases.length ||
      resumeGateNegativePassed !== resumeGateNegativeCases.length || !syntheticFailureStopped ||
      followingSyntheticTestRan || !validateMode('--self-test') || !validateMode('--resume-post-apply') ||
      JSON.stringify(authFixtureEmailPatterns) !== JSON.stringify(['p1-%@example.invalid', 'access-%@example.invalid']) ||
      JSON.stringify(profileFixtureIdPatterns) !== JSON.stringify([
        'd4000000-0000-4000-8000-00000000000%', 'd5100000-0000-4000-8000-00000000000%',
      ])) {
    throw new Error('P1 post-apply resume negative self-test failed')
  }
  console.log('P1_ISOLATED_RUNTIME_SELFTEST_OK targetPositive=1 targetNegative=3/3 migrationPositive=1 migrationNegative=6/6 credentialPositive=1 credentialNegative=3/3 resume69Denied=1 resume70Accepted=1 resumeDriftDenied=2/2 keyAmountDriftDenied=1 inventoryDriftDenied=1 rawLedgerDriftDenied=1 fullContentDriftDenied=1 artifactBindingDriftDenied=1 restoreStatusDriftDenied=1 storageDriftDenied=1 manifestShaDriftDenied=1 restoreEvidenceShaDriftDenied=1 evidenceNegative=5/5 oldApplyModesDenied=2/2 resumeGatePositive=1 resumeGateNegative=3/3 fixturePatterns=4/4 firstSqlFailureStops=1 candidateRemoteExecutionAllowed=0 resumeRemoteExecutionAllowed=0 databaseCalls=0 storageCalls=0 dEvidenceRequired=0')
}

function verifyTemporaryLink(workdir) {
  const refPath = resolve(workdir, 'supabase', '.temp', 'project-ref')
  if (!existsSync(refPath)) throw new Error('temporary linked project ref is missing')
  const linkedRef = readFileSync(refPath, 'utf8').trim()
  requireBoundary({ targetRef: TARGET_REF, linkedRef, workdir, workspaceLinkUsed: false })
  return linkedRef
}

function clearDbEnvironment(environment) {
  if (!environment || typeof environment !== 'object') return
  for (const key of Object.keys(environment)) environment[key] = ''
}

function validateDbEnvironment(environment) {
  return environment && ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']
    .every((key) => typeof environment[key] === 'string' && environment[key].length > 0)
}

function acquireTemporaryDbEnvironment(workdir, cliPath) {
  verifyTemporaryLink(workdir)
  const credentialProbe = requireSuccess('temporary credential preflight', run(cliPath, [
    'db', 'dump', '--linked', '--dry-run', '--workdir', workdir,
  ], { timeout: 120000 }))
  try {
    const direct = parseTemporaryPgEnvironment(
      credentialProbe.stdout + '\n' + credentialProbe.stderr,
      TARGET_REF,
      { requireHostMatch: false },
    )
    const poolerUrl = readFileSync(resolve(workdir, 'supabase', '.temp', 'pooler-url'), 'utf8')
    const environment = useSessionPooler(direct, poolerUrl, TARGET_REF)
    clearDbEnvironment(direct)
    if (!validateDbEnvironment(environment)) throw new Error('new temporary database credential is incomplete')
    verifyTemporaryLink(workdir)
    return environment
  } finally {
    credentialProbe.stdout = ''
    credentialProbe.stderr = ''
  }
}

function rotateTemporaryCredential(channel, acquire = acquireTemporaryDbEnvironment) {
  if (!channel?.dbEnvironment || !Number.isInteger(channel.credentialGeneration)) {
    throw new Error('old temporary credential generation is unavailable')
  }
  const oldEnvironment = channel.dbEnvironment
  const previousGeneration = channel.credentialGeneration
  clearDbEnvironment(oldEnvironment)
  channel.dbEnvironment = null
  let fresh
  try {
    fresh = acquire(channel.workdir, channel.cliPath)
  } catch (error) {
    clearDbEnvironment(fresh)
    throw new Error('new temporary credential acquisition failed: ' + redact(error instanceof Error ? error.message : error))
  }
  if (fresh === oldEnvironment || !validateDbEnvironment(fresh)) {
    clearDbEnvironment(fresh)
    throw new Error('old temporary credential was reused or the new credential is invalid')
  }
  channel.dbEnvironment = fresh
  channel.credentialGeneration = previousGeneration + 1
  return channel.credentialGeneration
}

function requireFreshCredentialGeneration(channel, previousGeneration) {
  if (!validateDbEnvironment(channel?.dbEnvironment) ||
      !Number.isInteger(channel.credentialGeneration) || channel.credentialGeneration <= previousGeneration) {
    throw new Error('post-CLI snapshot requires a newly acquired credential generation')
  }
}

function prepareTemporaryChannel() {
  const workdir = mkdtempSync(join(tmpdir(), 'canwin-p1-runtime-'))
  const cliPath = restoreRun.toolchain.supabaseCli.path
  try {
    requireSuccess('temporary supabase init', run(cliPath, ['init', '--workdir', workdir, '--yes']))
    requireSuccess('temporary supabase link', run(cliPath, [
      'link', '--project-ref', TARGET_REF, '--workdir', workdir, '--yes',
    ], { timeout: 120000 }))
    verifyTemporaryLink(workdir)
    const dbEnvironment = acquireTemporaryDbEnvironment(workdir, cliPath)
    verifyTemporaryLink(workdir)
    return { workdir, cliPath, dbEnvironment, credentialGeneration: 1 }
  } catch (error) {
    rmSync(workdir, { recursive: true, force: true })
    throw error
  }
}

function snapshot(dbEnvironment) {
  const value = runPsql({
    psqlPath: restoreRun.toolchain.psql.path,
    pgEnvironment: dbEnvironment,
    retryReadOnlySessionPooler: true,
    timeout: 180000,
    sql: `
select jsonb_build_object(
  'reachable',true,
  'migrationVersions',(select coalesce(jsonb_agg(version order by version),'[]'::jsonb) from supabase_migrations.schema_migrations),
  'migrationHistory',(select coalesce(jsonb_agg(jsonb_build_object('version',version,'status','applied') order by version),'[]'::jsonb) from supabase_migrations.schema_migrations),
  'p1MigrationApplied',(select exists(select 1 from supabase_migrations.schema_migrations where version='20260719130910')),
  'p1ColumnPresent',(select exists(select 1 from information_schema.columns where table_schema='public' and table_name='profile_access_roles' and column_name='assignment_kind')),
  'p1PublicFunctions',(select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('get_app_context_v1','get_navigation_manifest_v1','resolve_responsible_profile_v1','admin_apply_member_access_v1','admin_set_supervisor_system_v1','admin_replace_supervisor_scope_v1')),
  'authUsers',(select count(*) from auth.users),
  'authIdentities',(select count(*) from auth.identities),
  'bannedAuthUsers',(select count(*) from auth.users where banned_until > now() + interval '99 years'),
  'p1AuthFixtureUsers',(select count(*) from auth.users where lower(coalesce(email,'')) like '${authFixtureEmailPatterns[0]}' or lower(coalesce(email,'')) like '${authFixtureEmailPatterns[1]}'),
  'p1ProfileFixtureRows',(select count(*) from public.profiles where id::text like '${profileFixtureIdPatterns[0]}' or id::text like '${profileFixtureIdPatterns[1]}'),
  'p1RegionFixtureRows',(select count(*) from public.sales_regions where id='d4100000-0000-4000-8000-000000000001'::uuid),
  'p1RequestFixtureRows',(select count(*) from public.access_admin_requests where idempotency_key::text like 'd42%' or idempotency_key::text like 'd43%'),
  'idleInTransactionSessions',(select count(*) from pg_catalog.pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and state like 'idle in transaction%'),
  'teams',(select count(*) from public.teams),
  'p1FeatureFlags',(select count(*) from public.feature_flags where key='team_os_4_supervisor'),
  'teamsMissingP1Flag',(select count(*) from public.teams t where not exists(select 1 from public.feature_flags f where f.team_id=t.id and f.key='team_os_4_supervisor')),
  'storageBuckets',(select count(*) from storage.buckets),
  'storageObjects',(select count(*) from storage.objects),
  'publicRowCounts',(select coalesce(jsonb_object_agg(x.table_name,x.row_count order by x.table_name),'{}'::jsonb) from (
    select c.relname table_name,(xpath('/row/c/text()',query_to_xml(format('select count(*) c from public.%I',c.relname),false,true,'')))[1]::text::bigint row_count
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in('r','p')
  ) x)
)::text;`,
  })
  return JSON.parse(value)
}

function assertPreflight(value) {
  const proof = proveMigrationSets(signedLocalMigrations(), value.migrationHistory, [P1_VERSION])
  if (!value.reachable || proof.localCount !== contract.expected.postMigrationRows ||
      proof.remoteCount !== contract.expected.preMigrationRows || proof.commonCount !== contract.expected.preMigrationRows ||
      value.migrationVersions.length !== contract.expected.preMigrationRows || value.p1MigrationApplied ||
      value.p1ColumnPresent || Number(value.p1PublicFunctions) !== 0 ||
      Number(value.authUsers) !== contract.expected.authUsers || Number(value.p1AuthFixtureUsers) !== 0 ||
      Number(value.p1ProfileFixtureRows) !== 0 || Number(value.p1RegionFixtureRows) !== 0 ||
      Number(value.p1RequestFixtureRows) !== 0 || Number(value.idleInTransactionSessions) !== 0 ||
      Number(value.p1FeatureFlags) !== 0 || Number(value.teamsMissingP1Flag) !== Number(value.teams)) {
    throw new Error('isolated target is not at the exact clean 69-migration P1 baseline')
  }
  return proof
}

function runLocalVerifiers() {
  const checks = [
    ['P1 runner verifier', resolve(scriptRoot, 'verify-isolated-runtime-runner.mjs')],
    ['migration manifest verifier', resolve(repoRoot, 'scripts', 'p0', 'verify-migration-manifest.mjs')],
    ['CI database contract verifier', resolve(repoRoot, 'scripts', 'p0', 'verify-ci-database-contract.mjs')],
    ['P1 app shell verifier', resolve(scriptRoot, 'verify-app-shell.mjs')],
  ]
  for (const [label, path] of checks) requireSuccess(label, run(process.execPath, [path], { timeout: 180000 }))
}

function runTestFile(dbEnvironment, test) {
  const args = ['--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1']
  if (test.executionMode === 'read_only') {
    args.push('--single-transaction', '--command', 'set transaction read only;')
  }
  args.push('--command', 'set role postgres;', '--file', resolve(repoRoot, test.path))
  return runPgTool({
    commandPath: restoreRun.toolchain.psql.path,
    pgEnvironment: dbEnvironment,
    args,
    timeout: 180000,
  })
}

function runSealedFullReconciliation(dbEnvironment) {
  const result = requireSuccess('sealed full reconciliation', runPgTool({
    commandPath: restoreRun.toolchain.psql.path,
    pgEnvironment: dbEnvironment,
    args: [
      '--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1',
      '--single-transaction', '--command', 'set role postgres;',
      '--file', resolve(repoRoot, contract.fullReconciliation.sealedSqlPath),
    ],
    timeout: 300000,
  }))
  try {
    const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (lines.length !== 1) throw new Error('sealed full reconciliation did not return exactly one JSON row')
    return JSON.parse(lines[0])
  } catch (error) {
    throw new Error('sealed full reconciliation output is invalid: ' + redact(error instanceof Error ? error.message : error))
  } finally {
    result.stdout = ''
    result.stderr = ''
  }
}

async function collectTargetStorageSummary(baseline) {
  if (TARGET_REF === PRODUCTION_REF) throw new Error('production Storage archive is forbidden')
  let serverKey = ''
  let archive = null
  try {
    serverKey = getServerKey({ cliPath: restoreRun.toolchain.supabaseCli.path, projectRef: TARGET_REF })
    const client = createServerClient(TARGET_REF, serverKey)
    archive = await collectStorageArchive(client)
    return assertSignedStorageSummary(baseline, storageSummary(archive))
  } finally {
    serverKey = ''
    if (archive) {
      for (const item of archive.objects ?? []) item.base64 = ''
      if (Array.isArray(archive.objects)) archive.objects.length = 0
      if (Array.isArray(archive.buckets)) archive.buckets.length = 0
      archive = null
    }
  }
}

function lightSnapshotSummary(value) {
  const count = (candidate) => candidate === undefined || candidate === null ? null : Number(candidate)
  return {
    canonicalSha256: canonicalSha256(value),
    migrationRows: value.migrationVersions.length,
    publicTables: Object.keys(value.publicRowCounts).length,
    publicRowCountsSha256: canonicalSha256(value.publicRowCounts),
    authUsers: count(value.authUsers),
    authIdentities: count(value.authIdentities),
    bannedAuthUsers: count(value.bannedAuthUsers),
    storageBuckets: count(value.storageBuckets),
    storageObjects: count(value.storageObjects),
    fixtureRows: Number(value.p1AuthFixtureUsers) + Number(value.p1ProfileFixtureRows) +
      Number(value.p1RegionFixtureRows) + Number(value.p1RequestFixtureRows),
    idleInTransactionSessions: Number(value.idleInTransactionSessions),
  }
}

function catalogSnapshot(dbEnvironment) {
  return JSON.parse(runPsql({
    psqlPath: restoreRun.toolchain.psql.path,
    pgEnvironment: dbEnvironment,
    retryReadOnlySessionPooler: true,
    sql: `select jsonb_build_object(
      'publicTables',(select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p')),
      'publicRoutines',(select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in('f','p')),
      'publicViews',(select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('v','m')),
      'storageBuckets',(select count(*) from storage.buckets)
    )::text;`,
  }))
}

function assertCatalog(actual) {
  for (const [name, expected] of Object.entries(contract.expected.catalog)) {
    if (Number(actual[name]) !== expected) throw new Error(`catalog drift ${name} expected=${expected} actual=${actual[name]}`)
  }
}

function safeEvidence(value) {
  const text = JSON.stringify(value, null, 2) + '\n'
  if (/PGPASSWORD|postgres(?:ql)?:\/\/|sb_(?:secret|publishable)_|eyJ[A-Za-z0-9_-]+\./i.test(text)) {
    throw new Error('evidence contains a forbidden secret marker')
  }
  return text
}

async function executePostApplyResume(
  channel,
  sourceEvidence,
  before,
  baseline,
  proof,
) {
  const head = requireSuccess('git head', run('git', ['rev-parse', 'HEAD'])).stdout.trim()
  const runId = `p1-resume-${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${head.slice(0, 10)}`
  const evidenceDirectory = resolve(contract.evidenceRoot, runId)
  mkdirSync(contract.evidenceRoot, { recursive: true })
  mkdirSync(evidenceDirectory, { recursive: false })
  const attempt = {
    schemaVersion: 1,
    runId,
    mode: 'post-apply-verification-resume',
    targetProjectRef: TARGET_REF,
    targetProjectName: contract.target.projectName,
    supervisionHeadSha: head,
    sourceFailureRunId: contract.postApplyResume.sourceRunId,
    sourcePreflightSha256: contract.postApplyResume.preflightSha256,
    sourceFailureSha256: contract.postApplyResume.failureSha256,
    migrationVersion: P1_VERSION,
    migrationAlreadyApplied: true,
    dbPushPerformed: false,
    persistentRemoteWrites: 0,
    verificationStarted: false,
    attempts: 0,
    startedAt: new Date().toISOString(),
    testsPassed: [],
    perTestSnapshotsPassed: 0,
    perTestFullReconciliations: [],
    fullReconciliationSnapshotsPassed: 0,
    storageArchivesPassed: 0,
    signedEvidence: baseline.signedEvidence,
    initialLightSnapshot: lightSnapshotSummary(before),
    secretsPrinted: 0,
    secretsWritten: 0,
    productionReads: 0,
    productionWrites: 0,
  }
  try {
    verifyTemporaryLink(channel.workdir)
    attempt.verificationStarted = true
    attempt.attempts = 1
    attempt.currentStep = 'initial-full-reconciliation'
    const beforeFull = runSealedFullReconciliation(channel.dbEnvironment)
    const beforeFullSummary = assertSealedFullReconciliation(baseline, before, beforeFull)
    attempt.initialFullReconciliation = beforeFullSummary
    attempt.fullReconciliationSnapshotsPassed = 1
    attempt.currentStep = 'initial-storage-archive'
    const beforeStorageSummary = await collectTargetStorageSummary(baseline)
    attempt.initialStorageArchive = beforeStorageSummary
    attempt.storageArchivesPassed = 1
    writeFileSync(resolve(evidenceDirectory, 'preflight.json'), safeEvidence({
      ...attempt,
      status: 'ready',
      sourcePreflightSummary: lightSnapshotSummary(sourceEvidence.preflight.before),
    }), { flag: 'wx' })
    console.log(`P1_POST_APPLY_RESUME_PREFLIGHT_OK target=${TARGET_REF} local=${proof.localCount} remote=${proof.remoteCount} common=${proof.commonCount} pending=0 orderMatched=1 fullSnapshots=1/29 storageArchives=1/2 fixtureRows=0 idleTransactions=0 dbPush=0 secretsPrinted=0 productionReads=0 productionWrites=0`)
    let p1MarkerSeen = false
    let accessControlMarkerSeen = false
    for (const test of databaseContract.tests) {
      attempt.currentStep = `test:${test.category}:${test.path}`
      const result = requireSuccess(`SQL test ${test.path}`, runTestFile(channel.dbEnvironment, test))
      if (test.path === contract.candidate.testPath) {
        p1MarkerSeen = result.stdout.includes('team_os_4_p1_access_shell_ok')
        if (!p1MarkerSeen) throw new Error('P1 six-identity runtime marker is missing')
      }
      if (test.path === contract.postApplyResume.accessControlTestPath) {
        accessControlMarkerSeen = result.stdout.includes('access_control_foundation_ok')
        if (!accessControlMarkerSeen) throw new Error('legacy-member explicit-role marker is missing')
      }
      result.stdout = ''
      result.stderr = ''
      attempt.testsPassed.push(test.path)
      const afterTest = snapshot(channel.dbEnvironment)
      assertResumeStable(sourceEvidence.preflight.before, before, afterTest)
      attempt.perTestSnapshotsPassed += 1
      const afterTestFull = runSealedFullReconciliation(channel.dbEnvironment)
      const afterTestFullSummary = assertSealedFullReconciliation(baseline, afterTest, afterTestFull)
      assertFullReconciliationStable(beforeFullSummary, afterTestFullSummary)
      attempt.perTestFullReconciliations.push({
        testPath: test.path,
        snapshotSha: afterTestFullSummary.canonicalSha256,
        equal: true,
      })
      attempt.fullReconciliationSnapshotsPassed += 1
    }
    if (!p1MarkerSeen || !accessControlMarkerSeen || attempt.testsPassed.length !== contract.expected.tests ||
        attempt.perTestSnapshotsPassed !== contract.expected.tests ||
        attempt.perTestFullReconciliations.length !== contract.expected.tests) {
      throw new Error('post-apply SQL test totals, markers, or per-test full reconciliation snapshots are incomplete')
    }

    attempt.currentStep = 'catalog'
    const catalog = catalogSnapshot(channel.dbEnvironment)
    assertCatalog(catalog)
    attempt.currentStep = 'full-reconciliation'
    const beforeFinalCredentialGeneration = channel.credentialGeneration
    rotateTemporaryCredential(channel)
    requireFreshCredentialGeneration(channel, beforeFinalCredentialGeneration)
    const after = snapshot(channel.dbEnvironment)
    assertResumeStable(sourceEvidence.preflight.before, before, after)
    const afterFull = runSealedFullReconciliation(channel.dbEnvironment)
    const afterFullSummary = assertSealedFullReconciliation(baseline, after, afterFull)
    assertFullReconciliationStable(beforeFullSummary, afterFullSummary)
    attempt.fullReconciliationSnapshotsPassed += 1
    const afterStorageSummary = await collectTargetStorageSummary(baseline)
    if (afterStorageSummary.canonicalSha256 !== beforeStorageSummary.canonicalSha256) {
      throw new Error('initial/final Storage archive canonical content drift')
    }
    attempt.storageArchivesPassed += 1
    if (attempt.fullReconciliationSnapshotsPassed !== contract.expected.tests + 2 ||
        attempt.storageArchivesPassed !== 2) {
      throw new Error('full reconciliation or Storage archive totals are incomplete')
    }
    verifyTemporaryLink(channel.workdir)

    const completed = {
      ...attempt,
      status: 'succeeded',
      currentStep: 'completed',
      completedAt: new Date().toISOString(),
      databaseTestsPassed: contract.expected.databaseTests,
      permissionTestsPassed: contract.expected.permissionTests,
      businessTestsPassed: contract.expected.businessTests,
      catalogAssertionsPassed: Object.keys(contract.expected.catalog).length,
      catalog,
      reconciliation: {
        sourceMigrationRows: sourceEvidence.preflight.before.migrationVersions.length,
        postApplyMigrationRowsBefore: before.migrationVersions.length,
        postApplyMigrationRowsAfter: after.migrationVersions.length,
        initialLightSnapshot: lightSnapshotSummary(before),
        finalLightSnapshot: lightSnapshotSummary(after),
        initialFullReconciliation: beforeFullSummary,
        finalFullReconciliation: afterFullSummary,
        perTestFullReconciliations: attempt.perTestFullReconciliations,
        fullReconciliationSnapshotsPassed: attempt.fullReconciliationSnapshotsPassed,
        initialStorageArchive: beforeStorageSummary,
        finalStorageArchive: afterStorageSummary,
        storageArchivesPassed: attempt.storageArchivesPassed,
        perTestSnapshotsPassed: attempt.perTestSnapshotsPassed,
        fixtureRowsRemaining: 0,
        idleInTransactionSessions: after.idleInTransactionSessions,
      },
    }
    const evidencePath = resolve(evidenceDirectory, 'success.json')
    writeFileSync(evidencePath, safeEvidence(completed), { flag: 'wx' })
    console.log(`P1_POST_APPLY_RESUME_OK target=${TARGET_REF} migrationAlreadyApplied=70/70 tests=27/27 database=7 permission=11 business=9 perTestSnapshots=27/27 fullSnapshots=29/29 storageArchives=2/2 catalog=4 fixtureRows=0 persistentRemoteWrites=0 dbPush=0 attempts=1`)
    console.log(`P1_POST_APPLY_RESUME_EVIDENCE path=${evidencePath} sha256=${sha256(readFileSync(evidencePath))} secretsPrinted=0 productionReads=0 productionWrites=0`)
  } catch (error) {
    const failure = {
      ...attempt,
      status: 'failed-stop-preserved',
      failedAt: new Date().toISOString(),
      message: redact(error instanceof Error ? error.message : error),
      targetPreserved: true,
      retryPerformed: false,
      remoteCleanupPerformed: false,
    }
    writeFileSync(resolve(evidenceDirectory, 'failure.json'), safeEvidence(failure), { flag: 'wx' })
    throw error
  }
}

async function main() {
  if (mode === '--self-test') return runSelfTest()
  const syncState = assertFrozenContract()
  if (!validateResumeRemoteGate(mode, syncState, contract.postApplyResume)) {
    throw new Error('P1_REMOTE_EXECUTION_REFUSED: post-apply resume candidate is not reference-synchronized and qualified')
  }
  assertResumeSignedCiQualification()
  const baseline = loadSignedReconciliationBaseline()
  const sourceEvidence = loadResumeEvidence()
  runLocalVerifiers()
  const channel = prepareTemporaryChannel()
  try {
    const before = snapshot(channel.dbEnvironment)
    const proof = assertPostApplyBaseline(sourceEvidence.preflight.before, before)
    await executePostApplyResume(
      channel,
      sourceEvidence,
      before,
      baseline,
      proof,
    )
  } finally {
    clearDbEnvironment(channel.dbEnvironment)
    channel.dbEnvironment = null
    rmSync(channel.workdir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('P1_ISOLATED_RUNTIME_FAILED: ' + redact(error instanceof Error ? error.message : error))
  process.exitCode = 1
})
