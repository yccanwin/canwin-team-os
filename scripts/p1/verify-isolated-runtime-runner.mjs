import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = resolve(repoRoot, 'scripts', 'p1')
const normalizeLf = (value) => value.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
const mixedEol = (value) => normalizeLf(value).split('\n').map((line, index, lines) => (
  index === lines.length - 1 ? line : line + ['\n', '\r\n'][index % 2]
)).join('')
const rawSource = readFileSync(resolve(root, 'run-isolated-runtime.mjs'), 'utf8')
const source = normalizeLf(rawSource)
const validatorSource = normalizeLf(readFileSync(fileURLToPath(import.meta.url), 'utf8'))
const contract = JSON.parse(readFileSync(resolve(root, 'isolated-runtime-contract.json'), 'utf8'))
const databaseContract = JSON.parse(readFileSync(resolve(repoRoot, contract.databaseContractPath), 'utf8'))
const migration = normalizeLf(readFileSync(resolve(repoRoot, contract.candidate.migrationPath), 'utf8'))
const test = normalizeLf(readFileSync(resolve(repoRoot, contract.candidate.testPath), 'utf8'))
const rawAccessControlTest = readFileSync(resolve(repoRoot, contract.postApplyResume.accessControlTestPath), 'utf8')
const accessControlTest = normalizeLf(rawAccessControlTest)
const rawPostgresRegression = readFileSync(resolve(repoRoot, contract.scriptHardLocks.postgresRegressionPath), 'utf8')
const postgresRegression = normalizeLf(rawPostgresRegression)
const failures = []
let assertionCount = 0
const check = (condition, message) => { assertionCount += 1; if (!condition) failures.push(message) }
const sha256Lf = (path) => createHash('sha256')
  .update(normalizeLf(readFileSync(path, 'utf8')))
  .digest('hex')
const occurrences = (text, needle) => text.split(needle).length - 1
const sourceIndex = (needle) => source.indexOf(needle)

const resume = contract.postApplyResume
const expectedResumeRunId = 'p1-isolated-20260719T172151689Z-8273f5c69e'
const expectedEvidenceRoot = 'D:/CanWin-Team-OS-4.0-P1-Validation/' + expectedResumeRunId
const expectedPreflightSha256 = 'e44d53b72c85a71eff2d7a5359220f86c20af56af02a9bf6c0a81716c6d65b97'
const expectedFailureSha256 = '3a8077ad58b1a7ee1fc4a75340ab3db9b8f1c3d5ea772e019ff1282136029774'
const expectedQualificationHead = 'a620bb541f4c5eb613413e8b40455b3988ee0cf3'
const expectedQualificationRunId = '29699951990'
const expectedQualificationLinuxJobId = '88227205377'
const expectedQualificationWindowsJobId = '88227205362'
const expectedBackupManifestPath = 'D:/CanWin-Team-OS-4.0-Recovery/canwin-team-os-4-p0-20260719T074943659Z-c11fca6bd1/manifest.json'
const expectedBackupManifestSha256 = 'f4174b91f51f63e37b42e9d907aea0f72aa907ec31694041081ee06c2f6d20b2'
const expectedRestoreEvidencePath = 'D:/CanWin-Team-OS-4.0-Recovery/canwin-team-os-4-p0-20260719T074943659Z-c11fca6bd1/restore-evidence.json'
const expectedRestoreEvidenceSha256 = '04a6c5d6ac9510747abf5efee27dfe0ecb2a8550191b8ce047b9a1a8d5b458a8'
const expectedSealedSqlSha256Lf = 'ff1d1e457e5427eb6f0a911df275057b86da93eae6c3ea2528cd00457273595e'
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
const expectedDpapiKeyReference = 'dpapi-file:///E:/CanWin-Team-OS-4.0-Recovery-Keys/canwin-team-os-4-p0-20260719T074943659Z-c11fca6bd1.dpapi'
const expectedDpapiKeyPath = 'E:/CanWin-Team-OS-4.0-Recovery-Keys/canwin-team-os-4-p0-20260719T074943659Z-c11fca6bd1.dpapi'

check(contract.target.projectRef === 'zdmuaqokndhhbarudhtw', 'isolated target ref drift')
check(contract.forbiddenProductionProjectRef === 'agygfhmkazcbqaqwmljb', 'production deny ref drift')
check([
  source,
  source.replaceAll('\n', '\r\n'),
  mixedEol(rawSource),
].every((variant) => normalizeLf(variant) === source) && [
  postgresRegression,
  postgresRegression.replaceAll('\n', '\r\n'),
  mixedEol(rawPostgresRegression),
].every((variant) => normalizeLf(variant) === postgresRegression),
'runner/PG regression semantic source normalization fails for LF, CRLF, or mixed EOL')
check([
  accessControlTest,
  accessControlTest.replaceAll('\n', '\r\n'),
  mixedEol(rawAccessControlTest),
].every((variant) => normalizeLf(variant) === accessControlTest),
  'access-control test semantic source normalization fails for LF, CRLF, or mixed EOL')
check(source.includes("const TARGET_REF = 'zdmuaqokndhhbarudhtw'"), 'runner does not literal-lock target ref')
check(source.includes("const PRODUCTION_REF = 'agygfhmkazcbqaqwmljb'"), 'runner does not literal-deny production ref')
check(source.includes("const allowedModes = new Set(['--self-test', '--resume-post-apply'])"),
  'runner modes are not limited to self-test and post-apply resume')
check(!source.includes("'db', 'push'") && !/\bdb\s+push\b/i.test(source) &&
  !source.includes('executeFormal') && !source.includes('runPushDryRun'),
  'runner retains a db-push/apply execution path')
check(source.includes("const oldModesDenied = ['--execute', '--dry-run'].filter") &&
  source.includes('oldApplyModesDenied=2/2'),
  'old execute/dry-run modes are not covered by the denial self-test')
