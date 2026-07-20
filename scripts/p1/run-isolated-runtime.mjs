import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  copyFileSync,
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
import { stripVTControlCharacters } from 'node:util'
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
const REPAIR_VERSION = '20260720015435'
const SOURCE_FAILURE_RUN_ID = 'p1-resume-20260719T193911279Z-ea6ed9385d'
const SOURCE_FAILURE_HEAD = 'ea6ed9385de7c3ceff5cba6c6f8539f883bbea1d'
const SOURCE_PREFLIGHT_SHA256 = 'e0ea653d3a411cc9baafbd4b98e7d6d458b99316e8da93a1db1600a21e2dc36a'
const SOURCE_FAILURE_SHA256 = '576a11005285cd708adca5b3486e0b929ace8d97fc3cc3284d657b57519b91ad'
const PRIVATE_MEMBER_ACCESS_IDENTITY = 'private.admin_apply_member_access_v1(uuid, text, text[], uuid[], uuid[], text[], uuid)'
const RETIRED_ACL_REPAIR_CI_RUN_IDS = new Set(['29726897764', '29733854344', '29738966326'])
const RETIRED_ACL_REPAIR_CI_JOB_IDS = new Set([
  '88301987239', '88301987280', '88324427055', '88324427244', '88340968144', '88340968119',
])
const RETIRED_ACL_REPAIR_EVIDENCE_HEADS = new Set([
  'e774ead5a2857afb511400a12897e629033cf941',
  '71b7320b4c303af797ee9e4bf12044518a4fe18a',
  '070c2e4ca185037d37f65b4d98be617a43e4409d',
  '4fa8de78a8b05f8285f69fb0d6d9106e20e3cba7',
  '8fa14988502511d9722bd37add5b51d845f7934f',
])
const mode = process.argv[2]
const allowedModes = new Set(['--self-test', '--apply-acl-repair'])
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

function isRetiredAclRepairEvidence(candidate) {
  const candidateJobIds = [candidate?.jobId, candidate?.linuxJobId, candidate?.windowsJobId]
    .filter((value) => value !== undefined && value !== null)
    .map(String)
  return RETIRED_ACL_REPAIR_CI_RUN_IDS.has(String(candidate?.runId ?? '')) ||
    candidateJobIds.some((jobId) => RETIRED_ACL_REPAIR_CI_JOB_IDS.has(jobId)) ||
    RETIRED_ACL_REPAIR_EVIDENCE_HEADS.has(candidate?.headSha ?? '')
}

function validateRepairRemoteGate(candidateMode, repair, ci) {
  return candidateMode === '--apply-acl-repair' && repair?.mode === '--apply-acl-repair' &&
    repair?.remoteExecutionAllowed === true && repair?.dbPushAllowed === true &&
    repair?.maxFormalAttempts === 1 && repair?.maxDbPushAttempts === 1 && repair?.dryRunRequired === true &&
    repair?.applicationCompatibility?.status === 'passed' &&
    repair?.atomicLegacyRoleCompatibility?.status === 'passed' &&
    repair?.atomicLegacyRoleCompatibility?.staticPassed === true &&
    repair?.atomicLegacyRoleCompatibility?.databaseCiPassed === true &&
    repair?.applicationCompatibility?.remoteQualificationAllowed === true &&
    repair?.atomicLegacyRoleCompatibility?.remoteQualificationAllowed === true &&
    ci?.qualificationScope === 'acl_repair_session_pooler_prequalification' &&
    ci?.requiredConnectionMode === 'session-pooler' &&
    ci?.evidenceScope === 'current-independent-session-pooler-ci' &&
    ci?.priorSuccessfulRunPreservedWithoutRerun === '29733854344' &&
    ci?.priorParserFixRunPreservedWithoutRerun === '29738966326' &&
    ci?.formalAclRepairFailurePreservedWithoutRerun ===
      'p1-acl-repair-20260720T122757275Z-8fa1498850' &&
    /^[0-9]+$/.test(ci?.runId ?? '') && /^[0-9]+$/.test(ci?.linuxJobId ?? '') &&
    /^[0-9]+$/.test(ci?.windowsJobId ?? '') && /^[a-f0-9]{40}$/.test(ci?.headSha ?? '') &&
    ci?.runUrl === `https://github.com/yccanwin/canwin-team-os/actions/runs/${ci.runId}` &&
    !isRetiredAclRepairEvidence(ci) && ci?.status === 'success' && ci?.conclusion === 'success' &&
    ci?.databaseCiPassed === true && ci?.remoteQualificationAllowed === true &&
    ci?.currentQualificationAllowed === true && ci?.successEvidencePresent === true &&
    ci?.newIndependentCi === true
}

function findRepairSignedCiRun(
  ci = contract.repairCiRunEvidence,
  history = databaseContract.formalAttemptHistory,
) {
  const matches = history.filter((entry) => (
    entry.runId === ci?.runId && entry.runUrl === ci?.runUrl && entry.jobId === ci?.linuxJobId &&
    entry.windowsJobId === ci?.windowsJobId && entry.headSha === ci?.headSha &&
    entry.conclusion === ci?.status && entry.conclusion === 'success' &&
    entry.qualificationScope === 'acl_repair_session_pooler_prequalification' &&
    entry.qualificationScope === ci?.qualificationScope &&
    entry.requiredConnectionMode === 'session-pooler' &&
    entry.requiredConnectionMode === ci?.requiredConnectionMode &&
    entry.newIndependentCi === true && ci?.newIndependentCi === true &&
    !isRetiredAclRepairEvidence(entry) && !isRetiredAclRepairEvidence(ci) &&
    entry.windowsLocalGatePassed === true &&
    entry.windowsStaticGatesExpected === ci?.windowsStaticExpected &&
    entry.windowsStaticGatesPassed === ci?.windowsStaticPassed &&
    entry.windowsLocalIntegrationStepsExpected === ci?.windowsLocalExpected &&
    entry.windowsLocalIntegrationStepsPassed === ci?.windowsLocalPassed &&
    entry.migrationsPassed === contract.aclRepair.expectedMigrationCount &&
    entry.sqlTestsPassed === contract.aclRepair.sqlTestCount && entry.catalogAssertionsPassed === 4 &&
    entry.databaseTestsPassed === contract.expected.databaseTests &&
    entry.permissionTestsPassed === contract.expected.permissionTests &&
    entry.businessTestsPassed === contract.expected.businessTests &&
    entry.productionReadPerformed === false && entry.productionWritePerformed === false
  ))
  return matches.length === 1 ? matches[0] : null
}

function validateRepairWorktreeBoundary(head, signedCiHead, trackedStatus) {
  return {
    committedAfterSignedHead: /^[a-f0-9]{40}$/.test(head) && head !== signedCiHead,
    trackedWorktreeClean: trackedStatus === '',
  }
}

