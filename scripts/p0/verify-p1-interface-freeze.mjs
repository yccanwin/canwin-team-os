import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const readJson = (path) => JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'))
const contract = readJson('scripts/p0/p1-interface-freeze.json')
const navigation = readJson('docs/team-os-4.0/p0/p1-app-navigation-contract.json')
const roleMigration = readJson('scripts/p0/role-migration-contract.json')
const physical = readJson('scripts/p0/core-physical-object-contract.json')
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
  check(candidate.contractStatus === 'p1_repair_candidate_pending_remote_runtime', 'contract status drift')
  check(physical.contractStatus === 'p0_supervisor_frozen_runtime_not_implemented', 'physical object contract is not frozen')
  check(navigation.contractStatus === 'p1_repair_candidate_pending_remote_runtime', 'navigation candidate status drift')
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
    check(order.status === 'candidate_implemented_pending_remote', `${order.id} must remain candidate_implemented_pending_remote until isolated runtime acceptance`)
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
  check(ci.p1ActualRemoteRunEvidence === 'failed_repair_pending', 'P1 failed runtime evidence and repair boundary must remain explicit')

  const boundary = candidate.acceptanceBoundary ?? {}
  check(boundary.p1InterfacesFrozen === true, 'P1 interface freeze missing')
  check(boundary.p1WorkOrdersFrozen === true, 'P1 work-order freeze missing')
  check(boundary.p1CodeStarted === true, 'P1 code start must be recorded')
  check(boundary.p1CandidateImplemented === true, 'P1 candidate implementation must be recorded')
  check(boundary.runtimeAccepted === false, 'runtime acceptance must remain false')
  check(boundary.g0OverallClaim === true, 'G0 success evidence is missing')
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
  `P0_P1_INTERFACE_FREEZE_OK rpcs=${contract.rpcInterfaces.length} whitelists=${Object.keys(contract.fieldWhitelists).length} identities=${contract.baseTestIdentities.length} overlays=${contract.overlayTestCases.length} attacks=${contract.directApiAttackCases.length} workOrders=${contract.workOrders.length} negative=${negativePassed}/${negativeCases.length} p1ActualRemoteRun=failed_repair_pending runtimeAccepted=false g0=true p1CandidateImplemented=true`,
)
