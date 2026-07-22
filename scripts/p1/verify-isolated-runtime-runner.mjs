import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = resolve(repoRoot, 'scripts', 'p1')
const normalizeLf = (value) => value.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
const sha256Lf = (path) => createHash('sha256').update(normalizeLf(readFileSync(path, 'utf8'))).digest('hex')
const rawSource = readFileSync(resolve(root, 'run-isolated-runtime.mjs'), 'utf8')
const source = normalizeLf(rawSource)
const validatorSource = normalizeLf(readFileSync(fileURLToPath(import.meta.url), 'utf8'))
const contract = JSON.parse(readFileSync(resolve(root, 'isolated-runtime-contract.json'), 'utf8'))
const databaseContract = JSON.parse(readFileSync(resolve(repoRoot, contract.databaseContractPath), 'utf8'))
const migrationManifest = JSON.parse(readFileSync(resolve(repoRoot, contract.migrationManifestPath), 'utf8'))
const repairMigration = normalizeLf(readFileSync(resolve(repoRoot, contract.aclRepair.migrationPath), 'utf8'))
const repairSqlTest = normalizeLf(readFileSync(resolve(repoRoot, contract.aclRepair.testPaths.teamOs4P1), 'utf8'))
const compatibilitySources = Object.fromEntries(
  contract.aclRepair.applicationCompatibility.resolvedEvidence.files.map((path) => [
    path, normalizeLf(readFileSync(resolve(repoRoot, path), 'utf8')),
  ]),
)
const failures = []
let assertionCount = 0
const check = (condition, message) => { assertionCount += 1; if (!condition) failures.push(message) }
const occurrences = (text, needle) => text.split(needle).length - 1
const index = (needle, from = 0) => source.indexOf(needle, from)

const REPAIR_VERSION = '20260720015435'
const REPAIR_SHA = '1bb13f29fc0f5512bd00115dc1c953a2c3aaa0ec21522b1cc8cbb45a18a5cdc0'
const SOURCE_RUN = 'p1-resume-20260719T193911279Z-ea6ed9385d'
const SOURCE_HEAD = 'ea6ed9385de7c3ceff5cba6c6f8539f883bbea1d'
const SOURCE_PREFLIGHT_SHA = 'e0ea653d3a411cc9baafbd4b98e7d6d458b99316e8da93a1db1600a21e2dc36a'
const SOURCE_FAILURE_SHA = '576a11005285cd708adca5b3486e0b929ace8d97fc3cc3284d657b57519b91ad'
const APPLIED_FAILURE_RUN = 'p1-acl-repair-20260720T151012163Z-d1f4c5e7c4'
const APPLIED_FAILURE_SHA = '1d49c8e20cc05ea345cfd5204497d4f044f671f1916706381bb6bcea792a3881'
const APPLIED_PREFLIGHT_SHA = 'e7e17ce50461da38e64a7f442019835770c64522223e0965e034a7532001f335'
const expectedFunctions = [
  ['public.enqueue_wecom_notification_jobs(text, timestamp with time zone)', ['service_role']],
  ['public.claim_wecom_notification_jobs(integer, timestamp with time zone)', ['service_role']],
  ['public.complete_wecom_notification_job(uuid, boolean, text, text, timestamp with time zone)', ['service_role']],
  ['public.manage_profile_access(uuid, text[], uuid[])', ['service_role']],
  ['public.admin_replace_profile_roles(uuid, text[], uuid)', ['service_role']],
  ['public.admin_replace_supervisor_subordinates(uuid, uuid[], uuid)', ['service_role']],
].map(([identity, requiredGrantRoles]) => ({
  identity,
  revokeRoles: ['PUBLIC', 'anon', 'authenticated'],
  requiredGrantRoles,
}))
const PRIVATE_MEMBER_ACCESS_IDENTITY = 'private.admin_apply_member_access_v1(uuid, text, text[], uuid[], uuid[], text[], uuid)'
const expectedAtomicMapping = [
  { condition: 'primary-admin', legacyRole: 'admin' },
  { condition: 'additional-supervisor', legacyRole: 'captain' },
  { condition: 'primary-finance', legacyRole: 'finance' },
  { condition: 'additional-warehouse', legacyRole: 'warehouse' },
  { condition: 'fallback', legacyRole: 'member' },
]

check(contract.target.projectRef === 'zdmuaqokndhhbarudhtw', 'isolated target ref drift')
check(contract.forbiddenProductionProjectRef === 'agygfhmkazcbqaqwmljb', 'production deny ref drift')
check(source.includes("const allowedModes = new Set(['--self-test'])"),
  'runner mode is not limited to prequalification-safe self-test')
check(!source.includes('executePostApplyResume') && !source.includes('validateResumeRemoteGate') &&
  !source.includes('loadResumeEvidence') && !source.includes('assertPostApplyBaseline'),
  'retired resume execution code remains reachable')
check(contract.candidate.remoteExecutionAllowed === false && contract.postApplyResume.remoteExecutionAllowed === false &&
  contract.postApplyResume.dbPushAllowed === false,
  'old candidate/resume remote execution is not permanently disabled')
check(contract.candidate.testSha256Lf === 'bed07c4d494ac3e7f7e993e12090194ed413b0e92d681aea0adb3eb381f430fb',
  'historical 8273 P1 test hash was overwritten')
check(contract.referenceSync.remoteExecutionRequires === 'acl-repair-only-dual-platform-ci-qualified',
  'remote qualification boundary is not ACL-repair-only')

const repair = contract.aclRepair
check(contract.contractStatus === 'p1_acl_repair_resume_prequalification_pending' &&
  repair.mode === '--apply-acl-repair' && repair.remoteExecutionAllowed === false &&
  repair.dbPushAllowed === false && repair.requiredConnectionMode === 'session-pooler' &&
  repair.newIndependentCiRequired === true && repair.signedCiRunId === '29750768517' &&
  repair.signedCiHeadSha === '370a04aa9fddcce9788df33de3f0ae6924bda932' &&
  repair.signedCiLinuxJobId === '88380368836' && repair.signedCiWindowsJobId === '88380368845' &&
  repair.signedCiConclusion === 'success' &&
  repair.migrationVersion === REPAIR_VERSION,
  'closed apply / resume-prequalification boundary drift')
const resume = contract.aclRepairReadOnlyResume
const resumeCi = contract.aclRepairReadOnlyResumeCiRunEvidence
check(resume?.mode === '--resume-acl-repair-verification' && resume?.remoteExecutionAllowed === false &&
  resume?.dbPushAllowed === false && resume?.maxDbPushAttempts === 0 &&
  resume?.persistentDatabaseWritesAllowed === false && resume?.expectedPersistentRemoteWrites === 0 &&
  resumeCi?.status === 'pending-new-signed-run' && resumeCi?.currentQualificationAllowed === false &&
  resumeCi?.successEvidencePresent === false,
  'read-only resume is not prequalification locked')
