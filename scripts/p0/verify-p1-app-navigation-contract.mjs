import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const contractPath = resolve(repoRoot, 'docs/team-os-4.0/p0/p1-app-navigation-contract.json')
const failures = []

function fail(message) {
  failures.push(message)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function compareExactSet(label, actualValues, expectedValues) {
  const actual = sortedUnique(actualValues)
  const expected = sortedUnique(expectedValues)
  const missing = expected.filter((value) => !actual.includes(value))
  const unexpected = actual.filter((value) => !expected.includes(value))
  if (missing.length || unexpected.length) {
    fail(`${label} mismatch: missing=[${missing.join(', ')}] unexpected=[${unexpected.join(', ')}]`)
  }
}

function assertUnique(label, values) {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index)
  assert(duplicates.length === 0, `${label} contains duplicates: ${sortedUnique(duplicates).join(', ')}`)
}

function basePath(target) {
  return target?.split('?')[0] ?? null
}

const contract = JSON.parse(await readFile(contractPath, 'utf8'))
const inventoryPath = resolve(repoRoot, contract.sources.frontendInventory)
const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'))
const plan = await readFile(resolve(repoRoot, contract.sources.plan), 'utf8')
const counts = contract.expectedCounts

assert(contract.schemaVersion === 1, `Unsupported schemaVersion ${contract.schemaVersion}.`)
assert(contract.contractStatus === 'p1_repair_candidate_pending_remote_runtime', 'Contract must record the repaired P1 candidate without claiming remote runtime acceptance.')
for (const marker of contract.planAssertions) assert(plan.includes(marker), `Plan assertion drifted: ${marker}`)

const expectedPrimaryRoleIds = ['sales', 'implementation', 'operations', 'finance', 'admin']
const primaryRoles = contract.roleModel.primaryRoles
const primaryRoleIds = primaryRoles.map((role) => role.id)
assert(contract.roleModel.onePrimaryRolePerUser === true, 'The contract must allow exactly one primary role per user.')
assert(primaryRoles.length === counts.primaryRoles, `Expected ${counts.primaryRoles} primary roles, got ${primaryRoles.length}.`)
assertUnique('primary role ids', primaryRoleIds)
compareExactSet('primary role ids', primaryRoleIds, expectedPrimaryRoleIds)

const additionalFunctions = contract.roleModel.additionalFunctions
const additionalFunctionIds = additionalFunctions.map((entry) => entry.id)
assert(additionalFunctions.length === counts.additionalFunctions, `Expected ${counts.additionalFunctions} additional functions, got ${additionalFunctions.length}.`)
assertUnique('additional function ids', additionalFunctionIds)
compareExactSet('additional function ids', additionalFunctionIds, ['warehouse', 'supervisor'])
for (const entry of additionalFunctions) {
  assert(entry.isPrimaryRole === false, `${entry.id} must not be a primary role.`)
  assert(entry.createsIndependentHome === false, `${entry.id} must not create an independent home.`)
  assert(!primaryRoleIds.includes(entry.id), `${entry.id} appears in both primary roles and additional functions.`)
}

const supervisor = contract.supervisorSystem
assert(supervisor.switchField === 'supervisorEnabled', 'Supervisor switch must use AppContext.supervisorEnabled.')
assert(supervisor.defaultEnabled === false, 'Supervisor system must default to disabled.')
assert(supervisor.whenDisabled.teamApprovalVisible === false, 'Team approval must be hidden while supervisors are disabled.')
assert(supervisor.whenDisabled.pendingLabel === '待管理员确认', 'Disabled supervisor pending label must be 待管理员确认.')
assert(supervisor.whenDisabled.routeAllSupervisorActionsToPrimaryRole === 'admin', 'Disabled supervisor actions must fall back to admin.')
assert(supervisor.fallbacks.length >= 3, 'Supervisor fallback conditions are incomplete.')
for (const fallback of supervisor.fallbacks) assert(fallback.routeToPrimaryRole === 'admin', `Supervisor fallback ${fallback.condition} must route to admin.`)
assert(supervisor.switchChangesHistoricalOrders === false, 'Supervisor switch must not rewrite historical orders.')
assert(supervisor.switchChangesHistoricalApprovers === false, 'Supervisor switch must not rewrite historical approvers.')
assert(supervisor.switchChangesHistoricalOperationLogs === false, 'Supervisor switch must not rewrite historical operation logs.')

