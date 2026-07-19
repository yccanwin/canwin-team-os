import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contractPath = resolve(repoRoot, 'scripts', 'p0', 'role-migration-contract.json')
const expectedProductionRef = 'agygfhmkazcbqaqwmljb'
const expectedPrimaryRoles = ['sales', 'implementation', 'operations', 'finance', 'admin']
const expectedAdditionalFunctions = ['warehouse', 'supervisor']
const checks = []
const check = (label, result) => checks.push([label, Boolean(result)])
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (label, value, expected) => {
  check(label + ' is an object', isObject(value))
  if (!isObject(value)) return
  check(
    label + ' has exact fields',
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()),
  )
}
const exactSet = (value, expected) =>
  Array.isArray(value) && value.length === new Set(value).size &&
  JSON.stringify([...value].sort()) === JSON.stringify([...expected].sort())
const isIso = (value) => {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

let contract
try {
  contract = JSON.parse(readFileSync(contractPath, 'utf8'))
} catch (error) {
  console.error('[p0:role-migration] cannot read contract: ' + error.message)
  process.exit(1)
}

exactKeys('root', contract, [
  'schemaVersion', 'manifestType', 'source', 'targetModel', 'existingAccessRoleMapping',
  'legacyProfileRoleMapping', 'population', 'manualPrimaryRoleDecisions',
])
exactKeys('source', contract.source, [
  'environment', 'projectRef', 'snapshotAt', 'readOnly', 'writePerformed',
])
exactKeys('targetModel', contract.targetModel, [
  'primaryRoles', 'additionalFunctions', 'onePrimaryRoleRequired',
  'supervisorSystemDefaultEnabled', 'fallbackApprover',
])
exactKeys('population', contract.population, [
  'activeProfiles', 'activeWithExactlyOnePrimaryRole', 'activeWithoutPrimaryRole',
  'activeWithMultiplePrimaryRoles', 'activeSupervisors', 'activeWarehouseFunctions',
])
exactKeys('manualPrimaryRoleDecisions', contract.manualPrimaryRoleDecisions, [
  'required', 'resolved', 'status', 'allowedPrimaryRoles', 'resolutionSummary',
  'liveMatchEvidence', 'productionAssignmentsWritten',
])
exactKeys('manualPrimaryRoleDecisions.resolutionSummary', contract.manualPrimaryRoleDecisions?.resolutionSummary, expectedPrimaryRoles)
exactKeys('manualPrimaryRoleDecisions.liveMatchEvidence', contract.manualPrimaryRoleDecisions?.liveMatchEvidence, [
  'verifiedAt', 'projectRef', 'requestedPeople', 'uniqueActiveMatches',
  'requiredRoleCodesAvailable', 'readOnly', 'writePerformed',
])

check('schema version is supported', contract.schemaVersion === 1)
check('manifest type is correct', contract.manifestType === 'canwin-team-os-role-migration')
check('source is production', contract.source?.environment === 'production')
check('production ref is exact', contract.source?.projectRef === expectedProductionRef)
check('source snapshot time is exact ISO', isIso(contract.source?.snapshotAt))
check('source evidence was read-only', contract.source?.readOnly === true)
check('source write was not performed', contract.source?.writePerformed === false)
check('five primary roles are exact', exactSet(contract.targetModel?.primaryRoles, expectedPrimaryRoles))
check(
  'warehouse and supervisor are the only additional functions',
  exactSet(contract.targetModel?.additionalFunctions, expectedAdditionalFunctions),
)
check('exactly one primary role is required', contract.targetModel?.onePrimaryRoleRequired === true)
check('supervisor system defaults off', contract.targetModel?.supervisorSystemDefaultEnabled === false)
check('admin is the fallback approver', contract.targetModel?.fallbackApprover === 'admin')

const accessMapping = contract.existingAccessRoleMapping
exactKeys('existingAccessRoleMapping', accessMapping, [
  'owner', 'admin', 'sales', 'implementation', 'operations', 'finance', 'warehouse', 'supervisor',
])
for (const code of ['owner', 'admin', 'sales', 'implementation', 'operations', 'finance', 'warehouse', 'supervisor']) {
  exactKeys('existingAccessRoleMapping.' + code, accessMapping?.[code], [
    'kind', 'primaryRole', 'additionalFunction',
  ])
}
check('owner is an admin primary alias',
  accessMapping?.owner?.kind === 'primary-alias' && accessMapping.owner.primaryRole === 'admin')
for (const code of ['admin', 'sales', 'implementation', 'operations', 'finance']) {
  check(code + ' remains a primary role',
    accessMapping?.[code]?.kind === 'primary' && accessMapping[code].primaryRole === code &&
    accessMapping[code].additionalFunction === null)
}
for (const code of expectedAdditionalFunctions) {
  check(code + ' remains additional only',
    accessMapping?.[code]?.kind === 'additional' && accessMapping[code].primaryRole === null &&
    accessMapping[code].additionalFunction === code)
}

const legacyMapping = contract.legacyProfileRoleMapping
exactKeys('legacyProfileRoleMapping', legacyMapping, ['admin', 'finance', 'captain', 'warehouse', 'member'])
for (const code of ['admin', 'finance', 'captain', 'warehouse', 'member']) {
  exactKeys('legacyProfileRoleMapping.' + code, legacyMapping?.[code], [
    'automaticPrimaryRole', 'automaticAdditionalFunctions',
  ])
}
check('legacy admin maps safely', legacyMapping?.admin?.automaticPrimaryRole === 'admin')
check('legacy finance maps safely', legacyMapping?.finance?.automaticPrimaryRole === 'finance')
check('legacy captain never guesses a primary role',
  legacyMapping?.captain?.automaticPrimaryRole === null &&
  exactSet(legacyMapping.captain.automaticAdditionalFunctions, ['supervisor']))
check('legacy warehouse never guesses a primary role',
  legacyMapping?.warehouse?.automaticPrimaryRole === null &&
  exactSet(legacyMapping.warehouse.automaticAdditionalFunctions, ['warehouse']))
check('legacy member never guesses a primary role',
  legacyMapping?.member?.automaticPrimaryRole === null &&
  exactSet(legacyMapping.member.automaticAdditionalFunctions, []))

const population = contract.population
for (const [field, value] of Object.entries(population ?? {})) {
  check('population.' + field + ' is a nonnegative integer', Number.isSafeInteger(value) && value >= 0)
}
check(
  'active profile totals reconcile',
  population?.activeProfiles ===
    population?.activeWithExactlyOnePrimaryRole +
    population?.activeWithoutPrimaryRole +
    population?.activeWithMultiplePrimaryRoles,
)
check('no active profile has multiple primary roles', population?.activeWithMultiplePrimaryRoles === 0)
check(
  'manual decision count equals profiles without one primary role',
  contract.manualPrimaryRoleDecisions?.required ===
    population?.activeWithoutPrimaryRole + population?.activeWithMultiplePrimaryRoles,
)
check('manual decisions are owner-confirmed but not written to production',
  contract.manualPrimaryRoleDecisions?.resolved === 2 &&
  contract.manualPrimaryRoleDecisions?.status === 'owner-confirmed-awaiting-isolated-application' &&
  contract.manualPrimaryRoleDecisions?.productionAssignmentsWritten === 0)
check(
  'manual decisions allow exactly the five primary roles',
  exactSet(contract.manualPrimaryRoleDecisions?.allowedPrimaryRoles, expectedPrimaryRoles),
)
const resolutionSummary = contract.manualPrimaryRoleDecisions?.resolutionSummary ?? {}
check('manual decision summary assigns one sales and one admin role',
  resolutionSummary.sales === 1 && resolutionSummary.implementation === 0 &&
  resolutionSummary.operations === 0 && resolutionSummary.finance === 0 &&
  resolutionSummary.admin === 1)
check('manual decision summary reconciles',
  Object.values(resolutionSummary).every((value) => Number.isSafeInteger(value) && value >= 0) &&
  Object.values(resolutionSummary).reduce((sum, value) => sum + value, 0) === contract.manualPrimaryRoleDecisions?.resolved)
const liveMatch = contract.manualPrimaryRoleDecisions?.liveMatchEvidence
check('manual decision live match was read-only and exact',
  isIso(liveMatch?.verifiedAt) && liveMatch?.projectRef === expectedProductionRef &&
  liveMatch?.requestedPeople === 2 && liveMatch?.uniqueActiveMatches === 2 &&
  liveMatch?.requiredRoleCodesAvailable === true && liveMatch?.readOnly === true &&
  liveMatch?.writePerformed === false)

const serialized = JSON.stringify(contract)
const forbiddenPatterns = [
  /eyJhbGciOi[A-Za-z0-9_-]{8,}/,
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/,
  /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=/i,
]
check('no sensitive values are embedded', forbiddenPatterns.every((pattern) => !pattern.test(serialized)))

let passed = 0
for (const [label, result] of checks) {
  if (result) passed += 1
  else console.error('[p0:role-migration] FAIL ' + label)
}
console.log(
  '[p0:role-migration] active=' + population?.activeProfiles +
    ' exactly_one_primary=' + population?.activeWithExactlyOnePrimaryRole +
    ' manual_decisions=' + contract.manualPrimaryRoleDecisions?.required,
)
console.log(
  '[p0:role-migration] summary discovered=' + checks.length +
    ' run=' + checks.length + ' passed=' + passed +
    ' failed=' + (checks.length - passed) + ' skipped=0',
)
console.log(
  '[p0:role-migration] readiness=' +
    (contract.manualPrimaryRoleDecisions?.required === contract.manualPrimaryRoleDecisions?.resolved
      ? 'READY'
      : 'BLOCKED reason=owner-primary-role-decisions'),
)
if (passed !== checks.length) process.exit(1)
