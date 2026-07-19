import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const evidencePath = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'public-object-classification-freeze.json')
const registerPath = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'public-table-classification-register.json')
const ledgerPath = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', '01-database-object-classification.md')
const schemaPath = resolve(repoRoot, 'supabase', 'schema.sql')
const migrationsPath = resolve(repoRoot, 'supabase', 'migrations')

const expectedTableCounts = {
  retain: 47,
  extend: 37,
  read_only: 17,
  retirement_candidate: 2,
}
const requiredTableFields = [
  'tableName',
  'module',
  'currentPurpose',
  'frontendFunctionReadWriteEntrypoints',
  'criticalDependencies',
  'rowCount',
  'rls',
  'grants',
  'policies',
  'triggers',
  'indexRisk',
  'classification',
  'classificationReason',
  'teamOs4Mapping',
  'compatibilityAction',
  'acceptanceEvidence',
  'responsibleParty',
]
const allowedRoutineDispositions = new Set([
  'retain_active_business_rpc',
  'retain_compatibility_overload',
  'retain_compatibility_rpc_pending_p1_caller_confirmation',
  'retain_internal_helper',
  'retain_internal_trigger',
  'retirement_candidate_unused_trigger_helper',
])
const allowedRoutinePriorities = new Set([
  'P0-permission-hardening',
  'P1A-security-definer-identity-review',
  'P1A-unconfirmed-security-definer-entry',
  'P1B-retirement-proof',
  'P2-classified-retain',
])

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sha256File(path) {
  const canonicalText = readFileSync(path, 'utf8').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
  return createHash('sha256').update(canonicalText, 'utf8').digest('hex')
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function exactSet(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right))
}

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/--[^\r\n]*(?=\r?$)/gmu, '')
}

function discoverCreatedTables(sqlTexts) {
  const names = []
  const pattern = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/giu
  for (const sql of sqlTexts) {
    for (const match of stripSqlComments(sql).matchAll(pattern)) names.push(match[1])
  }
  return sortedUnique(names)
}

function parseLedger(markdown) {
  const rows = []
  const pattern = /^\|\s*(\d+)\s*\|\s*`([a-z_][a-z0-9_]*)`\s*\|\s*([^|]+?)\s*\|\s*(保留|扩展|只读|淘汰候选)\s*\|/u
  const classMap = new Map([
    ['保留', 'retain'],
    ['扩展', 'extend'],
    ['只读', 'read_only'],
    ['淘汰候选', 'retirement_candidate'],
  ])
  for (const line of markdown.split(/\r?\n/u)) {
    const match = line.match(pattern)
    if (!match) continue
    rows.push({ ordinal: Number(match[1]), name: match[2], classification: classMap.get(match[4]) })
  }
  return rows
}

function flattenedRegister(register) {
  return Object.entries(register.classifications ?? {}).flatMap(([classification, names]) =>
    (names ?? []).map((name) => ({ name, classification })),
  )
}

