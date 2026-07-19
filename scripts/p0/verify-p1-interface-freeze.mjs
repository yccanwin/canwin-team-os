import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const normalizeLf = (value) => value.replace(/\r\n?/g, '\n')
const sha256Utf8Lf = (value) => createHash('sha256').update(normalizeLf(value), 'utf8').digest('hex')
const readJson = (path) => JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'))
const contract = readJson('scripts/p0/p1-interface-freeze.json')
const navigation = readJson('docs/team-os-4.0/p0/p1-app-navigation-contract.json')
const roleMigration = readJson('scripts/p0/role-migration-contract.json')
const physical = readJson('scripts/p0/core-physical-object-contract.json')
const rollbackEvidencePath = 'docs/team-os-4.0/p0/p1-isolated-rollback-readonly-evidence.json'
const rollbackEvidenceText = readFileSync(resolve(repoRoot, rollbackEvidencePath), 'utf8')
const rollbackEvidenceLf = normalizeLf(rollbackEvidenceText)
const rollbackEvidence = JSON.parse(rollbackEvidenceLf)
const rollbackEvidenceSha256 = sha256Utf8Lf(rollbackEvidenceText)
let rollbackEvidenceMixedEolIndex = 0
const rollbackEvidenceEolFixtures = {
  lf: rollbackEvidenceLf,
  crlf: rollbackEvidenceLf.replace(/\n/g, '\r\n'),
  cr: rollbackEvidenceLf.replace(/\n/g, '\r'),
  mixed: rollbackEvidenceLf.replace(/\n/g, () => ['\n', '\r\n', '\r'][rollbackEvidenceMixedEolIndex++ % 3]),
}
const rollbackEvidenceEolHashes = Object.fromEntries(
  Object.entries(rollbackEvidenceEolFixtures).map(([format, value]) => [format, sha256Utf8Lf(value)]),
)
const clone = (value) => structuredClone(value)
const exactSet = (actual, expected) =>
  Array.isArray(actual) && actual.length === new Set(actual).size &&
  JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())

const primaryRoles = ['sales', 'implementation', 'operations', 'finance', 'admin']
const additionalFunctions = ['warehouse', 'supervisor']
const expectedRpcNames = [
  'get_app_context_v1', 'get_navigation_manifest_v1', 'resolve_responsible_profile_v1',
  'admin_apply_member_access_v1', 'admin_set_supervisor_system_v1',
  'admin_replace_supervisor_scope_v1',
]
const expectedWhitelistIds = [
  'app_context', 'navigation_manifest_item', 'responsibility_resolution', 'role_mutation_result',
]
const expectedBaseIdentityIds = Array.from({ length: 6 }, (_, index) => `P1-IDN-${String(index).padStart(3, '0')}`)
const expectedOverlayIds = Array.from({ length: 16 }, (_, index) => `P1-OVL-${String(index + 1).padStart(3, '0')}`)
const expectedApiIds = Array.from({ length: 12 }, (_, index) => `P1-API-${String(index + 1).padStart(3, '0')}`)
const expectedWorkOrderIds = [
  'P1-B1', 'P1-B2', 'P1-B3', 'P1-B4',
  'P1-F1', 'P1-F2', 'P1-F3', 'P1-F4',
  'P1-Q1', 'P1-Q2', 'P1-Q3', 'P1-Q4', 'P1-Q5',
]
const expectedLegacyCodes = [
  'owner', 'admin', 'sales', 'implementation', 'operations', 'finance', 'warehouse',
  'supervisor', 'captain', 'member',
]
const expectedSupervisorWhitelist = [
  'scopeId', 'periodStart', 'periodEnd', 'activeMemberCount', 'openWorkItemCount',
  'overdueWorkItemCount', 'leadCount', 'opportunityCount', 'quoteCount', 'orderCount',
  'fulfillmentBlockedCount', 'renewalDueCount', 'paymentReadinessCounts', 'lastUpdatedAt',
]
const expectedSupervisorForbidden = [
  'phone', 'wechatId', 'email', 'customerPaymentAmount', 'companyActualCost', 'companyProfit',
  'salesProfit', 'laborEarning', 'otherMemberIncome',
]