check(JSON.stringify(contract.acceptanceBoundary) === JSON.stringify({
  formalAclRepairDryRun: 'direct-db-connection-timeout-failed-stop-preserved',
  formalAclRepairFailureRunId: 'p1-acl-repair-20260720T122757275Z-8fa1498850',
  aclRepairQualification: 'historical-session-pooler-ci-apply-closed-resume-prequalification-pending',
  aclRepairQualificationCount: 0,
  aclRepairQualifiedRunId: null,
  aclRepairHistoricalQualifiedRunId: '29750768517',
  aclRepairRemoteExecutionAllowed: false,
  aclRepairDbPushAllowed: false,
  aclRepairAppliedFailureRunId: 'p1-acl-repair-20260720T151012163Z-d1f4c5e7c4',
  aclRepairConfirmedPersistentWrites: 1,
  aclRepairResumeQualification: 'pending-new-signed-run',
  aclRepairResumeRemoteExecutionAllowed: false,
  aclRepairResumeCurrentWrites: 0,
  historicalApplyDatabaseCiPassed: true,
  readOnlyResumeDatabaseCiPassed: false,
  nextConnectionMode: 'session-pooler',
  newIndependentCiRequired: true,
  g1OverallClaim: false,
  overallAcceptedProgressPercent: 25,
}), 'isolated-runtime acceptance boundary contradicts the closed apply / pending read-only resume state')
check(repair.migrationPath === 'supabase/migrations/20260720015435_harden_server_only_rpc_acl.sql' &&
  repair.migrationSha256Lf === REPAIR_SHA && sha256Lf(resolve(repoRoot, repair.migrationPath)) === REPAIR_SHA,
  'signed ACL repair migration path/hash drift')
check(JSON.stringify(repair.testPaths) === JSON.stringify({
  teamOs4P1: 'supabase/tests/team_os_4_p1_access_shell.sql',
  notificationCore: 'supabase/tests/notification_core.sql',
}), 'ACL repair current test paths drift')
check(JSON.stringify(repair.testSha256Lf) === JSON.stringify({
  teamOs4P1: 'c598b4e4ed3c7e26d9411cb4084685bea1233f47ae969c2685e048f480dac09e',
  notificationCore: 'a3d87069899b986b191bc21826f5e23c65fe4734066e52adc4e14753c9e6e5a3',
}) && Object.entries(repair.testPaths).every(([name, path]) => (
  sha256Lf(resolve(repoRoot, path)) === repair.testSha256Lf[name]
)), 'ACL repair current test hashes drift')
check(repair.preMigrationRows === 70 && repair.postMigrationRows === 71 &&
  repair.expectedMigrationCount === 71 && repair.sqlTestCount === 27,
  '70-to-71 or 27-test repair totals drift')
check(repair.maxFormalAttempts === 1 && repair.maxDbPushAttempts === 0 &&
  repair.dryRunRequired === false && JSON.stringify(repair.pendingMigrationVersions) === JSON.stringify([]),
  'historical apply path is not mechanically closed')
check(JSON.stringify(repair.targetFunctions) === JSON.stringify(expectedFunctions) &&
  JSON.stringify(repair.expectedChangedFunctions) ===
    JSON.stringify(expectedFunctions.slice(0, 3).map((entry) => entry.identity)),
  'exact six-function ACL repair inventory drift')
check(JSON.stringify(repair.allowedFullReconciliationDifferences) === JSON.stringify([
  'migrationHistory.schemaMigrations', 'schemaSecurity.publicRoutinesMd5',
]) && repair.unknownDifferencesAllowed === false,
  'ACL repair full-reconciliation difference allow-list drift')
const privateDefinition = repair.privateRoutineDefinitionTransition
check(JSON.stringify(privateDefinition?.expectedChangedFunctions) === JSON.stringify([PRIVATE_MEMBER_ACCESS_IDENTITY]) &&
  privateDefinition?.expectedDefinitionChanges === 1 && privateDefinition?.identityChangesAllowed === 0 &&
  privateDefinition?.securityEnvelopeChangesAllowed === 0 && privateDefinition?.unknownChangesAllowed === false,
  'private member-access routine definition transition contract drift')
const atomicCompatibility = repair.atomicLegacyRoleCompatibility
check(atomicCompatibility?.status === 'passed' &&
  atomicCompatibility?.staticPassed === true && atomicCompatibility?.databaseCiPassed === true &&
  atomicCompatibility?.remoteQualificationAllowed === false &&
  atomicCompatibility?.writeFunction === PRIVATE_MEMBER_ACCESS_IDENTITY &&
  JSON.stringify(atomicCompatibility?.mappingPrecedence) === JSON.stringify(expectedAtomicMapping) &&
  atomicCompatibility?.successfulMappingCases === 5 && atomicCompatibility?.rollbackControls === 2 &&
  atomicCompatibility?.sameTeamStaticGuards === 4 && atomicCompatibility?.remoteGateNegativeControls === 5 &&
  atomicCompatibility?.atomicRemoteGateNegativeControls === 2 &&
  atomicCompatibility?.migrationRewritesExistingProfiles === false &&
  atomicCompatibility?.appShellAssertionsPassed === 99 && atomicCompatibility?.appShellAssertionsExpected === 99,
  'atomic legacy role compatibility qualification drift')
check(atomicCompatibility?.sqlTestPath === repair.testPaths.teamOs4P1 &&
  atomicCompatibility?.sqlTestSha256Lf === repair.testSha256Lf.teamOs4P1 &&
  sha256Lf(resolve(repoRoot, atomicCompatibility.sqlTestPath)) === atomicCompatibility.sqlTestSha256Lf &&
  atomicCompatibility?.edgeFunctionPath === 'supabase/functions/admin-members/index.ts' &&
  sha256Lf(resolve(repoRoot, atomicCompatibility.edgeFunctionPath)) === atomicCompatibility.edgeFunctionSha256Lf &&
  atomicCompatibility?.staticTestPath === 'scripts/p1/verify-access-admin-v1-write-chain.ts' &&
  sha256Lf(resolve(repoRoot, atomicCompatibility.staticTestPath)) === atomicCompatibility.staticTestSha256Lf,
  'atomic compatibility source evidence hash drift')
check(repair.applicationCompatibility?.status === 'passed' &&
  repair.applicationCompatibility?.remoteQualificationAllowed === false &&
  repair.applicationCompatibility?.legacyRpcCallSites?.length === 0 &&
  repair.applicationCompatibility?.resolvedEvidence?.staticCallSitesRemaining === 0 &&
  repair.applicationCompatibility?.resolvedEvidence?.appShellAssertionsPassed === 99 &&
  repair.applicationCompatibility?.resolvedEvidence?.appShellAssertionsExpected === 99 &&
  repair.applicationCompatibility?.resolvedEvidence?.warehouseBackendRelaxed === false &&
  JSON.stringify(repair.applicationCompatibility?.resolvedEvidence?.formalStaticGateCoverage) === JSON.stringify({
    gate: 16,
    serial: true,
    runnerValidatorPassed: true,
    appShellPassed: true,
    accessV1BehaviorPassed: true,
  }),
  'application compatibility resolution or qualification drift')
const forbiddenLegacyRpcNames = ['manage_profile_access', 'admin_replace_profile_roles', 'admin_replace_supervisor_subordinates']
const findLegacyRpcCalls = (text) => forbiddenLegacyRpcNames.filter((name) => (
  new RegExp(`\\.rpc\\(\\s*['\"]${name}['\"]`).test(text)
))
check(JSON.stringify(repair.applicationCompatibility.resolvedEvidence.forbiddenRpcNames) ===
  JSON.stringify(forbiddenLegacyRpcNames) &&
  Object.values(compatibilitySources).every((text) => findLegacyRpcCalls(text).length === 0),
  'resolved frontend/Edge files still call a retired role/supervisor RPC')