check(source.includes("mkdtempSync(join(tmpdir(), 'canwin-p1-runtime-'))"), 'runner lacks independent temporary workdir')
check(source.includes("'link', '--project-ref', TARGET_REF, '--workdir', workdir"), 'temporary link is not explicit')
check(!source.includes("resolve(repoRoot, 'supabase', '.temp', 'project-ref')"), 'runner reads workspace linked state')
check(source.includes('verifyTemporaryLink(channel.workdir)'), 'runner does not recheck temporary ref')
check(source.includes('parseTemporaryPgEnvironment'), 'runner does not use the controlled temporary credential channel')
check(source.includes("credentialProbe.stdout = ''") && source.includes("credentialProbe.stderr = ''"), 'credential probe is not cleared')
check(source.includes('function rotateTemporaryCredential(') && source.includes('clearDbEnvironment(oldEnvironment)'), 'old temporary credential is not invalidated before rotation')
check(source.includes('fresh === oldEnvironment') && source.includes('new temporary credential acquisition failed'), 'credential reuse/acquisition failure is not fail-closed')
check(source.includes('requireFreshCredentialGeneration(channel, beforeFinalCredentialGeneration)'),
  'final reconciliation does not require a fresh credential generation')
check(source.includes("secretsPrinted: 0") && source.includes("secretsWritten: 0"), 'evidence secrecy markers missing')
check(source.includes('function proveMigrationSets(') && source.includes('localMinusRemote') && source.includes('remoteMinusLocal'), 'machine migration-set proof missing')
check(source.includes("status !== 'applied'") && source.includes('migration order proof failed'), 'migration status/order proof missing')
check(!source.includes("output.match(/\\b\\d{14}\\b/g)"), 'resume safety depends on CLI human output')

check(contract.candidate.remoteExecutionAllowed === false && resume?.resumeOnly === true &&
  resume?.remoteExecutionAllowed === true && resume?.signedCiHeadSha === expectedQualificationHead &&
  resume?.signedCiRunId === expectedQualificationRunId &&
  resume?.signedCiLinuxJobId === expectedQualificationLinuxJobId &&
  resume?.signedCiWindowsJobId === expectedQualificationWindowsJobId &&
  resume?.signedCiConclusion === 'success' &&
  resume?.mode === '--resume-post-apply' && resume?.dbPushAllowed === false &&
  resume?.expectedPersistentRemoteWrites === 0 && resume?.perTestSnapshotRequired === true &&
  resume?.sourceRunId === expectedResumeRunId,
  'candidate/resume remote gate, signed CI identity, or zero-persistent-write boundary drift')
const signedResumeCiRuns = databaseContract.formalAttemptHistory.filter((entry) => entry.runId === expectedQualificationRunId)
const signedResumeCiRun = signedResumeCiRuns[0]
check(signedResumeCiRuns.length === 1 &&
  signedResumeCiRun?.runUrl === 'https://github.com/yccanwin/canwin-team-os/actions/runs/29699951990' &&
  signedResumeCiRun?.jobId === expectedQualificationLinuxJobId &&
  signedResumeCiRun?.windowsJobId === expectedQualificationWindowsJobId &&
  signedResumeCiRun?.headSha === expectedQualificationHead && signedResumeCiRun?.conclusion === 'success' &&
  signedResumeCiRun?.qualificationScope === 'post_apply_resume_prequalification' &&
  signedResumeCiRun?.resumePrequalification === 'qualified_remote_enabled' &&
  signedResumeCiRun?.windowsLocalGatePassed === true &&
  signedResumeCiRun?.windowsStaticGatesExpected === 19 && signedResumeCiRun?.windowsStaticGatesPassed === 19 &&
  signedResumeCiRun?.windowsLocalIntegrationStepsExpected === 12 && signedResumeCiRun?.windowsLocalIntegrationStepsPassed === 12 &&
  signedResumeCiRun?.linuxDatabaseAccepted === true && signedResumeCiRun?.migrationsPassed === 70 &&
  signedResumeCiRun?.sqlTestsStarted === 27 && signedResumeCiRun?.sqlTestsPassed === 27 &&
  signedResumeCiRun?.databaseTestsPassed === 7 && signedResumeCiRun?.permissionTestsPassed === 11 &&
  signedResumeCiRun?.businessTestsPassed === 9 && signedResumeCiRun?.catalogAssertionsPassed === 4 &&
  signedResumeCiRun?.repositorySecretsRequired === false &&
  signedResumeCiRun?.testProjectRemoteReads === 0 && signedResumeCiRun?.testProjectRemoteWrites === 0 &&
  signedResumeCiRun?.productionReadPerformed === false && signedResumeCiRun?.productionWritePerformed === false &&
  signedResumeCiRun?.resumeVerificationExecuted === false && signedResumeCiRun?.pageAccountAcceptancePassed === false &&
  signedResumeCiRun?.g1OverallClaim === false,
  'signed resume CI formal history identity, dual-platform counts, or zero-remote/production boundary drift')
check(resume?.preflightPath === expectedEvidenceRoot + '/preflight.json' &&
  resume?.failurePath === expectedEvidenceRoot + '/failure.json',
  'post-apply resume evidence paths drift')
check(resume?.preflightSha256 === expectedPreflightSha256 && resume?.failureSha256 === expectedFailureSha256,
  'post-apply resume source evidence SHA drift')
check(resume?.accessControlTestPath === 'supabase/tests/access_control_foundation.sql' &&
  resume?.accessControlTestExecutionMode === 'rollback_fixture' &&
  resume?.accessControlTestSha256Lf === sha256Lf(resolve(repoRoot, resume.accessControlTestPath)),
  'post-apply access-control test path/hash drift')

const fullReconciliation = contract.fullReconciliation
check(fullReconciliation?.backupPackageId === 'canwin-team-os-4-p0-20260719T074943659Z-c11fca6bd1' &&
  fullReconciliation?.backupPackageManifestPath === expectedBackupManifestPath &&
  fullReconciliation?.backupPackageManifestSha256 === expectedBackupManifestSha256 &&
  fullReconciliation?.restoreEvidencePath === expectedRestoreEvidencePath &&
  fullReconciliation?.restoreEvidenceSha256 === expectedRestoreEvidenceSha256,
  'signed backup manifest or restore-evidence path/SHA drift')
check(fullReconciliation?.sealedSqlPath === 'scripts/p0/sealed-reconciliation.sql' &&
  fullReconciliation?.sealedSqlSha256Lf === expectedSealedSqlSha256Lf &&
  sha256Lf(resolve(repoRoot, fullReconciliation.sealedSqlPath)) === expectedSealedSqlSha256Lf,
  'sealed reconciliation SQL path/LF hash drift')