function validate(candidate) {
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const counts = candidate.expectedCounts ?? {}
  const rpcs = candidate.rpcInterfaces ?? []
  const whitelists = candidate.fieldWhitelists ?? {}
  const identities = candidate.baseTestIdentities ?? []
  const overlays = candidate.overlayTestCases ?? []
  const attacks = candidate.directApiAttackCases ?? []
  const workOrders = candidate.workOrders ?? []

  check(candidate.schemaVersion === 1, 'schema version must be 1')
  check(candidate.manifestType === 'canwin-team-os-p1-interface-freeze', 'manifest type drift')
  check(candidate.contractStatus === 'p1_rollback_evidence_eol_repair_implemented_ci_pending', 'contract status drift')
  check(physical.contractStatus === 'p0_supervisor_frozen_runtime_not_implemented', 'physical object contract is not frozen')
  check(navigation.contractStatus === 'p1_ci_passed_page_account_acceptance_pending', 'navigation candidate status drift')
  check(roleMigration.manualPrimaryRoleDecisions?.status === 'owner-confirmed-isolated-applied-production-unchanged', 'manual role decisions are not frozen and isolated-applied')

  check(counts.rpcInterfaces === expectedRpcNames.length && rpcs.length === counts.rpcInterfaces, 'RPC count drift')
  check(counts.fieldWhitelists === expectedWhitelistIds.length && Object.keys(whitelists).length === counts.fieldWhitelists, 'field whitelist count drift')
  check(counts.baseTestIdentities === expectedBaseIdentityIds.length && identities.length === counts.baseTestIdentities, 'base identity count drift')
  check(counts.overlayTestCases === expectedOverlayIds.length && overlays.length === counts.overlayTestCases, 'overlay case count drift')
  check(counts.directApiAttackCases === expectedApiIds.length && attacks.length === counts.directApiAttackCases, 'API attack count drift')
  check(counts.workOrders === expectedWorkOrderIds.length && workOrders.length === counts.workOrders, 'work-order count drift')
  check(exactSet(rpcs.map((entry) => entry.name), expectedRpcNames), 'RPC names drift')
  check(exactSet(Object.keys(whitelists), expectedWhitelistIds), 'field whitelist IDs drift')
  check(exactSet(identities.map((entry) => entry.id), expectedBaseIdentityIds), 'base identity IDs drift')
  check(exactSet(overlays.map((entry) => entry.id), expectedOverlayIds), 'overlay test IDs drift')
  check(exactSet(attacks.map((entry) => entry.id), expectedApiIds), 'API test IDs drift')
  check(exactSet(workOrders.map((entry) => entry.id), expectedWorkOrderIds), 'work-order IDs drift')
  check(exactSet(Object.keys(candidate.legacyRoleCompatibility ?? {}), expectedLegacyCodes), 'legacy role compatibility set drift')

  const navigationAppContextFields = navigation.appContext.fields.map((field) => field.name)
  check(exactSet(whitelists.app_context, navigationAppContextFields), 'AppContext whitelist differs from navigation contract')
  check(exactSet(whitelists.app_context, [
    'company', 'user', 'primaryRole', 'additionalFunctions', 'skills', 'regionScopeIds',
    'warehouseScopeIds', 'supervisorScope', 'supervisorEnabled', 'permissions',
    'availableWorkViews', 'currentWorkView', 'navigationRevision',
  ]), 'AppContext whitelist drift')
  check(exactSet(whitelists.navigation_manifest_item, [
    'routeId', 'label', 'order', 'group', 'canonicalPath', 'visible', 'enabled', 'readOnly',
  ]), 'navigation item whitelist drift')
  check(exactSet(whitelists.responsibility_resolution, ['profileId', 'reason', 'fallbackApplied']), 'responsibility whitelist drift')
  check(exactSet(whitelists.role_mutation_result, ['subjectId', 'revision', 'auditId']), 'role mutation whitelist drift')
  for (const [name, fields] of Object.entries(whitelists)) {
    check(fields.length === new Set(fields).size, `${name} contains duplicate fields`)
    check(fields.every((field) => /^[a-z][A-Za-z0-9]*$/.test(field)), `${name} has invalid field names`)
  }

  check(exactSet(candidate.supervisorSummaryWhitelist, expectedSupervisorWhitelist), 'supervisor summary whitelist drift')
  check(exactSet(candidate.supervisorSummaryForbiddenFields, expectedSupervisorForbidden), 'supervisor forbidden fields drift')
  check(candidate.supervisorSummaryWhitelist.every((field) => !candidate.supervisorSummaryForbiddenFields.includes(field)), 'supervisor whitelist exposes forbidden fields')

  const legacy = candidate.legacyRoleCompatibility ?? {}
  check(legacy.owner?.target === 'admin' && legacy.owner?.decision === 'read_compatible_no_new_assignment', 'owner alias drift')
  check(legacy.captain?.target === 'supervisor' && legacy.captain?.decision === 'read_compatible_manual_primary_required', 'captain compatibility drift')
  check(legacy.member?.target === null && legacy.member?.decision === 'manual_primary_required', 'member compatibility drift')
  for (const role of primaryRoles) check(legacy[role]?.target === role && legacy[role]?.kind === 'primary', `${role} primary mapping drift`)
  for (const role of additionalFunctions) check(legacy[role]?.target === role && legacy[role]?.kind === 'additional_function', `${role} overlay mapping drift`)
  for (const role of Object.keys(roleMigration.existingAccessRoleMapping)) {
    check(Object.hasOwn(legacy, role), `role migration mapping ${role} is missing from interface compatibility`)
  }
  for (const role of Object.keys(roleMigration.legacyProfileRoleMapping)) {
    check(Object.hasOwn(legacy, role), `legacy profile role ${role} is missing from interface compatibility`)
  }

  const rules = candidate.authorizationRules ?? {}
  check(rules.serverAuthority === true, 'server authority must remain true')
  check(rules.frontendMayDeriveSecondAuthorizationModel === false, 'frontend must not derive authorization')
  check(rules.jwtUserMetadataMayAuthorize === false, 'JWT user metadata must not authorize')
  check(rules.legacyProfilesRoleMayAuthorizeNewWrites === false, 'legacy profile role must not authorize new writes')
  check(rules.inactiveMemberDenied === true, 'inactive member denial missing')
  check(rules.supervisorDefaultEnabled === false, 'supervisor default must remain off')
  check(rules.supervisorFallbackPrimaryRole === 'admin', 'supervisor fallback must be admin')
  check(rules.switchChangeRewritesHistoricalResponsibility === false, 'switch must not rewrite history')
  check(rules.roleChangeRequiresAudit === true, 'role changes require audit')

  for (const rpc of rpcs) {
    check(/^[a-z][a-z0-9_]*_v1$/.test(rpc.name), `invalid versioned RPC name ${rpc.name}`)
    check(Array.isArray(rpc.arguments), `${rpc.name} arguments are not explicit`)
    check(Object.hasOwn(whitelists, rpc.returnsWhitelist), `${rpc.name} references unknown whitelist`)
    check(['stable_read', 'idempotent_write'].includes(rpc.transaction), `${rpc.name} transaction type drift`)
    if (rpc.transaction === 'idempotent_write') check(rpc.arguments.includes('p_idempotency_key'), `${rpc.name} lacks idempotency key`)
    check(Boolean(rpc.authorization?.trim()), `${rpc.name} lacks authorization rule`)
  }

  const expectedIdentityRoles = [null, ...primaryRoles]
  check(JSON.stringify(identities.map((entry) => entry.primaryRole)) === JSON.stringify(expectedIdentityRoles), 'base identity role order drift')
  for (const identity of identities) {
    check(identity.syntheticOnly === true, `${identity.id} must be synthetic`)
    check(identity.runtimeUserId === null, `${identity.id} must not store a runtime user ID`)
  }
  const identityIds = new Set(identities.map((entry) => entry.id))
  for (const overlay of overlays) {
    check(identityIds.has(overlay.baseIdentity), `${overlay.id} references unknown base identity`)
    check(overlay.additionalFunctions.every((role) => additionalFunctions.includes(role)), `${overlay.id} has unknown overlay`)
    check(typeof overlay.supervisorEnabled === 'boolean', `${overlay.id} lacks supervisor switch state`)
    check(Boolean(overlay.purpose?.trim()), `${overlay.id} lacks purpose`)
  }
  const attackActors = new Set([...identityIds, ...overlays.map((entry) => entry.id), 'synthetic_disabled_member'])
  for (const attack of attacks) {
    check(attackActors.has(attack.actor), `${attack.id} references unknown actor ${attack.actor}`)
    check(Boolean(attack.assertion?.trim()), `${attack.id} lacks assertion`)
  }

  for (const order of workOrders) {
    check(['backend', 'frontend', 'qa'].includes(order.team), `${order.id} has unknown team`)
    check(order.status === 'candidate_rollback_evidence_eol_repair_implemented_ci_pending', `${order.id} must preserve rollback evidence line-ending repair and pending CI boundary`)
    check(Boolean(order.deliverable?.trim()), `${order.id} lacks deliverable`)
  }
  check(workOrders.filter((entry) => entry.team === 'backend').length === 4, 'backend work-order count drift')
  check(workOrders.filter((entry) => entry.team === 'frontend').length === 4, 'frontend work-order count drift')
  check(workOrders.filter((entry) => entry.team === 'qa').length === 5, 'QA work-order count drift')

  const ci = candidate.ciContract ?? {}
  check(ci.workflowPath === '.github/workflows/p0-static.yml', 'CI workflow path drift')
  check(existsSync(resolve(repoRoot, ci.workflowPath)), 'CI workflow file is missing')
  check(ci.isolatedProjectRefSource === 'scripts/p0/project-ref-contract.json:testProjectRef', 'CI isolated ref source drift')
  check(ci.secretValuesMayBePrintedOrCommitted === false, 'CI secret boundary drift')
  check(ci.databasePermissionAndBusinessTestsRequired === true, 'CI runtime tests must remain required')
  check(ci.actualRemoteRunEvidence === 'passed', 'remote CI evidence must remain accepted after actual proof exists')
  check(ci.p1ActualRemoteRunEvidence === 'passed', 'P1 successful remote CI evidence missing')
  check(ci.p1RunEvidence?.runId === '29691027458', 'P1 run id drift')
  check(ci.p1RunEvidence?.linuxJobId === '88203660504' && ci.p1RunEvidence?.windowsJobId === '88203660515', 'P1 job ids drift')
  check(ci.p1RunEvidence?.headSha === 'ed853ebbab250f562d03f433f4d2df4ada87de4e', 'P1 head SHA drift')
  check(ci.p1RunEvidence?.databaseGates === '70/70 migrations, 27/27 SQL, 4/4 catalog', 'P1 database gate summary drift')
  check(ci.p1RunEvidence?.windowsGates === '15/15 static, 12/12 local, 71/71 P1 app shell', 'P1 Windows gate summary drift')
  check(ci.p1RunEvidence?.cleanupPassed === true, 'P1 cleanup evidence missing')
  const repairCi = ci.repairCandidateRunEvidence ?? {}
  check(repairCi.runId === '29693556452' && repairCi.headSha === 'b9bcca61b826c641e550c6c070f09c4adc407cbe', 'repair CI run identity drift')
  check(repairCi.linuxJobId === '88210359113' && repairCi.windowsJobId === '88210359107', 'repair CI job ids drift')
  check(repairCi.overallStatus === 'failed_preserved_without_rerun' && repairCi.rerunPerformed === false, 'repair CI failure preservation drift')
  check(repairCi.ciRepairCandidateLinuxAccepted === true && repairCi.linuxDatabaseGates === '70/70 migrations, 27/27 SQL, 4/4 catalog, cleanup passed', 'repair CI Linux acceptance drift')
  check(repairCi.windowsStatic === '16/17', 'repair CI Windows static count drift')
  check(repairCi.windowsFailure === 'static gate 17 PG selftest required D:/CanWinP1Postgres18 tools on the GitHub runner', 'repair CI Windows failure drift')
  check(repairCi.windowsLocalRemainingStepsExecuted === 0 && repairCi.windowsLocalRemainingStepsNotExecuted === 11, 'repair CI Windows stop boundary drift')
  check(repairCi.portableSelftestRepairPending === true, 'portable self-test repair must remain pending')
  check(repairCi.productionReadPerformed === false && repairCi.productionWritePerformed === false, 'repair CI production boundary drift')
  const secondRepairCi = ci.secondRepairCandidateRunEvidence ?? {}
  check(secondRepairCi.runId === '29694104452' && secondRepairCi.headSha === '92bbac9c265834d0d4f4c550137f519afe366a03', 'second repair CI run identity drift')
  check(secondRepairCi.linuxJobId === '88211774885' && secondRepairCi.windowsJobId === '88211774922', 'second repair CI job ids drift')
  check(secondRepairCi.overallStatus === 'failed_preserved_without_rerun' && secondRepairCi.rerunPerformed === false, 'second repair CI failure preservation drift')
  check(secondRepairCi.ciSecondRepairCandidateLinuxAccepted === true && secondRepairCi.linuxDatabaseGates === '70/70 migrations, 27/27 SQL, 4/4 catalog, cleanup passed', 'second repair CI Linux acceptance drift')
  check(secondRepairCi.portableSelftestRepairImplemented === true, 'portable self-test implementation evidence missing')
  check(secondRepairCi.windowsStatic === '15/17' && secondRepairCi.windowsFailedGate === '16 p1-isolated-runtime-runner' && secondRepairCi.windowsGate17Executed === false, 'second repair CI Windows static stop boundary drift')
  check(secondRepairCi.windowsFailure === 'validator raw CRLF exact-string mismatch for execute-only tool gate', 'second repair CI Windows failure drift')
  check(secondRepairCi.windowsLocalRemainingStepsExecuted === 0 && secondRepairCi.windowsLocalRemainingStepsNotExecuted === 11, 'second repair CI Windows local stop boundary drift')
  check(secondRepairCi.validatorLineEndingRepairPending === true, 'validator line-ending repair must remain pending')
  check(secondRepairCi.productionReadPerformed === false && secondRepairCi.productionWritePerformed === false, 'second repair CI production boundary drift')
  const freshCheckoutFailureCi = ci.freshCheckoutFailureRunEvidence ?? {}
  check(freshCheckoutFailureCi.runId === '29695919974' && freshCheckoutFailureCi.headSha === '02f7377071783f2f3213218c6c3c3ace961768bc', 'fresh-checkout failure CI run identity drift')
  check(freshCheckoutFailureCi.runUrl === 'https://github.com/yccanwin/canwin-team-os/actions/runs/29695919974', 'fresh-checkout failure CI run URL drift')
  check(freshCheckoutFailureCi.linuxJobId === '88216547033' && freshCheckoutFailureCi.windowsJobId === '88216547016', 'fresh-checkout failure CI job ids drift')
  check(freshCheckoutFailureCi.overallStatus === 'failed_preserved_without_rerun' && freshCheckoutFailureCi.rerunPerformed === false && freshCheckoutFailureCi.preservedWithoutRerun === true, 'fresh-checkout failed run preservation drift')
  check(freshCheckoutFailureCi.workflowDurationSeconds === 142 && freshCheckoutFailureCi.linuxDurationSeconds === 137 && freshCheckoutFailureCi.windowsDurationSeconds === 57, 'fresh-checkout failure CI duration drift')
  check(freshCheckoutFailureCi.linuxDatabaseGates === '70/70 migrations, 27/27 SQL (7 database, 11 permission, 9 business), 4/4 catalog, cleanup passed', 'fresh-checkout failure CI Linux gate summary drift')
  check(freshCheckoutFailureCi.windowsStatic === '5/19' && freshCheckoutFailureCi.windowsFailedGate === '6 p1-interface-freeze', 'fresh-checkout failure CI Windows static stop boundary drift')
  check(freshCheckoutFailureCi.windowsFailure === 'raw CRLF checkout bytes did not match the normalized UTF-8 LF rollback evidence SHA', 'fresh-checkout failure CI Windows root cause drift')
  check(freshCheckoutFailureCi.windowsLocalRemainingStepsExecuted === 0 && freshCheckoutFailureCi.windowsLocalRemainingStepsNotExecuted === 11, 'fresh-checkout failure CI Windows local stop boundary drift')
  check(freshCheckoutFailureCi.platformDifference === true && freshCheckoutFailureCi.staticSelfTestFailure === true && freshCheckoutFailureCi.databaseOrBusinessFailure === false, 'fresh-checkout failure CI classification drift')
  check(freshCheckoutFailureCi.rollbackEvidenceExpectedSha256Lf === '9e77cd23a712b5f908e56af8daf355c81cb36d52f468a10afdb131bea6b74ec3', 'fresh-checkout rollback evidence LF SHA drift')
  check(freshCheckoutFailureCi.windowsCrlfShapeSha256 === '04fb77da734a6b80f94f2e4bccbf6c0b1f4f33b04e39de5416ff61ec44296486', 'fresh-checkout rollback evidence CRLF SHA drift')
  check(freshCheckoutFailureCi.rollbackEvidenceLineEndingRepairImplemented === true && exactSet(freshCheckoutFailureCi.sourceEolFormatsValidated, ['lf', 'crlf', 'cr', 'mixed']) && freshCheckoutFailureCi.postRepairIndependentCi === 'pending', 'fresh-checkout line-ending repair boundary drift')
  check(freshCheckoutFailureCi.testProjectRemoteReads === 0 && freshCheckoutFailureCi.testProjectRemoteWrites === 0 && freshCheckoutFailureCi.productionReadPerformed === false && freshCheckoutFailureCi.productionWritePerformed === false, 'fresh-checkout failure CI remote boundary drift')
  check(freshCheckoutFailureCi.pageAccountAcceptancePassed === false && freshCheckoutFailureCi.g1OverallClaim === false, 'fresh-checkout failure CI must not claim page acceptance or G1')
  const independentRepairCi = ci.independentRepairRunEvidence ?? {}
  check(independentRepairCi.runId === '29694757727' && independentRepairCi.headSha === '8273f5c69e09de24c9afbf27b010d60f7b7caddf', 'independent repair CI run identity drift')
  check(independentRepairCi.runUrl === 'https://github.com/yccanwin/canwin-team-os/actions/runs/29694757727', 'independent repair CI run URL drift')
  check(independentRepairCi.linuxJobId === '88213478676' && independentRepairCi.windowsJobId === '88213478682', 'independent repair CI job ids drift')
  check(independentRepairCi.overallStatus === 'success', 'independent repair CI success evidence missing')
  check(independentRepairCi.workflowDurationSeconds === 148 && independentRepairCi.linuxDurationSeconds === 142 && independentRepairCi.windowsDurationSeconds === 111, 'independent repair CI duration evidence drift')
  check(independentRepairCi.linuxDatabaseGates === '70/70 migrations, 27/27 SQL (7 database, 11 permission, 9 business), 4/4 catalog, cleanup passed', 'independent repair CI Linux gate summary drift')
  check(independentRepairCi.windowsGates === '17/17 static, 12/12 local, 71/71 P1 app shell', 'independent repair CI Windows gate summary drift')
  check(independentRepairCi.frontendModulesBuilt === 1975 && independentRepairCi.frontendArtifactFiles === 66, 'independent repair CI frontend artifact counts drift')
  check(independentRepairCi.frontendArtifactSha256 === '33505fcddc4b814379906406287b1fa715677b1e218497e1fe5a1693f50fc21b', 'independent repair CI frontend artifact hash drift')
  check(independentRepairCi.githubUploadedArtifacts === 0, 'independent repair CI uploaded artifact count drift')
  check(independentRepairCi.linuxGithubWarningAnnotations === 1 && independentRepairCi.windowsGithubWarningAnnotations === 1, 'independent repair CI warning annotation count drift')
  check(JSON.stringify(independentRepairCi.nonBlockingWarnings) === JSON.stringify([
    'GitHub Actions Node.js 20 action runtime deprecation; actions were forced to Node.js 24',
    'Node.js DEP0040 punycode deprecation',
    'Windows Node.js DEP0169 url.parse deprecation',
  ]), 'independent repair CI non-blocking warning inventory drift')
  check(independentRepairCi.validatorLineEndingRepairImplemented === true && independentRepairCi.newIndependentCi === 'passed', 'independent repair CI validator acceptance drift')
  check(JSON.stringify(independentRepairCi.priorFailedRunIdsPreservedWithoutRerun) === JSON.stringify(['29693556452', '29694104452']), 'failed repair CI preservation drift')
  check(independentRepairCi.repositorySecretsRequired === false && independentRepairCi.productionReadPerformed === false && independentRepairCi.productionWritePerformed === false, 'independent repair CI secret or production boundary drift')
  check(independentRepairCi.isolatedTestProjectPersistentApplyPassed === false && independentRepairCi.reconciliationPassed === false && independentRepairCi.pageAccountAcceptancePassed === false && independentRepairCi.g1OverallClaim === false, 'independent CI must not claim isolated apply, reconciliation, page acceptance or G1')

  const isolated = candidate.isolatedTestProjectEvidence ?? {}
  check(isolated.targetProjectRef === 'zdmuaqokndhhbarudhtw', 'isolated target ref drift')
  check(isolated.dryRunPassed === true, 'isolated dry-run success evidence missing')
  check(isolated.localMigrationCount === 70 && isolated.remoteMigrationCount === 69, 'isolated migration inventory drift')
  check(JSON.stringify(isolated.pendingMigrationVersions) === JSON.stringify(['20260719130910']), 'isolated pending migration set drift')
  check(isolated.formalAttempts === 1 && isolated.formalAttemptLimit === 1, 'isolated formal attempt count drift')
  check(isolated.applyStatus === 'failed_repair_pending', 'isolated apply failure status missing')
  check(isolated.failedStep === 'apply-signed-p1-migration' && isolated.failedMigrationVersion === '20260719130910', 'isolated failed migration boundary drift')
  check(isolated.failedStatementNumber === 5, 'isolated failed statement number drift')
  check(isolated.failedStatement === 'alter table public.profile_access_roles alter column assignment_kind set not null', 'isolated failed statement drift')
  check(isolated.sqlstate === '55006' && isolated.failureCode === 'pending_trigger_events', 'isolated SQLSTATE or root cause drift')
  check(isolated.postFailureSqlExecuted === false && isolated.catalogAssertionsExecuted === false && isolated.reconciliationExecuted === false, 'post-failure execution boundary drift')
  check(isolated.productionReadPerformed === false && isolated.productionWritePerformed === false, 'isolated production boundary drift')
  check(isolated.testProjectWriteAttempts === 1, 'isolated test-project write attempt must remain one')
  check(isolated.transactionRollbackVerified === true, 'isolated rollback verification evidence missing')
  check(isolated.rollbackReadonlyEvidencePath === rollbackEvidencePath, 'isolated rollback evidence path drift')
  check(isolated.rollbackReadonlyEvidenceSha256 === '9e77cd23a712b5f908e56af8daf355c81cb36d52f468a10afdb131bea6b74ec3', 'isolated rollback evidence SHA contract drift')
  check(rollbackEvidenceSha256 === isolated.rollbackReadonlyEvidenceSha256, 'isolated rollback evidence file SHA mismatch')
  check(Object.values(rollbackEvidenceEolHashes).every((hash) => hash === isolated.rollbackReadonlyEvidenceSha256), 'isolated rollback evidence LF/CRLF/CR/mixed hash equivalence drift')
  check(isolated.rollbackVerifiedAtUtc === '2026-07-19T16:33:23.5401222Z' && rollbackEvidence.verifiedAtUtc === isolated.rollbackVerifiedAtUtc, 'isolated rollback verification timestamp drift')
  check(isolated.rollbackComparisonSnapshotSha256 === '83169f289d0a411a9fb54296a9f6900f0e9337f7b9e2ca5e321480994fbc9cd7' && rollbackEvidence.comparison?.comparisonSnapshotSha256 === isolated.rollbackComparisonSnapshotSha256, 'isolated rollback comparison snapshot SHA drift')
  check(isolated.rollbackPreflightSha256 === '4ea5d3dc8f63feb56b8c0339c5734b79453f32ed6b6c905663e869e76b3287ac' && rollbackEvidence.sourceFailure?.preflightSha256 === isolated.rollbackPreflightSha256, 'isolated rollback preflight SHA drift')
  check(isolated.rollbackExactPreflightMatch === true && rollbackEvidence.comparison?.exactPreflightMatch === true, 'isolated rollback exact preflight comparison missing')
  check(Array.isArray(isolated.rollbackDifferenceKeys) && isolated.rollbackDifferenceKeys.length === 0 && Array.isArray(rollbackEvidence.comparison?.differenceKeys) && rollbackEvidence.comparison.differenceKeys.length === 0, 'isolated rollback difference keys must remain empty')
  check(isolated.rollbackMigrationRows === 69 && rollbackEvidence.comparison?.migrationRows === 69, 'isolated rollback migration row count drift')
  check(isolated.rollbackP1ResidualObjects === 0 &&
    rollbackEvidence.p1ResidualChecks?.migrationHistoryRows === 0 &&
    rollbackEvidence.p1ResidualChecks?.assignmentKindColumnPresent === false &&
    rollbackEvidence.p1ResidualChecks?.p1Indexes === 0 &&
    rollbackEvidence.p1ResidualChecks?.p1Triggers === 0 &&
    rollbackEvidence.p1ResidualChecks?.p1Functions === 0 &&
    rollbackEvidence.p1ResidualChecks?.authFixtureUsers === 0 &&
    rollbackEvidence.p1ResidualChecks?.profileFixtureRows === 0 &&
    rollbackEvidence.p1ResidualChecks?.regionFixtureRows === 0 &&
    rollbackEvidence.p1ResidualChecks?.requestFixtureRows === 0 &&
    rollbackEvidence.p1ResidualChecks?.supervisorFeatureFlags === 0,
  'isolated rollback P1 residual evidence drift')
  check(isolated.rollbackIdleInTransactionSessions === 0 && rollbackEvidence.p1ResidualChecks?.idleInTransactionSessions === 0, 'isolated rollback idle transaction count drift')
  check(isolated.rollbackProductionReads === 0 && isolated.rollbackProductionWrites === 0 && rollbackEvidence.result?.productionReads === 0 && rollbackEvidence.result?.productionWrites === 0, 'isolated rollback production boundary drift')
  check(rollbackEvidence.result?.sqlstate55006FailureFullyRolledBack === true && rollbackEvidence.result?.isolatedBaselineClean === true && rollbackEvidence.result?.eligibleForNewQualifiedCandidate === true, 'isolated rollback result evidence drift')
  check(isolated.targetPreserved === true && isolated.retryPerformed === false && isolated.remoteCleanupPerformed === false, 'isolated stop-and-preserve boundary drift')
  check(isolated.evidencePath === 'D:\\CanWin-Team-OS-4.0-P1-Validation\\p1-isolated-20260719T150630589Z-ed853ebbab\\failure.json', 'isolated evidence path drift')
  check(isolated.evidenceSha256 === '773bf49d6fa8eb3abbe564969cbec83b22755282153fd11e5d5d0fc161cfc996', 'isolated evidence SHA drift')

  const repair = candidate.repairCandidate ?? {}
  const localPg = repair.localPostgresEvidence ?? {}
  check(repair.hashMode === 'utf8-lf', 'repair candidate hash mode must remain utf8-lf')
  check(repair.migrationSha256Lf === 'acc7f15afa502d7a124c2a13d74d0a71c2b98c11664d58de2d4639081d5a7597', 'repair migration LF SHA drift')
  check(repair.testSha256Lf === 'bed07c4d494ac3e7f7e993e12090194ed413b0e92d681aea0adb3eb381f430fb', 'repair SQL test LF SHA drift')
  check(repair.runtimeContractSha256Lf === 'c1069d2dece65d6f0d6889d8e8cd0ff186e31498686df227a539d0bde706366b', 'runtime contract LF SHA drift')
  check(repair.runnerSha256Lf === 'ac22d2d935d4b557314b5e7c61dfdf54e4af8c3dfe178ad047de1b2cf5955248', 'runtime runner LF SHA drift')
  check(repair.runnerValidatorSha256Lf === '3749561b5bb13f2e725be2447fe43f7d3b34ad745422e99a91b732307e9e6085', 'runtime validator LF SHA drift')
  check(repair.postgresRegressionSha256Lf === 'f4f54d77436b1b91035cd8fff7572dd52f4375aa75f52325a664426d0b9cf3ea', 'local Postgres regression LF SHA drift')
  check(repair.localPostgresAccepted === true && repair.isolatedRemoteApply === 'pending' && repair.isolatedRemoteEligibility === 'ready_pending_formal_apply', 'local repair acceptance or isolated remote readiness boundary drift')
  check(repair.validatorLineEndingRepairImplemented === true && repair.newIndependentCi === 'passed', 'validator line-ending implementation or independent CI boundary drift')
  check(repair.freshCheckoutFailureRunId === '29695919974' && repair.freshCheckoutFailurePreservedWithoutRerun === true, 'fresh-checkout failure preservation missing from repair candidate')
  check(repair.rollbackEvidenceLineEndingRepairImplemented === true && exactSet(repair.rollbackEvidenceEolFormatsValidated, ['lf', 'crlf', 'cr', 'mixed']) && repair.postRepairIndependentCi === 'pending', 'rollback evidence line-ending repair candidate boundary drift')
  check(localPg.path === 'D:\\CanWinP1LocalPgRuns\\p1-pending-trigger-iWUhfO', 'local Postgres evidence path drift')
  check(localPg.resultSha256 === '9c16a2d8934f75c0f6a59641a090f3fa65fbf909d07e3d6bde1743a107614af7', 'local Postgres result SHA drift')
  check(localPg.postgresMajor === 18 && localPg.negativePassed === '1/1' && localPg.positiveRepairPassed === '4/4', 'local Postgres control counts drift')
  check(localPg.negativeControl === 'SQLSTATE 55006 pending trigger events', 'local Postgres negative control drift')
  check(localPg.rollbackClean === true && localPg.serverStopped === true && localPg.attempts === 1 && localPg.remoteConnections === 0, 'local Postgres safety evidence drift')

  const boundary = candidate.acceptanceBoundary ?? {}
  check(boundary.p1InterfacesFrozen === true, 'P1 interface freeze missing')
  check(boundary.p1WorkOrdersFrozen === true, 'P1 work-order freeze missing')
  check(boundary.p1CodeStarted === true, 'P1 code start must be recorded')
  check(boundary.p1CandidateImplemented === true, 'P1 candidate implementation must be recorded')
  check(boundary.ciRuntimeAccepted === true, 'P1 CI runtime acceptance must be recorded')
  check(boundary.ciRepairCandidateLinuxAccepted === true, 'repair candidate Linux acceptance must be recorded')
  check(boundary.ciRepairCandidateWindowsStatic === '16/17', 'repair candidate Windows static boundary drift')
  check(boundary.portableSelftestRepairPending === false && boundary.portableSelftestRepairImplemented === true, 'portable self-test implementation boundary drift')
  check(boundary.ciSecondRepairCandidateLinuxAccepted === true, 'second repair candidate Linux acceptance must be recorded')
  check(boundary.ciSecondRepairCandidateWindowsStatic === '15/17', 'second repair candidate Windows static boundary drift')
  check(boundary.validatorLineEndingRepairPending === false && boundary.validatorLineEndingRepairImplemented === true, 'validator line-ending implementation boundary drift')
  check(boundary.newIndependentCi === 'passed', 'new independent CI success evidence missing')
  check(boundary.freshCheckoutFailureRunId === '29695919974' && boundary.freshCheckoutFailurePreservedWithoutRerun === true, 'fresh-checkout failure boundary missing')
  check(boundary.rollbackEvidenceLineEndingRepairImplemented === true && boundary.postRepairIndependentCi === 'pending', 'rollback evidence line-ending repair acceptance boundary drift')
  check(boundary.localPostgresAccepted === true, 'local PostgreSQL repair acceptance must be recorded')
  check(boundary.repairCandidateIsolatedRemoteApply === 'pending', 'isolated remote repair candidate must remain pending')
  check(boundary.isolatedTestProjectApply === 'failed_repair_pending', 'isolated apply failure boundary missing')
  check(boundary.isolatedTestProjectWriteAttempts === 1, 'isolated test-project write attempts must not be reported as zero')
  check(boundary.isolatedTestProjectRollbackVerified === true && boundary.isolatedTestProjectResidualObjects === 0, 'isolated rollback verification or zero-residual boundary missing')
  check(boundary.isolatedTestProjectReconciliationPerformed === false, 'isolated reconciliation must remain not performed')
  check(boundary.pageAccountAcceptancePassed === false, 'real page/account acceptance must remain pending')
  check(boundary.runtimeAccepted === false, 'runtime acceptance must remain false')
  check(boundary.g0OverallClaim === true, 'G0 success evidence is missing')
  check(boundary.g1OverallClaim === false, 'G1 must remain false before real page/account acceptance')
  check(boundary.productionWritePerformed === false, 'production write must remain false')
  check(boundary.productionMigrationAuthorized === false, 'production migration must remain unauthorized')

  const serialized = JSON.stringify(candidate)
  check(!/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(serialized), 'contract contains a UUID')
  check(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(serialized), 'contract contains an email address')
  return failures
}