check(findLegacyRpcCalls("await client.rpc('admin_replace_profile_roles', {})").length === 1 &&
  findLegacyRpcCalls("await client.rpc('admin_replace_supervisor_subordinates', {})").length === 1,
  'legacy RPC compatibility detector negative control failed')
const priorRepairCi = contract.priorRepairCiFailureEvidence
const priorSuccessfulRepairCi = contract.priorSuccessfulRepairCiRunEvidence
const priorParserFixRepairCi = contract.priorParserFixRepairCiRunEvidence
const priorFormalAclRepairFailure = contract.priorFormalAclRepairFailureEvidence
const repairCi = contract.repairCiRunEvidence
const formalAclRepairFailure = contract.formalAclRepairFailureEvidence
check(priorRepairCi.runId === '29726897764' &&
  priorRepairCi.headSha === 'e774ead5a2857afb511400a12897e629033cf941' &&
  priorRepairCi.linuxJobId === '88301987239' && priorRepairCi.windowsJobId === '88301987280' &&
  priorRepairCi.status === 'failure' && priorRepairCi.linuxStatus === 'failure' &&
  priorRepairCi.windowsStatus === 'success' && priorRepairCi.failedAssertionExpectedAuditRows === 6 &&
  priorRepairCi.failedAssertionActualAuditRows === 7 &&
  JSON.stringify(priorRepairCi.correctedExpectedAuditRowsByAction) ===
    JSON.stringify({ memberAccess: 5, supervisorSystem: 1, supervisorScope: 1 }) &&
  priorRepairCi.sqlTestsStarted === 18 && priorRepairCi.sqlTestsPassed === 17 &&
  priorRepairCi.preservedWithoutRerun === true &&
  priorSuccessfulRepairCi.runId === '29733854344' &&
  priorSuccessfulRepairCi.runUrl === 'https://github.com/yccanwin/canwin-team-os/actions/runs/29733854344' &&
  priorSuccessfulRepairCi.headSha === '71b7320b4c303af797ee9e4bf12044518a4fe18a' &&
  priorSuccessfulRepairCi.linuxJobId === '88324427055' && priorSuccessfulRepairCi.windowsJobId === '88324427244' &&
  priorSuccessfulRepairCi.status === 'success' && priorSuccessfulRepairCi.linuxStatus === 'success' &&
  priorSuccessfulRepairCi.windowsStatus === 'success' && priorSuccessfulRepairCi.migrationsPassed === 71 &&
  priorSuccessfulRepairCi.sqlTestsStarted === 27 && priorSuccessfulRepairCi.sqlTestsPassed === 27 &&
  priorSuccessfulRepairCi.databaseTestsPassed === 7 && priorSuccessfulRepairCi.permissionTestsPassed === 11 &&
  priorSuccessfulRepairCi.businessTestsPassed === 9 && priorSuccessfulRepairCi.catalogAssertionsPassed === 4 &&
  priorSuccessfulRepairCi.windowsStaticPassed === 19 && priorSuccessfulRepairCi.windowsLocalPassed === 12 &&
  priorSuccessfulRepairCi.linuxDatabaseAccepted === true && priorSuccessfulRepairCi.cleanupPassed === true &&
  priorSuccessfulRepairCi.retryPerformed === false &&
  priorSuccessfulRepairCi.priorFailedRunPreservedWithoutRerun === '29726897764' &&
  priorSuccessfulRepairCi.candidateRemoteExecutionAllowed === false &&
  priorSuccessfulRepairCi.g1OverallClaim === false &&
  priorSuccessfulRepairCi.evidenceScope === 'historical-prior-success-only' &&
  priorSuccessfulRepairCi.currentQualificationAllowed === false,
  'repair CI failure preservation or historical success evidence drift')
check(priorParserFixRepairCi.runId === '29738966326' &&
  priorParserFixRepairCi.runUrl === 'https://github.com/yccanwin/canwin-team-os/actions/runs/29738966326' &&
  priorParserFixRepairCi.headSha === '070c2e4ca185037d37f65b4d98be617a43e4409d' &&
  priorParserFixRepairCi.linuxJobId === '88340968144' &&
  priorParserFixRepairCi.windowsJobId === '88340968119' &&
  priorParserFixRepairCi.status === 'success' && priorParserFixRepairCi.conclusion === 'success' &&
  priorParserFixRepairCi.qualificationScope === 'acl_repair_parser_fix_prequalification' &&
  priorParserFixRepairCi.databaseCiPassed === true &&
  priorParserFixRepairCi.remoteQualificationAllowed === true &&
  priorParserFixRepairCi.currentQualificationAllowed === false &&
  priorParserFixRepairCi.evidenceScope === 'historical-parser-fix-ci-for-failed-direct-db-candidate',
  'historical parser-fix CI evidence drift')
check(priorFormalAclRepairFailure.runId === 'p1-acl-repair-20260720T104323349Z-4fa8de78a8' &&
  priorFormalAclRepairFailure.failureSha256 === '16373794dd745ad86422bb59f3966933532cb0bf073251963b519c2b8e367e73' &&
  priorFormalAclRepairFailure.supervisionHeadSha === '4fa8de78a8b05f8285f69fb0d6d9106e20e3cba7' &&
  priorFormalAclRepairFailure.status === 'failed-stop-preserved' &&
  priorFormalAclRepairFailure.currentStep === 'db-push-dry-run' &&
  priorFormalAclRepairFailure.formalAttemptStarted === false &&
  priorFormalAclRepairFailure.dbPushAttempts === 0 &&
  priorFormalAclRepairFailure.persistentRemoteWrites === 0 &&
  priorFormalAclRepairFailure.productionReads === 0 && priorFormalAclRepairFailure.productionWrites === 0 &&
  priorFormalAclRepairFailure.successEvidencePresent === false,
  'prior formal ACL dry-run failure evidence drift')
check(formalAclRepairFailure.runId === 'p1-acl-repair-20260720T122757275Z-8fa1498850' &&
  formalAclRepairFailure.failureSha256 === '19e4cd30c3d024a452b74f94380a17175364326dc59d41b837bc338c398579ba' &&
  formalAclRepairFailure.supervisionHeadSha === '8fa14988502511d9722bd37add5b51d845f7934f' &&
  formalAclRepairFailure.status === 'failed-stop-preserved' &&
  formalAclRepairFailure.currentStep === 'db-push-dry-run' &&
  formalAclRepairFailure.failureClass === 'isolated-test-direct-database-connection-timeout' &&
  formalAclRepairFailure.connectionMode === 'direct-database-host' &&
  formalAclRepairFailure.migrationVersion === REPAIR_VERSION &&
  formalAclRepairFailure.migrationAlreadyApplied === false &&
  formalAclRepairFailure.formalAttemptStarted === false && formalAclRepairFailure.verificationStarted === false &&
  formalAclRepairFailure.dbPushAttempted === false &&
  formalAclRepairFailure.dbPushPerformed === false && formalAclRepairFailure.dbPushAttempts === 0 &&
  formalAclRepairFailure.attempts === 0 && formalAclRepairFailure.confirmedPersistentWrites === 0 &&
  formalAclRepairFailure.persistentRemoteWrites === 0 &&
  formalAclRepairFailure.persistentRemoteWriteUpperBound === 0 &&
  formalAclRepairFailure.productionReads === 0 && formalAclRepairFailure.productionWrites === 0 &&
  formalAclRepairFailure.secretsPrinted === 0 && formalAclRepairFailure.secretsWritten === 0 &&
  formalAclRepairFailure.targetPreserved === true && formalAclRepairFailure.retryPerformed === false &&
  formalAclRepairFailure.remoteCleanupPerformed === false && formalAclRepairFailure.successEvidencePresent === false,
  'direct database formal dry-run failure evidence drift')