check(JSON.stringify(fullReconciliation?.signedArtifacts) === JSON.stringify(expectedSignedArtifacts) &&
  fullReconciliation?.reconciliationKeyAmountsArtifactPath === expectedSignedArtifacts.keyAmounts.path &&
  fullReconciliation?.reconciliationKeyAmountsArtifactSha256 === expectedSignedArtifacts.keyAmounts.sha256 &&
  fullReconciliation?.dpapiKeyReference === expectedDpapiKeyReference &&
  fullReconciliation?.dpapiKeyPath === expectedDpapiKeyPath,
  'six signed reconciliation/Storage artifact bindings or in-memory key path drift')
check(JSON.stringify(fullReconciliation?.expected?.keyAmountKeys) === JSON.stringify([
  'currency', 'customerPayments', 'internalPayables', 'salesProfit', 'points', 'laborEarnings',
]) && JSON.stringify(fullReconciliation?.expected?.inventoryKeys) === JSON.stringify([
  'onHand', 'reserved', 'shipped',
]), 'five key amounts, currency, or three inventory keys drift')
check(JSON.stringify(fullReconciliation?.expected?.rawLedgerKeys) === JSON.stringify([
  'customerPaymentGross', 'customerPaymentReversals', 'internalDue', 'internalPaid', 'internalSettlements',
  'procurementPayments', 'salesExpenses', 'quarterlyRebates', 'companyExpenses',
]), 'raw-ledger fingerprint key inventory drift')
check(JSON.stringify(fullReconciliation?.expected?.auth) === JSON.stringify({
  users: 7,
  identities: 7,
  profiles: 7,
  sourceRoleAssignments: 8,
  authorizedRoleAssignmentsApplied: 2,
  postOverlayRoleAssignments: 10,
  orphanProfiles: 0,
  orphanRoleAssignments: 0,
  bannedUsers: 7,
}) && JSON.stringify(fullReconciliation?.expected?.storage) === JSON.stringify({
  buckets: 1,
  objects: 32,
  bytes: 1700978,
  aggregateSha256: '12000d53bf395a9637638a372778a61f7a821eea3be622e81bec84051f3b379f',
}) && fullReconciliation?.expected?.migrationRows === 70,
  'exact-70, Auth, role-overlay, or Storage signed totals drift')
check(JSON.stringify(fullReconciliation?.execution) === JSON.stringify({
  initialFullAfterLightSnapshot: true,
  fullAfterEverySqlTest: true,
  perTestFullSnapshots: 27,
  finalFullAfterFreshCredential: true,
  beforeAfterCanonicalShaMustMatch: true,
  storageArchiveAtInitialAndFinal: true,
  temporarySessionOnly: true,
  persistentDatabaseWrites: false,
  sessionClosedDropsTemp: true,
}), 'initial/per-test/final full-reconciliation execution contract drift')
check(JSON.stringify(fullReconciliation?.allowedPersistentContentDifferencesFromSealedSource) === JSON.stringify([
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
]) && fullReconciliation?.expectedSchemaAndHistoryDifference === 'exact-signed-P1-migration-only' &&
  fullReconciliation?.unknownDifferencesAllowed === false &&
  fullReconciliation?.evidenceMode === 'summary-hash-counts-only' &&
  JSON.stringify(fullReconciliation?.sourceArtifactBoundary) === JSON.stringify({
    signedP0TableRowCountsAreCountsOnly: true,
    signedP0TargetAfterSha256IsNull: true,
    p1InitialAndFinalContentFingerprintsRequired: true,
  }),
  'authorized content-difference allow-list or unknown-difference refusal drift')
const validatorImports = validatorSource.slice(0, validatorSource.indexOf('\nconst repoRoot'))
const forbiddenValidatorEvidenceReads = [
  ['readFileSync(expected', 'BackupManifestPath'].join(''),
  ['readFileSync(expected', 'RestoreEvidencePath'].join(''),
  ['readFileSync(fullReconciliation.', 'backupPackageManifestPath'].join(''),
  ['readFileSync(fullReconciliation.', 'restoreEvidencePath'].join(''),
]
check(!validatorImports.includes("from '../p0/") &&
  forbiddenValidatorEvidenceReads.every((operation) => !validatorSource.includes(operation)),
  'validator self-check must not read D evidence, call a database, or call Storage')
check(source.includes('function signedArtifactInventory(') && source.includes('function assertSignedArtifact(') &&
  source.includes('for (const name of Object.keys(signedArtifacts))') &&
  source.includes('assertSignedArtifact(manifestArtifacts[name], signedArtifacts[name], name, full.dpapiKeyReference)') &&
  source.includes('manifest?.reconciliation?.targetAfterSha256 !== null') &&
  source.includes('manifest?.auth?.recoveryScope?.sessionsRestored !== false') &&
  source.includes('manifest?.auth?.recoveryScope?.sourceJwtSecretCopied !== false'),
  'six signed artifacts, P0 content boundary, or Auth session/JWT isolation is not machine-bound')
check(source.includes('key = readProtectedKey({ repoRoot, keyPath: full.dpapiKeyPath })') &&
  source.includes('plaintext = readEncryptedArtifact({') &&
  source.includes('artifact: manifest.reconciliation.keyAmounts') &&
  source.includes('canonicalSha256(decryptedKeyAmounts) !== canonicalSha256(keyAmounts)') &&
  source.includes('if (Buffer.isBuffer(plaintext)) plaintext.fill(0)') &&
  source.includes('if (Buffer.isBuffer(key)) key.fill(0)'),
  'signed raw-ledger artifact is not decrypted, compared, and cleared only in memory')
check(source.includes('keyAmountsSha256: canonicalSha256(keyAmounts)') &&
  source.includes('rawLedgersSha256: canonicalSha256(rawLedgers)') &&
  source.includes('inventorySha256: canonicalSha256(inventory)') &&
  source.includes('artifactSha256: Object.fromEntries(Object.entries(signedArtifacts)') &&
  source.includes('sourceP0CountsOnly: true') && source.includes('currentP1ContentFingerprintsRequired: true'),
  'signed amount/inventory/raw-ledger/artifact evidence summary is incomplete')
check(source.includes('parseSignedEvidence(resume.preflightPath, resume.preflightSha256') &&
  source.includes('parseSignedEvidence(resume.failurePath, resume.failureSha256') &&
  source.includes("failure.currentStep !== 'test:database:supabase/tests/access_control_foundation.sql'") &&
  source.includes('failure.attempts !== 1') && source.includes('failure.retryPerformed !== false') &&
  source.includes('failure.remoteCleanupPerformed !== false') && source.includes('assertPreflight(preflight.before)'),
  'signed failed-attempt evidence is not fully bound before resume')