const requiredAppContextFields = [
  'company',
  'user',
  'primaryRole',
  'additionalFunctions',
  'skills',
  'regionScopeIds',
  'warehouseScopeIds',
  'supervisorScope',
  'supervisorEnabled',
  'permissions',
  'availableWorkViews',
  'currentWorkView',
  'navigationRevision',
]
const appContextFields = contract.appContext.fields
assert(contract.appContext.authority === 'server', 'AppContext authority must be server.')
assert(contract.appContext.frontendMayDeriveAuthorization === false, 'Frontend must not derive a second authorization model.')
assert(appContextFields.length === counts.appContextFields, `Expected ${counts.appContextFields} AppContext fields, got ${appContextFields.length}.`)
assertUnique('AppContext fields', appContextFields.map((field) => field.name))
compareExactSet('AppContext fields', appContextFields.map((field) => field.name), requiredAppContextFields)
for (const field of appContextFields) {
  assert(field.required === true, `AppContext field ${field.name} must have an explicit value, including nullable values.`)
  assert(Boolean(field.type && field.purpose), `AppContext field ${field.name} lacks type or purpose.`)
}

const roleBusinessTargets = contract.navigation.roleBusinessTargets
assertUnique('role business target roles', roleBusinessTargets.map((entry) => entry.primaryRole))
compareExactSet('role business target roles', roleBusinessTargets.map((entry) => entry.primaryRole), primaryRoleIds)

const desktopBaseIds = contract.navigation.desktop.fixedBaseOrder.map((item) => item.id)
const desktopConditionalIds = contract.navigation.desktop.conditionalAppendOrder.map((item) => item.id)
assert(desktopBaseIds.length === counts.desktopBaseItems, `Expected ${counts.desktopBaseItems} desktop base items, got ${desktopBaseIds.length}.`)
assert(desktopConditionalIds.length === counts.desktopConditionalItems, `Expected ${counts.desktopConditionalItems} desktop conditional items, got ${desktopConditionalIds.length}.`)
assert(JSON.stringify(desktopBaseIds) === JSON.stringify(['my-workbench', 'progress', 'calendar', 'role-business']), `Desktop base order is wrong: ${desktopBaseIds.join(', ')}`)
assert(JSON.stringify(desktopConditionalIds) === JSON.stringify(['warehouse-processing', 'team-approval']), `Desktop conditional append order is wrong: ${desktopConditionalIds.join(', ')}`)
assert(contract.navigation.desktop.conditionalAppendOrder[0].visibleWhen.includes('warehouse'), 'Warehouse navigation condition is missing.')
assert(contract.navigation.desktop.conditionalAppendOrder[1].visibleWhen.includes('supervisorEnabled is true'), 'Team approval must require the supervisor switch.')

const messages = contract.navigation.desktop.topBar.messages
assert(messages.required === true && messages.target === '/notifications-v3', 'Messages must be fixed in the top bar and target /notifications-v3.')
const accountMenuIds = contract.navigation.desktop.accountMenuOrder.map((item) => item.id)
assert(accountMenuIds.includes('work-view-switch'), 'Account menu is missing the work-view switch.')
assert(contract.navigation.desktop.accountMenuOrder.find((item) => item.id === 'work-view-switch')?.source === 'appContext.availableWorkViews', 'Work-view switch must consume AppContext.availableWorkViews.')
assert(accountMenuIds.includes('profile'), 'Account menu is missing profile.')

