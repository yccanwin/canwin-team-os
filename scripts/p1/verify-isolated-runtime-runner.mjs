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
const expectedFunctions = [
  ['public.enqueue_wecom_notification_jobs(text, timestamp with time zone)', ['service_role']],
  ['public.claim_wecom_notification_jobs(integer, timestamp with time zone)', ['service_role']],
  ['public.complete_wecom_notification_job(uuid, boolean, text, text, timestamp with time zone)', ['service_role']],
  ['public.manage_profile_access(uuid, text[], uuid[])', []],
  ['public.admin_replace_profile_roles(uuid, text[], uuid)', []],
  ['public.admin_replace_supervisor_subordinates(uuid, uuid[], uuid)', []],
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
check(source.includes("const allowedModes = new Set(['--self-test', '--apply-acl-repair'])"),
  'runner modes are not limited to self-test and ACL repair')
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
check(contract.contractStatus === 'p1_acl_repair_parser_fix_remote_qualified_after_preserved_formal_dry_run_failure' &&
  repair.mode === '--apply-acl-repair' && repair.remoteExecutionAllowed === true &&
  repair.dbPushAllowed === true && repair.migrationVersion === REPAIR_VERSION,
  'qualified ACL repair remote boundary drift')
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
check(repair.maxFormalAttempts === 1 && repair.maxDbPushAttempts === 1 &&
  repair.dryRunRequired === true && JSON.stringify(repair.pendingMigrationVersions) === JSON.stringify([REPAIR_VERSION]),
  'single-attempt/dry-run/exact-pending migration boundary drift')
check(JSON.stringify(repair.targetFunctions) === JSON.stringify(expectedFunctions) &&
  JSON.stringify(repair.expectedChangedFunctions) ===
    JSON.stringify(expectedFunctions.slice(0, 4).map((entry) => entry.identity)),
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
  atomicCompatibility?.remoteQualificationAllowed === true &&
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
  repair.applicationCompatibility?.remoteQualificationAllowed === true &&
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
check(repairCi.runId === '29738966326' &&
  repairCi.runUrl === 'https://github.com/yccanwin/canwin-team-os/actions/runs/29738966326' &&
  repairCi.headSha === '070c2e4ca185037d37f65b4d98be617a43e4409d' &&
  repairCi.linuxJobId === '88340968144' && repairCi.windowsJobId === '88340968119' &&
  repairCi.status === 'success' && repairCi.conclusion === 'success' &&
  repairCi.linuxStatus === 'success' && repairCi.windowsStatus === 'success' &&
  repairCi.qualificationScope === 'acl_repair_parser_fix_prequalification' &&
  repairCi.migrationsPassed === 71 && repairCi.sqlTestsStarted === 27 && repairCi.sqlTestsPassed === 27 &&
  repairCi.databaseTestsPassed === 7 && repairCi.permissionTestsPassed === 11 &&
  repairCi.businessTestsPassed === 9 && repairCi.catalogAssertionsPassed === 4 &&
  repairCi.windowsStaticExpected === 19 && repairCi.windowsStaticPassed === 19 &&
  repairCi.windowsLocalExpected === 12 && repairCi.windowsLocalPassed === 12 &&
  repairCi.linuxDatabaseAccepted === true && repairCi.cleanupPassed === true &&
  repairCi.productionReadPerformed === false && repairCi.productionWritePerformed === false &&
  repairCi.retryPerformed === false && repairCi.candidateRemoteExecutionAllowed === false &&
  repairCi.g1OverallClaim === false && repairCi.databaseCiPassed === true &&
  repairCi.priorSuccessfulRunPreservedWithoutRerun === '29733854344' &&
  repairCi.formalAclRepairFailurePreservedWithoutRerun === 'p1-acl-repair-20260720T104323349Z-4fa8de78a8' &&
  repairCi.remoteQualificationAllowed === true && repairCi.currentQualificationAllowed === true &&
  repairCi.successEvidencePresent === true,
  'current repair CI qualification evidence drift')
check(formalAclRepairFailure.runId === 'p1-acl-repair-20260720T104323349Z-4fa8de78a8' &&
  formalAclRepairFailure.failureSha256 === '16373794dd745ad86422bb59f3966933532cb0bf073251963b519c2b8e367e73' &&
  formalAclRepairFailure.supervisionHeadSha === '4fa8de78a8b05f8285f69fb0d6d9106e20e3cba7' &&
  formalAclRepairFailure.status === 'failed-stop-preserved' &&
  formalAclRepairFailure.currentStep === 'db-push-dry-run' &&
  formalAclRepairFailure.migrationVersion === REPAIR_VERSION &&
  formalAclRepairFailure.migrationAlreadyApplied === false &&
  formalAclRepairFailure.formalAttemptStarted === false && formalAclRepairFailure.dbPushAttempted === false &&
  formalAclRepairFailure.dbPushPerformed === false && formalAclRepairFailure.dbPushAttempts === 0 &&
  formalAclRepairFailure.attempts === 0 && formalAclRepairFailure.confirmedPersistentWrites === 0 &&
  formalAclRepairFailure.persistentRemoteWrites === 0 &&
  formalAclRepairFailure.persistentRemoteWriteUpperBound === 0 &&
  formalAclRepairFailure.productionReads === 0 && formalAclRepairFailure.productionWrites === 0 &&
  formalAclRepairFailure.targetPreserved === true && formalAclRepairFailure.retryPerformed === false &&
  formalAclRepairFailure.remoteCleanupPerformed === false && formalAclRepairFailure.successEvidencePresent === false,
  'formal ACL dry-run failure evidence drift')
check(source.includes('const repairFormalFailureClosed =') &&
  source.includes("contract.contractStatus === 'p1_acl_repair_formal_dry_run_failed_qualification_closed'") &&
  source.includes("contract.contractStatus === 'p1_acl_repair_parser_fix_remote_qualified_after_preserved_formal_dry_run_failure'") &&
  source.includes('const qualificationStateCount = [repairCiQualified, repairCiPending, repairFormalFailureClosed]') &&
  source.includes('qualificationStateCount !== 1') &&
  source.includes("ci?.evidenceScope !== 'historical-prior-success-only'") &&
  source.includes('ci?.currentQualificationAllowed !== false') &&
  source.includes("ci?.runId === '29738966326'") &&
  source.includes("ci?.headSha === '070c2e4ca185037d37f65b4d98be617a43e4409d'") &&
  source.includes("ci?.linuxJobId === '88340968144'") && source.includes("ci?.windowsJobId === '88340968119'") &&
  source.includes('currentQualifiedRepairGatePositive=1') &&
  source.includes('formalFailureClosedGateNegative=2/2') &&
  source.includes('priorSuccessfulRepairCiRevivalDenied=1'),
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
check(source.includes("'db', 'push', '--linked', '--dry-run', '--workdir', channel.workdir, '--yes'") &&
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
check(source.includes('"(?:stdout|stderr)"\\s*:') &&
  source.includes("safeEvidence({ stdout: 'raw output must not survive' })") &&
  source.includes("safeEvidence({ stderr: 'raw error output must not survive' })") &&
  source.includes('dryRunFailureEvidencePreserved=1') && source.includes('dryRunRawOutputAbsent=1') &&
  source.includes('evidenceNegative=7/7'),
  'dry-run raw-output/secret evidence negative controls are missing')
check(source.includes("'db', 'push', '--linked', '--workdir', channel.workdir, '--yes'") &&
  occurrences(source, "'db', 'push'") === 2 && !source.includes("'--include-all'") &&
  !source.includes("'--include-seed'") && !source.includes("'--include-roles'"),
  'formal push is not exactly one minimal signed path')
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
  source.includes('ACL repair routine difference set is not the exact signed four-function change inventory') &&
  source.includes('targetFunctionsValidated: targetIdentities.length'),
  'all-routine ACL snapshot, six target postconditions, or four-function difference proof is incomplete')
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
  remoteGateSource.includes('repair?.atomicLegacyRoleCompatibility?.remoteQualificationAllowed === true'),
  'remote gate does not hard-require all four atomic compatibility qualification conditions')
const gateIndex = index('validateRepairRemoteGate(mode, contract.aclRepair, contract.repairCiRunEvidence)', mainIndex)
const ciIndex = index('assertRepairSignedCiQualification()', gateIndex)
const baselineIndex = index('loadSignedReconciliationBaseline()', ciIndex)
const failureIndex = index('loadRepairFailureEvidence()', baselineIndex)
const verifierIndex = index('runLocalVerifiers()', failureIndex)
const channelIndex = index('prepareTemporaryChannel()', verifierIndex)
const exact70Index = index('assertExact70RepairBaseline(sourceEvidence, before70)', channelIndex)
const executeIndex = index('executeAclRepair(channel, sourceEvidence, before70, baseline, proof70)', exact70Index)
check(mainIndex >= 0 && mainIndex < gateIndex && gateIndex < ciIndex && ciIndex < baselineIndex &&
  baselineIndex < failureIndex && failureIndex < verifierIndex && verifierIndex < channelIndex &&
  channelIndex < exact70Index && exact70Index < executeIndex,
  'formal main order is not gate -> CI -> signed evidence -> local gates -> temp exact70 -> repair')
const executeStart = index('async function executeAclRepair(')
const initialFullIndex = index('const beforeFull = runSealedFullReconciliation(channel.dbEnvironment)', executeStart)
const initialPrivateDefinitionIndex = index('const beforePrivateRoutineDefinition = privateRoutineDefinitionSnapshot(channel.dbEnvironment)', initialFullIndex)
const initialStorageIndex = index('const beforeStorageSummary = await collectTargetStorageSummary(baseline)', initialFullIndex)
const dryRunIndex = index('attempt.dryRun = runRepairPushDryRun(channel)', initialStorageIndex)
const dryRunAssertIndex = index('assertRepairPushDryRun(attempt.dryRun)', dryRunIndex)
const preflightIndex = index("writeFileSync(resolve(evidenceDirectory, 'preflight.json')", dryRunAssertIndex)
const pushIndex = index('runRepairPushOnce(channel, attempt)', preflightIndex)
const exact71Index = index('assertExact71RepairBaseline(before70, afterApply71)', pushIndex)
const aclIndex = index('assertRoutineAclRepairTransition(beforeRoutineAcl, afterRoutineAcl)', exact71Index)
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
check(source.includes('attempt.fullReconciliationSnapshotsPassed = 1') &&
  occurrences(source, 'attempt.fullReconciliationSnapshotsPassed += 1') === 2 &&
  source.includes('attempt.fullReconciliationSnapshotsPassed !== contract.expected.tests + 2') &&
  source.includes('fullSnapshots=29/29') && source.includes('storageArchives=2/2'),
  '29 full reconciliations or two Storage archives are not hard-required')
check(source.includes('attempt.privateRoutineDefinitionSnapshotsPassed = 1') &&
  occurrences(source, 'attempt.privateRoutineDefinitionSnapshotsPassed += 1') === 2 &&
  source.includes('attempt.privateRoutineDefinitionSnapshotsPassed !== 3') &&
  source.includes('privateDefinition=1/1') && source.includes('privateDefinitionSnapshots=3/3'),
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
  source.includes('repairGateNegative=5/5') && source.includes('atomicGateNegative=2/2'),
  'atomic-only remote gate negative controls are missing or miscounted')

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
check(source.includes("clearDbEnvironment(channel.dbEnvironment)") && source.includes('channel.dbEnvironment = null') &&
  source.includes('rmSync(channel.workdir, { recursive: true, force: true })'),
  'temporary credential/workdir cleanup is incomplete')
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
console.log(`P1_ISOLATED_RUNTIME_RUNNER_OK assertions=${assertionCount} exact70to71=1 signedMigrationInventory=71/71 dryRunOnly71=1 dryRunEvidenceSafe=1 dbPushMax=1 failedPushUnknownState=1 aclTargets=6/6 expectedAclChanges=4/4 privateDefinitionChange=1/1 privateDefinitionSnapshots=3/3 atomicMapping=5/5 atomicRollback=2/2 sameTeamStatic=4/4 atomicGateNegative=2/2 repairGateNegative=5/5 formalFailureClosedGateNegative=2/2 priorSuccessfulRepairCiRevivalDenied=1 atomicDatabaseCiPassed=1 priorRepairCiFailurePreserved=1 priorSuccessfulRepairCiHistorical=1 formalAclRepairFailurePreserved=1 formalAclRepairAttempts=0 formalAclRepairDbPushAttempts=0 formalAclRepairWrites=0 currentCi=29738966326 fullDifferencePaths=2/2 sqlTests=27 perTestSnapshots=27 fullSnapshots=29 storageArchives=2 signedFailureCounts=5/5/6/1 oldResumeDenied=1 applicationCompatibilityPassed=1 legacyRpcCalls=0 detectorNegative=2/2 appShell=99/99 staticGate16=runner+appShell+accessV1 warehouseBackendRelaxed=0 repairRemote=1 productionDenied=1 validatorDatabaseCalls=0 validatorStorageCalls=0 validatorDEvidenceRequired=0`)