check(source.includes('function assertPostApplyBaseline(') &&
  source.includes('proveMigrationSets(signedLocalMigrations(), current.migrationHistory, [])') &&
  source.includes('proof.remoteCount !== contract.expected.postMigrationRows') &&
  source.includes('current.migrationVersions.length !== contract.expected.postMigrationRows') &&
  source.includes("throw new Error('resume target is not the exact clean post-P1 70-migration baseline')"),
  '69-source to exact-70 post-apply baseline proof is incomplete')
check(source.includes('sourceBefore.publicRowCounts') && source.includes('current.publicRowCounts') &&
  source.includes("table === 'feature_flags' ? Number(sourceBefore.teamsMissingP1Flag) : 0"),
  'post-apply public-row reconciliation is not anchored to the signed 69 baseline')
check(source.includes('function assertResumeStable(') &&
  source.includes('JSON.stringify(canonicalize(after)) !== JSON.stringify(canonicalize(before))'),
  'resume before/after equality proof is missing')
check(source.includes("const authFixtureEmailPatterns = ['p1-%@example.invalid', 'access-%@example.invalid']") &&
  source.includes("'d4000000-0000-4000-8000-00000000000%'") &&
  source.includes("'d5100000-0000-4000-8000-00000000000%'") &&
  source.includes("like '${authFixtureEmailPatterns[0]}' or lower(coalesce(email,'')) like '${authFixtureEmailPatterns[1]}'") &&
  source.includes("like '${profileFixtureIdPatterns[0]}' or id::text like '${profileFixtureIdPatterns[1]}'"),
  'snapshot does not reject both p1/access Auth fixtures and d400/d510 profile fixtures')

const selfTestMainIndex = sourceIndex("if (mode === '--self-test') return runSelfTest()")
const qualificationIndex = sourceIndex('\n  assertResumeSignedCiQualification()\n')
const signedBaselineIndex = sourceIndex('const baseline = loadSignedReconciliationBaseline()')
const evidenceIndex = sourceIndex('const sourceEvidence = loadResumeEvidence()')
const localVerifierIndex = sourceIndex('\n  runLocalVerifiers()\n')
const channelIndex = sourceIndex('const channel = prepareTemporaryChannel()')
const postApplySnapshotIndex = sourceIndex('const before = snapshot(channel.dbEnvironment)')
const postApplyAssertIndex = sourceIndex('assertPostApplyBaseline(sourceEvidence.preflight.before, before)')
const resumeExecuteIndex = sourceIndex('\n    await executePostApplyResume(\n')
check(selfTestMainIndex >= 0 && selfTestMainIndex < qualificationIndex &&
  qualificationIndex < signedBaselineIndex && signedBaselineIndex < evidenceIndex &&
  evidenceIndex < localVerifierIndex && localVerifierIndex < channelIndex &&
  channelIndex < postApplySnapshotIndex && postApplySnapshotIndex < postApplyAssertIndex &&
  postApplyAssertIndex < resumeExecuteIndex,
  'resume sequence is not self-test short-circuit -> CI -> signed recovery/resume evidence -> local gates -> temporary channel -> exact-70 -> verification')

check(source.includes('function validateResumeRemoteGate(') &&
  source.includes("candidateMode === '--resume-post-apply'") && source.includes("syncState === 'synchronized'") &&
  source.includes('resume?.remoteExecutionAllowed === true') &&
  source.includes("/^[a-f0-9]{40}$/.test(resume?.signedCiHeadSha ?? '')") &&
  !source.slice(sourceIndex('function validateResumeRemoteGate('), sourceIndex('function sha256(')).includes('contract.candidate?.signedCiHeadSha'),
  'resume remote gate is not isolated from the old migration candidate CI identity')
check(source.includes(`const RESUME_CI_HEAD = '${expectedQualificationHead}'`) &&
  source.includes(`const RESUME_CI_RUN_ID = '${expectedQualificationRunId}'`) &&
  source.includes(`const RESUME_CI_LINUX_JOB_ID = '${expectedQualificationLinuxJobId}'`) &&
  source.includes(`const RESUME_CI_WINDOWS_JOB_ID = '${expectedQualificationWindowsJobId}'`) &&
  source.includes('function findResumeSignedCiRun()') &&
  source.includes('entry.runId === resume.signedCiRunId && entry.jobId === resume.signedCiLinuxJobId') &&
  source.includes('entry.windowsJobId === resume.signedCiWindowsJobId') &&
  source.includes('entry.headSha === resume.signedCiHeadSha && entry.conclusion === resume.signedCiConclusion') &&
  source.includes('entry.windowsStaticGatesExpected === 19 && entry.windowsStaticGatesPassed === 19') &&
  source.includes('entry.windowsLocalIntegrationStepsExpected === 12 && entry.windowsLocalIntegrationStepsPassed === 12') &&
  source.includes('entry.migrationsPassed === contract.expected.postMigrationRows') &&
  source.includes('entry.sqlTestsPassed === contract.expected.tests && entry.catalogAssertionsPassed === 4') &&
  source.includes('entry.databaseTestsPassed === contract.expected.databaseTests') &&
  source.includes('entry.permissionTestsPassed === contract.expected.permissionTests') &&
  source.includes('entry.businessTestsPassed === contract.expected.businessTests') &&
  source.includes('entry.productionReadPerformed === false && entry.productionWritePerformed === false'),
  'runner does not bind the exact signed CI run/jobs or dual-platform/database acceptance counts')