check(repairCi.status === 'success' && repairCi.conclusion === 'success' &&
  repairCi.runId === '29750768517' &&
  repairCi.runUrl === 'https://github.com/yccanwin/canwin-team-os/actions/runs/29750768517' &&
  repairCi.headSha === '370a04aa9fddcce9788df33de3f0ae6924bda932' &&
  repairCi.linuxJobId === '88380368836' && repairCi.windowsJobId === '88380368845' &&
  repairCi.linuxStatus === 'success' && repairCi.windowsStatus === 'success' &&
  repairCi.qualificationScope === 'acl_repair_session_pooler_prequalification' &&
  repairCi.requiredConnectionMode === 'session-pooler' && repairCi.newIndependentCiRequired === true &&
  repairCi.newIndependentCi === true && repairCi.evidenceScope === 'current-independent-session-pooler-ci' &&
  repairCi.databaseCiPassed === true && repairCi.remoteQualificationAllowed === true &&
  repairCi.currentQualificationAllowed === true && repairCi.successEvidencePresent === true &&
  repairCi.migrationsPassed === 71 && repairCi.sqlTestsPassed === 27 &&
  repairCi.databaseTestsPassed === 7 && repairCi.permissionTestsPassed === 11 &&
  repairCi.businessTestsPassed === 9 && repairCi.catalogAssertionsPassed === 4 &&
  repairCi.windowsStaticPassed === 19 && repairCi.windowsLocalPassed === 12 &&
  repairCi.productionReadPerformed === false && repairCi.productionWritePerformed === false &&
  repairCi.priorSuccessfulRunPreservedWithoutRerun === '29733854344' &&
  repairCi.priorParserFixRunPreservedWithoutRerun === '29738966326' &&
  repairCi.formalAclRepairFailurePreservedWithoutRerun === 'p1-acl-repair-20260720T122757275Z-8fa1498850' &&
  repairCi.priorQualifiedRunId === '29738966326' &&
  repairCi.closedByFormalAclRepairFailureRunId === 'p1-acl-repair-20260720T122757275Z-8fa1498850' &&
  repairCi.g1OverallClaim === false,
  'current Session Pooler CI qualification evidence drift')
check(source.includes('const repairFormalFailureClosed =') &&
  source.includes("contract.contractStatus === 'p1_acl_repair_formal_dry_run_failed_qualification_closed'") &&
  source.includes("contract.contractStatus === 'p1_acl_repair_session_pooler_remote_qualified_after_preserved_direct_db_failure'") &&
  source.includes("contract.contractStatus === 'p1_acl_repair_direct_db_dry_run_timeout_qualification_closed'") &&
  source.includes("contract.contractStatus === 'p1_acl_repair_resume_prequalification_pending'") &&
  source.includes('repairCiQualified, repairCiPending, repairFormalFailureClosed, repairDirectDbFailureClosed,') &&
  source.includes('resumePrequalificationPending,') &&
  source.includes('qualificationStateCount !== 1') &&
  source.includes("const RETIRED_ACL_REPAIR_CI_RUN_IDS = new Set(['29726897764', '29733854344', '29738966326'])") &&
  source.includes("'070c2e4ca185037d37f65b4d98be617a43e4409d'") &&
  source.includes("'4fa8de78a8b05f8285f69fb0d6d9106e20e3cba7'") &&
  source.includes("'8fa14988502511d9722bd37add5b51d845f7934f'") &&
  source.includes('function isRetiredAclRepairEvidence(') &&
  source.includes("ci?.evidenceScope === 'current-independent-session-pooler-ci'") &&
  source.includes('ci?.currentQualificationAllowed === true') &&
  source.includes("ci?.qualificationScope === 'acl_repair_session_pooler_prequalification'") &&
  source.includes("ci?.requiredConnectionMode === 'session-pooler'") &&
  source.includes('repair.signedCiRunId === ci?.runId') &&
  source.includes('repair.signedCiHeadSha === ci?.headSha') &&
  source.includes("entry.qualificationScope === 'acl_repair_session_pooler_prequalification'") &&
  source.includes("entry.requiredConnectionMode === 'session-pooler'") &&
  source.includes('entry.newIndependentCi === true') && source.includes('matches.length === 1') &&
  source.includes("'merge-base', '--is-ancestor',") &&
  source.includes('contract.formalAclRepairFailureEvidence.supervisionHeadSha') &&
  source.includes('futureQualifiedRepairGatePositive=1') &&
  source.includes('currentQualifiedRepairGateAccepted=0') &&
  source.includes('closedRepairGateNegative=3/3') &&
  source.includes('priorRepairCiRevivalDenied=2/2') &&
  source.includes('relabeledRevivalDenied=5/5') &&
  source.includes('independentCiHistoryPositive=1') &&
  source.includes('independentCiHistoryNegative=5/5') &&
  source.includes('relabeledHistoryRevivalDenied=2/2'),
  'runner does not preserve the mutually exclusive closed qualification state or deny historical CI revival')

const failed = contract.formalResumeFailureEvidence
check(failed.runId === SOURCE_RUN && failed.supervisionHeadSha === SOURCE_HEAD &&
  failed.preflightSha256 === SOURCE_PREFLIGHT_SHA && failed.failureSha256 === SOURCE_FAILURE_SHA,
  'signed formal failure identity/SHA drift')
check(failed.failedStep === 'test:database:supabase/tests/notification_core.sql' &&
  failed.firstFailedSqlTest === 'supabase/tests/notification_core.sql' &&
  failed.firstError === 'Notification worker RPC exposed',
  'signed first failure step/error drift')
check(failed.testsPassed === 5 && failed.perTestSnapshotsPassed === 5 &&
  failed.fullReconciliationSnapshotsPassed === 6 && failed.storageArchivesPassed === 1 && failed.attempts === 1,
  'signed failed-run counters drift')
check(failed.persistentRemoteWrites === 0 && failed.productionReads === 0 && failed.productionWrites === 0 &&
  failed.secretsPrinted === 0 && failed.secretsWritten === 0 && failed.retryPerformed === false &&
  failed.remoteCleanupPerformed === false && failed.targetPreserved === true,
  'signed failure zero-write/secrecy/preservation evidence drift')
check(source.includes(`const SOURCE_FAILURE_RUN_ID = '${SOURCE_RUN}'`) &&
  source.includes(`const SOURCE_FAILURE_HEAD = '${SOURCE_HEAD}'`) &&
  source.includes(`const SOURCE_PREFLIGHT_SHA256 = '${SOURCE_PREFLIGHT_SHA}'`) &&
  source.includes(`const SOURCE_FAILURE_SHA256 = '${SOURCE_FAILURE_SHA}'`),
  'runner does not literal-bind the preserved formal failure')