function assertRepairSignedCiQualification() {
  const signedCiHead = contract.repairCiRunEvidence.headSha
  const signedRun = findRepairSignedCiRun()
  if (!signedRun) throw new Error('ACL repair independent dual-platform CI success evidence is missing')
  const head = requireSuccess('git head', run('git', ['rev-parse', 'HEAD'])).stdout.trim()
  const trackedStatus = requireSuccess('tracked worktree status', run('git', [
    'status', '--porcelain', '--untracked-files=no',
  ])).stdout.trim()
  const worktreeBoundary = validateRepairWorktreeBoundary(head, signedCiHead, trackedStatus)
  if (!worktreeBoundary.committedAfterSignedHead) {
    throw new Error('ACL repair qualification changes are not committed after the signed prequalification HEAD')
  }
  if (!worktreeBoundary.trackedWorktreeClean) throw new Error('ACL repair requires a clean tracked worktree')
  requireSuccess('ACL repair signed CI ancestry', run('git', [
    'merge-base', '--is-ancestor', signedCiHead, head,
  ]))
  requireSuccess('ACL repair signed CI includes preserved direct DB failure head', run('git', [
    'merge-base', '--is-ancestor',
    contract.formalAclRepairFailureEvidence.supervisionHeadSha,
    signedCiHead,
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
    const expectedHash = version === P1_VERSION
      ? contract.candidate.migrationSha256Lf
      : version === REPAIR_VERSION
        ? contract.aclRepair.migrationSha256Lf
        : entry.sha256
    const referenceHashAccepted = version !== P1_VERSION || [
      contract.candidate.migrationSha256Lf,
      contract.referenceSync.previousMigrationSha256Lf,
    ].includes(entry.sha256)
    const repairHashAccepted = version !== REPAIR_VERSION || entry.sha256 === contract.aclRepair.migrationSha256Lf
    if (entry.version !== version || entry.file !== file || hash !== expectedHash ||
        !referenceHashAccepted || !repairHashAccepted) {
      throw new Error('signed local migration inventory drift at ' + version)
    }
    return { version, status: 'signed', sha256Lf: hash }
  })
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

function loadRepairFailureEvidence() {
  const expected = contract.formalResumeFailureEvidence
  const preflight = parseSignedEvidence(expected.preflightPath, expected.preflightSha256, 'ACL repair source preflight')
  const failure = parseSignedEvidence(expected.failurePath, expected.failureSha256, 'ACL repair source failure')
  const evidenceFiles = readdirSync(expected.evidenceDirectory).filter((name) => !name.startsWith('.')).sort()
  if (expected.runId !== SOURCE_FAILURE_RUN_ID || expected.supervisionHeadSha !== SOURCE_FAILURE_HEAD ||
      expected.preflightSha256 !== SOURCE_PREFLIGHT_SHA256 || expected.failureSha256 !== SOURCE_FAILURE_SHA256 ||
      JSON.stringify(evidenceFiles) !== JSON.stringify(['failure.json', 'preflight.json']) ||
      resolve(expected.preflightPath) !== resolve(expected.evidenceDirectory, 'preflight.json') ||
      resolve(expected.failurePath) !== resolve(expected.evidenceDirectory, 'failure.json') ||
      preflight.runId !== SOURCE_FAILURE_RUN_ID || failure.runId !== SOURCE_FAILURE_RUN_ID ||
      preflight.supervisionHeadSha !== SOURCE_FAILURE_HEAD || failure.supervisionHeadSha !== SOURCE_FAILURE_HEAD ||
      preflight.targetProjectRef !== TARGET_REF || failure.targetProjectRef !== TARGET_REF ||
      preflight.status !== 'ready' || preflight.migrationAlreadyApplied !== true ||
      preflight.dbPushPerformed !== false || preflight.persistentRemoteWrites !== 0 ||
      preflight.attempts !== 1 || preflight.testsPassed?.length !== 0 ||
      preflight.perTestSnapshotsPassed !== 0 || preflight.fullReconciliationSnapshotsPassed !== 1 ||
      preflight.storageArchivesPassed !== 1 || preflight.secretsPrinted !== 0 || preflight.secretsWritten !== 0 ||
      preflight.productionReads !== 0 || preflight.productionWrites !== 0 ||
      failure.status !== 'failed-stop-preserved' || failure.attempts !== 1 ||
      failure.currentStep !== 'test:database:supabase/tests/notification_core.sql' ||
      !failure.message?.includes('Notification worker RPC exposed') || failure.testsPassed?.length !== 5 ||
      failure.perTestSnapshotsPassed !== 5 || failure.perTestFullReconciliations?.length !== 5 ||
      failure.fullReconciliationSnapshotsPassed !== 6 || failure.storageArchivesPassed !== 1 ||
      failure.persistentRemoteWrites !== 0 || failure.secretsPrinted !== 0 || failure.secretsWritten !== 0 ||
      failure.retryPerformed !== false || failure.remoteCleanupPerformed !== false || failure.targetPreserved !== true ||
      failure.productionReads !== 0 || failure.productionWrites !== 0) {
    throw new Error('ACL repair source failed-attempt evidence boundary drift')
  }
  if (expected.startedAtUtc !== failure.startedAt || expected.failedAtUtc !== failure.failedAt ||
      expected.failedStep !== failure.currentStep || expected.firstFailedSqlTest !== 'supabase/tests/notification_core.sql' ||
      expected.firstError !== 'Notification worker RPC exposed' || expected.testsPassed !== 5 ||
      expected.perTestSnapshotsPassed !== 5 || expected.fullReconciliationSnapshotsPassed !== 6 ||
      expected.storageArchivesPassed !== 1 || expected.attempts !== 1 || expected.persistentRemoteWrites !== 0 ||
      expected.productionReads !== 0 || expected.productionWrites !== 0 || expected.secretsPrinted !== 0 ||
      expected.secretsWritten !== 0 || expected.retryPerformed !== false ||
      expected.remoteCleanupPerformed !== false || expected.targetPreserved !== true) {
    throw new Error('ACL repair source evidence contract drift')
  }
  return { preflight, failure }
}

function assertExact70RepairBaseline(sourceEvidence, current) {
  const proof = proveMigrationSets(signedLocalMigrations(), current.migrationHistory, [REPAIR_VERSION])
  if (!current.reachable || proof.localCount !== contract.aclRepair.postMigrationRows ||
      proof.remoteCount !== contract.aclRepair.preMigrationRows ||
      current.migrationVersions.length !== contract.aclRepair.preMigrationRows || !current.p1MigrationApplied ||
      !current.p1ColumnPresent || Number(current.p1PublicFunctions) !== 6 ||
      Number(current.authUsers) !== contract.fullReconciliation.expected.auth.users || Number(current.p1AuthFixtureUsers) !== 0 ||
      Number(current.authIdentities) !== contract.fullReconciliation.expected.auth.identities ||
      Number(current.bannedAuthUsers) !== contract.fullReconciliation.expected.auth.bannedUsers ||
      Number(current.p1ProfileFixtureRows) !== 0 || Number(current.p1RegionFixtureRows) !== 0 ||
      Number(current.p1RequestFixtureRows) !== 0 || Number(current.idleInTransactionSessions) !== 0 ||
      Number(current.p1FeatureFlags) !== Number(current.teams) || Number(current.teamsMissingP1Flag) !== 0 ||
      Number(current.storageBuckets) !== contract.fullReconciliation.expected.storage.buckets ||
      Number(current.storageObjects) !== contract.fullReconciliation.expected.storage.objects ||
      canonicalSha256(current) !== sourceEvidence.preflight.initialLightSnapshot.canonicalSha256 ||
      canonicalSha256(current.publicRowCounts) !== sourceEvidence.preflight.initialLightSnapshot.publicRowCountsSha256) {
    throw new Error('ACL repair target is not the exact preserved 70-migration failed-candidate baseline')
  }
  return proof
}

function lightContentProjection(value) {
  const { migrationVersions: _versions, migrationHistory: _history, ...content } = value
  return content
}

function assertExact71RepairBaseline(before70, current) {
  const proof = proveMigrationSets(signedLocalMigrations(), current.migrationHistory, [])
  if (!current.reachable || proof.localCount !== contract.aclRepair.postMigrationRows ||
      proof.remoteCount !== contract.aclRepair.postMigrationRows ||
      current.migrationVersions.length !== contract.aclRepair.postMigrationRows ||
      !current.migrationVersions.includes(REPAIR_VERSION) ||
      canonicalSha256(lightContentProjection(current)) !== canonicalSha256(lightContentProjection(before70))) {
    throw new Error('ACL repair did not produce the exact clean 71-migration content-stable baseline')
  }
  return proof
}

function assertRepairStable(before70, afterApply71, after) {
  assertExact71RepairBaseline(before70, after)
  if (JSON.stringify(canonicalize(after)) !== JSON.stringify(canonicalize(afterApply71))) {
    throw new Error('ACL repair verification left a migration, Auth, Storage, fixture, transaction, or public-row residue')
  }
}

function assertMd5(value, label) {
  if (!/^[a-f0-9]{32}$/.test(String(value ?? ''))) throw new Error(`${label} is not an MD5 content fingerprint`)
}

function assertSealedFullReconciliation(baseline, lightSnapshot, fullSnapshot, expectedMigrationRows) {
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
      Number(fullSnapshot.migrationHistory?.schemaMigrations) !== expectedMigrationRows ||
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

function assertAclRepairFullTransition(before70, after71) {
  if (Number(before70.migrationHistory?.schemaMigrations) !== contract.aclRepair.preMigrationRows ||
      Number(after71.migrationHistory?.schemaMigrations) !== contract.aclRepair.postMigrationRows) {
    throw new Error('ACL repair full reconciliation migration history transition drift')
  }
  for (const key of fullReconciliationKeys.filter((key) => !['migrationHistory', 'schemaSecurity'].includes(key))) {
    if (canonicalSha256(before70[key]) !== canonicalSha256(after71[key])) {
      throw new Error(`ACL repair changed forbidden full reconciliation content at ${key}`)
    }
  }
  for (const key of schemaSecurityKeys.filter((key) => key !== 'publicRoutinesMd5')) {
    if (before70.schemaSecurity[key] !== after71.schemaSecurity[key]) {
      throw new Error(`ACL repair changed forbidden schema/security fingerprint at ${key}`)
    }
  }
  if (before70.schemaSecurity.publicRoutinesMd5 === after71.schemaSecurity.publicRoutinesMd5) {
    throw new Error('ACL repair did not change the signed public routine ACL fingerprint')
  }
  return {
    allowedDifferencePaths: ['migrationHistory.schemaMigrations', 'schemaSecurity.publicRoutinesMd5'],
    beforeMigrationRows: Number(before70.migrationHistory.schemaMigrations),
    afterMigrationRows: Number(after71.migrationHistory.schemaMigrations),
    beforePublicRoutinesMd5: before70.schemaSecurity.publicRoutinesMd5,
    afterPublicRoutinesMd5: after71.schemaSecurity.publicRoutinesMd5,
    forbiddenContentDifferences: 0,
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
  if (!validateMode(mode)) throw new Error('usage: --self-test or --apply-acl-repair')
  if (contract.target?.projectRef !== TARGET_REF || contract.forbiddenProductionProjectRef !== PRODUCTION_REF ||
      contract.candidate?.migrationVersion !== P1_VERSION || contract.aclRepair?.migrationVersion !== REPAIR_VERSION) {
    throw new Error('P1 isolated runtime contract ref/version drift')
  }
  const repair = contract.aclRepair
  const ci = contract.repairCiRunEvidence
  const priorSuccessfulRepairCi = contract.priorSuccessfulRepairCiRunEvidence
  const priorFormalFailure = contract.priorFormalAclRepairFailureEvidence
  const formalFailure = contract.formalAclRepairFailureEvidence
  const priorParserFixRepairCi = contract.priorParserFixRepairCiRunEvidence
  const priorSuccessfulRepairCiHistorical =
    priorSuccessfulRepairCi?.runId === '29733854344' &&
    priorSuccessfulRepairCi?.headSha === '71b7320b4c303af797ee9e4bf12044518a4fe18a' &&
    priorSuccessfulRepairCi?.status === 'success' &&
    priorSuccessfulRepairCi?.evidenceScope === 'historical-prior-success-only' &&
    priorSuccessfulRepairCi?.currentQualificationAllowed === false
  const priorFormalAclRepairFailurePreserved =
    priorFormalFailure?.runId === 'p1-acl-repair-20260720T104323349Z-4fa8de78a8' &&
    priorFormalFailure?.failureSha256 === '16373794dd745ad86422bb59f3966933532cb0bf073251963b519c2b8e367e73' &&
    priorFormalFailure?.supervisionHeadSha === '4fa8de78a8b05f8285f69fb0d6d9106e20e3cba7' &&
    priorFormalFailure?.status === 'failed-stop-preserved' &&
    priorFormalFailure?.currentStep === 'db-push-dry-run' &&
    priorFormalFailure?.formalAttemptStarted === false && priorFormalFailure?.dbPushAttempts === 0 &&
    priorFormalFailure?.persistentRemoteWrites === 0 && priorFormalFailure?.productionReads === 0 &&
    priorFormalFailure?.productionWrites === 0 && priorFormalFailure?.successEvidencePresent === false
  const priorParserFixRepairCiHistorical =
    priorParserFixRepairCi?.runId === '29738966326' &&
    priorParserFixRepairCi?.headSha === '070c2e4ca185037d37f65b4d98be617a43e4409d' &&
    priorParserFixRepairCi?.status === 'success' && priorParserFixRepairCi?.databaseCiPassed === true &&
    priorParserFixRepairCi?.remoteQualificationAllowed === true &&
    priorParserFixRepairCi?.currentQualificationAllowed === false &&
    priorParserFixRepairCi?.evidenceScope === 'historical-parser-fix-ci-for-failed-direct-db-candidate' &&
    priorParserFixRepairCi?.formalAclRepairFailurePreservedWithoutRerun ===
      'p1-acl-repair-20260720T104323349Z-4fa8de78a8'
  const directDbFormalFailurePreserved =
    formalFailure?.runId === 'p1-acl-repair-20260720T122757275Z-8fa1498850' &&
    formalFailure?.failureSha256 === '19e4cd30c3d024a452b74f94380a17175364326dc59d41b837bc338c398579ba' &&
    formalFailure?.supervisionHeadSha === '8fa14988502511d9722bd37add5b51d845f7934f' &&
    formalFailure?.status === 'failed-stop-preserved' && formalFailure?.currentStep === 'db-push-dry-run' &&
    formalFailure?.failureClass === 'isolated-test-direct-database-connection-timeout' &&
    formalFailure?.connectionMode === 'direct-database-host' &&
    formalFailure?.migrationVersion === REPAIR_VERSION && formalFailure?.migrationAlreadyApplied === false &&
    formalFailure?.formalAttemptStarted === false && formalFailure?.verificationStarted === false &&
    formalFailure?.dbPushAttempted === false && formalFailure?.dbPushPerformed === false &&
    formalFailure?.dbPushOutcome === 'not-attempted' && formalFailure?.dbPushAttempts === 0 &&
    formalFailure?.attempts === 0 && formalFailure?.confirmedPersistentWrites === 0 &&
    formalFailure?.persistentRemoteWrites === 0 && formalFailure?.persistentRemoteWriteUpperBound === 0 &&
    formalFailure?.productionReads === 0 && formalFailure?.productionWrites === 0 &&
    formalFailure?.secretsPrinted === 0 && formalFailure?.secretsWritten === 0 &&
    formalFailure?.targetPreserved === true && formalFailure?.retryPerformed === false &&
    formalFailure?.remoteCleanupPerformed === false && formalFailure?.successEvidencePresent === false
  const repairCiQualified =
    contract.contractStatus === 'p1_acl_repair_session_pooler_remote_qualified_after_preserved_direct_db_failure' &&
    repair.remoteExecutionAllowed === true && repair.dbPushAllowed === true &&
    repair.applicationCompatibility?.status === 'passed' &&
    repair.atomicLegacyRoleCompatibility?.status === 'passed' &&
    repair.atomicLegacyRoleCompatibility?.staticPassed === true &&
    repair.atomicLegacyRoleCompatibility?.databaseCiPassed === true &&
    repair.applicationCompatibility?.remoteQualificationAllowed === true &&
    repair.atomicLegacyRoleCompatibility?.remoteQualificationAllowed === true &&
    /^[0-9]+$/.test(ci?.runId ?? '') && /^[a-f0-9]{40}$/.test(ci?.headSha ?? '') &&
    /^[0-9]+$/.test(ci?.linuxJobId ?? '') && /^[0-9]+$/.test(ci?.windowsJobId ?? '') &&
    repair.signedCiRunId === ci?.runId && repair.signedCiHeadSha === ci?.headSha &&
    repair.signedCiLinuxJobId === ci?.linuxJobId && repair.signedCiWindowsJobId === ci?.windowsJobId &&
    repair.signedCiConclusion === ci?.conclusion && !isRetiredAclRepairEvidence(ci) &&
    ci?.status === 'success' && ci?.conclusion === 'success' &&
    ci?.linuxStatus === 'success' && ci?.windowsStatus === 'success' &&
    ci?.qualificationScope === 'acl_repair_session_pooler_prequalification' &&
    ci?.requiredConnectionMode === 'session-pooler' &&
    ci?.migrationsPassed === 71 && ci?.sqlTestsStarted === 27 && ci?.sqlTestsPassed === 27 &&
    ci?.databaseTestsPassed === 7 && ci?.permissionTestsPassed === 11 && ci?.businessTestsPassed === 9 &&
    ci?.catalogAssertionsPassed === 4 && ci?.windowsStaticExpected === 19 && ci?.windowsStaticPassed === 19 &&
    ci?.windowsLocalExpected === 12 && ci?.windowsLocalPassed === 12 && ci?.linuxDatabaseAccepted === true &&
    ci?.cleanupPassed === true && ci?.candidateRemoteExecutionAllowed === false && ci?.g1OverallClaim === false &&
    ci?.productionReadPerformed === false && ci?.productionWritePerformed === false && ci?.retryPerformed === false &&
    ci?.priorSuccessfulRunPreservedWithoutRerun === '29733854344' &&
    ci?.priorParserFixRunPreservedWithoutRerun === '29738966326' &&
    ci?.formalAclRepairFailurePreservedWithoutRerun === 'p1-acl-repair-20260720T122757275Z-8fa1498850' &&
    ci?.databaseCiPassed === true && ci?.remoteQualificationAllowed === true &&
    ci?.currentQualificationAllowed === true && ci?.successEvidencePresent === true &&
    ci?.newIndependentCi === true &&
    priorSuccessfulRepairCiHistorical && priorFormalAclRepairFailurePreserved &&
    priorParserFixRepairCiHistorical && directDbFormalFailurePreserved && Boolean(findRepairSignedCiRun())
  const repairCiPending = repair.remoteExecutionAllowed === false && repair.dbPushAllowed === false &&
    repair.applicationCompatibility?.status === 'passed' &&
    repair.atomicLegacyRoleCompatibility?.status === 'static-passed-prior-database-ci-failed-preserved-new-candidate-pending' &&
    repair.atomicLegacyRoleCompatibility?.staticPassed === true &&
    repair.atomicLegacyRoleCompatibility?.databaseCiPassed === null &&
    repair.applicationCompatibility?.remoteQualificationAllowed === false &&
    repair.atomicLegacyRoleCompatibility?.remoteQualificationAllowed === false &&
    ci?.runId === '29726897764' && ci?.headSha === 'e774ead5a2857afb511400a12897e629033cf941' &&
    ci?.status === 'failure' && ci?.failedAssertionExpectedAuditRows === 6 &&
    ci?.failedAssertionActualAuditRows === 7 && ci?.preservedWithoutRerun === true &&
    ci?.candidateRemoteExecutionAllowed === false && ci?.g1OverallClaim === false
  const repairFormalFailureClosed =
    contract.contractStatus === 'p1_acl_repair_formal_dry_run_failed_qualification_closed' &&
    repair.remoteExecutionAllowed === false && repair.dbPushAllowed === false &&
    repair.applicationCompatibility?.status === 'passed' &&
    repair.applicationCompatibility?.remoteQualificationAllowed === false &&
    repair.atomicLegacyRoleCompatibility?.status === 'passed' &&
    repair.atomicLegacyRoleCompatibility?.staticPassed === true &&
    repair.atomicLegacyRoleCompatibility?.databaseCiPassed === null &&
    repair.atomicLegacyRoleCompatibility?.remoteQualificationAllowed === false &&
    priorSuccessfulRepairCiHistorical &&
    ci?.status === 'pending-new-signed-run' && ci?.runId === null && ci?.runUrl === null &&
    ci?.headSha === null && ci?.linuxJobId === null && ci?.windowsJobId === null &&
    ci?.conclusion === null && ci?.databaseCiPassed === null &&
    ci?.remoteQualificationAllowed === false && ci?.successEvidencePresent === false &&
    ci?.closedByFormalAclRepairFailureRunId === 'p1-acl-repair-20260720T104323349Z-4fa8de78a8' &&
    priorFormalAclRepairFailurePreserved
  const repairDirectDbFailureClosed =
    contract.contractStatus === 'p1_acl_repair_direct_db_dry_run_timeout_qualification_closed' &&
    repair.remoteExecutionAllowed === false && repair.dbPushAllowed === false &&
    repair.applicationCompatibility?.status === 'passed' &&
    repair.applicationCompatibility?.remoteQualificationAllowed === false &&
    repair.atomicLegacyRoleCompatibility?.status === 'passed' &&
    repair.atomicLegacyRoleCompatibility?.staticPassed === true &&
    repair.atomicLegacyRoleCompatibility?.databaseCiPassed === null &&
    repair.atomicLegacyRoleCompatibility?.remoteQualificationAllowed === false &&
    priorSuccessfulRepairCiHistorical && priorFormalAclRepairFailurePreserved &&
    priorParserFixRepairCiHistorical && directDbFormalFailurePreserved &&
    ci?.status === 'pending-session-pooler-new-signed-run' && ci?.runId === null && ci?.runUrl === null &&
    ci?.headSha === null && ci?.linuxJobId === null && ci?.windowsJobId === null && ci?.conclusion === null &&
    ci?.qualificationScope === 'acl_repair_session_pooler_prequalification' &&
    ci?.requiredConnectionMode === 'session-pooler' && ci?.newIndependentCiRequired === true &&
    ci?.databaseCiPassed === null && ci?.remoteQualificationAllowed === false &&
    ci?.currentQualificationAllowed === false && ci?.successEvidencePresent === false &&
    ci?.priorQualifiedRunId === '29738966326' &&
    ci?.closedByFormalAclRepairFailureRunId === 'p1-acl-repair-20260720T122757275Z-8fa1498850' &&
    ci?.g1OverallClaim === false
  const qualificationStateCount = [
    repairCiQualified, repairCiPending, repairFormalFailureClosed, repairDirectDbFailureClosed,
  ]
    .filter(Boolean).length
  if (contract.candidate.remoteExecutionAllowed !== false || contract.postApplyResume?.remoteExecutionAllowed !== false ||
      contract.postApplyResume?.dbPushAllowed !== false || !['--resume-post-apply', 'retired'].includes(contract.postApplyResume?.mode) ||
      qualificationStateCount !== 1) {
    throw new Error('old failed candidate is not retired or ACL repair qualification state is ambiguous')
  }
  const expectedFunctions = [
    ['public.enqueue_wecom_notification_jobs(text, timestamp with time zone)', ['service_role']],
    ['public.claim_wecom_notification_jobs(integer, timestamp with time zone)', ['service_role']],
    ['public.complete_wecom_notification_job(uuid, boolean, text, text, timestamp with time zone)', ['service_role']],
    ['public.manage_profile_access(uuid, text[], uuid[])', []],
    ['public.admin_replace_profile_roles(uuid, text[], uuid)', []],
    ['public.admin_replace_supervisor_subordinates(uuid, uuid[], uuid)', []],
  ].map(([identity, requiredGrantRoles]) => ({
    identity, revokeRoles: ['PUBLIC', 'anon', 'authenticated'], requiredGrantRoles,
  }))
  const expectedAtomicMapping = [
    { condition: 'primary-admin', legacyRole: 'admin' },
    { condition: 'additional-supervisor', legacyRole: 'captain' },
    { condition: 'primary-finance', legacyRole: 'finance' },
    { condition: 'additional-warehouse', legacyRole: 'warehouse' },
    { condition: 'fallback', legacyRole: 'member' },
  ]
  const privateDefinition = repair.privateRoutineDefinitionTransition
  const atomicCompatibility = repair.atomicLegacyRoleCompatibility
  if (repair.mode !== '--apply-acl-repair' || repair.migrationPath !==
      'supabase/migrations/20260720015435_harden_server_only_rpc_acl.sql' ||
      JSON.stringify(repair.testPaths) !== JSON.stringify({
        teamOs4P1: 'supabase/tests/team_os_4_p1_access_shell.sql',
        notificationCore: 'supabase/tests/notification_core.sql',
      }) || JSON.stringify(repair.testSha256Lf) !== JSON.stringify({
        teamOs4P1: 'c598b4e4ed3c7e26d9411cb4084685bea1233f47ae969c2685e048f480dac09e',
        notificationCore: 'a3d87069899b986b191bc21826f5e23c65fe4734066e52adc4e14753c9e6e5a3',
      }) ||
      repair.preMigrationRows !== 70 || repair.postMigrationRows !== 71 ||
      repair.expectedMigrationCount !== 71 || repair.sqlTestCount !== 27 ||
      repair.maxFormalAttempts !== 1 || repair.maxDbPushAttempts !== 1 || repair.dryRunRequired !== true ||
      JSON.stringify(repair.pendingMigrationVersions) !== JSON.stringify([REPAIR_VERSION]) ||
      JSON.stringify(repair.targetFunctions) !== JSON.stringify(expectedFunctions) ||
      JSON.stringify(repair.expectedChangedFunctions) !==
        JSON.stringify(expectedFunctions.slice(0, 4).map((entry) => entry.identity)) ||
      JSON.stringify(repair.allowedFullReconciliationDifferences) !==
        JSON.stringify(['migrationHistory.schemaMigrations', 'schemaSecurity.publicRoutinesMd5']) ||
      repair.unknownDifferencesAllowed !== false ||
      JSON.stringify(privateDefinition?.expectedChangedFunctions) !== JSON.stringify([PRIVATE_MEMBER_ACCESS_IDENTITY]) ||
      privateDefinition?.expectedDefinitionChanges !== 1 || privateDefinition?.identityChangesAllowed !== 0 ||
      privateDefinition?.securityEnvelopeChangesAllowed !== 0 || privateDefinition?.unknownChangesAllowed !== false ||
      atomicCompatibility?.status !== (repairCiPending
        ? 'static-passed-prior-database-ci-failed-preserved-new-candidate-pending'
        : 'passed') ||
      atomicCompatibility?.staticPassed !== true ||
      atomicCompatibility?.databaseCiPassed !== (repairCiQualified ? true : null) ||
      atomicCompatibility?.remoteQualificationAllowed !== repairCiQualified ||
      atomicCompatibility?.writeFunction !== PRIVATE_MEMBER_ACCESS_IDENTITY ||
      JSON.stringify(atomicCompatibility?.mappingPrecedence) !== JSON.stringify(expectedAtomicMapping) ||
      atomicCompatibility?.successfulMappingCases !== 5 || atomicCompatibility?.rollbackControls !== 2 ||
      atomicCompatibility?.sameTeamStaticGuards !== 4 || atomicCompatibility?.remoteGateNegativeControls !== 5 ||
      atomicCompatibility?.atomicRemoteGateNegativeControls !== 2 ||
      atomicCompatibility?.migrationRewritesExistingProfiles !== false ||
      atomicCompatibility?.appShellAssertionsPassed !== 99 || atomicCompatibility?.appShellAssertionsExpected !== 99) {
    throw new Error('ACL repair migration/function/difference allow-list contract drift')
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
      full.expected?.migrationRows !== repair.postMigrationRows ||
      JSON.stringify(full.expected?.keyAmountKeys) !== JSON.stringify(['currency', 'customerPayments', 'internalPayables', 'salesProfit', 'points', 'laborEarnings']) ||
      JSON.stringify(full.expected?.inventoryKeys) !== JSON.stringify(['onHand', 'reserved', 'shipped']) ||
      JSON.stringify(full.expected?.rawLedgerKeys) !== JSON.stringify(['customerPaymentGross', 'customerPaymentReversals', 'internalDue', 'internalPaid', 'internalSettlements', 'procurementPayments', 'salesExpenses', 'quarterlyRebates', 'companyExpenses']) ||
      full.execution?.initialFullBeforeRepair !== true || full.execution?.fullAfterEverySqlTest !== true ||
      full.execution?.perTestFullSnapshots !== contract.expected.tests ||
      full.execution?.finalFullAfterFreshCredential !== true ||
      full.execution?.beforeAfterAllowedAclTransitionOnly !== true ||
      full.execution?.storageArchiveAtInitialAndFinal !== true ||
      full.execution?.temporaryTestSessionsOnly !== true ||
      full.execution?.persistentDatabaseWrites !== 'exactly-one-signed-acl-and-atomic-compatibility-migration' ||
      full.execution?.sessionClosedDropsTemp !== true ||
      JSON.stringify(full.allowedPersistentContentDifferencesFromSealedSource) !== JSON.stringify(allowedDifferences) ||
      full.expectedSchemaAndHistoryDifference !== 'exact-signed-P1-plus-ACL-repair-migrations-only' ||
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
  const repairMigrationPath = resolve(repoRoot, repair.migrationPath)
  const repairTeamOsTestPath = resolve(repoRoot, repair.testPaths.teamOs4P1)
  const repairNotificationTestPath = resolve(repoRoot, repair.testPaths.notificationCore)
  const accessControlTestPath = resolve(repoRoot, contract.postApplyResume.accessControlTestPath)
  const atomicSqlTestPath = resolve(repoRoot, atomicCompatibility.sqlTestPath)
  const atomicEdgeFunctionPath = resolve(repoRoot, atomicCompatibility.edgeFunctionPath)
  const atomicStaticTestPath = resolve(repoRoot, atomicCompatibility.staticTestPath)
  if (sha256Lf(migrationPath) !== contract.candidate.migrationSha256Lf ||
      sha256Lf(repairMigrationPath) !== repair.migrationSha256Lf ||
      repair.migrationSha256Lf !== '1bb13f29fc0f5512bd00115dc1c953a2c3aaa0ec21522b1cc8cbb45a18a5cdc0' ||
      sha256Lf(repairTeamOsTestPath) !== repair.testSha256Lf.teamOs4P1 ||
      sha256Lf(repairNotificationTestPath) !== repair.testSha256Lf.notificationCore ||
      sha256Lf(accessControlTestPath) !== contract.postApplyResume.accessControlTestSha256Lf ||
      atomicCompatibility.sqlTestPath !== repair.testPaths.teamOs4P1 ||
      atomicCompatibility.sqlTestSha256Lf !== repair.testSha256Lf.teamOs4P1 ||
      sha256Lf(atomicSqlTestPath) !== atomicCompatibility.sqlTestSha256Lf ||
      atomicCompatibility.edgeFunctionPath !== 'supabase/functions/admin-members/index.ts' ||
      sha256Lf(atomicEdgeFunctionPath) !== atomicCompatibility.edgeFunctionSha256Lf ||
      atomicCompatibility.staticTestPath !== 'scripts/p1/verify-access-admin-v1-write-chain.ts' ||
      sha256Lf(atomicStaticTestPath) !== atomicCompatibility.staticTestSha256Lf) {
    throw new Error('P1/ACL repair candidate hash drift')
  }
  if (migrationManifest.entries.length !== repair.expectedMigrationCount ||
      migrationManifest.entries.at(-1)?.version !== REPAIR_VERSION ||
      migrationManifest.entries.at(-1)?.sha256 !== repair.migrationSha256Lf) {
    throw new Error('P1 migration manifest is not an exact signed 71-migration chain')
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
  const head = requireSuccess('git head', run('git', ['rev-parse', 'HEAD'])).stdout.trim()
  requireSuccess('signed CI ancestry', run('git', [
    'merge-base', '--is-ancestor', contract.candidate.signedCiHeadSha, head,
  ]))
  requireSuccess('supervision evidence ancestry', run('git', [
    'merge-base', '--is-ancestor', contract.candidate.requiredAncestorSha, head,
  ]))
  return repairCiQualified ? 'qualified' : 'prequalification-pending'
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
  proveMigrationSets(local, remote, [REPAIR_VERSION])
  const migrationNegativeCases = [
    () => proveMigrationSets(local.slice(0, -1), remote, [REPAIR_VERSION]),
    () => proveMigrationSets([...local, { version: '20990101000000', status: 'signed', sha256Lf: 'a'.repeat(64) }], remote, [REPAIR_VERSION]),
    () => proveMigrationSets(local, remote.slice(0, -1), [REPAIR_VERSION]),
    () => proveMigrationSets(local, [...remote, { version: '20990101000000', status: 'applied' }], [REPAIR_VERSION]),
    () => proveMigrationSets(local, [...remote].reverse(), [REPAIR_VERSION]),
    () => proveMigrationSets(local, remote.map((entry, index) => index === 0 ? { ...entry, status: 'pending' } : entry), [REPAIR_VERSION]),
  ]
  let migrationNegativePassed = 0
  for (const test of migrationNegativeCases) {
    try { test() } catch { migrationNegativePassed += 1 }
  }
  if (positive.length !== 0 || negativePassed !== negativeCases.length || migrationNegativePassed !== migrationNegativeCases.length) {
    throw new Error('ACL repair runner boundary/migration self-test failed')
  }
  const stagedFiles = migrationManifest.entries.map((entry) => entry.file)
  const stagedHashes = local.map((entry) => entry.sha256Lf)
  validateStagedMigrationInventory(stagedFiles, stagedHashes, local)
  const stagedInventoryNegativeCases = [
    () => validateStagedMigrationInventory([], [], local),
    () => validateStagedMigrationInventory(stagedFiles, stagedHashes.map((hash, index) => index === 70 ? '0'.repeat(64) : hash), local),
    () => validateStagedMigrationInventory(stagedFiles.slice(1), stagedHashes.slice(1), local),
  ]
  let stagedInventoryNegativePassed = 0
  for (const test of stagedInventoryNegativeCases) {
    try { test() } catch { stagedInventoryNegativePassed += 1 }
  }
  const expectedDryRunFile = `${REPAIR_VERSION}_harden_server_only_rpc_acl.sql`
  const dryRunPositiveCases = [
    collectRepairPushDryRunEvidence(
      `\u001b[32mWould push these migrations:\u001b[0m\n • ${expectedDryRunFile}\nrequest-id=12345678901234`,
      '',
    ),
    collectRepairPushDryRunEvidence(
      '',
      `Would push these migrations:\r\n C:\\signed\\${expectedDryRunFile}\r\nunrelated=20991231235959`,
    ),
  ]
  for (const evidence of dryRunPositiveCases) assertRepairPushDryRun(evidence)
  const dryRunNegativeCases = [
    collectRepairPushDryRunEvidence(`Would push:\n${REPAIR_VERSION}`, ''),
    collectRepairPushDryRunEvidence(`Would push:\n${REPAIR_VERSION}_wrong.sql`, ''),
    collectRepairPushDryRunEvidence(
      `Would push:\n${expectedDryRunFile}\n20990101000000_unexpected.sql`,
      '',
    ),
    collectRepairPushDryRunEvidence('Would push no migrations', ''),
  ]
  let dryRunNegativePassed = 0
  for (const evidence of dryRunNegativeCases) {
    try { assertRepairPushDryRun(evidence) } catch { dryRunNegativePassed += 1 }
  }
  const preservedDryRunAttempt = {
    dryRun: collectRepairPushDryRunEvidence(
      `${REPAIR_VERSION}_wrong.sql\nPGPASSWORD=synthetic-must-not-survive`,
      'postgresql://synthetic-must-not-survive',
    ),
  }
  let preservedDryRunFailureStopped = false
  try { assertRepairPushDryRun(preservedDryRunAttempt.dryRun) } catch { preservedDryRunFailureStopped = true }
  const preservedDryRunEvidence = safeEvidence(preservedDryRunAttempt)
  if (dryRunPositiveCases.some((evidence) => (
        JSON.stringify(evidence.actualVersions) !== JSON.stringify([REPAIR_VERSION]) ||
        JSON.stringify(evidence.actualMigrationFiles) !== JSON.stringify([expectedDryRunFile]) ||
        evidence.expectedMigrationFile !== expectedDryRunFile ||
        !/^[a-f0-9]{64}$/.test(evidence.outputSha256) ||
        JSON.stringify(Object.keys(evidence).sort()) !== JSON.stringify([
          'actualMigrationFiles', 'actualVersions', 'expectedMigrationFile', 'outputSha256',
        ])
      )) || dryRunNegativePassed !== dryRunNegativeCases.length || !preservedDryRunFailureStopped ||
      !preservedDryRunEvidence.includes('"actualVersions"') ||
      !preservedDryRunEvidence.includes('"actualMigrationFiles"') ||
      !preservedDryRunEvidence.includes('"expectedMigrationFile"') ||
      !preservedDryRunEvidence.includes('"outputSha256"') ||
      /synthetic-must-not-survive|PGPASSWORD|postgresql:\/\//i.test(preservedDryRunEvidence)) {
    throw new Error('ACL repair dry-run evidence self-test failed')
  }
  const syntheticPoolerEnvironment = {
    PGHOST: 'aws-0-ap-southeast-1.pooler.supabase.com',
    PGPORT: '5432',
    PGUSER: `cli_login_postgres.${TARGET_REF}`,
    PGPASSWORD: 'synthetic-pooler-password-must-not-survive',
    PGDATABASE: 'postgres',
    PGSSLMODE: 'require',
    PGCLIENTENCODING: 'UTF8',
    PGOPTIONS: '-c jit=true',
  }
  const syntheticPoolerChannel = { workdir: temp, dbEnvironment: syntheticPoolerEnvironment }
  const syntheticInheritedEnvironment = {
    ...process.env,
    SUPABASE_DB_PASSWORD: 'synthetic-supabase-db-password-must-not-survive',
    SUPABASE_DB_URL: 'postgresql://synthetic-secret-must-not-survive',
    DATABASE_URL: 'postgresql://synthetic-secret-must-not-survive',
    PGPASSFILE: 'synthetic-pgpassfile-must-not-survive',
    PGSERVICE: 'synthetic-pgservice-must-not-survive',
    PGSERVICEFILE: 'synthetic-pgservicefile-must-not-survive',
  }
  const poolerPushInvocations = [
    buildSessionPoolerPushInvocation(syntheticPoolerChannel, { dryRun: true }, syntheticInheritedEnvironment),
    buildSessionPoolerPushInvocation(syntheticPoolerChannel, { dryRun: false }, syntheticInheritedEnvironment),
  ]
  let poolerInvocationEvidenceDenied = false
  try { safeEvidence({ poolerPushInvocation: poolerPushInvocations[0] }) } catch { poolerInvocationEvidenceDenied = true }
  const poolerPushPositivePassed = poolerPushInvocations.filter((invocation, index) => {
    const dbUrlIndex = invocation.args.indexOf('--db-url')
    const dbUrl = invocation.args[dbUrlIndex + 1]
    return invocation.args[0] === 'db' && invocation.args[1] === 'push' && dbUrlIndex === 2 &&
      invocation.args.includes('--dry-run') === (index === 0) &&
      !invocation.args.includes('--linked') && !invocation.args.includes('--password') &&
      !invocation.args.join(' ').includes(syntheticPoolerEnvironment.PGPASSWORD) &&
      assertPasswordlessSessionPoolerUrl(dbUrl, syntheticPoolerEnvironment) &&
      invocation.childEnvironment.PGPASSWORD === syntheticPoolerEnvironment.PGPASSWORD &&
      invocation.childEnvironment.PGSSLMODE === 'require' &&
      invocation.childEnvironment.SUPABASE_DB_PASSWORD === undefined &&
      invocation.childEnvironment.SUPABASE_DB_URL === undefined &&
      invocation.childEnvironment.DATABASE_URL === undefined &&
      invocation.childEnvironment.PGPASSFILE === undefined &&
      invocation.childEnvironment.PGSERVICE === undefined &&
      invocation.childEnvironment.PGSERVICEFILE === undefined
  }).length
  const poolerPushNegativeCases = [
    () => buildSessionPoolerPushInvocation({
      ...syntheticPoolerChannel,
      dbEnvironment: { ...syntheticPoolerEnvironment, PGHOST: `db.${TARGET_REF}.supabase.co` },
    }, { dryRun: true }),
    () => buildSessionPoolerPushInvocation({
      ...syntheticPoolerChannel,
      dbEnvironment: { ...syntheticPoolerEnvironment, PGHOST: 'pooler.invalid.example' },
    }, { dryRun: true }),
    () => buildSessionPoolerPushInvocation({
      ...syntheticPoolerChannel,
      dbEnvironment: { ...syntheticPoolerEnvironment, PGPORT: '6543' },
    }, { dryRun: true }),
    () => buildSessionPoolerPushInvocation({
      ...syntheticPoolerChannel,
      dbEnvironment: { ...syntheticPoolerEnvironment, PGUSER: 'cli_login_postgres.wrongref' },
    }, { dryRun: true }),
    () => buildSessionPoolerPushInvocation({
      ...syntheticPoolerChannel,
      dbEnvironment: { ...syntheticPoolerEnvironment, PGSSLMODE: 'disable' },
    }, { dryRun: true }),
    () => buildSessionPoolerPushInvocation({
      ...syntheticPoolerChannel,
      dbEnvironment: { ...syntheticPoolerEnvironment, PGPASSWORD: '' },
    }, { dryRun: true }),
    () => assertPasswordlessSessionPoolerUrl(
      `postgresql://postgres:forbidden@${syntheticPoolerEnvironment.PGHOST}:5432/postgres?sslmode=require`,
      syntheticPoolerEnvironment,
    ),
  ]
  let poolerPushNegativePassed = 0
  for (const test of poolerPushNegativeCases) {
    try { test() } catch { poolerPushNegativePassed += 1 }
  }
  for (const invocation of poolerPushInvocations) clearPushInvocationSecret(invocation)
  const poolerPushSecretsCleared = poolerPushInvocations
    .filter((invocation) => invocation.childEnvironment.PGPASSWORD === '').length
  if (poolerPushPositivePassed !== poolerPushInvocations.length ||
      poolerPushNegativePassed !== poolerPushNegativeCases.length || !poolerInvocationEvidenceDenied ||
      poolerPushSecretsCleared !== poolerPushInvocations.length) {
    throw new Error('ACL repair Session Pooler push invocation self-test failed')
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

  const before70 = {
    reachable: true,
    migrationVersions: remote.map((entry) => entry.version),
    migrationHistory: remote,
    p1MigrationApplied: true,
    p1ColumnPresent: true,
    p1PublicFunctions: 6,
    authUsers: contract.expected.authUsers,
    authIdentities: contract.fullReconciliation.expected.auth.identities,
    bannedAuthUsers: contract.fullReconciliation.expected.auth.bannedUsers,
    p1AuthFixtureUsers: 0,
    p1ProfileFixtureRows: 0,
    p1RegionFixtureRows: 0,
    p1RequestFixtureRows: 0,
    idleInTransactionSessions: 0,
    teams: 1,
    p1FeatureFlags: 1,
    teamsMissingP1Flag: 0,
    storageBuckets: 1,
    storageObjects: 32,
    publicRowCounts: { feature_flags: 1, profile_access_roles: 10, profiles: 7, teams: 1 },
  }
  const postHistory = local.map((entry) => ({ version: entry.version, status: 'applied' }))
  const after71 = {
    ...before70,
    migrationVersions: postHistory.map((entry) => entry.version),
    migrationHistory: postHistory,
  }
  const syntheticSourceEvidence = {
    preflight: {
      initialLightSnapshot: {
        canonicalSha256: canonicalSha256(before70),
        publicRowCountsSha256: canonicalSha256(before70.publicRowCounts),
      },
    },
  }
  assertExact70RepairBaseline(syntheticSourceEvidence, before70)
  assertExact71RepairBaseline(before70, after71)
  assertRepairStable(before70, after71, JSON.parse(JSON.stringify(after71)))
  const repairBaselineNegativeCases = [
    () => assertExact70RepairBaseline(syntheticSourceEvidence, after71),
    () => assertExact71RepairBaseline(before70, { ...after71, authUsers: after71.authUsers + 1 }),
    () => assertRepairStable(before70, after71, {
      ...after71, publicRowCounts: { ...after71.publicRowCounts, profiles: 8 },
    }),
  ]
  let repairBaselineNegativePassed = 0
  for (const test of repairBaselineNegativeCases) {
    try { test() } catch { repairBaselineNegativePassed += 1 }
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
  const syntheticPublicRows = { ...before70.publicRowCounts }
  for (let index = 0; index < 99; index += 1) syntheticPublicRows[`synthetic_table_${String(index).padStart(3, '0')}`] = 0
  const syntheticLight70 = { ...before70, publicRowCounts: syntheticPublicRows }
  const syntheticLight71 = { ...after71, publicRowCounts: syntheticPublicRows }
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
  const syntheticFull70 = syntheticFullSnapshot
  const syntheticFull71 = {
    ...syntheticFull70,
    migrationHistory: { schemaMigrations: 71 },
    schemaSecurity: { ...syntheticSchemaSecurity, publicRoutinesMd5: 'b'.repeat(32) },
  }
  const syntheticFull70Summary = assertSealedFullReconciliation(baseline, syntheticLight70, syntheticFull70, 70)
  const syntheticFull71Summary = assertSealedFullReconciliation(baseline, syntheticLight71, syntheticFull71, 71)
  assertFullReconciliationStable(syntheticFull70Summary, { ...syntheticFull70Summary })
  assertAclRepairFullTransition(syntheticFull70, syntheticFull71)
  assertFullReconciliationStable(syntheticFull71Summary, { ...syntheticFull71Summary })
  assertSignedStorageSummary(baseline, contract.fullReconciliation.expected.storage)
  const reconciliationNegativeCases = [
    () => assertSealedFullReconciliation(baseline, syntheticLight71, {
      ...syntheticFull71,
      keyAmounts: { ...syntheticKeyAmounts, customerPayments: 501 },
    }, 71),
    () => assertAclRepairFullTransition(syntheticFull70, {
      ...syntheticFull71,
      inventory: { ...syntheticInventory, onHand: 1 },
    }),
    () => assertAclRepairFullTransition(syntheticFull70, {
      ...syntheticFull71,
      schemaSecurity: { ...syntheticFull71.schemaSecurity, publicTableAclMd5: 'c'.repeat(32) },
    }),
    () => assertAclRepairFullTransition(syntheticFull70, {
      ...syntheticFull71,
      schemaSecurity: { ...syntheticFull70.schemaSecurity },
    }),
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

  const aclEntry = (grantee) => ({ grantee, privilege: 'EXECUTE', grantable: false })
  const targetIdentities = contract.aclRepair.targetFunctions.map((entry) => entry.identity)
  const expectedChangedIdentitySet = new Set(contract.aclRepair.expectedChangedFunctions)
  const allIdentities = [...targetIdentities, 'public.synthetic_unchanged()'].sort()
  const beforeRoutineAcls = Object.fromEntries(allIdentities.map((identity) => [
    identity,
    identity === 'public.synthetic_unchanged()' || !expectedChangedIdentitySet.has(identity)
      ? [aclEntry('postgres')]
      : [aclEntry('anon'), aclEntry('authenticated'), aclEntry('service_role')],
  ]))
  const afterRoutineAcls = Object.fromEntries(allIdentities.map((identity) => [
    identity,
    identity === 'public.synthetic_unchanged()' || !expectedChangedIdentitySet.has(identity)
      ? [aclEntry('postgres')]
      : [aclEntry('service_role')],
  ]))
  const beforeEffective = Object.fromEntries(allIdentities.map((identity) => [identity, {
    PUBLIC: false,
    anon: expectedChangedIdentitySet.has(identity),
    authenticated: expectedChangedIdentitySet.has(identity),
    service_role: expectedChangedIdentitySet.has(identity),
  }]))
  const afterEffective = Object.fromEntries(allIdentities.map((identity) => [identity, {
    PUBLIC: false, anon: false, authenticated: false, service_role: expectedChangedIdentitySet.has(identity),
  }]))
  const beforeAcl = { allRoutineAcls: beforeRoutineAcls, allRoutineEffectiveExecute: beforeEffective }
  const afterAcl = { allRoutineAcls: afterRoutineAcls, allRoutineEffectiveExecute: afterEffective }
  assertRoutineAclRepairTransition(beforeAcl, afterAcl)
  const aclNegativeCases = [
    () => assertRoutineAclRepairTransition(beforeAcl, {
      ...afterAcl,
      allRoutineAcls: { ...afterRoutineAcls, 'public.synthetic_unchanged()': [aclEntry('anon')] },
      allRoutineEffectiveExecute: {
        ...afterEffective,
        'public.synthetic_unchanged()': { ...afterEffective['public.synthetic_unchanged()'], anon: true },
      },
    }),
    () => assertRoutineAclRepairTransition(beforeAcl, {
      ...afterAcl,
      allRoutineAcls: { ...afterRoutineAcls, [targetIdentities[0]]: [] },
      allRoutineEffectiveExecute: {
        ...afterEffective, [targetIdentities[0]]: { ...afterEffective[targetIdentities[0]], service_role: false },
      },
    }),
    () => assertRoutineAclRepairTransition(beforeAcl, {
      ...afterAcl,
      allRoutineAcls: { ...afterRoutineAcls, [targetIdentities[1]]: beforeRoutineAcls[targetIdentities[1]] },
      allRoutineEffectiveExecute: { ...afterEffective, [targetIdentities[1]]: beforeEffective[targetIdentities[1]] },
    }),
  ]
  let aclNegativePassed = 0
  for (const test of aclNegativeCases) {
    try { test() } catch { aclNegativePassed += 1 }
  }

  const privateDefinitionBefore = {
    identity: PRIVATE_MEMBER_ACCESS_IDENTITY,
    definitionSha256: 'a'.repeat(64),
    owner: 'postgres',
    language: 'plpgsql',
    securityDefiner: true,
    configuration: ['search_path='],
    returnType: 'jsonb',
  }
  const privateDefinitionAfter = { ...privateDefinitionBefore, definitionSha256: 'b'.repeat(64) }
  assertPrivateRoutineDefinitionTransition(privateDefinitionBefore, privateDefinitionAfter)
  assertPrivateRoutineDefinitionStable(privateDefinitionAfter, { ...privateDefinitionAfter })
  const privateDefinitionNegativeCases = [
    () => assertPrivateRoutineDefinitionTransition(privateDefinitionBefore, { ...privateDefinitionBefore }),
    () => assertPrivateRoutineDefinitionTransition(privateDefinitionBefore, {
      ...privateDefinitionAfter, identity: 'private.synthetic_member_access()',
    }),
    () => assertPrivateRoutineDefinitionTransition(privateDefinitionBefore, {
      ...privateDefinitionAfter, securityDefiner: false,
    }),
  ]
  let privateDefinitionNegativePassed = 0
  for (const test of privateDefinitionNegativeCases) {
    try { test() } catch { privateDefinitionNegativePassed += 1 }
  }

  const evidenceBytes = Buffer.from(JSON.stringify({ runId: 'synthetic-resume-evidence' }), 'utf8')
  parseEvidenceBytes(evidenceBytes, sha256(evidenceBytes), 'synthetic evidence')
  const syntheticManifestBytes = Buffer.from(JSON.stringify(syntheticManifest), 'utf8')
  const syntheticRestoreEvidenceBytes = Buffer.from(JSON.stringify(syntheticRestoreEvidence), 'utf8')
  const evidenceNegativeCases = [
    () => parseEvidenceBytes(evidenceBytes, '0'.repeat(64), 'synthetic evidence'),
    () => parseEvidenceBytes(Buffer.from('{', 'utf8'), sha256(Buffer.from('{', 'utf8')), 'synthetic evidence'),
    () => safeEvidence({ marker: 'PGPASSWORD=must-not-survive' }),
    () => safeEvidence({ stdout: 'raw output must not survive' }),
    () => safeEvidence({ stderr: 'raw error output must not survive' }),
    () => parseEvidenceBytes(syntheticManifestBytes, '0'.repeat(64), 'synthetic manifest'),
    () => parseEvidenceBytes(syntheticRestoreEvidenceBytes, '0'.repeat(64), 'synthetic restore evidence'),
  ]
  let evidenceNegativePassed = 0
  for (const test of evidenceNegativeCases) {
    try { test() } catch { evidenceNegativePassed += 1 }
  }

  const cleanCommittedBoundary = validateRepairWorktreeBoundary(
    'b'.repeat(40),
    'a'.repeat(40),
    '',
  )
  const worktreeBoundaryNegativePassed = [
    validateRepairWorktreeBoundary('a'.repeat(40), 'a'.repeat(40), ''),
    validateRepairWorktreeBoundary('b'.repeat(40), 'a'.repeat(40), ' M tracked.sql'),
  ].filter((candidate) => !candidate.committedAfterSignedHead || !candidate.trackedWorktreeClean).length
  const oldModesDenied = ['--execute', '--dry-run', '--resume-post-apply'].filter((candidateMode) => !validateMode(candidateMode)).length
  const qualifiedRepair = {
    ...contract.aclRepair,
    remoteExecutionAllowed: true,
    dbPushAllowed: true,
    applicationCompatibility: { status: 'passed', remoteQualificationAllowed: true },
    atomicLegacyRoleCompatibility: {
      status: 'passed', staticPassed: true, databaseCiPassed: true, remoteQualificationAllowed: true,
    },
  }
  const qualifiedCi = {
    runId: '39999999999',
    runUrl: 'https://github.com/yccanwin/canwin-team-os/actions/runs/39999999999',
    linuxJobId: '99999999991',
    windowsJobId: '99999999992',
    headSha: 'a'.repeat(40),
    status: 'success',
    conclusion: 'success',
    qualificationScope: 'acl_repair_session_pooler_prequalification',
    requiredConnectionMode: 'session-pooler',
    evidenceScope: 'current-independent-session-pooler-ci',
    priorSuccessfulRunPreservedWithoutRerun: '29733854344',
    priorParserFixRunPreservedWithoutRerun: '29738966326',
    formalAclRepairFailurePreservedWithoutRerun: 'p1-acl-repair-20260720T122757275Z-8fa1498850',
    databaseCiPassed: true,
    remoteQualificationAllowed: true,
    currentQualificationAllowed: true,
    successEvidencePresent: true,
    newIndependentCi: true,
    migrationsPassed: 71,
    sqlTestsStarted: 27,
    sqlTestsPassed: 27,
    databaseTestsPassed: 7,
    permissionTestsPassed: 11,
    businessTestsPassed: 9,
    catalogAssertionsPassed: 4,
    windowsStaticExpected: 19,
    windowsStaticPassed: 19,
    windowsLocalExpected: 12,
    windowsLocalPassed: 12,
    linuxDatabaseAccepted: true,
    cleanupPassed: true,
    candidateRemoteExecutionAllowed: false,
    g1OverallClaim: false,
    productionReadPerformed: false,
    productionWritePerformed: false,
    retryPerformed: false,
  }
  const qualifiedHistoryEntry = {
    runId: qualifiedCi.runId,
    runUrl: qualifiedCi.runUrl,
    jobId: qualifiedCi.linuxJobId,
    windowsJobId: qualifiedCi.windowsJobId,
    headSha: qualifiedCi.headSha,
    conclusion: 'success',
    qualificationScope: 'acl_repair_session_pooler_prequalification',
    requiredConnectionMode: 'session-pooler',
    newIndependentCi: true,
    windowsLocalGatePassed: true,
    windowsStaticGatesExpected: 19,
    windowsStaticGatesPassed: 19,
    windowsLocalIntegrationStepsExpected: 12,
    windowsLocalIntegrationStepsPassed: 12,
    migrationsPassed: 71,
    sqlTestsPassed: 27,
    catalogAssertionsPassed: 4,
    databaseTestsPassed: 7,
    permissionTestsPassed: 11,
    businessTestsPassed: 9,
    productionReadPerformed: false,
    productionWritePerformed: false,
  }
  const independentCiHistoryPositive = findRepairSignedCiRun(qualifiedCi, [qualifiedHistoryEntry]) !== null
  const independentCiHistoryNegativeCases = [
    [{ ...qualifiedHistoryEntry, qualificationScope: 'acl_repair_parser_fix_prequalification' }],
    [{ ...qualifiedHistoryEntry, requiredConnectionMode: 'direct-database-host' }],
    [{ ...qualifiedHistoryEntry, newIndependentCi: false }],
    [qualifiedHistoryEntry, { ...qualifiedHistoryEntry }],
    [{ ...qualifiedHistoryEntry, runUrl: 'https://github.com/yccanwin/canwin-team-os/actions/runs/1' }],
  ]
  const independentCiHistoryNegativePassed = independentCiHistoryNegativeCases
    .filter((history) => findRepairSignedCiRun(qualifiedCi, history) === null).length
  const unqualifiedRepair = { ...qualifiedRepair, remoteExecutionAllowed: false, dbPushAllowed: false }
  const atomicDatabaseUnqualifiedRepair = {
    ...qualifiedRepair,
    atomicLegacyRoleCompatibility: {
      ...qualifiedRepair.atomicLegacyRoleCompatibility,
      databaseCiPassed: false,
    },
  }
  const atomicRemoteLockedRepair = {
    ...qualifiedRepair,
    atomicLegacyRoleCompatibility: {
      ...qualifiedRepair.atomicLegacyRoleCompatibility,
      remoteQualificationAllowed: false,
    },
  }
  const repairGateNegativeCases = [
    () => validateRepairRemoteGate('--apply-acl-repair', unqualifiedRepair, qualifiedCi),
    () => validateRepairRemoteGate('--apply-acl-repair', qualifiedRepair, { ...qualifiedCi, status: 'failure' }),
    () => validateRepairRemoteGate('--apply-acl-repair', qualifiedRepair, {
      ...qualifiedCi, qualificationScope: 'acl_repair_parser_fix_prequalification',
    }),
    () => validateRepairRemoteGate('--apply-acl-repair', qualifiedRepair, {
      ...qualifiedCi, requiredConnectionMode: 'direct',
    }),
    () => validateRepairRemoteGate('--resume-post-apply', qualifiedRepair, qualifiedCi),
    () => validateRepairRemoteGate('--apply-acl-repair', atomicDatabaseUnqualifiedRepair, qualifiedCi),
    () => validateRepairRemoteGate('--apply-acl-repair', atomicRemoteLockedRepair, qualifiedCi),
  ]
  const repairGateNegativePassed = repairGateNegativeCases.filter((test) => test() === false).length
  const syntheticClosedRepair = {
    ...qualifiedRepair,
    remoteExecutionAllowed: false,
    dbPushAllowed: false,
    applicationCompatibility: { status: 'passed', remoteQualificationAllowed: false },
    atomicLegacyRoleCompatibility: {
      ...qualifiedRepair.atomicLegacyRoleCompatibility,
      databaseCiPassed: null,
      remoteQualificationAllowed: false,
    },
  }
  const syntheticClosedCi = {
    status: 'pending-session-pooler-new-signed-run',
    runId: null,
    headSha: null,
    databaseCiPassed: null,
    remoteQualificationAllowed: false,
    successEvidencePresent: false,
  }
  const closedRepairGateNegativePassed = [
    () => validateRepairRemoteGate('--apply-acl-repair', syntheticClosedRepair, syntheticClosedCi),
    () => validateRepairRemoteGate(
      '--apply-acl-repair', qualifiedRepair, contract.priorSuccessfulRepairCiRunEvidence,
    ),
    () => validateRepairRemoteGate(
      '--apply-acl-repair', qualifiedRepair, contract.priorParserFixRepairCiRunEvidence,
    ),
  ].filter((test) => test() === false).length
  const currentClosedRepairGateDenied = !validateRepairRemoteGate(
    '--apply-acl-repair', contract.aclRepair, contract.repairCiRunEvidence,
  )
  const relabelAsCurrentSessionPoolerCi = (candidate) => ({
    ...candidate,
    status: 'success',
    conclusion: 'success',
    qualificationScope: 'acl_repair_session_pooler_prequalification',
    requiredConnectionMode: 'session-pooler',
    evidenceScope: 'current-independent-session-pooler-ci',
    priorSuccessfulRunPreservedWithoutRerun: '29733854344',
    priorParserFixRunPreservedWithoutRerun: '29738966326',
    formalAclRepairFailurePreservedWithoutRerun: 'p1-acl-repair-20260720T122757275Z-8fa1498850',
    databaseCiPassed: true,
    remoteQualificationAllowed: true,
    currentQualificationAllowed: true,
    successEvidencePresent: true,
    newIndependentCi: true,
  })
  const relabeledRevivalNegativeCases = [
    () => validateRepairRemoteGate(
      '--apply-acl-repair', qualifiedRepair,
      relabelAsCurrentSessionPoolerCi(contract.priorRepairCiFailureEvidence),
    ),
    () => validateRepairRemoteGate(
      '--apply-acl-repair', qualifiedRepair,
      relabelAsCurrentSessionPoolerCi(contract.priorSuccessfulRepairCiRunEvidence),
    ),
    () => validateRepairRemoteGate(
      '--apply-acl-repair', qualifiedRepair,
      relabelAsCurrentSessionPoolerCi(contract.priorParserFixRepairCiRunEvidence),
    ),
    () => validateRepairRemoteGate('--apply-acl-repair', qualifiedRepair, {
      ...qualifiedCi,
      headSha: contract.priorFormalAclRepairFailureEvidence.supervisionHeadSha,
    }),
    () => validateRepairRemoteGate('--apply-acl-repair', qualifiedRepair, {
      ...qualifiedCi,
      headSha: contract.formalAclRepairFailureEvidence.supervisionHeadSha,
    }),
  ]
  const relabeledRevivalNegativePassed = relabeledRevivalNegativeCases
    .filter((test) => test() === false).length
  const relabeledParserFixCi = relabelAsCurrentSessionPoolerCi(contract.priorParserFixRepairCiRunEvidence)
  const relabeledFailureHeadCi = {
    ...qualifiedCi,
    headSha: contract.formalAclRepairFailureEvidence.supervisionHeadSha,
  }
  const historyEntryFor = (candidate) => ({
    ...qualifiedHistoryEntry,
    runId: candidate.runId,
    runUrl: candidate.runUrl,
    jobId: candidate.linuxJobId,
    windowsJobId: candidate.windowsJobId,
    headSha: candidate.headSha,
  })
  const relabeledHistoryRevivalNegativePassed = [
    findRepairSignedCiRun(relabeledParserFixCi, [historyEntryFor(relabeledParserFixCi)]),
    findRepairSignedCiRun(relabeledFailureHeadCi, [historyEntryFor(relabeledFailureHeadCi)]),
  ].filter((candidate) => candidate === null).length
  if (!validateRepairRemoteGate('--apply-acl-repair', qualifiedRepair, qualifiedCi)) {
    throw new Error('qualified ACL repair gate positive self-test failed')
  }

  const failedPushAttempt = {
    dbPushAttempts: 0,
    dbPushAttempted: false,
    dbPushPerformed: false,
    dbPushOutcome: 'not-attempted',
    confirmedPersistentWrites: 0,
    persistentRemoteWrites: 0,
    persistentRemoteWriteUpperBound: 0,
  }
  beginRepairPushAttempt(failedPushAttempt)
  let failedPushStopped = false
  try {
    finishRepairPushAttempt(failedPushAttempt, { status: 1, error: null, stdout: '', stderr: 'synthetic push failure' })
  } catch {
    failedPushStopped = true
  }
  if (!failedPushStopped || failedPushAttempt.dbPushOutcome !== 'unknown_failed_command' ||
      failedPushAttempt.dbPushPerformed !== null || failedPushAttempt.persistentRemoteWrites !== null ||
      failedPushAttempt.persistentRemoteWriteUpperBound !== 1 || failedPushAttempt.confirmedPersistentWrites !== 0) {
    throw new Error('failed db push could be falsely reported as zero-write or not attempted')
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
  if (repairBaselineNegativePassed !== repairBaselineNegativeCases.length ||
      evidenceNegativePassed !== evidenceNegativeCases.length || oldModesDenied !== 3 ||
      reconciliationNegativePassed !== reconciliationNegativeCases.length ||
      aclNegativePassed !== aclNegativeCases.length ||
      privateDefinitionNegativePassed !== privateDefinitionNegativeCases.length ||
      stagedInventoryNegativePassed !== stagedInventoryNegativeCases.length ||
      dryRunNegativePassed !== dryRunNegativeCases.length || !preservedDryRunFailureStopped ||
      poolerPushPositivePassed !== poolerPushInvocations.length ||
      poolerPushNegativePassed !== poolerPushNegativeCases.length || !poolerInvocationEvidenceDenied ||
      poolerPushSecretsCleared !== poolerPushInvocations.length ||
      !cleanCommittedBoundary.committedAfterSignedHead || !cleanCommittedBoundary.trackedWorktreeClean ||
      worktreeBoundaryNegativePassed !== 2 ||
      repairGateNegativePassed !== repairGateNegativeCases.length || closedRepairGateNegativePassed !== 3 ||
      !currentClosedRepairGateDenied || !independentCiHistoryPositive ||
      independentCiHistoryNegativePassed !== independentCiHistoryNegativeCases.length ||
      relabeledRevivalNegativePassed !== relabeledRevivalNegativeCases.length ||
      relabeledHistoryRevivalNegativePassed !== 2 || !syntheticFailureStopped ||
      followingSyntheticTestRan || !validateMode('--self-test') || !validateMode('--apply-acl-repair') ||
      JSON.stringify(authFixtureEmailPatterns) !== JSON.stringify(['p1-%@example.invalid', 'access-%@example.invalid']) ||
      JSON.stringify(profileFixtureIdPatterns) !== JSON.stringify([
        'd4000000-0000-4000-8000-00000000000%', 'd5100000-0000-4000-8000-00000000000%',
    ])) {
    throw new Error('P1 ACL repair negative self-test failed: ' + JSON.stringify({
      repairGateNegativePassed,
      closedRepairGateNegativePassed,
      currentClosedRepairGateDenied,
      independentCiHistoryPositive,
      independentCiHistoryNegativePassed,
      relabeledRevivalNegativePassed,
      relabeledHistoryRevivalNegativePassed,
      syntheticFailureStopped,
      followingSyntheticTestRan,
    }))
  }
  console.log('P1_ISOLATED_RUNTIME_SELFTEST_OK targetPositive=1 targetNegative=3/3 migration70to71Positive=1 migrationNegative=6/6 stagedInventoryPositive=71/71 stagedInventoryNegative=3/3 dryRunPositive=2/2 dryRunNegative=4/4 dryRunFailureEvidencePreserved=1 dryRunRawOutputAbsent=1 poolerPushPositive=2/2 poolerPushNegative=7/7 poolerPushPasswordEnvOnly=1 poolerPushSecretsCleared=2/2 poolerDirectDenied=1 credentialPositive=1 credentialNegative=3/3 exact70Accepted=1 exact71Accepted=1 repairBaselineDriftDenied=3/3 fullAclTransitionAccepted=1 reconciliationDriftDenied=7/7 routineAclTargets=6/6 routineAclExactChanged=4/4 routineAclNegative=3/3 privateDefinitionChanged=1/1 privateDefinitionNegative=3/3 atomicMapping=5/5 atomicRollback=2/2 sameTeamStatic=4/4 evidenceNegative=7/7 worktreeBoundaryPositive=1 worktreeBoundaryNegative=2/2 oldApplyModesDenied=3/3 futureQualifiedRepairGatePositive=1 currentClosedRepairGateDenied=1 repairGateNegative=7/7 closedRepairGateNegative=3/3 priorRepairCiRevivalDenied=2/2 relabeledRevivalDenied=5/5 independentCiHistoryPositive=1 independentCiHistoryNegative=5/5 relabeledHistoryRevivalDenied=2/2 atomicGateNegative=2/2 failedPushUnknownStatePreserved=1 fixturePatterns=4/4 firstSqlFailureStops=1 candidateRemoteExecutionAllowed=0 oldResumeRemoteExecutionAllowed=0 repairRemote=0 currentCi=pending-session-pooler-new-signed-run databaseCalls=0 storageCalls=0 dEvidenceRequired=0')
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

function assertPasswordlessSessionPoolerUrl(dbUrl, environment) {
  let parsed
  try {
    parsed = new URL(dbUrl)
  } catch {
    throw new Error('ACL repair Session Pooler db URL is invalid')
  }
  if (parsed.protocol !== 'postgresql:' || parsed.username || parsed.password ||
      !/^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(parsed.hostname) ||
      parsed.hostname !== environment.PGHOST || String(parsed.port || '5432') !== '5432' ||
      decodeURIComponent(parsed.pathname.slice(1)) !== environment.PGDATABASE ||
      parsed.searchParams.get('sslmode') !== 'require') {
    throw new Error('ACL repair db URL is not a passwordless Session Pooler endpoint')
  }
  return true
}

function buildSessionPoolerPushInvocation(channel, { dryRun }, inheritedEnvironment = process.env) {
  const environment = channel?.dbEnvironment
  if (!validateDbEnvironment(environment) || typeof dryRun !== 'boolean' ||
      !/^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(environment.PGHOST) ||
      environment.PGPORT !== '5432' || environment.PGDATABASE !== 'postgres' ||
      environment.PGSSLMODE !== 'require' ||
      environment.PGUSER !== `cli_login_postgres.${TARGET_REF}`) {
    throw new Error('ACL repair push requires the verified target Session Pooler environment')
  }
  const dbUrl = `postgresql://${environment.PGHOST}:5432/${encodeURIComponent(environment.PGDATABASE)}?sslmode=require`
  assertPasswordlessSessionPoolerUrl(dbUrl, environment)
  const args = [
    'db', 'push', '--db-url', dbUrl,
    ...(dryRun ? ['--dry-run'] : []),
    '--workdir', channel.workdir, '--yes',
  ]
  if (args.includes('--linked') || args.includes('--password') ||
      args.some((value) => value.includes(environment.PGPASSWORD))) {
    throw new Error('ACL repair push arguments contain a forbidden connection secret or linked route')
  }
  const childEnvironment = {
    ...inheritedEnvironment,
    PGHOST: environment.PGHOST,
    PGPORT: '5432',
    PGUSER: environment.PGUSER,
    PGPASSWORD: environment.PGPASSWORD,
    PGDATABASE: environment.PGDATABASE,
    PGSSLMODE: 'require',
    PGCLIENTENCODING: 'UTF8',
    PGOPTIONS: environment.PGOPTIONS ?? '-c jit=true',
  }
  delete childEnvironment.SUPABASE_DB_PASSWORD
  delete childEnvironment.SUPABASE_DB_URL
  delete childEnvironment.DATABASE_URL
  delete childEnvironment.PGPASSFILE
  delete childEnvironment.PGSERVICE
  delete childEnvironment.PGSERVICEFILE
  return { args, childEnvironment }
}

function clearPushInvocationSecret(invocation) {
  if (invocation?.childEnvironment) invocation.childEnvironment.PGPASSWORD = ''
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

function validateStagedMigrationInventory(stagedFiles, stagedHashes, signedMigrations = signedLocalMigrations()) {
  const expectedFiles = migrationManifest.entries.map((entry) => entry.file)
  if (!Array.isArray(stagedFiles) || !Array.isArray(stagedHashes) ||
      JSON.stringify(stagedFiles) !== JSON.stringify(expectedFiles) ||
      stagedFiles.length !== contract.aclRepair.expectedMigrationCount ||
      stagedFiles.at(-1) !== `${REPAIR_VERSION}_harden_server_only_rpc_acl.sql` ||
      JSON.stringify(stagedHashes) !== JSON.stringify(signedMigrations.map((entry) => entry.sha256Lf))) {
    throw new Error('temporary signed migration inventory is not the exact hash-bound 71-file chain')
  }
  return true
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
    const temporaryMigrations = resolve(workdir, 'supabase', 'migrations')
    mkdirSync(temporaryMigrations, { recursive: true })
    if (readdirSync(temporaryMigrations).length !== 0) {
      throw new Error('temporary migration directory is not empty before staging the signed ACL repair')
    }
    const signedMigrations = signedLocalMigrations()
    for (const [index, entry] of migrationManifest.entries.entries()) {
      const stagedPath = resolve(temporaryMigrations, entry.file)
      copyFileSync(resolve(repoRoot, 'supabase', 'migrations', entry.file), stagedPath)
      if (sha256Lf(stagedPath) !== signedMigrations[index].sha256Lf) {
        throw new Error(`temporary signed migration inventory copy drift at ${entry.version}`)
      }
    }
    const stagedFiles = readdirSync(temporaryMigrations).sort()
    const stagedHashes = stagedFiles.map((file) => sha256Lf(resolve(temporaryMigrations, file)))
    validateStagedMigrationInventory(stagedFiles, stagedHashes, signedMigrations)
    requireSuccess('temporary supabase link', run(cliPath, [
      'link', '--project-ref', TARGET_REF, '--workdir', workdir, '--yes',
    ], { timeout: 120000 }))
    verifyTemporaryLink(workdir)
    const dbEnvironment = acquireTemporaryDbEnvironment(workdir, cliPath)
    verifyTemporaryLink(workdir)
    return { workdir, cliPath, dbEnvironment, credentialGeneration: 1, stagedFiles }
  } catch (error) {
    rmSync(workdir, { recursive: true, force: true })
    throw error
  }
}

function collectRepairPushDryRunEvidence(stdout, stderr) {
  const output = `${String(stdout ?? '')}\n${String(stderr ?? '')}`
  const normalizedOutput = stripVTControlCharacters(output)
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
  const migrationFiles = []
  const migrationFilePattern = /(?:^|[^A-Za-z0-9_-])(\d{14}_[A-Za-z0-9_-]+\.sql)(?![A-Za-z0-9_.-])/g
  for (const match of normalizedOutput.matchAll(migrationFilePattern)) migrationFiles.push(match[1])
  const actualMigrationFiles = [...new Set(migrationFiles)].sort()
  const actualVersions = [...new Set(actualMigrationFiles.map((file) => file.slice(0, 14)))].sort()
  return {
    actualVersions,
    actualMigrationFiles,
    expectedMigrationFile: `${REPAIR_VERSION}_harden_server_only_rpc_acl.sql`,
    outputSha256: sha256(output),
  }
}

function assertRepairPushDryRun(evidence) {
  if (JSON.stringify(evidence.actualVersions) !== JSON.stringify([REPAIR_VERSION]) ||
      JSON.stringify(evidence.actualMigrationFiles) !== JSON.stringify([evidence.expectedMigrationFile])) {
    throw new Error('ACL repair dry-run did not enumerate exactly the one signed migration 71')
  }
}

function runRepairPushDryRun(channel) {
  verifyTemporaryLink(channel.workdir)
  const invocation = buildSessionPoolerPushInvocation(channel, { dryRun: true })
  let result
  try {
    result = run(channel.cliPath, invocation.args, {
      env: invocation.childEnvironment,
      timeout: 180000,
    })
    requireSuccess('signed ACL repair db push dry-run', result)
    return collectRepairPushDryRunEvidence(result.stdout, result.stderr)
  } finally {
    if (result) {
      result.stdout = ''
      result.stderr = ''
    }
    clearPushInvocationSecret(invocation)
  }
}

function beginRepairPushAttempt(attempt) {
  if (attempt.dbPushAttempts !== 0 || attempt.dbPushAttempted !== false || attempt.dbPushPerformed !== false ||
      attempt.confirmedPersistentWrites !== 0 || attempt.persistentRemoteWriteUpperBound !== 0) {
    throw new Error('ACL repair db push single-attempt boundary already consumed')
  }
  attempt.dbPushAttempts = 1
  attempt.dbPushAttempted = true
  attempt.dbPushOutcome = 'running'
  attempt.persistentRemoteWrites = null
  attempt.persistentRemoteWriteUpperBound = 1
}

function finishRepairPushAttempt(attempt, result) {
  if (result.status !== 0 || result.error) {
    attempt.dbPushOutcome = 'unknown_failed_command'
    attempt.dbPushPerformed = null
    attempt.persistentRemoteWrites = null
    throw new Error('single signed ACL repair db push failed with unknown target apply state: ' +
      redact(result.stderr || result.stdout || result.error?.message))
  }
  attempt.dbPushOutcome = 'confirmed-applied'
  attempt.dbPushPerformed = true
  attempt.confirmedPersistentWrites = 1
  attempt.persistentRemoteWrites = 1
}

function runRepairPushOnce(channel, attempt) {
  verifyTemporaryLink(channel.workdir)
  const invocation = buildSessionPoolerPushInvocation(channel, { dryRun: false })
  try {
    beginRepairPushAttempt(attempt)
    attempt.currentStep = `apply-migration:${REPAIR_VERSION}`
    const result = run(channel.cliPath, invocation.args, {
      env: invocation.childEnvironment,
      timeout: 300000,
    })
    try {
      finishRepairPushAttempt(attempt, result)
    } finally {
      result.stdout = ''
      result.stderr = ''
    }
  } finally {
    clearPushInvocationSecret(invocation)
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

function privateRoutineDefinitionSnapshot(dbEnvironment) {
  const value = runPsql({
    psqlPath: restoreRun.toolchain.psql.path,
    pgEnvironment: dbEnvironment,
    retryReadOnlySessionPooler: true,
    timeout: 180000,
    sql: `
select jsonb_build_object(
  'identity',format('%I.%I(%s)',n.nspname,p.proname,pg_catalog.oidvectortypes(p.proargtypes)),
  'definition',pg_catalog.pg_get_functiondef(p.oid),
  'owner',owner_role.rolname,
  'language',language_row.lanname,
  'securityDefiner',p.prosecdef,
  'configuration',coalesce(to_jsonb(p.proconfig),'[]'::jsonb),
  'returnType',pg_catalog.format_type(p.prorettype,null)
)::text
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid=p.pronamespace
join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner
join pg_catalog.pg_language language_row on language_row.oid=p.prolang
where p.oid=pg_catalog.to_regprocedure('${PRIVATE_MEMBER_ACCESS_IDENTITY}');`,
  })
  const raw = JSON.parse(value)
  if (typeof raw.definition !== 'string' || raw.identity !== PRIVATE_MEMBER_ACCESS_IDENTITY) {
    throw new Error('private member-access routine definition snapshot is missing or ambiguous')
  }
  return {
    identity: raw.identity,
    definitionSha256: sha256(raw.definition),
    owner: raw.owner,
    language: raw.language,
    securityDefiner: raw.securityDefiner,
    configuration: raw.configuration,
    returnType: raw.returnType,
  }
}

function assertPrivateRoutineDefinitionTransition(before, after) {
  const expectedKeys = [
    'identity', 'definitionSha256', 'owner', 'language', 'securityDefiner', 'configuration', 'returnType',
  ]
  assertExactKeys(before, expectedKeys, 'pre-repair private routine definition snapshot')
  assertExactKeys(after, expectedKeys, 'post-repair private routine definition snapshot')
  const definitionContract = contract.aclRepair.privateRoutineDefinitionTransition
  if (JSON.stringify(definitionContract.expectedChangedFunctions) !== JSON.stringify([PRIVATE_MEMBER_ACCESS_IDENTITY]) ||
      definitionContract.expectedDefinitionChanges !== 1 || definitionContract.identityChangesAllowed !== 0 ||
      definitionContract.securityEnvelopeChangesAllowed !== 0 || definitionContract.unknownChangesAllowed !== false) {
    throw new Error('private routine definition transition contract drift')
  }
  if (before.identity !== PRIVATE_MEMBER_ACCESS_IDENTITY || after.identity !== PRIVATE_MEMBER_ACCESS_IDENTITY) {
    throw new Error('private routine identity changed during ACL/atomic repair')
  }
  for (const key of expectedKeys.filter((key) => !['identity', 'definitionSha256'].includes(key))) {
    if (canonicalSha256(before[key]) !== canonicalSha256(after[key])) {
      throw new Error(`private routine security envelope changed at ${key}`)
    }
  }
  if (!/^[a-f0-9]{64}$/.test(before.definitionSha256) || !/^[a-f0-9]{64}$/.test(after.definitionSha256) ||
      before.definitionSha256 === after.definitionSha256) {
    throw new Error('private member-access routine definition did not change exactly once')
  }
  return {
    exactChangedFunctions: [PRIVATE_MEMBER_ACCESS_IDENTITY],
    definitionChanges: 1,
    beforeDefinitionSha256: before.definitionSha256,
    afterDefinitionSha256: after.definitionSha256,
    identityChanges: 0,
    securityEnvelopeChanges: 0,
    forbiddenDefinitionChanges: 0,
  }
}

function assertPrivateRoutineDefinitionStable(expected, actual) {
  if (canonicalSha256(expected) !== canonicalSha256(actual)) {
    throw new Error('private member-access routine definition drifted after migration 71')
  }
}

function routineAclSnapshot(dbEnvironment) {
  const value = runPsql({
    psqlPath: restoreRun.toolchain.psql.path,
    pgEnvironment: dbEnvironment,
    retryReadOnlySessionPooler: true,
    timeout: 180000,
    sql: `
with routines as (
  select p.oid,
    format('%I.%I(%s)',n.nspname,p.proname,pg_catalog.oidvectortypes(p.proargtypes)) identity,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'grantee',case when a.grantee=0 then 'PUBLIC' else g.rolname end,
          'privilege',a.privilege_type,
          'grantable',a.is_grantable
        ) order by case when a.grantee=0 then 'PUBLIC' else g.rolname end,a.privilege_type,a.is_grantable
      )
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      left join pg_catalog.pg_roles g on g.oid=a.grantee
    ),'[]'::jsonb) direct_acl
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
), inventory as (
  select identity,direct_acl,jsonb_build_object(
    'PUBLIC',(select exists(
      select 1 from jsonb_array_elements(direct_acl) x
      where x->>'grantee'='PUBLIC' and x->>'privilege'='EXECUTE'
    )),
    'anon',pg_catalog.has_function_privilege('anon',oid,'EXECUTE'),
    'authenticated',pg_catalog.has_function_privilege('authenticated',oid,'EXECUTE'),
    'service_role',pg_catalog.has_function_privilege('service_role',oid,'EXECUTE')
  ) effective_execute from routines
)
select jsonb_build_object(
  'allRoutineAcls',(select coalesce(jsonb_object_agg(identity,direct_acl order by identity),'{}'::jsonb) from inventory),
  'allRoutineEffectiveExecute',(select coalesce(jsonb_object_agg(identity,effective_execute order by identity),'{}'::jsonb) from inventory)
)::text;`,
  })
  return JSON.parse(value)
}

function assertRoutineAclRepairTransition(before, after) {
  assertExactKeys(before, ['allRoutineAcls', 'allRoutineEffectiveExecute'], 'pre-repair routine ACL snapshot')
  assertExactKeys(after, ['allRoutineAcls', 'allRoutineEffectiveExecute'], 'post-repair routine ACL snapshot')
  const beforeIdentities = Object.keys(before.allRoutineAcls).sort()
  const afterIdentities = Object.keys(after.allRoutineAcls).sort()
  const targetIdentities = contract.aclRepair.targetFunctions.map((entry) => entry.identity).sort()
  const expectedChangedIdentities = [...contract.aclRepair.expectedChangedFunctions].sort()
  if (JSON.stringify(beforeIdentities) !== JSON.stringify(afterIdentities)) {
    throw new Error('ACL repair changed the public routine identity inventory')
  }
  const changedDirect = beforeIdentities.filter((identity) => (
    canonicalSha256(before.allRoutineAcls[identity]) !== canonicalSha256(after.allRoutineAcls[identity])
  )).sort()
  const changedEffective = beforeIdentities.filter((identity) => (
    canonicalSha256(before.allRoutineEffectiveExecute[identity]) !==
      canonicalSha256(after.allRoutineEffectiveExecute[identity])
  )).sort()
  if (JSON.stringify(changedDirect) !== JSON.stringify(expectedChangedIdentities) ||
      JSON.stringify(changedEffective) !== JSON.stringify(expectedChangedIdentities)) {
    throw new Error('ACL repair routine difference set is not the exact signed four-function change inventory')
  }
  for (const expected of contract.aclRepair.targetFunctions) {
    const direct = after.allRoutineAcls[expected.identity]
    const effective = after.allRoutineEffectiveExecute[expected.identity]
    if (!Array.isArray(direct) || !effective) throw new Error(`ACL repair target routine is missing: ${expected.identity}`)
    for (const role of expected.revokeRoles) {
      if (effective[role] !== false || direct.some((entry) => entry.grantee === role && entry.privilege === 'EXECUTE')) {
        throw new Error(`ACL repair left ${expected.identity} executable by ${role}`)
      }
    }
    for (const role of expected.requiredGrantRoles) {
      if (effective[role] !== true || !direct.some((entry) => entry.grantee === role && entry.privilege === 'EXECUTE')) {
        throw new Error(`ACL repair removed required ${role} execution from ${expected.identity}`)
      }
    }
  }
  return {
    routineInventorySha256: canonicalSha256(beforeIdentities),
    beforeRoutineAclsSha256: canonicalSha256(before.allRoutineAcls),
    afterRoutineAclsSha256: canonicalSha256(after.allRoutineAcls),
    beforeEffectiveExecuteSha256: canonicalSha256(before.allRoutineEffectiveExecute),
    afterEffectiveExecuteSha256: canonicalSha256(after.allRoutineEffectiveExecute),
    exactChangedFunctions: changedDirect,
    changedFunctions: changedDirect.length,
    targetFunctionsValidated: targetIdentities.length,
    forbiddenRoutineAclChanges: 0,
  }
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
  if (/PGPASSWORD|postgres(?:ql)?:\/\/|sb_(?:secret|publishable)_|eyJ[A-Za-z0-9_-]+\.|"(?:stdout|stderr)"\s*:/i.test(text)) {
    throw new Error('evidence contains a forbidden secret marker')
  }
  return text
}

async function executeAclRepair(channel, sourceEvidence, before70, baseline, proof70) {
  const head = requireSuccess('git head', run('git', ['rev-parse', 'HEAD'])).stdout.trim()
  const runId = `p1-acl-repair-${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${head.slice(0, 10)}`
  const evidenceDirectory = resolve(contract.evidenceRoot, runId)
  mkdirSync(contract.evidenceRoot, { recursive: true })
  mkdirSync(evidenceDirectory, { recursive: false })
  const attempt = {
    schemaVersion: 1,
    runId,
    mode: 'single-signed-acl-and-atomic-compatibility-repair',
    targetProjectRef: TARGET_REF,
    targetProjectName: contract.target.projectName,
    supervisionHeadSha: head,
    sourceFailureRunId: SOURCE_FAILURE_RUN_ID,
    sourceFailureHeadSha: SOURCE_FAILURE_HEAD,
    sourcePreflightSha256: SOURCE_PREFLIGHT_SHA256,
    sourceFailureSha256: SOURCE_FAILURE_SHA256,
    migrationVersion: REPAIR_VERSION,
    migrationAlreadyApplied: false,
    dbPushAttempted: false,
    dbPushPerformed: false,
    dbPushOutcome: 'not-attempted',
    dbPushAttempts: 0,
    confirmedPersistentWrites: 0,
    persistentRemoteWrites: 0,
    persistentRemoteWriteUpperBound: 0,
    formalAttemptStarted: false,
    verificationStarted: false,
    attempts: 0,
    startedAt: new Date().toISOString(),
    testsPassed: [],
    perTestSnapshotsPassed: 0,
    perTestFullReconciliations: [],
    fullReconciliationSnapshotsPassed: 0,
    privateRoutineDefinitionSnapshotsPassed: 0,
    storageArchivesPassed: 0,
    signedEvidence: baseline.signedEvidence,
    initialLightSnapshot: lightSnapshotSummary(before70),
    secretsPrinted: 0,
    secretsWritten: 0,
    productionReads: 0,
    productionWrites: 0,
  }
  try {
    verifyTemporaryLink(channel.workdir)
    attempt.currentStep = 'initial-full-reconciliation'
    const beforeFull = runSealedFullReconciliation(channel.dbEnvironment)
    const beforeFullSummary = assertSealedFullReconciliation(baseline, before70, beforeFull, 70)
    if (canonicalSha256(beforeFullSummary) !== canonicalSha256(sourceEvidence.preflight.initialFullReconciliation)) {
      throw new Error('preserved exact-70 full reconciliation no longer matches signed failed-run preflight')
    }
    attempt.initialFullReconciliation = beforeFullSummary
    attempt.fullReconciliationSnapshotsPassed = 1
    attempt.currentStep = 'initial-routine-acl-snapshot'
    const beforeRoutineAcl = routineAclSnapshot(channel.dbEnvironment)
    attempt.currentStep = 'initial-private-routine-definition-snapshot'
    const beforePrivateRoutineDefinition = privateRoutineDefinitionSnapshot(channel.dbEnvironment)
    attempt.initialPrivateRoutineDefinition = beforePrivateRoutineDefinition
    attempt.privateRoutineDefinitionSnapshotsPassed = 1
    attempt.currentStep = 'initial-storage-archive'
    const beforeStorageSummary = await collectTargetStorageSummary(baseline)
    attempt.initialStorageArchive = beforeStorageSummary
    attempt.storageArchivesPassed = 1
    attempt.currentStep = 'db-push-dry-run'
    attempt.dryRun = runRepairPushDryRun(channel)
    assertRepairPushDryRun(attempt.dryRun)
    writeFileSync(resolve(evidenceDirectory, 'preflight.json'), safeEvidence({
      ...attempt,
      status: 'ready-to-apply',
      sourceFailureCounts: {
        testsPassed: sourceEvidence.failure.testsPassed.length,
        perTestSnapshotsPassed: sourceEvidence.failure.perTestSnapshotsPassed,
        fullReconciliationSnapshotsPassed: sourceEvidence.failure.fullReconciliationSnapshotsPassed,
        storageArchivesPassed: sourceEvidence.failure.storageArchivesPassed,
      },
    }), { flag: 'wx' })
    console.log(`P1_ACL_REPAIR_PREFLIGHT_OK target=${TARGET_REF} local=${proof70.localCount} remote=${proof70.remoteCount} common=${proof70.commonCount} pending=${REPAIR_VERSION} orderMatched=1 fullSnapshots=1/29 storageArchives=1/2 fixtureRows=0 idleTransactions=0 dbPushAttempts=0 secretsPrinted=0 productionReads=0 productionWrites=0`)
    attempt.formalAttemptStarted = true
    attempt.attempts = 1
    runRepairPushOnce(channel, attempt)
    attempt.currentStep = 'post-apply-fresh-credential'
    const preApplyCredentialGeneration = channel.credentialGeneration
    rotateTemporaryCredential(channel)
    requireFreshCredentialGeneration(channel, preApplyCredentialGeneration)
    const afterApply71 = snapshot(channel.dbEnvironment)
    const proof71 = assertExact71RepairBaseline(before70, afterApply71)
    const afterRoutineAcl = routineAclSnapshot(channel.dbEnvironment)
    const aclTransition = assertRoutineAclRepairTransition(beforeRoutineAcl, afterRoutineAcl)
    const afterPrivateRoutineDefinition = privateRoutineDefinitionSnapshot(channel.dbEnvironment)
    const privateDefinitionTransition = assertPrivateRoutineDefinitionTransition(
      beforePrivateRoutineDefinition,
      afterPrivateRoutineDefinition,
    )
    attempt.privateRoutineDefinitionSnapshotsPassed += 1
    attempt.migrationAlreadyApplied = true
    attempt.postApplyMigrationProof = proof71
    attempt.routineAclTransition = aclTransition
    attempt.privateRoutineDefinitionTransition = privateDefinitionTransition
    attempt.verificationStarted = true
    let p1MarkerSeen = false
    let accessControlMarkerSeen = false
    let notificationMarkerSeen = false
    let postApplyFullSummary = null
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
      if (test.path === 'supabase/tests/notification_core.sql') {
        notificationMarkerSeen = result.stdout.includes('notification_core_ok')
        if (!notificationMarkerSeen) throw new Error('notification ACL repair runtime marker is missing')
      }
      result.stdout = ''
      result.stderr = ''
      attempt.testsPassed.push(test.path)
      const afterTest = snapshot(channel.dbEnvironment)
      assertRepairStable(before70, afterApply71, afterTest)
      attempt.perTestSnapshotsPassed += 1
      const afterTestFull = runSealedFullReconciliation(channel.dbEnvironment)
      const afterTestFullSummary = assertSealedFullReconciliation(baseline, afterTest, afterTestFull, 71)
      assertAclRepairFullTransition(beforeFull, afterTestFull)
      if (postApplyFullSummary) assertFullReconciliationStable(postApplyFullSummary, afterTestFullSummary)
      else postApplyFullSummary = afterTestFullSummary
      attempt.perTestFullReconciliations.push({
        testPath: test.path,
        snapshotSha: afterTestFullSummary.canonicalSha256,
        equal: true,
      })
      attempt.fullReconciliationSnapshotsPassed += 1
    }
    if (!p1MarkerSeen || !accessControlMarkerSeen || !notificationMarkerSeen ||
        attempt.testsPassed.length !== contract.expected.tests ||
        attempt.perTestSnapshotsPassed !== contract.expected.tests ||
        attempt.perTestFullReconciliations.length !== contract.expected.tests) {
      throw new Error('ACL repair SQL test totals, markers, or per-test full reconciliation snapshots are incomplete')
    }

    attempt.currentStep = 'catalog'
    const catalog = catalogSnapshot(channel.dbEnvironment)
    assertCatalog(catalog)
    attempt.currentStep = 'full-reconciliation'
    const beforeFinalCredentialGeneration = channel.credentialGeneration
    rotateTemporaryCredential(channel)
    requireFreshCredentialGeneration(channel, beforeFinalCredentialGeneration)
    const after = snapshot(channel.dbEnvironment)
    assertRepairStable(before70, afterApply71, after)
    const afterFull = runSealedFullReconciliation(channel.dbEnvironment)
    const afterFullSummary = assertSealedFullReconciliation(baseline, after, afterFull, 71)
    const fullTransition = assertAclRepairFullTransition(beforeFull, afterFull)
    assertFullReconciliationStable(postApplyFullSummary, afterFullSummary)
    attempt.fullReconciliationSnapshotsPassed += 1
    const finalPrivateRoutineDefinition = privateRoutineDefinitionSnapshot(channel.dbEnvironment)
    assertPrivateRoutineDefinitionStable(afterPrivateRoutineDefinition, finalPrivateRoutineDefinition)
    attempt.privateRoutineDefinitionSnapshotsPassed += 1
    const afterStorageSummary = await collectTargetStorageSummary(baseline)
    if (afterStorageSummary.canonicalSha256 !== beforeStorageSummary.canonicalSha256) {
      throw new Error('initial/final Storage archive canonical content drift')
    }
    attempt.storageArchivesPassed += 1
    if (attempt.fullReconciliationSnapshotsPassed !== contract.expected.tests + 2 ||
        attempt.storageArchivesPassed !== 2 || attempt.privateRoutineDefinitionSnapshotsPassed !== 3) {
      throw new Error('full reconciliation, private routine definition, or Storage archive totals are incomplete')
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
        sourceFailureMigrationRows: sourceEvidence.preflight.initialLightSnapshot.migrationRows,
        postApplyMigrationRowsBefore: before70.migrationVersions.length,
        postApplyMigrationRowsAfter: after.migrationVersions.length,
        initialLightSnapshot: lightSnapshotSummary(before70),
        finalLightSnapshot: lightSnapshotSummary(after),
        initialFullReconciliation: beforeFullSummary,
        finalFullReconciliation: afterFullSummary,
        allowedFullTransition: fullTransition,
        routineAclTransition: aclTransition,
        privateRoutineDefinitionTransition: privateDefinitionTransition,
        finalPrivateRoutineDefinition,
        privateRoutineDefinitionSnapshotsPassed: attempt.privateRoutineDefinitionSnapshotsPassed,
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
    console.log(`P1_ACL_REPAIR_OK target=${TARGET_REF} migrationApplied=71/71 tests=27/27 database=7 permission=11 business=9 perTestSnapshots=27/27 fullSnapshots=29/29 privateDefinition=1/1 privateDefinitionSnapshots=3/3 atomicMapping=5/5 atomicRollback=2/2 sameTeamStatic=4/4 storageArchives=2/2 aclFunctions=6/6 catalog=4 fixtureRows=0 confirmedPersistentWrites=1 dbPushAttempts=1 attempts=1`)
    console.log(`P1_ACL_REPAIR_EVIDENCE path=${evidencePath} sha256=${sha256(readFileSync(evidencePath))} secretsPrinted=0 productionReads=0 productionWrites=0`)
  } catch (error) {
    const failure = {
      ...attempt,
      status: 'failed-stop-preserved',
      failedAt: new Date().toISOString(),
      message: redact(error instanceof Error ? error.message : error),
      targetPreserved: true,
      retryPerformed: false,
      remoteCleanupPerformed: false,
      persistentWriteClaimSafe: attempt.dbPushOutcome === 'unknown_failed_command'
        ? attempt.persistentRemoteWrites === null && attempt.persistentRemoteWriteUpperBound === 1
        : true,
    }
    writeFileSync(resolve(evidenceDirectory, 'failure.json'), safeEvidence(failure), { flag: 'wx' })
    throw error
  }
}

async function main() {
  if (mode === '--self-test') return runSelfTest()
  const qualificationState = assertFrozenContract()
  if (qualificationState !== 'qualified' ||
      !validateRepairRemoteGate(mode, contract.aclRepair, contract.repairCiRunEvidence)) {
    throw new Error('P1_REMOTE_EXECUTION_REFUSED: ACL repair candidate is not dual-platform-CI qualified')
  }
  assertRepairSignedCiQualification()
  const baseline = loadSignedReconciliationBaseline()
  const sourceEvidence = loadRepairFailureEvidence()
  runLocalVerifiers()
  const channel = prepareTemporaryChannel()
  try {
    const before70 = snapshot(channel.dbEnvironment)
    const proof70 = assertExact70RepairBaseline(sourceEvidence, before70)
    await executeAclRepair(channel, sourceEvidence, before70, baseline, proof70)
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
