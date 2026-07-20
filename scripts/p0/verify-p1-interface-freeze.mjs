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
const expectedApiIds = Array.from({ length: 13 }, (_, index) => `P1-API-${String(index + 1).padStart(3, '0')}`)
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
  check(candidate.contractStatus === 'p1_acl_and_atomic_compatibility_repair_candidate_database_ci_pending', 'contract status drift')
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
  check(JSON.stringify(candidate.warehouseAssignmentPolicy) === JSON.stringify({ defaultPrimaryRoles: ['admin'], grantablePrimaryRoles: ['implementation'], forbiddenPrimaryRoles: ['sales', 'operations', 'finance'], source: 'docs/CanWin-Team-OS-4.0-最终施工总方案.md:55' }), 'warehouse assignment policy drift')

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
  const identityPrimaryRole = new Map(identities.map((entry) => [entry.id, entry.primaryRole]))
  for (const overlay of overlays) {
    check(identityIds.has(overlay.baseIdentity), `${overlay.id} references unknown base identity`)
    check(overlay.additionalFunctions.every((role) => additionalFunctions.includes(role)), `${overlay.id} has unknown overlay`)
    if (overlay.additionalFunctions.includes('warehouse')) check(['admin', 'implementation'].includes(identityPrimaryRole.get(overlay.baseIdentity)), `${overlay.id} grants warehouse outside admin or implementation`)
    check(typeof overlay.supervisorEnabled === 'boolean', `${overlay.id} lacks supervisor switch state`)
    check(Boolean(overlay.purpose?.trim()), `${overlay.id} lacks purpose`)
  }
  const overlayById = new Map(overlays.map((entry) => [entry.id, entry]))
  check(JSON.stringify(overlayById.get('P1-OVL-001')) === JSON.stringify({ id: 'P1-OVL-001', baseIdentity: 'P1-IDN-005', additionalFunctions: ['warehouse'], supervisorEnabled: false, purpose: 'admin carries the default warehouse function' }), 'admin default warehouse overlay drift')
  check(JSON.stringify(overlayById.get('P1-OVL-002')) === JSON.stringify({ id: 'P1-OVL-002', baseIdentity: 'P1-IDN-002', additionalFunctions: ['warehouse'], supervisorEnabled: false, purpose: 'implementation with scoped warehouse work' }), 'implementation warehouse overlay drift')
  check(JSON.stringify(overlayById.get('P1-OVL-003')) === JSON.stringify({ id: 'P1-OVL-003', baseIdentity: 'P1-IDN-003', requestedFunctions: ['warehouse'], additionalFunctions: [], expectedGrantRejected: true, supervisorEnabled: false, purpose: 'operations warehouse request is rejected' }), 'operations warehouse negative overlay drift')
  const attackActors = new Set([...identityIds, ...overlays.map((entry) => entry.id), 'synthetic_disabled_member'])
  for (const attack of attacks) {
    check(attackActors.has(attack.actor), `${attack.id} references unknown actor ${attack.actor}`)
    check(Boolean(attack.assertion?.trim()), `${attack.id} lacks assertion`)
  }
  check(JSON.stringify(attacks.find((entry) => entry.id === 'P1-API-013')) === JSON.stringify({ id: 'P1-API-013', actor: 'P1-IDN-001', assertion: 'sales cannot receive the warehouse function' }), 'sales warehouse negative API case drift')

  for (const order of workOrders) {
    check(['backend', 'frontend', 'qa'].includes(order.team), `${order.id} has unknown team`)
    check(order.status === 'candidate_post_apply_verification_pending', `${order.id} must preserve the pending post-apply verification boundary`)
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
  const postRepairCi = ci.postRepairIndependentCiRunEvidence ?? {}
  check(postRepairCi.runId === '29696529290' && postRepairCi.runUrl === 'https://github.com/yccanwin/canwin-team-os/actions/runs/29696529290', 'post-repair CI run identity drift')
  check(postRepairCi.headSha === 'e04dfa3ee8a9f569b97c905c87f760d7b76a6e00' && postRepairCi.linuxJobId === '88218121933' && postRepairCi.windowsJobId === '88218121940', 'post-repair CI head or job ids drift')
  check(postRepairCi.overallStatus === 'success' && postRepairCi.workflowDurationSeconds === 136 && postRepairCi.linuxDurationSeconds === 132 && postRepairCi.windowsDurationSeconds === 76, 'post-repair CI result or duration drift')
  check(postRepairCi.linuxDatabaseGates === '70/70 migrations, 27/27 SQL (7 database, 11 permission, 9 business), 4/4 catalog, cleanup passed', 'post-repair CI Linux gate summary drift')
  check(postRepairCi.windowsGates === '19/19 static, 12/12 local, 71/71 P1 app shell', 'post-repair CI Windows gate summary drift')
  check(postRepairCi.frontendModulesBuilt === 1975 && postRepairCi.frontendArtifactFiles === 66 && postRepairCi.frontendArtifactSha256 === '33505fcddc4b814379906406287b1fa715677b1e218497e1fe5a1693f50fc21b' && postRepairCi.githubUploadedArtifacts === 0, 'post-repair CI frontend artifact evidence drift')
  check(postRepairCi.realAccountSafetySelfTest === 'passed guards=7 negativeFailureCases=1 accounts=6 evidenceSecrets=0 cleanup=seal-not-delete network=0', 'post-repair CI real-account safety self-test drift')
  check(postRepairCi.realPageRunnerSelfTest === 'passed without network; real acceptance pending', 'post-repair CI real-page self-test boundary drift')
  check(postRepairCi.linuxGithubWarningAnnotations === 1 && postRepairCi.windowsGithubWarningAnnotations === 1, 'post-repair CI warning annotation count drift')
  check(postRepairCi.postRepairIndependentCi === 'passed' && postRepairCi.repositorySecretsRequired === false && postRepairCi.testProjectRemoteReads === 0 && postRepairCi.testProjectRemoteWrites === 0, 'post-repair CI acceptance or test-project remote boundary drift')
  check(postRepairCi.productionReadPerformed === false && postRepairCi.productionWritePerformed === false, 'post-repair CI production boundary drift')
  check(JSON.stringify(postRepairCi.priorFailedRunIdsPreservedWithoutRerun) === JSON.stringify(['29693556452', '29694104452', '29695919974']), 'post-repair CI failed-run preservation drift')
  check(postRepairCi.isolatedTestProjectPersistentApplyPassed === false && postRepairCi.reconciliationPassed === false && postRepairCi.pageAccountAcceptancePassed === false && postRepairCi.g1OverallClaim === false, 'post-repair CI must not claim isolated apply, reconciliation, page acceptance or G1')

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

  const postApply = candidate.postApplyVerificationFailureEvidence ?? {}
  const migrationProof = postApply.migrationStageControlFlowProof ?? {}
  const firstSql = postApply.firstSql ?? {}
  check(postApply.runId === 'p1-isolated-20260719T172151689Z-8273f5c69e', 'post-apply failure run id drift')
  check(postApply.evidenceDirectory === 'D:\\CanWin-Team-OS-4.0-P1-Validation\\p1-isolated-20260719T172151689Z-8273f5c69e', 'post-apply failure evidence directory drift')
  check(postApply.failurePath === `${postApply.evidenceDirectory}\\failure.json` && postApply.failureSha256 === '3a8077ad58b1a7ee1fc4a75340ab3db9b8f1c3d5ea772e019ff1282136029774', 'post-apply failure evidence path or SHA drift')
  check(postApply.preflightPath === `${postApply.evidenceDirectory}\\preflight.json` && postApply.preflightSha256 === 'e44d53b72c85a71eff2d7a5359220f86c20af56af02a9bf6c0a81716c6d65b97', 'post-apply preflight evidence path or SHA drift')
  check(postApply.candidateHeadSha === '8273f5c69e09de24c9afbf27b010d60f7b7caddf' && postApply.supervisionHeadSha === 'e04dfa3ee8a9f569b97c905c87f760d7b76a6e00', 'post-apply candidate or supervision SHA drift')
  check(postApply.startedAtUtc === '2026-07-19T17:21:51.692Z' && postApply.failedAtUtc === '2026-07-19T17:22:06.528Z', 'post-apply evidence timestamp drift')
  check(postApply.formalAttempts === 1 && postApply.formalAttemptLimit === 1 && postApply.status === 'failed_stop_preserved' && postApply.phase === 'post_apply_verification', 'post-apply formal stop boundary drift')
  check(postApply.migrationVersion === '20260719130910' && postApply.preflightMigrationRows === 69 && postApply.preflightP1Applied === false, 'post-apply preflight migration inventory drift')
  check(postApply.preflightP1FixtureRows === 0 && postApply.preflightIdleInTransactionSessions === 0, 'post-apply preflight fixture or transaction boundary drift')
  check(migrationProof.firstSqlReached === true && migrationProof.requiredP1MigrationApplied === true && migrationProof.requiredMigrationRows === 70, 'post-apply migration-stage control-flow proof missing')
  check(migrationProof.postMigrationSnapshotSerializedInFailure === false && migrationProof.postFailureRemoteStateRechecked === false, 'post-apply evidence must not claim a durable post snapshot or remote re-read')
  check(firstSql.order === 1 && firstSql.path === 'supabase/tests/access_control_foundation.sql' && firstSql.currentStep === 'test:database:supabase/tests/access_control_foundation.sql', 'post-apply first SQL identity drift')
  check(firstSql.errorFileLine === 92 && firstSql.doBlockLine === 53 && firstSql.error === 'Legacy member received implicit customers.manage permission', 'post-apply first SQL error evidence drift')
  check(firstSql.classification === 'false_positive' && firstSql.passed === false, 'post-apply first SQL classification drift')
  check(postApply.sqlTestsExpected === 27 && postApply.sqlTestsPassed === 0 && postApply.remainingSqlTestsNotExecuted === 26, 'post-apply SQL stop boundary drift')
  check(postApply.catalogAssertionsExpected === 4 && postApply.catalogAssertionsExecuted === 0 && postApply.reconciliationExecuted === false, 'post-apply catalog or reconciliation boundary drift')
  check(postApply.finalPostSnapshotRecorded === false && postApply.successEvidenceWritten === false, 'post-apply evidence must not claim a final snapshot or success marker')
  check(postApply.targetPreserved === true && postApply.retryPerformed === false && postApply.remoteCleanupPerformed === false, 'post-apply test-project preservation boundary drift')
  check(JSON.stringify(postApply.evidenceFiles) === JSON.stringify(['preflight.json', 'failure.json']) && postApply.evidenceSecrets === 0, 'post-apply evidence file inventory or secret boundary drift')
  check(postApply.productionReadPerformed === false && postApply.productionWritePerformed === false, 'post-apply production boundary drift')

  const repair = candidate.repairCandidate ?? {}
  const localPg = repair.localPostgresEvidence ?? {}
  check(repair.hashMode === 'utf8-lf', 'repair candidate hash mode must remain utf8-lf')
  check(repair.migrationSha256Lf === 'acc7f15afa502d7a124c2a13d74d0a71c2b98c11664d58de2d4639081d5a7597', 'repair migration LF SHA drift')
  check(repair.testSha256Lf === 'bed07c4d494ac3e7f7e993e12090194ed413b0e92d681aea0adb3eb381f430fb', 'repair SQL test LF SHA drift')
  check(repair.postApplyAccessControlTestSha256Lf === '31fa286b318ad2b24e2d956005c4a5fcc9b0fddfd0269be029330d5c1c3e43f8', 'post-apply access-control test LF SHA drift')
  check(repair.runtimeContractSha256Lf === 'f99e605341b36e2de18779b6dd52a624b1ef421a9b60c4517f59845a7ba22013', 'runtime contract LF SHA drift')
  check(repair.runnerSha256Lf === 'f9d9d6abed29a482757682d25002f2c414a1271e0f7fa2e9360fc62f009ed648', 'runtime runner LF SHA drift')
  check(repair.runnerValidatorSha256Lf === '60a90fc8bf75d44a02c2d824e29b912d14fbbe844af79b0e5a705c77fe59c2af' && repair.runnerValidatorAssertions === '100/100' && repair.fixturePatternsCovered === '4/4', 'runtime validator LF SHA or assertion count drift')
  check(sha256Utf8Lf(readFileSync(resolve(repoRoot, 'supabase/tests/access_control_foundation.sql'), 'utf8')) === repair.postApplyAccessControlTestSha256Lf, 'post-apply access-control test file SHA mismatch')
  check(repair.postgresRegressionSha256Lf === 'f4f54d77436b1b91035cd8fff7572dd52f4375aa75f52325a664426d0b9cf3ea', 'local Postgres regression LF SHA drift')
  check(repair.localPostgresAccepted === true && repair.isolatedRemoteApply === 'migration_applied_post_apply_verification_failed' && repair.isolatedRemoteEligibility === 'post_apply_resume_qualified_remote_enabled', 'local repair acceptance or isolated remote readiness boundary drift')
  check(repair.validatorLineEndingRepairImplemented === true && repair.newIndependentCi === 'passed', 'validator line-ending implementation or independent CI boundary drift')
  check(repair.freshCheckoutFailureRunId === '29695919974' && repair.freshCheckoutFailurePreservedWithoutRerun === true, 'fresh-checkout failure preservation missing from repair candidate')
  check(repair.rollbackEvidenceLineEndingRepairImplemented === true && exactSet(repair.rollbackEvidenceEolFormatsValidated, ['lf', 'crlf', 'cr', 'mixed']) && repair.postRepairIndependentCi === 'passed' && repair.postRepairIndependentCiRunId === '29696529290', 'post-repair independent CI candidate boundary drift')
  const resumePrequalification = repair.resumePrequalification ?? {}
  check(resumePrequalification.status === 'qualified_remote_enabled', 'post-apply resume prequalification status drift')
  check(resumePrequalification.candidateRemoteExecutionAllowed === false && resumePrequalification.resumeRemoteExecutionAllowed === true && resumePrequalification.resumeSignedCiHeadSha === 'a620bb541f4c5eb613413e8b40455b3988ee0cf3', 'post-apply resume remote boundary drift')
  check(resumePrequalification.resumeSignedCiRunId === '29699951990' && resumePrequalification.resumeSignedCiLinuxJobId === '88227205377' && resumePrequalification.resumeSignedCiWindowsJobId === '88227205362' && resumePrequalification.resumeSignedCiConclusion === 'success', 'post-apply resume signed CI run or job drift')
  check(resumePrequalification.resumeSignedCiWindowsStatic === '19/19' && resumePrequalification.resumeSignedCiWindowsLocal === '12/12' && resumePrequalification.resumeSignedCiLinuxCounts === '70/27/7/11/9/4', 'post-apply resume signed CI count drift')
  check(resumePrequalification.signedCiHeadExecutionAllowed === false && resumePrequalification.trackedDirtyAllowed === false && resumePrequalification.untrackedAuditEvidenceAllowed === true, 'post-apply resume same-head, tracked-dirty, or untracked-audit boundary drift')
  check(resumePrequalification.dbPushAllowed === false && resumePrequalification.expectedPersistentRemoteWrites === 0 && resumePrequalification.migrationPreviouslyApplied === true && resumePrequalification.resumeVerificationExecuted === false, 'post-apply resume apply/write/execution boundary drift')
  check(resumePrequalification.productionReadPerformed === false && resumePrequalification.productionWritePerformed === false, 'post-apply resume production boundary drift')
  const full = resumePrequalification.fullReconciliation ?? {}
  check(full.exactPostMigrationRows === 70 && full.sqlTests === 27 && full.perTestFullSnapshots === 27 && full.fullSnapshots === 29, 'full reconciliation migration, SQL or snapshot counts drift')
  check(JSON.stringify(full.fullSnapshotPlan) === JSON.stringify({ initial: 1, afterEachSqlTest: 27, finalAfterFreshCredential: 1 }), 'full reconciliation 29-snapshot plan drift')
  check(full.storageArchiveSnapshots === 2 && JSON.stringify(full.storageArchivePlan) === JSON.stringify({ initial: 1, final: 1 }), 'full reconciliation Storage archive plan drift')
  check(full.signedArtifactCount === 6 && Object.keys(full.signedArtifactSha256 ?? {}).length === 6 && Object.values(full.signedArtifactSha256 ?? {}).every((sha) => /^[a-f0-9]{64}$/.test(sha)), 'full reconciliation signed artifact inventory drift')
  check(exactSet(full.keyAmountKeys, ['customerPayments', 'internalPayables', 'salesProfit', 'points', 'laborEarnings']) && full.currency === 'CNY' && full.decimalPrecision === 2, 'full reconciliation five key-amount contract drift')
  check(exactSet(full.rawLedgerKeys, ['customerPaymentGross', 'customerPaymentReversals', 'internalDue', 'internalPaid', 'internalSettlements', 'procurementPayments', 'salesExpenses', 'quarterlyRebates', 'companyExpenses']), 'full reconciliation nine raw-ledger keys drift')
  check(exactSet(full.inventoryKeys, ['onHand', 'reserved', 'shipped']), 'full reconciliation three inventory keys drift')
  check(JSON.stringify(full.auth) === JSON.stringify({ users: 7, identities: 7, profiles: 7, sourceRoleAssignments: 8, authorizedRoleAssignmentsApplied: 2, postOverlayRoleAssignments: 10, orphanProfiles: 0, orphanRoleAssignments: 0, bannedUsers: 7, sessionsRestored: false, sourceJwtSecretCopied: false }), 'full reconciliation Auth/session isolation drift')
  check(JSON.stringify(full.storage) === JSON.stringify({ buckets: 1, objects: 32, bytes: 1700978, aggregateSha256: '12000d53bf395a9637638a372778a61f7a821eea3be622e81bec84051f3b379f' }), 'full reconciliation Storage totals/content drift')
  check(exactSet(full.requiredContentFingerprints, ['publicTableContentMd5', 'auth.usersContentMd5', 'auth.identitiesContentMd5', 'schemaSecurity', 'canonicalSha256']) && full.beforeAfterCanonicalShaMustMatch === true, 'full reconciliation content-fingerprint boundary drift')
  check(JSON.stringify(full.allowedPersistentContentDifferencesFromSealedSource) === JSON.stringify([
    { table: 'profile_access_roles', effect: 'authorized-role-overlay-plus-assignment-kind-backfill', rowDeltaFromSignedManifest: 2 },
    { table: 'feature_flags', effect: 'one-team-os-4-supervisor-row-per-missing-team', rowDeltaFromSignedPreflight: 1 },
  ]), 'full reconciliation authorized difference inventory drift')
  check(full.expectedSchemaAndHistoryDifference === 'exact-signed-P1-migration-only' && full.unknownDifferencesAllowed === false, 'full reconciliation schema/history or unknown-difference boundary drift')
  check(JSON.stringify(full.sourceP0Boundary) === JSON.stringify({ signedP0TableRowCountsAreCountsOnly: true, signedP0TargetAfterSha256IsNull: true, p1InitialAndFinalContentFingerprintsRequired: true }), 'legacy P0 counts-only evidence boundary drift')
  check(full.temporarySessionOnly === true && full.persistentDatabaseWrites === false && full.sessionClosedDropsTemporaryState === true, 'full reconciliation temporary-session boundary drift')
  check(full.validationDatabaseCalls === 0 && full.validationStorageCalls === 0 && exactSet(full.fixturePatterns, ['p1-email', 'access-email', 'd400-profile', 'd510-profile']), 'full reconciliation offline validation or fixture-pattern boundary drift')

  const formalResumeFailure = candidate.formalResumeFailureEvidence ?? {}
  const formalResumeEvidenceDirectory = 'D:/CanWin-Team-OS-4.0-P1-Validation/p1-resume-20260719T193911279Z-ea6ed9385d'
  check(formalResumeFailure.runId === 'p1-resume-20260719T193911279Z-ea6ed9385d' && formalResumeFailure.supervisionHeadSha === 'ea6ed9385de7c3ceff5cba6c6f8539f883bbea1d', 'formal resume failure run or head drift')
  check(formalResumeFailure.evidenceDirectory === formalResumeEvidenceDirectory && formalResumeFailure.preflightPath === `${formalResumeEvidenceDirectory}/preflight.json` && formalResumeFailure.failurePath === `${formalResumeEvidenceDirectory}/failure.json`, 'formal resume failure evidence path drift')
  check(formalResumeFailure.preflightSha256 === 'e0ea653d3a411cc9baafbd4b98e7d6d458b99316e8da93a1db1600a21e2dc36a' && formalResumeFailure.failureSha256 === '576a11005285cd708adca5b3486e0b929ace8d97fc3cc3284d657b57519b91ad', 'formal resume failure evidence SHA drift')
  check(formalResumeFailure.startedAtUtc === '2026-07-19T19:39:11.283Z' && formalResumeFailure.failedAtUtc === '2026-07-19T19:40:00.235Z', 'formal resume failure timestamp drift')
  check(formalResumeFailure.failedStep === 'test:database:supabase/tests/notification_core.sql' && formalResumeFailure.firstFailedSqlTest === 'supabase/tests/notification_core.sql' && formalResumeFailure.firstError === 'Notification worker RPC exposed', 'formal resume first failure drift')
  check(formalResumeFailure.testsPassed === 5 && formalResumeFailure.perTestSnapshotsPassed === 5 && formalResumeFailure.fullReconciliationSnapshotsPassed === 6 && formalResumeFailure.storageArchivesPassed === 1, 'formal resume partial acceptance counts drift')
  check(formalResumeFailure.attempts === 1 && formalResumeFailure.persistentRemoteWrites === 0 && formalResumeFailure.productionReads === 0 && formalResumeFailure.productionWrites === 0, 'formal resume attempt or remote-write boundary drift')
  check(formalResumeFailure.secretsPrinted === 0 && formalResumeFailure.secretsWritten === 0 && formalResumeFailure.retryPerformed === false && formalResumeFailure.remoteCleanupPerformed === false && formalResumeFailure.targetPreserved === true, 'formal resume preserve/secret boundary drift')
  check(JSON.stringify(formalResumeFailure.derivedAudit) === JSON.stringify({ directoryFileInventory: ['preflight.json', 'failure.json'], successEvidencePresent: false, derivation: 'directory inventory; fields are not asserted as native failure.json properties' }), 'formal resume derived directory audit drift')

  const expectedAclFunctions = [
    { identity: 'public.enqueue_wecom_notification_jobs(text, timestamp with time zone)', revokeRoles: ['PUBLIC', 'anon', 'authenticated'], requiredGrantRoles: ['service_role'] },
    { identity: 'public.claim_wecom_notification_jobs(integer, timestamp with time zone)', revokeRoles: ['PUBLIC', 'anon', 'authenticated'], requiredGrantRoles: ['service_role'] },
    { identity: 'public.complete_wecom_notification_job(uuid, boolean, text, text, timestamp with time zone)', revokeRoles: ['PUBLIC', 'anon', 'authenticated'], requiredGrantRoles: ['service_role'] },
    { identity: 'public.manage_profile_access(uuid, text[], uuid[])', revokeRoles: ['PUBLIC', 'anon', 'authenticated'], requiredGrantRoles: [] },
    { identity: 'public.admin_replace_profile_roles(uuid, text[], uuid)', revokeRoles: ['PUBLIC', 'anon', 'authenticated'], requiredGrantRoles: [] },
    { identity: 'public.admin_replace_supervisor_subordinates(uuid, uuid[], uuid)', revokeRoles: ['PUBLIC', 'anon', 'authenticated'], requiredGrantRoles: [] },
  ]
  const aclRepair = candidate.aclRepairCandidate ?? {}
  check(aclRepair.mode === '--apply-acl-repair' && aclRepair.remoteExecutionAllowed === false && aclRepair.dbPushAllowed === false, 'ACL repair local-only mode drift')
  check(aclRepair.migrationVersion === '20260720015435' && aclRepair.migrationPath === 'supabase/migrations/20260720015435_harden_server_only_rpc_acl.sql', 'ACL repair migration identity drift')
  check(aclRepair.migrationSha256Lf === '1bb13f29fc0f5512bd00115dc1c953a2c3aaa0ec21522b1cc8cbb45a18a5cdc0' && aclRepair.migrationSha256Lf === sha256Utf8Lf(readFileSync(resolve(repoRoot, aclRepair.migrationPath), 'utf8')), 'ACL repair migration SHA drift')
  check(aclRepair.preMigrationRows === 70 && aclRepair.postMigrationRows === 71 && aclRepair.expectedMigrationCount === 71 && aclRepair.sqlTestCount === 27, 'ACL repair migration or SQL counts drift')
  check(aclRepair.maxFormalAttempts === 1 && aclRepair.maxDbPushAttempts === 1 && aclRepair.dryRunRequired === true && JSON.stringify(aclRepair.pendingMigrationVersions) === JSON.stringify(['20260720015435']), 'ACL repair attempt or dry-run boundary drift')
  check(aclRepair.signedCiHeadSha === null && aclRepair.signedCiRunId === null && aclRepair.signedCiLinuxJobId === null && aclRepair.signedCiWindowsJobId === null && aclRepair.signedCiConclusion === null, 'unsigned ACL repair candidate must not claim signed CI')
  check(JSON.stringify(aclRepair.functions) === JSON.stringify(expectedAclFunctions), 'ACL repair six-function privilege inventory drift')
  check(aclRepair.targetFunctionCount === 6 && aclRepair.expectedChangedFunctionCount === 4 && JSON.stringify(aclRepair.expectedChangedFunctions) === JSON.stringify(expectedAclFunctions.slice(0, 4).map((entry) => entry.identity)), 'ACL repair target-six changed-four boundary drift')
  const expectedChangedTests = [
    { path: 'supabase/tests/notification_core.sql', sha256Lf: 'a3d87069899b986b191bc21826f5e23c65fe4734066e52adc4e14753c9e6e5a3' },
    { path: 'supabase/tests/team_os_4_p1_access_shell.sql', sha256Lf: 'c4823724a65047b0e67af6ba62c954acf3085d70ffbbda1c5e1a0be23ce94dfb' },
  ]
  check(JSON.stringify(aclRepair.changedTests) === JSON.stringify(expectedChangedTests) && aclRepair.changedTests.every((entry) => entry.sha256Lf === sha256Utf8Lf(readFileSync(resolve(repoRoot, entry.path), 'utf8'))), 'ACL repair changed-test evidence drift')
  const currentRuntime = aclRepair.currentRuntimeArtifacts ?? {}
  check(JSON.stringify(currentRuntime.contract) === JSON.stringify({ path: 'scripts/p1/isolated-runtime-contract.json', sha256Lf: '421f78b398eb259d2a3fa43836e7a3ff9f2c70527ad88af1896b0d0a4e118d08' }) && currentRuntime.contract.sha256Lf === sha256Utf8Lf(readFileSync(resolve(repoRoot, currentRuntime.contract.path), 'utf8')), 'ACL repair current runtime contract SHA drift')
  check(JSON.stringify(currentRuntime.runner) === JSON.stringify({ path: 'scripts/p1/run-isolated-runtime.mjs', sha256Lf: '9f04478e3f218dad16eec3660919dfedabb3e69ad2a2c7522b7caa396a010620' }) && currentRuntime.runner.sha256Lf === sha256Utf8Lf(readFileSync(resolve(repoRoot, currentRuntime.runner.path), 'utf8')), 'ACL repair current runner SHA drift')
  check(JSON.stringify(currentRuntime.validator) === JSON.stringify({ path: 'scripts/p1/verify-isolated-runtime-runner.mjs', sha256Lf: '168bd3e03b1fc3e9536fc74d353b10e01a2b51c1ff1ff8a3e9eb5d3930233577', assertions: '63/63' }) && currentRuntime.validator.sha256Lf === sha256Utf8Lf(readFileSync(resolve(repoRoot, currentRuntime.validator.path), 'utf8')), 'ACL repair current validator SHA or assertion drift')
  const aclFull = aclRepair.fullReconciliation ?? {}
  check(JSON.stringify(aclFull.expected) === JSON.stringify({ migrationRows: 71 }), 'ACL repair full reconciliation expected rows drift')
  check(JSON.stringify(aclFull.execution) === JSON.stringify({ initialFullBeforeRepair: true, fullAfterEverySqlTest: true, perTestFullSnapshots: 27, finalFullAfterFreshCredential: true, beforeAfterAllowedAclTransitionOnly: true, storageArchiveAtInitialAndFinal: true, temporaryTestSessionsOnly: true, persistentDatabaseWrites: 'exactly-one-signed-acl-and-atomic-compatibility-migration', sessionClosedDropsTemp: true }), 'ACL repair full reconciliation execution plan drift')
  check(aclFull.expectedSchemaAndHistoryDifference === 'exact-signed-P1-plus-ACL-repair-migrations-only', 'ACL repair schema/history difference drift')
  const privateTransition = aclRepair.privateRoutineDefinitionTransition ?? {}
  check(JSON.stringify(privateTransition) === JSON.stringify({ expectedChangedFunctions: ['private.admin_apply_member_access_v1(uuid, text, text[], uuid[], uuid[], text[], uuid)'], expectedDefinitionChanges: 1, requiredSnapshots: 3, identityChangesAllowed: 0, securityEnvelopeChangesAllowed: 0, unknownChangesAllowed: false }), 'private member-access definition transition drift')
  const atomicCompatibility = aclRepair.atomicLegacyRoleCompatibility ?? {}
  check(atomicCompatibility.status === 'static-passed-database-ci-pending' && atomicCompatibility.staticPassed === true && atomicCompatibility.databaseCiPassed === null && atomicCompatibility.remoteQualificationAllowed === false, 'atomic compatibility current pending boundary drift')
  check(JSON.stringify(atomicCompatibility.mappingPrecedence) === JSON.stringify([{ condition: 'primary-admin', legacyRole: 'admin' }, { condition: 'additional-supervisor', legacyRole: 'captain' }, { condition: 'primary-finance', legacyRole: 'finance' }, { condition: 'additional-warehouse', legacyRole: 'warehouse' }, { condition: 'fallback', legacyRole: 'member' }]), 'atomic compatibility role mapping drift')
  check(atomicCompatibility.writeFunction === 'private.admin_apply_member_access_v1(uuid, text, text[], uuid[], uuid[], text[], uuid)' && atomicCompatibility.successfulMappingCases === 5 && atomicCompatibility.rollbackControls === 2 && atomicCompatibility.sameTeamStaticGuards === 4 && atomicCompatibility.remoteGateNegativeControls === 5 && atomicCompatibility.atomicRemoteGateNegativeControls === 2 && atomicCompatibility.migrationRewritesExistingProfiles === false, 'atomic compatibility evidence totals or remote locks drift')
  check(atomicCompatibility.sqlTestPath === 'supabase/tests/team_os_4_p1_access_shell.sql' && atomicCompatibility.sqlTestSha256Lf === 'c4823724a65047b0e67af6ba62c954acf3085d70ffbbda1c5e1a0be23ce94dfb' && atomicCompatibility.staticTestSha256Lf === 'ab62a1a9db9a3cb07f9b4246a5c3cb8314c39ff3931e99f520584396bd8ccef3' && atomicCompatibility.appShellAssertionsPassed === 99 && atomicCompatibility.appShellAssertionsExpected === 99, 'atomic compatibility source hashes or app assertions drift')
  const aclCompatibility = aclRepair.applicationCompatibility ?? {}
  check(aclCompatibility.status === 'passed' && aclCompatibility.remoteQualificationAllowed === false && JSON.stringify(aclCompatibility.legacyRpcCallSites) === JSON.stringify([]), 'ACL repair application compatibility status drift')
  check(JSON.stringify(aclCompatibility.resolvedEvidence) === JSON.stringify({ files: ['src/features/access-admin/supabaseDataSource.ts', 'supabase/functions/admin-members/index.ts'], forbiddenRpcNames: ['manage_profile_access', 'admin_replace_profile_roles', 'admin_replace_supervisor_subordinates'], staticCallSitesRemaining: 0, appShellAssertionsPassed: 99, appShellAssertionsExpected: 99, warehouseBackendRelaxed: false, formalStaticGateCoverage: { gate: 16, serial: true, runnerValidatorPassed: true, appShellPassed: true, accessV1BehaviorPassed: true } }), 'ACL repair application compatibility evidence drift')
  check(aclCompatibility.requiredOutcome === 'all-old-role-and-supervisor-writers-replaced-and-accepted' && aclCompatibility.g1BlockedUntilAclAndPageAcceptance === true, 'ACL repair compatibility or G1 safety boundary drift')
  check(JSON.stringify(aclRepair.allowedFullReconciliationDifferences) === JSON.stringify(['migrationHistory.schemaMigrations', 'schemaSecurity.publicRoutinesMd5']) && aclRepair.unknownDifferencesAllowed === false, 'ACL repair reconciliation allowlist drift')

  const aclRepairCi = candidate.repairCiRunEvidence ?? {}
  check(aclRepairCi.runId === null && aclRepairCi.runUrl === null && aclRepairCi.headSha === null && aclRepairCi.linuxJobId === null && aclRepairCi.windowsJobId === null && aclRepairCi.conclusion === null, 'unsigned ACL repair CI identity must remain null')
  check(aclRepairCi.migrationsPassed === null && aclRepairCi.sqlTestsPassed === null && aclRepairCi.catalogAssertionsPassed === null && aclRepairCi.windowsStaticGatesExpected === 19 && aclRepairCi.windowsStaticGatesPassed === null && aclRepairCi.windowsLocalIntegrationStepsExpected === 12 && aclRepairCi.windowsLocalIntegrationStepsPassed === null, 'unsigned ACL repair CI counts drift')
  check(aclRepairCi.candidateRemoteExecutionAllowed === false && aclRepairCi.g1OverallClaim === false, 'ACL repair CI remote or G1 boundary drift')

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
  check(boundary.rollbackEvidenceLineEndingRepairImplemented === true && boundary.postRepairIndependentCi === 'passed' && boundary.postRepairIndependentCiRunId === '29696529290', 'post-repair independent CI acceptance boundary drift')
  check(boundary.localPostgresAccepted === true, 'local PostgreSQL repair acceptance must be recorded')
  check(boundary.repairCandidateIsolatedRemoteApply === 'migration_applied_post_apply_verification_failed' && boundary.postApplyVerificationCandidate === 'pending', 'isolated post-apply verification candidate boundary drift')
  check(boundary.postApplyResumePrequalification === 'failed_stop_preserved_acl_repair_pending' && boundary.postApplyCandidateRemoteExecutionAllowed === false && boundary.postApplyResumeRemoteExecutionAllowed === false, 'post-apply resume terminal boundary drift')
  check(boundary.postApplyResumeSignedCiHeadSha === 'a620bb541f4c5eb613413e8b40455b3988ee0cf3' && boundary.postApplyResumeSignedCiRunId === '29699951990' && boundary.postApplyResumeSignedCiLinuxJobId === '88227205377' && boundary.postApplyResumeSignedCiWindowsJobId === '88227205362' && boundary.postApplyResumeSignedCiConclusion === 'success', 'post-apply resume signed CI identity drift')
  check(boundary.postApplyResumeSignedHeadExecutionAllowed === false && boundary.postApplyResumeTrackedDirtyAllowed === false && boundary.postApplyResumeUntrackedAuditEvidenceAllowed === true, 'post-apply resume worktree qualification boundary drift')
  check(boundary.p1MigrationPreviouslyApplied === true && boundary.postApplyResumeVerificationExecuted === true, 'post-apply resume execution boundary drift')
  check(boundary.postApplyResumeFailureRunId === 'p1-resume-20260719T193911279Z-ea6ed9385d' && boundary.postApplyResumeFailurePreserved === true, 'post-apply resume failure preservation boundary drift')
  check(boundary.aclRepairMigrationPath === 'supabase/migrations/20260720015435_harden_server_only_rpc_acl.sql' && boundary.aclRepairLocalGates === 'pending', 'ACL repair current boundary drift')
  check(boundary.fullReconciliationExactRows === 71 && boundary.fullReconciliationSqlTests === 27 && boundary.fullReconciliationPerTestSnapshots === 27 && boundary.fullReconciliationSnapshots === 29, 'ACL repair full reconciliation acceptance counts drift')
  check(boundary.fullReconciliationStorageArchives === 2 && boundary.fullReconciliationSignedArtifacts === 6, 'full reconciliation Storage or artifact acceptance counts drift')
  check(boundary.fullReconciliationKeyAmounts === 5 && boundary.fullReconciliationRawLedgers === 9 && boundary.fullReconciliationInventoryMeasures === 3, 'full reconciliation business measure acceptance counts drift')
  check(boundary.fullReconciliationContentFingerprintsRequired === true && boundary.sourceP0CountsOnlyBoundaryRecorded === true, 'full reconciliation fingerprint or legacy P0 boundary missing')
  check(boundary.fixturePatternsCovered === '4/4' && boundary.runnerValidatorAssertions === '100/100', 'runner fixture-pattern or validator assertion evidence drift')
  check(boundary.isolatedTestProjectApply === 'migration_applied_post_apply_verification_failed', 'isolated post-apply failure boundary missing')
  check(boundary.isolatedTestProjectWriteAttempts === 2, 'isolated test-project write attempt history drift')
  check(boundary.priorFailedApplyRollbackVerified === true && boundary.priorFailedApplyRollbackResidualObjects === 0, 'prior isolated rollback verification boundary missing')
  check(boundary.postApplyMigrationStageControlFlowP1Applied === true && boundary.postApplyMigrationStageControlFlowRows === 70, 'post-apply migration-stage control-flow boundary missing')
  check(boundary.postApplyMigrationSnapshotSerializedInFailure === false && boundary.postFailureRemoteStateRechecked === false, 'post-apply boundary must not claim a durable post snapshot or remote re-read')
  check(boundary.postApplyVerificationSqlTestsPassed === 0 && boundary.postApplyVerificationRemainingSqlTestsNotExecuted === 26 && boundary.postApplyVerificationCatalogAssertionsExecuted === 0, 'post-apply verification stop counts drift')
  check(boundary.isolatedTestProjectReconciliationPerformed === false, 'isolated reconciliation must remain not performed')
  check(boundary.pageAccountAcceptancePassed === false, 'real page/account acceptance must remain pending')
  check(boundary.runtimeAccepted === false, 'runtime acceptance must remain false')
  check(boundary.g0OverallClaim === true, 'G0 success evidence is missing')
  check(boundary.g1OverallClaim === false, 'G1 must remain false before real page/account acceptance')
  check(boundary.overallAcceptedProgressPercent === 25, 'accepted progress must remain 25 percent before G1')
  check(boundary.productionReadPerformed === false && boundary.productionWritePerformed === false, 'production read/write must remain false')
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
  ['sales warehouse overlay reintroduced', (value) => { value.overlayTestCases[0].baseIdentity = 'P1-IDN-001' }],
  ['operations warehouse grant reintroduced', (value) => { value.overlayTestCases[2].additionalFunctions = ['warehouse'] }],
  ['warehouse forbidden-role policy reduced', (value) => { value.warehouseAssignmentPolicy.forbiddenPrimaryRoles.pop() }],
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
  ['post-repair CI acceptance erased', (value) => { value.acceptanceBoundary.postRepairIndependentCi = 'pending' }],
  ['isolated failure erased', (value) => { value.isolatedTestProjectEvidence.applyStatus = 'passed' }],
  ['isolated write falsely zero', (value) => { value.acceptanceBoundary.isolatedTestProjectWriteAttempts = 0 }],
  ['prior isolated rollback verification erased', (value) => { value.acceptanceBoundary.priorFailedApplyRollbackVerified = false }],
  ['prior isolated rollback residuals falsely added', (value) => { value.acceptanceBoundary.priorFailedApplyRollbackResidualObjects = 1 }],
  ['local Postgres acceptance erased', (value) => { value.acceptanceBoundary.localPostgresAccepted = false }],
  ['post-apply verification falsely accepted', (value) => { value.acceptanceBoundary.postApplyVerificationCandidate = 'passed' }],
  ['post-apply candidate remote enabled', (value) => { value.repairCandidate.resumePrequalification.candidateRemoteExecutionAllowed = true }],
  ['post-apply resume remote authorization erased', (value) => { value.repairCandidate.resumePrequalification.resumeRemoteExecutionAllowed = false }],
  ['post-apply resume signature erased', (value) => { value.repairCandidate.resumePrequalification.resumeSignedCiHeadSha = null }],
  ['post-apply same-head execution allowed', (value) => { value.repairCandidate.resumePrequalification.signedCiHeadExecutionAllowed = true }],
  ['post-apply tracked dirty allowed', (value) => { value.repairCandidate.resumePrequalification.trackedDirtyAllowed = true }],
  ['post-apply untracked audit evidence denied', (value) => { value.repairCandidate.resumePrequalification.untrackedAuditEvidenceAllowed = false }],
  ['post-apply resume falsely executed', (value) => { value.repairCandidate.resumePrequalification.resumeVerificationExecuted = true }],
  ['full reconciliation snapshot count reduced', (value) => { value.repairCandidate.resumePrequalification.fullReconciliation.fullSnapshots = 28 }],
  ['full reconciliation content fingerprints erased', (value) => { value.repairCandidate.resumePrequalification.fullReconciliation.requiredContentFingerprints = [] }],
  ['legacy P0 counts-only boundary erased', (value) => { value.repairCandidate.resumePrequalification.fullReconciliation.sourceP0Boundary.signedP0TableRowCountsAreCountsOnly = false }],
  ['d510 fixture pattern erased', (value) => { value.repairCandidate.resumePrequalification.fullReconciliation.fixturePatterns.pop() }],
  ['formal resume failure SHA tampered', (value) => { value.formalResumeFailureEvidence.failureSha256 = '0'.repeat(64) }],
  ['formal resume first error erased', (value) => { value.formalResumeFailureEvidence.firstError = null }],
  ['formal resume partial snapshot count inflated', (value) => { value.formalResumeFailureEvidence.fullReconciliationSnapshotsPassed = 29 }],
  ['ACL repair migration SHA tampered', (value) => { value.aclRepairCandidate.migrationSha256Lf = '0'.repeat(64) }],
  ['ACL repair current runner SHA tampered', (value) => { value.aclRepairCandidate.currentRuntimeArtifacts.runner.sha256Lf = '0'.repeat(64) }],
  ['ACL repair function inventory reduced', (value) => { value.aclRepairCandidate.functions.pop() }],
  ['ACL repair changed-function inventory inflated', (value) => { value.aclRepairCandidate.expectedChangedFunctions.push(value.aclRepairCandidate.functions[4].identity) }],
  ['ACL repair authenticated revoke erased', (value) => { value.aclRepairCandidate.functions[0].revokeRoles.pop() }],
  ['ACL repair service grant erased', (value) => { value.aclRepairCandidate.functions[0].requiredGrantRoles = [] }],
  ['ACL repair full snapshots reduced', (value) => { value.aclRepairCandidate.fullReconciliation.execution.perTestFullSnapshots = 26 }],
  ['private definition transition count erased', (value) => { value.aclRepairCandidate.privateRoutineDefinitionTransition.expectedDefinitionChanges = 0 }],
  ['private definition snapshots reduced', (value) => { value.aclRepairCandidate.privateRoutineDefinitionTransition.requiredSnapshots = 2 }],
  ['atomic database CI falsely accepted', (value) => { value.aclRepairCandidate.atomicLegacyRoleCompatibility.databaseCiPassed = true }],
  ['atomic remote gate negative controls reduced', (value) => { value.aclRepairCandidate.atomicLegacyRoleCompatibility.atomicRemoteGateNegativeControls = 1 }],
  ['ACL repair compatibility call site restored', (value) => { value.aclRepairCandidate.applicationCompatibility.resolvedEvidence.staticCallSitesRemaining = 1 }],
  ['ACL repair compatibility falsely unlocks G1', (value) => { value.aclRepairCandidate.applicationCompatibility.g1BlockedUntilAclAndPageAcceptance = false }],
  ['ACL repair remote execution enabled before CI', (value) => { value.aclRepairCandidate.remoteExecutionAllowed = true }],
  ['ACL repair unknown reconciliation difference allowed', (value) => { value.aclRepairCandidate.unknownDifferencesAllowed = true }],
  ['unsigned ACL repair CI falsely accepted', (value) => { value.repairCiRunEvidence.conclusion = 'success' }],
  ['post-apply snapshot falsely claimed', (value) => { value.postApplyVerificationFailureEvidence.migrationStageControlFlowProof.postMigrationSnapshotSerializedInFailure = true }],
  ['post-apply remaining SQL falsely executed', (value) => { value.acceptanceBoundary.postApplyVerificationRemainingSqlTestsNotExecuted = 0 }],
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
  `P0_P1_INTERFACE_FREEZE_OK rpcs=${contract.rpcInterfaces.length} whitelists=${Object.keys(contract.fieldWhitelists).length} identities=${contract.baseTestIdentities.length} overlays=${contract.overlayTestCases.length} attacks=${contract.directApiAttackCases.length} workOrders=${contract.workOrders.length} negative=${negativePassed}/${negativeCases.length} historicalResumeCi=70/27 formalResumeFailure=p1-resume-20260719T193911279Z-ea6ed9385d formalResumeSql=5/27 formalResumeSnapshots=6/29 failurePreserved=true aclRepairMigration=20260720015435 aclRepairFunctions=6 aclRepairRemote=false aclRepairCi=pending nextFullExactRows=71 nextSqlTests=27 nextPerTestFullSnapshots=27 nextFullSnapshots=29 pageAccountAcceptance=false runtimeAccepted=false progress=25 g0=true g1=false p1CandidateImplemented=true`,
)