function countBy(values, selector) {
  const counts = {}
  for (const value of values) {
    const key = selector(value)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function collectFailures(evidence, register, context) {
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }

  check(evidence.schemaVersion === 1, 'unsupported evidence schema')
  check(evidence.evidenceType === 'p0-public-object-classification-supervisor-freeze', 'evidence type drifted')
  check(evidence.status === 'accepted_supervisor_frozen', 'classification freeze must be accepted')
  check(Number.isFinite(Date.parse(evidence.frozenAtUtc)), 'freeze timestamp invalid')
  check(evidence.productionReadOnly === true && evidence.productionWritePerformed === false, 'production boundary drifted')
  check(evidence.isolatedReadOnly === true && evidence.isolatedWritePerformed === false, 'isolated read-only boundary drifted')
  check(evidence.businessRowsReturned === false && evidence.functionBodiesReturned === false && evidence.secretsReturned === false, 'sensitive output boundary drifted')

  for (const source of Object.values(evidence.sources ?? {})) {
    const sourcePath = resolve(repoRoot, source.path ?? '')
    check(sourcePath.startsWith(repoRoot), `source escaped repository: ${source.path}`)
    check(context.sourceHashes.get(source.path) === source.sha256, `source hash drifted: ${source.path}`)
  }

  const tables = evidence.tableClassifications ?? []
  const tableNames = tables.map((entry) => entry.tableName)
  check(tables.length === 103 && new Set(tableNames).size === 103, 'table classifications must contain 103 unique tables')
  check(exactSet(tableNames, context.ledgerRows.map((entry) => entry.name)), 'table set differs from ledger')
  check(exactSet(tableNames, context.localTableNames), 'table set differs from local schema/migrations')
  check(exactSet(tableNames, flattenedRegister(register).map((entry) => entry.name)), 'table set differs from register')
  check(context.ledgerRows.length === 103 && context.ledgerRows.every((entry, index) => entry.ordinal === index + 1), 'ledger ordinals must be 1..103')
  check(
    context.localTableNames.length === 103 && context.migrationCount === 70,
    'local SQL inventory must remain 103 classified tables across 69 historical migrations plus one additive P1 candidate',
  )

  const tableCounts = countBy(tables, (entry) => entry.classification)
  for (const [classification, expected] of Object.entries(expectedTableCounts)) {
    check(tableCounts[classification] === expected, `classification ${classification} expected ${expected}`)
  }
  const ledgerClassByName = new Map(context.ledgerRows.map((entry) => [entry.name, entry.classification]))
  const registerClassByName = new Map(flattenedRegister(register).map((entry) => [entry.name, entry.classification]))
  for (const table of tables) {
    for (const field of requiredTableFields) check(Object.hasOwn(table, field), `table ${table.tableName} missing field ${field}`)
    check(table.acceptanceStatus === 'supervisor_classification_frozen', `table ${table.tableName} not accepted`)
    check(table.classification === ledgerClassByName.get(table.tableName), `table ${table.tableName} differs from ledger classification`)
    check(table.classification === registerClassByName.get(table.tableName), `table ${table.tableName} differs from register classification`)
    check(Number.isInteger(table.rowCount?.exactRows) && table.rowCount.exactRows >= 0, `table ${table.tableName} exact row count invalid`)
    check(table.rowCount?.productionBusinessRowsRead === false && table.rowCount?.businessRowsReturned === false, `table ${table.tableName} row privacy boundary drifted`)
    check(table.rls?.enabled === true, `table ${table.tableName} RLS is not enabled`)
    check(Array.isArray(table.grants) && Array.isArray(table.policies?.entries) && Array.isArray(table.triggers), `table ${table.tableName} security mappings invalid`)
    check(Array.isArray(table.frontendFunctionReadWriteEntrypoints?.directRuntimeSource) && Array.isArray(table.frontendFunctionReadWriteEntrypoints?.routines), `table ${table.tableName} entrypoint mapping invalid`)
    check(Array.isArray(table.acceptanceEvidence) && table.acceptanceEvidence.length >= 5, `table ${table.tableName} acceptance evidence incomplete`)
  }

  const zeroPolicy = tables.filter((entry) => entry.policies.entries.length === 0)
  check(exactSet(zeroPolicy.map((entry) => entry.tableName), ['crm_lead_conversions', 'deal_catalog_version_requests', 'deal_package_admin_requests']), 'zero-policy table set drifted')
  check(zeroPolicy.every((entry) => entry.policies.decision === 'rpc_only_intentional_keep_direct_api_denied'), 'zero-policy RPC-only decision missing')

  const routines = evidence.routineClassifications ?? []
  check(routines.length === 162 && new Set(routines.map((entry) => entry.signature)).size === 162, 'routine classifications must contain 162 unique signatures')
  for (const routine of routines) {
    check(routine.acceptanceStatus === 'supervisor_classification_frozen', `routine ${routine.signature} not accepted`)
    check(allowedRoutineDispositions.has(routine.disposition), `routine ${routine.signature} disposition invalid`)
    check(allowedRoutinePriorities.has(routine.authorizationReview?.priority), `routine ${routine.signature} priority invalid`)
    check(routine.bodyDependencyEvidence?.productionFingerprintMatched === true, `routine ${routine.signature} fingerprint not matched`)
    check(routine.bodyDependencyEvidence?.functionBodyReturned === false, `routine ${routine.signature} body must not be returned`)
    check(routine.bodyDependencyEvidence?.dynamicSqlMarker === false, `routine ${routine.signature} dynamic SQL requires unresolved review`)
    check(/^[a-f0-9]{32}$/u.test(routine.bodyDependencyEvidence?.definitionMd5 ?? ''), `routine ${routine.signature} fingerprint invalid`)
    check(Array.isArray(routine.bodyDependencyEvidence?.tableDependencies) && Array.isArray(routine.bodyDependencyEvidence?.routineDependencies), `routine ${routine.signature} dependency mapping invalid`)
  }

  check(evidence.counts?.tables === 103 && evidence.counts?.tableAccepted === 103, 'accepted table counts drifted')
  check(evidence.counts?.routines === 162 && evidence.counts?.routineAccepted === 162, 'accepted routine counts drifted')
  check(evidence.counts?.policies === 229 && evidence.counts?.triggerObjects === 29 && evidence.counts?.indexes === 248, 'related object counts drifted')
  check(evidence.counts?.foreignKeys === 309 && evidence.counts?.unindexedForeignKeys === 205, 'foreign-key priority counts drifted')
  check(evidence.counts?.zeroPolicyRpcOnlyDecisions === 3 && evidence.counts?.exactRowsAcrossRestoredPublicTables === 796, 'isolated count/zero-policy totals drifted')
  check(evidence.counts?.routineAuthorizationPriorities?.['P0-permission-hardening'] === 7, 'P0 routine priority count drifted')
  check(evidence.counts?.routineAuthorizationPriorities?.['P1A-security-definer-identity-review'] === 2, 'P1A identity-review count drifted')
  check(evidence.counts?.routineAuthorizationPriorities?.['P1A-unconfirmed-security-definer-entry'] === 36, 'P1A unconfirmed-entry count drifted')
  check(evidence.counts?.routineAuthorizationPriorities?.['P2-classified-retain'] === 117, 'P2 routine count drifted')

  check(evidence.crossReview?.runtimeSourceDynamicTableSites === 0, 'dynamic database table sites remain')
  check(evidence.crossReview?.productionRoutineFingerprintsMatched === 162 && evidence.crossReview?.productionRoutineFingerprintMismatches === 0, 'routine fingerprint cross-review drifted')
  check(evidence.crossReview?.securityInvokerIsolatedSubgateAccepted === true, 'security invoker subgate not accepted')
  check(evidence.g0Contribution?.tableClassificationComplete === true && evidence.g0Contribution?.routineClassificationComplete === true, 'classification contribution incomplete')
  check(evidence.g0Contribution?.policyAndTriggerMappingComplete === true && evidence.g0Contribution?.criticalIndexAndPermissionRiskPriorityComplete === true, 'related risk contribution incomplete')
  check(evidence.g0Contribution?.g0OverallClaim === false, 'classification evidence must not claim overall G0')

  check(register.registerStatus === 'accepted_supervisor_frozen', 'register status not accepted')
  check(register.g0?.status === 'not_achieved' && register.g0?.claim === false, 'register must not claim overall G0')
  check(register.catalogSnapshot?.freezeAccepted === true, 'catalog snapshot freeze not accepted')
  check(register.expectedCounts?.accepted === 103, 'register accepted count drifted')
  check(register.classificationAcceptance?.status === 'accepted_supervisor_frozen' && register.classificationAcceptance?.acceptedTableCount === 103, 'register classification acceptance drifted')
  check(register.openGaps?.requiredPerTableAudit?.completedTableCount === 103 && register.openGaps?.requiredPerTableAudit?.pendingTableCount === 0, 'register table audit counts drifted')
  check(register.openGaps?.relatedObjects?.functions?.acceptedRoutineCount === 162, 'register routine acceptance drifted')
  check(register.openGaps?.relatedObjects?.policies?.acceptedTableMappingCount === 103, 'register policy mapping acceptance drifted')
  check(register.openGaps?.relatedObjects?.triggers?.acceptedTableMappingCount === 103, 'register trigger mapping acceptance drifted')
  check(register.openGaps?.relatedObjects?.indexes?.acceptedPriorityCount === 205, 'register index priority acceptance drifted')

  check(!context.evidenceText.includes('sb_secret_') && !context.evidenceText.includes('postgresql://'), 'evidence contains a secret-like connection value')
  return failures
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

const evidence = readJson(evidencePath)
const register = readJson(registerPath)
const ledgerMarkdown = readFileSync(ledgerPath, 'utf8')
const migrationFiles = readdirSync(migrationsPath).filter((name) => name.endsWith('.sql')).sort()
const sqlTexts = [
  readFileSync(schemaPath, 'utf8'),
  ...migrationFiles.map((name) => readFileSync(resolve(migrationsPath, name), 'utf8')),
]
const sourceHashes = new Map()
for (const source of Object.values(evidence.sources ?? {})) {
  const path = resolve(repoRoot, source.path)
  sourceHashes.set(source.path, sha256File(path))
}
const context = {
  ledgerRows: parseLedger(ledgerMarkdown),
  localTableNames: discoverCreatedTables(sqlTexts),
  migrationCount: migrationFiles.length,
  sourceHashes,
  evidenceText: readFileSync(evidencePath, 'utf8'),
}

const failures = collectFailures(evidence, register, context)
if (failures.length) {
  console.error('P0_OBJECT_CLASSIFICATION_FREEZE_DRIFT')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

const selfTests = [
  ['missing-table', (copy) => copy.tableClassifications.pop()],
  ['duplicate-table', (copy) => { copy.tableClassifications[1].tableName = copy.tableClassifications[0].tableName }],
  ['wrong-classification', (copy) => { copy.tableClassifications[0].classification = 'read_only' }],
  ['false-table-acceptance', (copy) => { copy.tableClassifications[0].acceptanceStatus = 'candidate_unaccepted' }],
  ['missing-routine', (copy) => copy.routineClassifications.pop()],
  ['false-routine-fingerprint', (copy) => { copy.routineClassifications[0].bodyDependencyEvidence.productionFingerprintMatched = false }],
  ['hidden-zero-policy-decision', (copy) => { copy.tableClassifications.find((entry) => entry.tableName === 'crm_lead_conversions').policies.decision = 'unknown' }],
  ['false-g0', (copy) => { copy.g0Contribution.g0OverallClaim = true }],
  ['source-hash-drift', (copy) => { copy.sources.ledger.sha256 = '0'.repeat(64) }],
  ['hidden-index-risk', (copy) => { copy.counts.unindexedForeignKeys = 0 }],
]

for (const [name, mutate] of selfTests) {
  const changed = clone(evidence)
  mutate(changed)
  if (collectFailures(changed, register, context).length === 0) {
    console.error(`P0_OBJECT_CLASSIFICATION_FREEZE_SELFTEST_FAILED case=${name}`)
    process.exit(1)
  }
}

console.log(`P0_OBJECT_CLASSIFICATION_FREEZE_SELFTEST_OK cases=${selfTests.length}`)
console.log(
  'P0_OBJECT_CLASSIFICATION_FREEZE_OK tables=103 retain=47 extend=37 readOnly=17 retirementCandidate=2' +
  ' accepted=103 routines=162 routineAccepted=162 policies=229 triggers=29 zeroPolicyRpcOnly=3' +
  ' unindexedPriority=205 g0=false databaseCalls=0',
)