const qualificationFunctionIndex = sourceIndex('function assertResumeSignedCiQualification()')
const qualificationHeadIndex = source.indexOf("run('git', ['rev-parse', 'HEAD'])", qualificationFunctionIndex)
const trackedStatusIndex = source.indexOf("'status', '--porcelain', '--untracked-files=no'", qualificationHeadIndex)
const worktreeBoundaryIndex = source.indexOf('validateResumeWorktreeBoundary(head, resumeHead, trackedStatus)', trackedStatusIndex)
const sameHeadRefusalIndex = source.indexOf('if (!worktreeBoundary.committedAfterSignedHead)', worktreeBoundaryIndex)
const trackedStatusRefusalIndex = source.indexOf('if (!worktreeBoundary.trackedWorktreeClean)', sameHeadRefusalIndex)
const qualificationAncestryIndex = source.indexOf("'merge-base', '--is-ancestor', resumeHead, head", trackedStatusRefusalIndex)
check(qualificationFunctionIndex >= 0 && qualificationHeadIndex > qualificationFunctionIndex &&
  trackedStatusIndex > qualificationHeadIndex && worktreeBoundaryIndex > trackedStatusIndex &&
  sameHeadRefusalIndex > worktreeBoundaryIndex && trackedStatusRefusalIndex > sameHeadRefusalIndex &&
  qualificationAncestryIndex > trackedStatusRefusalIndex &&
  source.includes('function validateResumeWorktreeBoundary(head, resumeHead, trackedStatus)') &&
  source.includes("committedAfterSignedHead: /^[a-f0-9]{40}$/.test(head) && head !== resumeHead") &&
  source.includes("trackedWorktreeClean: trackedStatus === ''") &&
  source.includes('post-apply resume qualification changes are not committed after the signed prequalification HEAD') &&
  source.includes('post-apply resume requires a clean tracked worktree') &&
  !source.includes("'status', '--porcelain', '--untracked-files=all'"),
  'qualification must reject the signed HEAD itself and dirty tracked files while allowing untracked audit evidence')

check(source.includes('for (const test of databaseContract.tests)') &&
  source.includes('const afterTest = snapshot(channel.dbEnvironment)') &&
  source.includes('assertResumeStable(sourceEvidence.preflight.before, before, afterTest)') &&
  source.includes('attempt.perTestSnapshotsPassed += 1') &&
  source.includes('attempt.perTestSnapshotsPassed !== contract.expected.tests'),
  '27-test per-test residue snapshots are incomplete')
const sqlLoopIndex = sourceIndex('for (const test of databaseContract.tests)')
const sqlRunIndex = source.indexOf('runTestFile(channel.dbEnvironment, test)', sqlLoopIndex)
const sqlPassIndex = source.indexOf('attempt.testsPassed.push(test.path)', sqlLoopIndex)
const sqlSnapshotIndex = source.indexOf('const afterTest = snapshot(channel.dbEnvironment)', sqlLoopIndex)
const sqlLoopTail = source.slice(sqlLoopIndex, sqlSnapshotIndex)
check(sqlLoopIndex >= 0 && sqlRunIndex > sqlLoopIndex && sqlPassIndex > sqlRunIndex &&
  sqlSnapshotIndex > sqlPassIndex && /const result\s*=\s*requireSuccess\([\s\S]{0,160}runTestFile\(channel\.dbEnvironment,\s*test\)\)/.test(sqlLoopTail),
  'SQL test nonzero result can be counted or followed before immediate requireSuccess')
check(source.includes('syntheticFailureStopped') && source.includes('followingSyntheticTestRan') &&
  source.includes('firstSqlFailureStops=1'),
  'first SQL failure stop negative self-test is missing')
const executeFunctionIndex = sourceIndex('async function executePostApplyResume(')
const initialFullIndex = source.indexOf('const beforeFull = runSealedFullReconciliation(channel.dbEnvironment)', executeFunctionIndex)
const initialFullAssertIndex = source.indexOf('const beforeFullSummary = assertSealedFullReconciliation(baseline, before, beforeFull)', initialFullIndex)
const initialStorageIndex = source.indexOf('const beforeStorageSummary = await collectTargetStorageSummary(baseline)', initialFullAssertIndex)
const preflightWriteIndex = source.indexOf("writeFileSync(resolve(evidenceDirectory, 'preflight.json')", initialStorageIndex)
const afterTestFullIndex = source.indexOf('const afterTestFull = runSealedFullReconciliation(channel.dbEnvironment)', sqlLoopIndex)
const afterTestFullAssertIndex = source.indexOf('const afterTestFullSummary = assertSealedFullReconciliation(baseline, afterTest, afterTestFull)', afterTestFullIndex)
const perTestStableIndex = source.indexOf('assertFullReconciliationStable(beforeFullSummary, afterTestFullSummary)', afterTestFullAssertIndex)
const perTestEvidenceIndex = source.indexOf('attempt.perTestFullReconciliations.push({', perTestStableIndex)
const finalCredentialIndex = source.indexOf('const beforeFinalCredentialGeneration = channel.credentialGeneration', perTestEvidenceIndex)
const finalLightIndex = source.indexOf('const after = snapshot(channel.dbEnvironment)', finalCredentialIndex)
const finalFullIndex = source.indexOf('const afterFull = runSealedFullReconciliation(channel.dbEnvironment)', finalLightIndex)
const finalFullAssertIndex = source.indexOf('const afterFullSummary = assertSealedFullReconciliation(baseline, after, afterFull)', finalFullIndex)
const finalStableIndex = source.indexOf('assertFullReconciliationStable(beforeFullSummary, afterFullSummary)', finalFullAssertIndex)
const finalStorageIndex = source.indexOf('const afterStorageSummary = await collectTargetStorageSummary(baseline)', finalStableIndex)
check(executeFunctionIndex >= 0 && executeFunctionIndex < initialFullIndex && initialFullIndex < initialFullAssertIndex &&
  initialFullAssertIndex < initialStorageIndex && initialStorageIndex < preflightWriteIndex && preflightWriteIndex < sqlLoopIndex &&
  sqlSnapshotIndex < afterTestFullIndex && afterTestFullIndex < afterTestFullAssertIndex &&
  afterTestFullAssertIndex < perTestStableIndex && perTestStableIndex < perTestEvidenceIndex &&
  perTestEvidenceIndex < finalCredentialIndex && finalCredentialIndex < finalLightIndex && finalLightIndex < finalFullIndex &&
  finalFullIndex < finalFullAssertIndex && finalFullAssertIndex < finalStableIndex && finalStableIndex < finalStorageIndex,
  'formal order is not exact-70 initial full/Storage -> 27 immediate test full snapshots -> fresh-credential final full/Storage')
check(source.includes('function runSealedFullReconciliation(') &&
  source.includes("'--single-transaction', '--command', 'set role postgres;'") &&
  source.includes("'--file', resolve(repoRoot, contract.fullReconciliation.sealedSqlPath)") &&
  source.includes("lines.length !== 1") &&
  !Object.hasOwn(fullReconciliation.execution, 'databaseReadOnlyTransaction'),
  'sealed SQL execution/session contract drift')