check(source.includes("JSON.stringify(evidenceFiles) !== JSON.stringify(['failure.json', 'preflight.json'])") &&
  source.includes("failure.currentStep !== 'test:database:supabase/tests/notification_core.sql'") &&
  source.includes("!failure.message?.includes('Notification worker RPC exposed')") &&
  source.includes('failure.fullReconciliationSnapshotsPassed !== 6'),
  'runner does not fully bind the two-file failed-run evidence')
const appliedFailure = contract.appliedAclAssertionFailureEvidence
check(appliedFailure?.runId === APPLIED_FAILURE_RUN &&
  appliedFailure?.failureSha256 === APPLIED_FAILURE_SHA &&
  appliedFailure?.preflightSha256 === APPLIED_PREFLIGHT_SHA,
  'applied ACL assertion failure identity/SHA drift')
check(source.includes(`const APPLIED_FAILURE_RUN_ID = '${APPLIED_FAILURE_RUN}'`) &&
  source.includes(`const APPLIED_FAILURE_SHA256 = '${APPLIED_FAILURE_SHA}'`) &&
  source.includes(`const APPLIED_PREFLIGHT_SHA256 = '${APPLIED_PREFLIGHT_SHA}'`) &&
  source.includes('function loadAppliedAclAssertionFailureEvidence()') &&
  source.includes('failure.migrationAlreadyApplied !== false') &&
  source.includes("failure.dbPushOutcome !== 'confirmed-applied'") &&
  source.includes('failure.confirmedPersistentWrites !== 1') &&
  source.includes('failure.persistentRemoteWrites !== 1') &&
  source.includes('failure.persistentRemoteWriteUpperBound !== 1') &&
  source.includes('failure.formalAttemptStarted !== true') &&
  source.includes('failure.verificationStarted !== false'),
  'runner does not bind the confirmed one-write applied ACL failure without rewriting its false marker')

check(source.includes("mkdtempSync(join(tmpdir(), 'canwin-p1-runtime-'))") &&
  source.includes("'link', '--project-ref', TARGET_REF, '--workdir', workdir") &&
  !source.includes("resolve(repoRoot, 'supabase', '.temp', 'project-ref')"),
  'temporary project isolation/link boundary drift')
check(source.includes('for (const [index, entry] of migrationManifest.entries.entries())') &&
  source.includes("copyFileSync(resolve(repoRoot, 'supabase', 'migrations', entry.file), stagedPath)") &&
  source.includes('validateStagedMigrationInventory(stagedFiles, stagedHashes, signedMigrations)'),
  'complete signed 71-file inventory is not staged and hash-verified')
check(source.includes('validateStagedMigrationInventory([], [], local)') &&
  source.includes("index === 70 ? '0'.repeat(64) : hash") &&
  source.includes('stagedInventoryNegative=3/3'),
  'empty/hash-drift/incomplete staged inventory negative controls are missing')
check(source.includes('buildSessionPoolerPushInvocation(channel, { dryRun: true })') &&
  source.includes("requireSuccess('signed ACL repair db push dry-run', result)") &&
  source.includes('env: invocation.childEnvironment') &&
  source.includes('clearPushInvocationSecret(invocation)') &&
  source.includes('stripVTControlCharacters(output)') &&
  source.includes(".replaceAll('\\r\\n', '\\n')") && source.includes(".replaceAll('\\r', '\\n')") &&
  source.includes('const migrationFilePattern = /(?:^|[^A-Za-z0-9_-])(') &&
  source.includes('file.slice(0, 14)') &&
  !source.includes('output.match(/\\b\\d{14}\\b/g)') &&
  source.includes('JSON.stringify(evidence.actualVersions) !== JSON.stringify([REPAIR_VERSION])') &&
  source.includes('JSON.stringify(evidence.actualMigrationFiles) !== JSON.stringify([evidence.expectedMigrationFile])'),
  'db push dry-run does not safely parse and strictly enumerate only migration71')
check(source.includes('actualVersions,') && source.includes('actualMigrationFiles,') &&
  source.includes('expectedMigrationFile: `${REPAIR_VERSION}_harden_server_only_rpc_acl.sql`') &&
  source.includes('outputSha256: sha256(output)') &&
  source.includes('return collectRepairPushDryRunEvidence(result.stdout, result.stderr)') &&
  !source.includes('return { versions, migrationFile: stagedFile'),
  'dry-run evidence does not retain only actual versions/files and output hash')
check(source.includes('function assertPasswordlessSessionPoolerUrl(') &&
  source.includes('function buildSessionPoolerPushInvocation(') &&
  source.includes("'db', 'push', '--db-url', dbUrl") &&
  source.includes('encodeURIComponent(environment.PGDATABASE)') &&
  source.includes('parsed.username || parsed.password') &&
  source.includes('/^[a-z0-9-]+\\.pooler\\.supabase\\.com$/i.test(environment.PGHOST)') &&
  source.includes('environment.PGPORT !== \'5432\'') &&
  source.includes('environment.PGSSLMODE !== \'require\'') &&
  source.includes('environment.PGUSER !== `cli_login_postgres.${TARGET_REF}`') &&
  source.includes('syntheticInheritedEnvironment') &&
  source.includes('PGPASSWORD: environment.PGPASSWORD') &&
  source.includes("delete childEnvironment.SUPABASE_DB_PASSWORD") &&
  source.includes("delete childEnvironment.SUPABASE_DB_URL") &&
  source.includes("delete childEnvironment.DATABASE_URL") &&
  source.includes("delete childEnvironment.PGPASSFILE") &&
  source.includes("delete childEnvironment.PGSERVICE") &&
  source.includes("delete childEnvironment.PGSERVICEFILE") &&
  source.includes("args.includes('--linked')") && source.includes("args.includes('--password')") &&
  source.includes('poolerPushPositive=2/2') && source.includes('poolerPushNegative=7/7') &&
  source.includes('poolerPushPasswordEnvOnly=1') && source.includes('poolerDirectDenied=1'),
  'db push is not strictly routed through a passwordless Session Pooler URL with environment-only password')
check(source.includes('"(?:stdout|stderr)"\\s*:') &&
  source.includes("safeEvidence({ stdout: 'raw output must not survive' })") &&
  source.includes("safeEvidence({ stderr: 'raw error output must not survive' })") &&
  source.includes('dryRunFailureEvidencePreserved=1') && source.includes('dryRunRawOutputAbsent=1') &&
  source.includes('poolerInvocationEvidenceDenied') && source.includes('poolerPushSecretsCleared=2/2') &&
  source.includes('evidenceNegative=7/7'),
  'dry-run/push raw-output or secret evidence negative controls are missing')
check(source.includes('buildSessionPoolerPushInvocation(channel, { dryRun: false })') &&
  occurrences(source, "'db', 'push'") === 1 && !source.includes("'--include-all'") &&
  !source.includes("'--include-seed'") && !source.includes("'--include-roles'"),
  'formal push is not exactly one shared passwordless Session Pooler path')
check(source.includes('attempt.dbPushAttempted = true') &&
  source.includes("attempt.dbPushOutcome = 'unknown_failed_command'") &&
  source.includes('attempt.dbPushPerformed = null') && source.includes('attempt.persistentRemoteWrites = null') &&
  source.includes('attempt.persistentRemoteWriteUpperBound = 1') &&
  source.includes('failedPushUnknownStatePreserved=1'),
  'failed push can be falsely reported as zero-write')
check(source.includes("attempt.dbPushOutcome = 'confirmed-applied'") &&
  source.includes('attempt.confirmedPersistentWrites = 1') && source.includes('attempt.persistentRemoteWrites = 1'),
  'successful push confirmed-write evidence is incomplete')