const mobileIds = contract.navigation.mobile.fixedOrder.map((item) => item.id)
assert(mobileIds.length === counts.mobileItems, `Expected ${counts.mobileItems} mobile items, got ${mobileIds.length}.`)
assert(JSON.stringify(mobileIds) === JSON.stringify(['workbench', 'progress', 'calendar', 'role-business', 'my']), `Mobile order is wrong: ${mobileIds.join(', ')}`)
assert(contract.navigation.mobile.messagesPlacement === 'top_bar', 'Mobile messages must remain in the top bar.')

const inventoryRoutes = inventory.currentRoutes
const inventoryPaths = inventoryRoutes.map((route) => route.path)
const compatibilityRoutes = contract.legacyRouteCompatibility
const compatibilityPaths = compatibilityRoutes.map((route) => route.path)
assert(compatibilityRoutes.length === counts.legacyRoutes, `Expected ${counts.legacyRoutes} legacy routes, got ${compatibilityRoutes.length}.`)
assert(counts.legacyRoutes === inventory.expectedCounts.currentRoutes, 'Contract legacy route count must equal the frontend inventory route count.')
assertUnique('legacy route paths', compatibilityPaths)
compareExactSet('legacy route paths', compatibilityPaths, inventoryPaths)

const allowedStates = new Set(contract.allowedCompatibilityStates)
const inventoryRouteByPath = new Map(inventoryRoutes.map((route) => [route.path, route]))
for (const route of compatibilityRoutes) {
  const inventoryRoute = inventoryRouteByPath.get(route.path)
  assert(Boolean(inventoryRoute), `Unexplained route not present in frontend inventory: ${route.path}`)
  assert(route.inventoryMappingId === inventoryRoute?.section48MappingId, `Route ${route.path} mapping id differs from frontend inventory.`)
  assert(allowedStates.has(route.compatibilityState), `Route ${route.path} has unknown compatibility state ${route.compatibilityState}.`)
  assert(Boolean(route.reason?.trim()), `Route ${route.path} has no explanation.`)
  assert(route.inventoryMappingId !== null || Boolean(route.additionalReason?.trim()), `Route ${route.path} is outside section 4.8 but has no additional explanation.`)
  if (route.compatibilityState === 'redirect') {
    assert(Boolean(route.canonicalTarget), `Redirect route ${route.path} has no canonical target.`)
    assert(basePath(route.canonicalTarget) !== route.path, `Redirect route ${route.path} points to itself.`)
  }
  if (route.compatibilityState === 'close_route_preserve_data') {
    assert(route.canonicalTarget === null, `Closed route ${route.path} must not expose a canonical page target.`)
    assert(route.hiddenFromDefaultNavigation === true && route.readOnly === false && route.writeMode === 'disabled', `Closed route ${route.path} must be hidden, inaccessible and write-disabled.`)
  }
}

for (const target of [
  ...roleBusinessTargets.map((entry) => entry.target),
  ...contract.navigation.desktop.fixedBaseOrder.map((item) => item.target).filter(Boolean),
  ...contract.navigation.desktop.conditionalAppendOrder.map((item) => item.target),
  ...contract.navigation.mobile.fixedOrder.map((item) => item.target).filter(Boolean),
  messages.target,
]) {
  assert(inventoryPaths.includes(basePath(target)), `Navigation target ${target} has no compatible base route in frontend inventory.`)
}

if (failures.length) {
  console.error('P1_APP_NAVIGATION_CONTRACT_DRIFT')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    `P1_APP_NAVIGATION_CONTRACT_OK primaryRoles=${counts.primaryRoles} additionalFunctions=${counts.additionalFunctions} appContextFields=${counts.appContextFields} desktop=${counts.desktopBaseItems}+${counts.desktopConditionalItems} mobile=${counts.mobileItems} legacyRoutes=${counts.legacyRoutes}`,
  )
}