check(source.includes('function assertSealedFullReconciliation(') &&
  source.includes("assertExactKeys(fullSnapshot.publicTableContentMd5") &&
  source.includes("assertMd5(fullSnapshot.auth.usersContentMd5") &&
  source.includes("assertMd5(fullSnapshot.auth.identitiesContentMd5") &&
  source.includes('publicTableContentSha256: canonicalSha256(fullSnapshot.publicTableContentMd5)') &&
  source.includes('authContentSha256: canonicalSha256({') &&
  source.includes('schemaSecuritySha256: canonicalSha256(fullSnapshot.schemaSecurity)') &&
  source.includes("throw new Error('sealed full reconciliation canonical content drift')"),
  'public/Auth/schema content fingerprints or canonical before/after comparison are incomplete')
check(source.includes('attempt.fullReconciliationSnapshotsPassed = 1') &&
  occurrences(source, 'attempt.fullReconciliationSnapshotsPassed += 1') === 2 &&
  source.includes('attempt.fullReconciliationSnapshotsPassed !== contract.expected.tests + 2') &&
  source.includes('attempt.perTestFullReconciliations.length !== contract.expected.tests') &&
  source.includes('fullSnapshots=29/29') && source.includes('storageArchives=2/2'),
  '29 full snapshots, 27 itemized full snapshots, or two Storage archives are not hard-required')
check(source.includes('async function collectTargetStorageSummary(') &&
  source.includes("if (TARGET_REF === PRODUCTION_REF) throw new Error('production Storage archive is forbidden')") &&
  source.includes('getServerKey({ cliPath: restoreRun.toolchain.supabaseCli.path, projectRef: TARGET_REF })') &&
  source.includes('archive = await collectStorageArchive(client)') &&
  source.includes('return assertSignedStorageSummary(baseline, storageSummary(archive))') &&
  source.includes('afterStorageSummary.canonicalSha256 !== beforeStorageSummary.canonicalSha256') &&
  source.includes("throw new Error('initial/final Storage archive canonical content drift')") &&
  source.includes("item.base64 = ''") && source.includes('serverKey = \'\''),
  'isolated Storage full-content comparison, production denial, or in-memory clearing is incomplete')
const selfTestStart = sourceIndex('function runSelfTest()')
const selfTestEnd = source.indexOf('function verifyTemporaryLink(', selfTestStart)
const selfTestSource = source.slice(selfTestStart, selfTestEnd)
check(selfTestStart >= 0 && selfTestEnd > selfTestStart &&
  !selfTestSource.includes('loadSignedReconciliationBaseline(') &&
  !selfTestSource.includes('loadResumeEvidence(') &&
  !selfTestSource.includes('runSealedFullReconciliation(') &&
  !selfTestSource.includes('collectTargetStorageSummary(') &&
  selfTestSource.includes('databaseCalls=0') && selfTestSource.includes('storageCalls=0') &&
  selfTestSource.includes('dEvidenceRequired=0') && selfTestSource.includes('resumeRemoteExecutionAllowed=1'),
  'runner self-test can touch a database, Storage, or D evidence')
check(selfTestSource.includes('const cleanCommittedBoundary = validateResumeWorktreeBoundary(') &&
  selfTestSource.includes('const worktreeBoundaryNegativePassed = [') &&
  selfTestSource.includes('worktreeBoundaryNegativePassed !== 2') &&
  selfTestSource.includes('worktreeBoundaryPositive=1') && selfTestSource.includes('worktreeBoundaryNegative=2/2') &&
  selfTestSource.includes("validateResumeWorktreeBoundary('b'.repeat(40), contract.postApplyResume.signedCiHeadSha, ' M tracked.sql')"),
  'worktree same-HEAD/dirty-tracked negative controls or clean-descendant positive control are incomplete')
check(selfTestSource.includes('const syntheticManifest = {') &&
  selfTestSource.includes('const syntheticRestoreEvidence = {') &&
  selfTestSource.includes('const syntheticFullSnapshot = {') &&
  selfTestSource.includes('const reconciliationNegativeCases = [') &&
  selfTestSource.includes('reconciliationNegativePassed !== reconciliationNegativeCases.length') &&
  selfTestSource.includes('keyAmountDriftDenied=1') && selfTestSource.includes('inventoryDriftDenied=1') &&
  selfTestSource.includes('rawLedgerDriftDenied=1') && selfTestSource.includes('fullContentDriftDenied=1') &&
  selfTestSource.includes('artifactBindingDriftDenied=1') && selfTestSource.includes('restoreStatusDriftDenied=1') &&
  selfTestSource.includes('storageDriftDenied=1') && selfTestSource.includes('manifestShaDriftDenied=1') &&
  selfTestSource.includes('restoreEvidenceShaDriftDenied=1') && selfTestSource.includes('fixturePatterns=4/4') &&
  selfTestSource.includes("JSON.stringify(authFixtureEmailPatterns) !== JSON.stringify(['p1-%@example.invalid', 'access-%@example.invalid'])") &&
  selfTestSource.includes("'d4000000-0000-4000-8000-00000000000%', 'd5100000-0000-4000-8000-00000000000%'") ,
  'synthetic signed-evidence, amount, inventory, raw-ledger, content, or Storage drift controls are incomplete')
check(source.includes("if (test.executionMode === 'read_only')") &&
  source.includes("args.push('--single-transaction', '--command', 'set transaction read only;')"),
  'read-only SQL tests are not database-enforced read-only transactions')
const rollbackFixtures = databaseContract.tests.filter((entry) => entry.executionMode === 'rollback_fixture')
check(databaseContract.tests.length === 27 && rollbackFixtures.length === 5 &&
  databaseContract.tests.every((entry) => entry.sha256Lf === sha256Lf(resolve(repoRoot, entry.path))) &&
  rollbackFixtures.every((entry) => {
    const sql = normalizeLf(readFileSync(resolve(repoRoot, entry.path), 'utf8'))
    return /^\s*(?:--[^\n]*\n\s*)*begin\s*;/i.test(sql) && /rollback\s*;\s*$/i.test(sql)
  }), '27-test hashes or five explicit BEGIN/ROLLBACK fixture contracts drift')