check(source.includes('function assertExact70RepairBaseline(') &&
  source.includes('proveMigrationSets(signedLocalMigrations(), current.migrationHistory, [REPAIR_VERSION])') &&
  source.includes('function assertExact71RepairBaseline(') &&
  source.includes('proveMigrationSets(signedLocalMigrations(), current.migrationHistory, [])'),
  'machine exact70/exact71 migration-set proofs are missing')
check(source.includes('function routineAclSnapshot(') && source.includes("'allRoutineAcls'") &&
  source.includes("'allRoutineEffectiveExecute'") && source.includes("pg_catalog.has_function_privilege('anon',oid,'EXECUTE')") &&
  source.includes('ACL repair routine difference set is not the exact signed three-function change inventory') &&
  source.includes('ACL repair target routine final ACL is not exact') &&
  source.includes('targetFunctionsValidated: targetIdentities.length') &&
  source.includes('routineAclNegative=10/10'),
  'all-routine ACL snapshot, exact six-target terminal state, or three-function difference proof is incomplete')
check(source.includes("for (const role of expected.revokeRoles)") &&
  source.includes("for (const role of expected.requiredGrantRoles)") &&
  source.includes('forbiddenRoutineAclChanges: 0'),
  'revoked/required role grants or forbidden ACL changes are not checked')
check(source.includes('function assertAclRepairFullTransition(') &&
  source.includes("!['migrationHistory', 'schemaSecurity'].includes(key)") &&
  source.includes("key !== 'publicRoutinesMd5'") &&
  source.includes('forbiddenContentDifferences: 0'),
  'full reconciliation does not permit only migration history and public routine ACL fingerprint')
check(source.includes('function privateRoutineDefinitionSnapshot(') &&
  source.includes('function assertPrivateRoutineDefinitionTransition(') &&
  source.includes('function assertPrivateRoutineDefinitionStable(') &&
  source.includes('private member-access routine definition did not change exactly once') &&
  source.includes('securityEnvelopeChanges: 0') && source.includes('forbiddenDefinitionChanges: 0'),
  'private routine exact-one definition transition or security-envelope proof is incomplete')

const mainIndex = index('async function main()')
const remoteGateStart = index('function validateRepairRemoteGate(')
const remoteGateEnd = index('function findRepairSignedCiRun(', remoteGateStart)
const remoteGateSource = source.slice(remoteGateStart, remoteGateEnd)
check(remoteGateStart >= 0 && remoteGateEnd > remoteGateStart &&
  remoteGateSource.includes("repair?.atomicLegacyRoleCompatibility?.status === 'passed'") &&
  remoteGateSource.includes('repair?.atomicLegacyRoleCompatibility?.staticPassed === true') &&
  remoteGateSource.includes('repair?.atomicLegacyRoleCompatibility?.databaseCiPassed === true') &&
  remoteGateSource.includes('repair?.atomicLegacyRoleCompatibility?.remoteQualificationAllowed === true') &&
  remoteGateSource.includes("ci?.evidenceScope === 'current-independent-session-pooler-ci'") &&
  remoteGateSource.includes('!isRetiredAclRepairEvidence(ci)') &&
  remoteGateSource.includes('ci?.databaseCiPassed === true') &&
  remoteGateSource.includes('ci?.remoteQualificationAllowed === true') &&
  remoteGateSource.includes('ci?.currentQualificationAllowed === true') &&
  remoteGateSource.includes('ci?.successEvidencePresent === true') &&
  remoteGateSource.includes('ci?.newIndependentCi === true'),
  'remote gate does not hard-require atomic, independent Session Pooler CI qualification conditions')
const mainEnd = index('main().catch(', mainIndex)
const mainSource = source.slice(mainIndex, mainEnd)
check(mainIndex >= 0 && mainEnd > mainIndex &&
  mainSource.includes("if (mode === '--self-test') return runSelfTest()") &&
  mainSource.includes('P1_REMOTE_EXECUTION_REFUSED: apply and resume are locked pending fresh signed CI') &&
  !mainSource.includes('validateRepairRemoteGate(') && !mainSource.includes('assertRepairSignedCiQualification(') &&
  !mainSource.includes('prepareTemporaryChannel(') && !mainSource.includes('executeAclRepair(') &&
  !mainSource.includes('runRepairPushOnce(') && !mainSource.includes('runRepairPushDryRun('),
  'prequalification main can reach a remote, credential, dry-run, or db-push path')
const executeStart = index('async function executeAclRepair(')
const executeApplyEnd = index('async function executeAclRepairReadOnlyResume()', executeStart)
const executeApplySource = source.slice(executeStart, executeApplyEnd)
const initialFullIndex = index('const beforeFull = runSealedFullReconciliation(channel.dbEnvironment)', executeStart)
const initialPrivateDefinitionIndex = index('const beforePrivateRoutineDefinition = privateRoutineDefinitionSnapshot(channel.dbEnvironment)', initialFullIndex)
const initialStorageIndex = index('const beforeStorageSummary = await collectTargetStorageSummary(baseline)', initialFullIndex)
const dryRunIndex = index('attempt.dryRun = runRepairPushDryRun(channel)', initialStorageIndex)
const dryRunAssertIndex = index('assertRepairPushDryRun(attempt.dryRun)', dryRunIndex)
const preflightIndex = index("writeFileSync(resolve(evidenceDirectory, 'preflight.json')", dryRunAssertIndex)
const pushIndex = index('runRepairPushOnce(channel, attempt)', preflightIndex)
const exact71Index = index('assertExact71RepairBaseline(before70, afterApply71)', pushIndex)
const aclIndex = index('assertRoutineAclRepairTransition(beforeRoutineAcl, afterRoutineAcl, observedAclDifference)', exact71Index)
const privateTransitionIndex = index('assertPrivateRoutineDefinitionTransition(', aclIndex)
const finalFullIndex = index('const afterFull = runSealedFullReconciliation(channel.dbEnvironment)', privateTransitionIndex)
const finalPrivateStableIndex = index('assertPrivateRoutineDefinitionStable(afterPrivateRoutineDefinition, finalPrivateRoutineDefinition)', finalFullIndex)
const sqlIndex = index('for (const test of databaseContract.tests)', aclIndex)
const finalCredentialIndex = index('const beforeFinalCredentialGeneration = channel.credentialGeneration', sqlIndex)
check(executeStart >= 0 && executeStart < initialFullIndex && initialFullIndex < initialPrivateDefinitionIndex &&
  initialPrivateDefinitionIndex < initialStorageIndex &&
  initialStorageIndex < dryRunIndex && dryRunIndex < dryRunAssertIndex &&
  dryRunAssertIndex < preflightIndex && preflightIndex < pushIndex &&
  pushIndex < exact71Index && exact71Index < aclIndex && aclIndex < privateTransitionIndex &&
  privateTransitionIndex < sqlIndex && sqlIndex < finalCredentialIndex && finalCredentialIndex < finalFullIndex &&
  finalFullIndex < finalPrivateStableIndex,
  'formal order is not exact70 full/private/Storage -> dry-run -> one push -> exact71 ACL/private -> 27 tests -> fresh final private stability')