const failures = validate(contract)
const negativeCases = [
  ['extra primary role', (value) => { value.baseTestIdentities[1].primaryRole = 'captain' }],
  ['real runtime user id', (value) => { value.baseTestIdentities[1].runtimeUserId = '00000000-0000-4000-8000-000000000001' }],
  ['missing API case', (value) => { value.directApiAttackCases.pop() }],
  ['whitelist leak', (value) => { value.supervisorSummaryWhitelist.push('companyProfit') }],
  ['frontend authority', (value) => { value.authorizationRules.frontendMayDeriveSecondAuthorizationModel = true }],
  ['unversioned RPC', (value) => { value.rpcInterfaces[0].name = 'get_app_context' }],
  ['write without idempotency', (value) => { value.rpcInterfaces[3].arguments = value.rpcInterfaces[3].arguments.filter((name) => name !== 'p_idempotency_key') }],
  ['work status reverted', (value) => { value.workOrders[0].status = 'frozen_not_started' }],
  ['remote CI success erased', (value) => { value.ciContract.actualRemoteRunEvidence = 'pending' }],
  ['P1 CI success erased', (value) => { value.ciContract.p1ActualRemoteRunEvidence = 'failed_repair_pending' }],
  ['repair CI Linux acceptance erased', (value) => { value.acceptanceBoundary.ciRepairCandidateLinuxAccepted = false }],
  ['repair CI Windows falsely all green', (value) => { value.acceptanceBoundary.ciRepairCandidateWindowsStatic = '17/17' }],
  ['portable repair regressed to pending', (value) => { value.acceptanceBoundary.portableSelftestRepairPending = true }],
  ['second repair CI Linux acceptance erased', (value) => { value.acceptanceBoundary.ciSecondRepairCandidateLinuxAccepted = false }],
  ['second repair CI Windows falsely all green', (value) => { value.acceptanceBoundary.ciSecondRepairCandidateWindowsStatic = '17/17' }],
  ['validator line-ending implementation erased', (value) => { value.acceptanceBoundary.validatorLineEndingRepairImplemented = false }],
  ['new independent CI success erased', (value) => { value.acceptanceBoundary.newIndependentCi = 'pending' }],
  ['fresh-checkout failure preservation erased', (value) => { value.acceptanceBoundary.freshCheckoutFailurePreservedWithoutRerun = false }],
  ['rollback evidence line-ending repair erased', (value) => { value.acceptanceBoundary.rollbackEvidenceLineEndingRepairImplemented = false }],
  ['post-repair CI falsely accepted', (value) => { value.acceptanceBoundary.postRepairIndependentCi = 'passed' }],
  ['isolated failure erased', (value) => { value.isolatedTestProjectEvidence.applyStatus = 'passed' }],
  ['isolated write falsely zero', (value) => { value.acceptanceBoundary.isolatedTestProjectWriteAttempts = 0 }],
  ['isolated rollback verification erased', (value) => { value.acceptanceBoundary.isolatedTestProjectRollbackVerified = false }],
  ['isolated rollback residuals falsely added', (value) => { value.acceptanceBoundary.isolatedTestProjectResidualObjects = 1 }],
  ['local Postgres acceptance erased', (value) => { value.acceptanceBoundary.localPostgresAccepted = false }],
  ['remote repair falsely accepted', (value) => { value.acceptanceBoundary.repairCandidateIsolatedRemoteApply = 'passed' }],
  ['repair hash mode changed', (value) => { value.repairCandidate.hashMode = 'raw-bytes' }],
  ['page acceptance falsely claimed', (value) => { value.acceptanceBoundary.pageAccountAcceptancePassed = true }],
  ['G1 falsely claimed', (value) => { value.acceptanceBoundary.g1OverallClaim = true }],
  ['G0 success erased', (value) => { value.acceptanceBoundary.g0OverallClaim = false }],
  ['production write', (value) => { value.acceptanceBoundary.productionWritePerformed = true }],
]
let negativePassed = 0
for (const [name, mutate] of negativeCases) {
  const candidate = clone(contract)
  mutate(candidate)
  if (validate(candidate).length > 0) negativePassed += 1
  else failures.push(`negative self-test did not fail: ${name}`)
}