check(source.includes('team_os_4_p1_access_shell_ok') && source.includes('access_control_foundation_ok') &&
  source.includes('attempt.testsPassed.length !== contract.expected.tests'),
  'P1/access-control markers or 27-test total are not required')
check(source.includes('assertCatalog(catalog)') && source.includes('assertResumeStable(sourceEvidence.preflight.before, before, after)'),
  'catalog/final reconciliation is missing')
check(Object.keys(contract.expected.catalog ?? {}).length === 4 &&
  contract.expected.postMigrationRows === 70 && contract.expected.preMigrationRows === 69 &&
  contract.expected.tests === 27 && resume?.sourcePreMigrationRows === 69 &&
  resume?.requiredPostMigrationRows === 70,
  '69/70, 27-test, or 4-catalog contract totals drift')
check(source.includes('migrationAlreadyApplied: true') && source.includes('dbPushPerformed: false') &&
  source.includes('persistentRemoteWrites: 0') && source.includes('productionReads: 0') &&
  source.includes('productionWrites: 0'),
  'resume evidence does not explicitly preserve zero-push/zero-persistent-write boundaries')
check(source.includes('function safeEvidence(') && source.includes('/PGPASSWORD|postgres(?:ql)?:\\/\\/|sb_(?:secret|publishable)_|eyJ') &&
  source.includes('clearDbEnvironment(channel.dbEnvironment)') && source.includes('channel.dbEnvironment = null'),
  'secret scanning or final credential clearing is incomplete')
check(source.includes('attempt.verificationStarted = true') && source.includes('attempt.attempts = 1'),
  'single resume verification attempt marker missing')
check(source.includes('retryPerformed: false') && source.includes('remoteCleanupPerformed: false'), 'first-failure stop evidence missing')
check(source.includes('rmSync(channel.workdir, { recursive: true, force: true })'), 'temporary channel cleanup missing')
check(contract.candidate.remoteExecutionAllowed === false &&
  contract.referenceSync.remoteExecutionRequires === 'resume-only-synchronized-and-qualified',
  'old apply candidate is not permanently disabled or resume sync boundary drifted')
check(source.includes('if (!validateResumeRemoteGate(mode, syncState, contract.postApplyResume))') &&
  source.includes('P1_REMOTE_EXECUTION_REFUSED: post-apply resume candidate is not reference-synchronized and qualified'),
  'main does not exclusively use the independent resume remote gate')

check(/^\s*(?:--[^\n]*\n\s*)*begin\s*;/i.test(accessControlTest) && /rollback\s*;\s*$/i.test(accessControlTest),
  'access-control legacy-member cases are not fully transactional')
check(accessControlTest.includes("'Access Negative', 'member', 'active'") &&
  accessControlTest.includes("'Access Sales', 'member', 'active'") &&
  accessControlTest.includes("'Access Admin', 'member', 'active'"),
  'legacy-member negative/sales/admin fixture shapes are missing')
check(accessControlTest.includes("'d5100000-0000-4000-8000-000000000002'::uuid, 'sales'::text") &&
  accessControlTest.includes("'d5100000-0000-4000-8000-000000000003'::uuid, 'admin'::text") &&
  accessControlTest.includes("Legacy member without an explicit primary role received managed access") &&
  accessControlTest.includes("Explicit sales primary role permission contract failed") &&
  accessControlTest.includes("Explicit admin primary role permission contract failed"),
  'owner-confirmed legacy-member explicit sales/admin positive-negative contract is incomplete')

const repair = contract.pendingTriggerRepair
const backfillIndex = migration.indexOf(repair.backfillStatement)
const immediateIndex = migration.indexOf(repair.immediateStatement, backfillIndex)
const deferredIndex = migration.indexOf(repair.deferredStatement, immediateIndex)
const alterIndex = migration.indexOf(repair.alterStatement, deferredIndex)
check(repair.constraintName === 'public.profile_access_roles_last_admin', 'pending-trigger constraint name drift')
check(backfillIndex >= 0 && backfillIndex < immediateIndex && immediateIndex < deferredIndex && deferredIndex < alterIndex,
  'pending-trigger repair order must be backfill -> targeted immediate -> restore deferred -> alter')
check(occurrences(migration, repair.immediateStatement) === 1 && occurrences(migration, repair.deferredStatement) === 1,
  'pending-trigger repair statements must each occur exactly once')
check(repair.forbidAllConstraintsFlush === true && !/set\s+constraints\s+all\s+immediate/i.test(migration),
  'migration uses an over-broad SET CONSTRAINTS ALL flush')
check(test.includes("tgname = 'profile_access_roles_last_admin'") && test.includes('tgdeferrable') && test.includes('tginitdeferred'),
  'P1 SQL test does not preserve the existing last-admin trigger mode')
check(postgresRegression.includes("negative control did not reproduce SQLSTATE 55006 pending trigger events") &&
  postgresRegression.includes('set constraints canwin_p1_regression.profile_access_roles_last_admin immediate;') &&
  postgresRegression.includes('set constraints canwin_p1_regression.profile_access_roles_last_admin deferred;'),
  'real temporary Postgres regression lacks the 55006 control or repaired sequence')
check(postgresRegression.includes("PGHOST: '127.0.0.1'") && postgresRegression.includes('remoteConnectionsAllowed !== false'),
  'temporary Postgres regression is not loopback-only and fail-closed')
const localPostgres = repair.localPostgres
check(localPostgres.temporaryRoot === 'D:/CanWinP1LocalPgRuns' && /^[\x20-\x7e]+$/.test(localPostgres.temporaryRoot),
  'temporary Postgres root is not fixed to a pure-ASCII D drive path')
check(localPostgres.binaryRoot === 'D:/CanWinP1Postgres18/bin' &&
  [localPostgres.initdbPath, localPostgres.pgCtlPath, localPostgres.psqlPath]
    .every((path) => path.startsWith(localPostgres.binaryRoot + '/') && /^[\x20-\x7e]+$/.test(path)),
  'local Postgres tools are not fixed absolute ASCII paths')
check(localPostgres.user === 'p1_regression' && localPostgres.bootstrapUser === 'p1_regression' &&
  localPostgres.encoding === 'UTF8' && localPostgres.clientEncoding === 'UTF8' && localPostgres.locale === 'C' &&
  localPostgres.toolVersion === '18.4',
  'ASCII bootstrap user, UTF8, or locale C lock drift')