check(executeApplySource.includes('attempt.fullReconciliationSnapshotsPassed = 1') &&
  occurrences(executeApplySource, 'attempt.fullReconciliationSnapshotsPassed += 1') === 2 &&
  executeApplySource.includes('attempt.fullReconciliationSnapshotsPassed !== contract.expected.tests + 2') &&
  executeApplySource.includes('fullSnapshots=29/29') && executeApplySource.includes('storageArchives=2/2'),
  '29 full reconciliations or two Storage archives are not hard-required')
check(executeApplySource.includes('attempt.privateRoutineDefinitionSnapshotsPassed = 1') &&
  occurrences(executeApplySource, 'attempt.privateRoutineDefinitionSnapshotsPassed += 1') === 2 &&
  executeApplySource.includes('attempt.privateRoutineDefinitionSnapshotsPassed !== 3') &&
  executeApplySource.includes('privateDefinition=1/1') && executeApplySource.includes('privateDefinitionSnapshots=3/3'),
  'private routine definition transition is not measured before/after/final as exact 3/3')
check(source.includes('for (const test of databaseContract.tests)') &&
  source.includes('const afterTest = snapshot(channel.dbEnvironment)') &&
  source.includes('assertRepairStable(before70, afterApply71, afterTest)') &&
  source.includes('const afterTestFull = runSealedFullReconciliation(channel.dbEnvironment)'),
  '27 per-test light/full residue checks are incomplete')
check(source.includes('requireFreshCredentialGeneration(channel, beforeFinalCredentialGeneration)') &&
  source.includes('afterStorageSummary.canonicalSha256 !== beforeStorageSummary.canonicalSha256'),
  'fresh final credential or Storage content equality is missing')
check(source.includes('retryPerformed: false') && source.includes('remoteCleanupPerformed: false') &&
  source.includes('targetPreserved: true'),
  'first-failure stop/preserve evidence is missing')

const full = contract.fullReconciliation
check(full.expected.migrationRows === 71 && full.execution.initialFullBeforeRepair === true &&
  full.execution.fullAfterEverySqlTest === true && full.execution.perTestFullSnapshots === 27 &&
  full.execution.finalFullAfterFreshCredential === true && full.execution.beforeAfterAllowedAclTransitionOnly === true &&
  full.execution.storageArchiveAtInitialAndFinal === true && full.execution.temporaryTestSessionsOnly === true &&
  full.execution.persistentDatabaseWrites === 'exactly-one-signed-acl-and-atomic-compatibility-migration' &&
  full.execution.sessionClosedDropsTemp === true,
  'full reconciliation 71/29/Storage/single-write execution contract drift')
check(full.expectedSchemaAndHistoryDifference === 'exact-signed-P1-plus-ACL-repair-migrations-only' &&
  full.unknownDifferencesAllowed === false && Object.keys(full.signedArtifacts).length === 6,
  'signed source/schema difference or six-artifact boundary drift')

check(migrationManifest.entries.length === 71 && migrationManifest.entries.at(-1)?.version === REPAIR_VERSION &&
  migrationManifest.entries.at(-1)?.sha256 === REPAIR_SHA,
  'migration manifest is not exact signed 71')
check(databaseContract.tests.length === 27 && databaseContract.expectedCounts.total === 27 &&
  databaseContract.tests.every((entry) => sha256Lf(resolve(repoRoot, entry.path)) === entry.sha256Lf),
  '27 database test inventory/hash drift')
check(databaseContract.tests.find((entry) => entry.path === repair.testPaths.teamOs4P1)?.sha256Lf === repair.testSha256Lf.teamOs4P1 &&
  databaseContract.tests.find((entry) => entry.path === repair.testPaths.notificationCore)?.sha256Lf === repair.testSha256Lf.notificationCore,
  'repair test hashes are not synchronized to CI contract')
check(occurrences(repairMigration.toLowerCase(), 'revoke all on function') === 1 &&
  occurrences(repairMigration.toLowerCase(), 'grant execute on function') === 1 &&
  /notify\s+pgrst\s*,\s*'reload schema'\s*;/i.test(repairMigration),
  'repair migration is not the one revoke/one grant/one notify repair')
check(occurrences(repairMigration.toLowerCase(), 'create or replace function private.admin_apply_member_access_v1(') === 1 &&
  !repairMigration.toLowerCase().includes('create trigger') &&
  expectedAtomicMapping.every(({ legacyRole }) => repairMigration.includes(`'${legacyRole}'`)) &&
  repairMigration.includes('update public.profiles p') && repairMigration.includes("'legacyRole', legacy_role") &&
  repairMigration.includes("'legacyRole', target.role"),
  'migration 71 private function replacement or five-role atomic mapping drift')
check(repairSqlTest.includes('P1 role save did not atomically synchronize the legacy role mapping') &&
  repairSqlTest.includes('P1 failed role save left a partial legacy or 4.0 permission write') &&
  repairSqlTest.includes('P1_ATOMICITY_SENTINEL') &&
  source.includes('atomicMapping=5/5') && source.includes('atomicRollback=2/2') &&
  source.includes('sameTeamStatic=4/4'),
  'atomic mapping/rollback/same-team evidence totals are not hard-locked')
check(source.includes('const atomicDatabaseUnqualifiedRepair = {') &&
  source.includes('const atomicRemoteLockedRepair = {') &&
  source.includes('databaseCiPassed: false') && source.includes('remoteQualificationAllowed: false') &&
  source.includes('repairGateNegative=7/7') && source.includes('atomicGateNegative=2/2'),
  'atomic-only remote gate negative controls are missing or miscounted')

const resumeExecuteStart = index('async function executeAclRepairReadOnlyResume()')
const resumeExecuteEnd = index('async function main()', resumeExecuteStart)
const resumeExecuteSource = source.slice(resumeExecuteStart, resumeExecuteEnd)
check(resumeExecuteStart >= 0 && resumeExecuteEnd > resumeExecuteStart &&
  resumeExecuteSource.includes("validateAppliedReadOnlyResumeGate('--resume-acl-repair-verification'") &&
  resumeExecuteSource.includes('loadAppliedAclAssertionFailureEvidence()') &&
  resumeExecuteSource.includes('prepareTemporaryChannel()') &&
  resumeExecuteSource.includes('assertExact71ReadOnlyBaseline(sourceEvidence, initial)') &&
  resumeExecuteSource.includes('assertRoutineAclFinalState(initialRoutineAcl)') &&
  resumeExecuteSource.includes('assertPrivateRoutineMatchesSignedMigration(') &&
  resumeExecuteSource.includes('for (const test of databaseContract.tests)') &&
  resumeExecuteSource.includes('attempt.fullReconciliationSnapshotsPassed !== 29') &&
  resumeExecuteSource.includes('attempt.storageArchivesPassed !== 2') &&
  resumeExecuteSource.includes('catalogAssertionsPassed: 4') &&
  resumeExecuteSource.includes('dbPushAttempted: false') &&
  resumeExecuteSource.includes('persistentRemoteWrites: 0') &&
  !resumeExecuteSource.includes('runRepairPushOnce(') &&
  !resumeExecuteSource.includes('runRepairPushDryRun(') &&
  !resumeExecuteSource.includes('buildSessionPoolerPushInvocation('),
  'prequalified read-only resume does not prove exact71/27/29/2/ACL/private/catalog or contains a push path')