if (failures.length > 0) {
  console.error('P0_P1_INTERFACE_FREEZE_DRIFT')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `P0_P1_INTERFACE_FREEZE_OK rpcs=${contract.rpcInterfaces.length} whitelists=${Object.keys(contract.fieldWhitelists).length} identities=${contract.baseTestIdentities.length} overlays=${contract.overlayTestCases.length} attacks=${contract.directApiAttackCases.length} workOrders=${contract.workOrders.length} negative=${negativePassed}/${negativeCases.length} hashMode=utf8-lf rollbackEvidenceEolFormats=${Object.keys(rollbackEvidenceEolHashes).join(',')} p1ActualRemoteRun=passed ciRuntimeAccepted=true firstRepairWindowsStatic=16/17 portableSelftestRepairImplemented=true secondRepairLinuxAccepted=true secondRepairWindowsStatic=15/17 validatorLineEndingRepairImplemented=true newIndependentCi=passed independentWindowsStatic=17/17 independentWindowsLocal=12/12 independentLinuxMigrations=70/70 independentLinuxSql=27/27 independentLinuxCatalog=4/4 freshCheckoutFailureRun=29695919974 freshCheckoutWindowsStatic=5/19 freshCheckoutFailedGate=6 freshCheckoutLinuxMigrations=70/70 freshCheckoutLinuxSql=27/27 freshCheckoutLinuxCatalog=4/4 postRepairIndependentCi=pending localPostgresAccepted=true isolatedTestProjectApply=failed_repair_pending repairCandidateIsolatedRemoteApply=pending testProjectWriteAttempts=1 rollbackVerified=true residualObjects=0 reconciliation=false pageAccountAcceptance=false runtimeAccepted=false g0=true g1=false p1CandidateImplemented=true`,
)