check(JSON.stringify([...localPostgres.forbiddenInheritedEnvironment].sort()) ===
  JSON.stringify(['HOME', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USERPROFILE']),
  'Windows identity inheritance deny-list drift')
check(!JSON.stringify(localPostgres).includes('NUL'), 'NUL device is allowed by local Postgres contract')
check(postgresRegression.includes('function runStaticSelfTest()') &&
  postgresRegression.includes('ASCII/UTF8/locale static negative test failed') &&
  postgresRegression.includes('P1_PENDING_TRIGGER_POSTGRES_SELFTEST_OK'),
  'ASCII/UTF8/locale negative self-test is missing')
check(JSON.stringify(localPostgres.pgCtlStart?.stdio) === JSON.stringify(['ignore', 'ignore', 'ignore']) &&
  localPostgres.pgCtlStart?.logFlag === '-l' && localPostgres.pgCtlStart?.waitFlag === '-w' &&
  localPostgres.pgCtlStart?.timeoutFlag === '-t' && localPostgres.pgCtlStart?.timeoutSeconds === 30 &&
  localPostgres.pgCtlStart?.hardLimitSeconds === 120,
  'pg_ctl no-pipe/log/wait/timeout contract drift')
check(postgresRegression.includes("stdio: options.stdio ?? 'pipe'") &&
  postgresRegression.includes('function validateStartInvocation(') &&
  postgresRegression.includes("stdio: [...regression.pgCtlStart.stdio]") &&
  postgresRegression.includes('pg_ctl start uses a Node pipe'),
  'pg_ctl start no-pipe implementation or negative guard missing')
check(postgresRegression.includes('requireServerStartSuccess(started, serverLog)') &&
  postgresRegression.includes('redactedLogTail(serverLog)') &&
  postgresRegression.includes('regression.pgCtlStart.logFlag') &&
  postgresRegression.includes('regression.pgCtlStart.waitFlag') &&
  postgresRegression.includes('regression.pgCtlStart.timeoutFlag'),
  'pg_ctl start does not use ASCII server log plus wait/timeout locks')
check(postgresRegression.includes('if (serverStarted || existsSync(resolve(dataDirectory, \'postmaster.pid\')))') &&
  postgresRegression.includes('ignoreDeadline: true') &&
  postgresRegression.includes("['stop', '-D', dataDirectory, '-m', 'fast', '-w', '-t', '30']"),
  'temporary Postgres finally-stop guarantee missing')
check(postgresRegression.includes('pgCtlStartNegative=${startNegativePassed}/${startNegativeCases.length}') &&
  postgresRegression.includes('two-minute local Postgres hard limit exceeded'),
  'pg_ctl pipe/log/wait/timeout negatives or hard limit missing')
const staticContractStart = postgresRegression.indexOf('function validateStaticContract(')
const staticContractEnd = postgresRegression.indexOf('function probeToolVersion(', staticContractStart)
const staticContractSource = postgresRegression.slice(staticContractStart, staticContractEnd)
check(staticContractStart >= 0 && staticContractEnd > staticContractStart && !staticContractSource.includes('existsSync('),
  'self-test static contract still requires local tool files')
check(postgresRegression.includes('function validateExecutionToolchain(') &&
  postgresRegression.includes('const pathExists = dependencies.pathExists ?? existsSync') &&
  postgresRegression.includes('const versionProbe = dependencies.versionProbe ?? probeToolVersion') &&
  postgresRegression.includes('assertStaticContract()\n  assertExecutionToolchain()'),
  'execute-only tool existence/version gate is missing')
check(postgresRegression.includes('selfTestMissingTools=allowed') &&
  postgresRegression.includes('executeMissingTools=${executeMissingPassed}/${toolPaths.length}') &&
  postgresRegression.includes('executeVersionDrift=${executeVersionDriftPassed}/1'),
  'missing-tool self-test allowance or execute refusal negatives missing')

check(sha256Lf(resolve(repoRoot, contract.candidate.migrationPath)) === contract.candidate.migrationSha256Lf,
  'P1 migration LF hash drift')
check(sha256Lf(resolve(repoRoot, contract.candidate.testPath)) === contract.candidate.testSha256Lf,
  'P1 SQL test LF hash drift')
check(sha256Lf(resolve(repoRoot, contract.scriptHardLocks.runnerPath)) === contract.scriptHardLocks.runnerSha256Lf,
  'P1 runner LF hash drift')
const validatorLfSha = sha256Lf(resolve(repoRoot, contract.scriptHardLocks.validatorPath))
check(validatorLfSha === contract.scriptHardLocks.validatorSha256Lf,
  `P1 validator LF hash drift actual=${validatorLfSha}`)
check(sha256Lf(resolve(repoRoot, contract.scriptHardLocks.postgresRegressionPath)) === contract.scriptHardLocks.postgresRegressionSha256Lf,
  'P1 local Postgres regression LF hash drift')

if (failures.length > 0) {
  console.error('P1_ISOLATED_RUNTIME_RUNNER_DRIFT')
  for (const failure of failures) console.error('- ' + failure)
  process.exit(1)
}
console.log(`P1_ISOLATED_RUNTIME_RUNNER_OK assertions=${assertionCount} sourceEolFormats=lf,crlf,mixed targetLocked=1 productionDenied=1 resumeOnly=1 candidateRemote=0 resumeRemote=1 signedCiRun=29699951990 signedCiLinux=88227205377 signedCiWindows=88227205362 signedCiDualPlatform=19/19+12/12 signedCiCounts=70/27/7/11/9/4 sameHeadDenied=1 trackedDirtyDenied=1 untrackedAuditAllowed=1 dbPush=0 signed69Baseline=1 exact70PostApply=1 signedArtifacts=6 authRecoveryScope=1 fixturePatterns=4/4 sqlTests=27 perTestSnapshots=27 fullSnapshots=29 storageArchives=2 catalog=4 canonicalBeforeAfter=1 contentFingerprints=1 syntheticDriftControls=9 readOnlyTransactions=1 rollbackFixtures=1 credentialRotation=1 pendingTriggerOrder=1 postgresRegression=1 temporaryChannel=1 singleAttempt=1 secretsPersisted=0 validatorDatabaseCalls=0 validatorStorageCalls=0 validatorDEvidenceRequired=0 runnerSelftestDatabaseCalls=0 runnerSelftestStorageCalls=0 runnerSelftestDEvidenceRequired=0`)