const resumePreflightIndex = resumeExecuteSource.indexOf("writeFileSync(resolve(evidenceDirectory, 'preflight.json')")
const resumeFormalStartIndex = resumeExecuteSource.indexOf('attempt.formalAttemptStarted = true')
const resumeTestIndex = resumeExecuteSource.indexOf('const result = runTestFile(channel.dbEnvironment, test)')
const resumeResidueIndex = resumeExecuteSource.indexOf('const afterTest = snapshot(channel.dbEnvironment)', resumeTestIndex)
const resumeRequireSuccessIndex = resumeExecuteSource.indexOf('requireSuccess(`SQL test ${test.path}`, result)', resumeResidueIndex)
check(resumePreflightIndex >= 0 && resumePreflightIndex < resumeFormalStartIndex &&
  resumeFormalStartIndex < resumeTestIndex && resumeTestIndex < resumeResidueIndex &&
  resumeResidueIndex < resumeRequireSuccessIndex &&
  resumeExecuteSource.includes("status: 'ready-to-verify-applied-migration-read-only'") &&
  resumeExecuteSource.includes("if (!p1MarkerSeen) throw new Error('P1 six-identity runtime marker is missing')") &&
  resumeExecuteSource.includes("if (!accessControlMarkerSeen) throw new Error('legacy-member explicit-role marker is missing')") &&
  resumeExecuteSource.includes("if (!notificationMarkerSeen) throw new Error('notification ACL repair runtime marker is missing')") &&
  resumeExecuteSource.includes('if (channel) {') && resumeExecuteSource.includes('clearDbEnvironment(channel.dbEnvironment)'),
  'read-only resume preflight, failed-test residue snapshot, marker stop, or cleanup order drift')
const runTestFileStart = index('function runTestFile(')
const runTestFileEnd = index('function runSealedFullReconciliation(', runTestFileStart)
const runTestFileSource = source.slice(runTestFileStart, runTestFileEnd)
check(runTestFileStart >= 0 && runTestFileEnd > runTestFileStart &&
  runTestFileSource.includes('return run(resolve(restoreRun.toolchain.psql.path), args, {') &&
  !runTestFileSource.includes('runPgTool({') &&
  resumeTestIndex < resumeResidueIndex && resumeResidueIndex < resumeRequireSuccessIndex,
  'SQL test runner still throws before a failed-test residue snapshot can be captured')
check(!source.includes('retryReadOnlySessionPooler: true') &&
  source.includes('retryReadOnlySessionPooler: false'),
  'formal read-only validation can silently retry while evidence claims first-failure stop')
check(source.includes("if (!['read_only', 'rollback_fixture'].includes(test.executionMode))") &&
  source.includes('unsupported SQL test execution mode'),
  'unknown SQL test execution mode is not fail-closed')
check(resume?.signedPost71PrivateRoutineDefinition === null &&
  source.includes('function validateSignedPost71PrivateRoutineDefinition(') &&
  source.includes('signedPost71DefinitionPositive=1') && source.includes('signedPost71DefinitionNegative=3/3') &&
  !mainSource.includes('executeAclRepairReadOnlyResume('),
  'unsigned post-71 private definition does not keep resume unreachable')

const selfStart = index('function runSelfTest()')
const selfEnd = index('function verifyTemporaryLink(', selfStart)
const selfSource = source.slice(selfStart, selfEnd)
check(selfStart >= 0 && selfEnd > selfStart && !selfSource.includes('loadRepairFailureEvidence(') &&
  !selfSource.includes('runSealedFullReconciliation(') && !selfSource.includes('collectTargetStorageSummary(') &&
  selfSource.includes('dryRunPositive=2/2') && selfSource.includes('dryRunNegative=4/4') &&
  selfSource.includes('dryRunFailureEvidencePreserved=1') && selfSource.includes('dryRunRawOutputAbsent=1') &&
  selfSource.includes('databaseCalls=0') && selfSource.includes('storageCalls=0') &&
  selfSource.includes('dEvidenceRequired=0'),
  'self-test can touch D evidence, database, or Storage')
check(source.includes('function clearDbEnvironment(') &&
  !mainSource.includes('channel.dbEnvironment') && !mainSource.includes('channel.workdir'),
  'prequalification main unexpectedly owns a temporary credential or workdir')
const forbiddenDEvidenceMarker = ['D:/CanWin-Team-OS-4.0-P1-', 'Validation/p1-resume'].join('')
const forbiddenP0ImportMarker = ["from '", '../p0/'].join('')
check(!validatorSource.includes(forbiddenP0ImportMarker) && !validatorSource.includes(forbiddenDEvidenceMarker),
  'validator must not import remote helpers or read D evidence')
check(normalizeLf(source.replaceAll('\n', '\r\n')) === source,
  'runner semantic source normalization fails for CRLF')

check(sha256Lf(resolve(repoRoot, contract.scriptHardLocks.runnerPath)) === contract.scriptHardLocks.runnerSha256Lf,
  'runner LF hash drift')
const validatorSha = sha256Lf(resolve(repoRoot, contract.scriptHardLocks.validatorPath))
check(validatorSha === contract.scriptHardLocks.validatorSha256Lf,
  `validator LF hash drift actual=${validatorSha}`)

if (failures.length > 0) {
  console.error('P1_ISOLATED_RUNTIME_RUNNER_DRIFT')
  for (const failure of failures) console.error('- ' + failure)
  process.exit(1)
}
console.log(`P1_ISOLATED_RUNTIME_RUNNER_OK assertions=${assertionCount} exact70to71=1 signedMigrationInventory=71/71 historicalApplyDbPushMax=1 currentDbPushMax=0 dryRunEvidenceSafe=1 sessionPoolerPushHistorical=2/2 sessionPoolerNegative=7/7 pushSecretEnvOnly=1 pushSecretsCleared=2/2 failedPushUnknownState=1 aclTargets=6/6 expectedAclChanges=3/3 aclExactTerminal=6/6 privateDefinitionChange=1/1 privateDefinitionSnapshots=3/3 signedPost71Pending=1 resumeImplementationPrequalified=1 resumePreflight=1 failedTestResidueSnapshot=1 atomicMapping=5/5 atomicRollback=2/2 sameTeamStatic=4/4 atomicGateNegative=2/2 repairGateNegative=7/7 closedRepairGateNegative=3/3 priorRepairCiRevivalDenied=2/2 relabeledRevivalDenied=5/5 independentCiHistoryPositive=1 independentCiHistoryNegative=5/5 relabeledHistoryRevivalDenied=2/2 atomicDatabaseCiHistorical=true priorRepairCiFailurePreserved=1 priorSuccessfulRepairCiHistorical=1 priorParserFixCiHistorical=1 priorFormalAclRepairFailurePreserved=1 currentFormalAclRepairFailurePreserved=1 appliedAclFailurePreserved=1 appliedRepairWrites=1 currentResumeWrites=0 historicalApplyCi=29750768517 fullDifferencePaths=2/2 sqlTests=27 perTestSnapshots=27 fullSnapshots=29 storageArchives=2 signedFailureCounts=5/5/6/1 oldResumeDenied=1 applicationCompatibilityPassed=1 legacyRpcCalls=0 detectorNegative=2/2 appShell=99/99 staticGate16=runner+appShell+accessV1 warehouseBackendRelaxed=0 applyRemote=0 resumeRemote=0 productionDenied=1 validatorDatabaseCalls=0 validatorStorageCalls=0 validatorDEvidenceRequired=0`)
