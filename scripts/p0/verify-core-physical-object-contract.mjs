import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contractPath = resolve(repoRoot, 'scripts', 'p0', 'core-physical-object-contract.json')
const businessPath = resolve(repoRoot, 'scripts', 'p0', 'core-business-contract.json')
const classificationPath = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'public-object-classification-freeze.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const contract = readJson(contractPath)
const business = readJson(businessPath)
const classification = readJson(classificationPath)
const clone = (value) => structuredClone(value)
const exactSet = (actual, expected) =>
  Array.isArray(actual) && actual.length === new Set(actual).size &&
  JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
const isSnakeCase = (value) => typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value)

const expectedLogicalEntities = [
  'company', 'member_role', 'responsibility_route', 'settlement_customer', 'brand', 'store',
  'contact_store_relationship', 'store_product_subscription', 'catalog_version', 'quote_snapshot',
  'order_line_store_allocation', 'fulfillment_unit', 'inventory_ledger', 'customer_funds_event',
  'internal_funds_event', 'sales_profit_event', 'labor_earning_event', 'work_item', 'schedule_event',
  'case_candidate', 'case_public_projection', 'case_image_slot',
]
const expectedExtensions = [
  'profile_access_roles', 'crm_brands', 'customer_product_subscriptions', 'deal_catalog_items',
  'deal_quote_lines', 'tasks', 'calendar_events',
]
const expectedNewTables = [
  'crm_settlement_customers', 'crm_contact_store_links', 'customer_product_subscription_terms',
  'deal_order_line_store_allocations', 'fulfillment_units', 'sales_profit_events',
  'labor_earning_events', 'case_candidates', 'case_display_authorizations',
  'case_publications', 'case_media_assets',
]
const expectedDictionaries = {
  primary_role_id: ['sales', 'implementation', 'operations', 'finance', 'admin'],
  additional_function_id: ['warehouse', 'supervisor'],
  role_assignment_kind: ['primary', 'additional_function'],
  settlement_customer_status: ['active', 'inactive', 'archived'],
  product_item_type: ['software', 'hardware', 'service'],
  work_item_status: ['pending', 'in_progress', 'waiting_other', 'completed', 'cancelled'],
  work_item_kind: ['reminder', 'business_action'],
  schedule_event_kind: ['meeting', 'visit', 'rest', 'other'],
  subscription_expiry_state: ['known', 'unknown'],
  fulfillment_unit_status: ['pending', 'ready', 'in_progress', 'accepted', 'cancelled'],
  money_event_type: ['accrual', 'reversal', 'adjustment'],
  case_candidate_status: ['internal_candidate', 'pending_review', 'approved', 'archived'],
  case_authorization_action: ['grant', 'revoke'],
  case_publication_status: ['draft', 'published', 'withdrawn', 'archived'],
  case_media_slot: ['logo', 'miniprogram_code'],
  case_media_status: ['private_draft', 'published', 'withdrawn'],
}
const expectedInvariantIds = Array.from({ length: 12 }, (_, index) => `INV-${String(index + 1).padStart(2, '0')}`)

function validate(candidate) {
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const counts = candidate.expectedCounts ?? {}
  const entities = candidate.entityMappings ?? []
  const extensions = candidate.existingTableExtensions ?? []
  const newTables = candidate.newTables ?? []
  const dictionaries = candidate.dictionaries ?? []
  const invariants = candidate.invariantBindings ?? []
  const liveExistingTables = new Set(classification.tableClassifications.map((entry) => entry.tableName))
  const classificationByTable = new Map(classification.tableClassifications.map((entry) => [entry.tableName, entry.classification]))
  const proposedNewTables = new Set(newTables.map((entry) => entry.table))
  const dictionaryIds = new Set(dictionaries.map((entry) => entry.id))

  check(candidate.schemaVersion === 1, 'schema version must be 1')
  check(candidate.manifestType === 'canwin-team-os-core-physical-objects', 'manifest type drift')
  check(candidate.contractStatus === 'p0_supervisor_frozen_runtime_not_implemented', 'contract status drift')
  check(classification.status === 'accepted_supervisor_frozen', '103-table classification is not supervisor frozen')
  check(classification.tableClassifications.length === 103, 'classification does not contain 103 tables')
  check(business.status?.physicalTableNames === 'p0-supervisor-frozen', 'core business physical table status is not frozen')
  check(business.status?.physicalEnumNames === 'p0-supervisor-frozen', 'core business dictionary status is not frozen')

  check(counts.logicalEntities === expectedLogicalEntities.length, 'logical entity expected count drift')
  check(counts.existingTableExtensions === expectedExtensions.length, 'extension expected count drift')
  check(counts.newTables === expectedNewTables.length, 'new table expected count drift')
  check(counts.dictionaries === Object.keys(expectedDictionaries).length, 'dictionary expected count drift')
  check(counts.invariantBindings === expectedInvariantIds.length, 'invariant expected count drift')
  check(entities.length === counts.logicalEntities, 'logical entity actual count drift')
  check(extensions.length === counts.existingTableExtensions, 'extension actual count drift')
  check(newTables.length === counts.newTables, 'new table actual count drift')
  check(dictionaries.length === counts.dictionaries, 'dictionary actual count drift')
  check(invariants.length === counts.invariantBindings, 'invariant actual count drift')

  check(exactSet(entities.map((entry) => entry.logicalEntity), expectedLogicalEntities), 'logical entity set drift')
  check(exactSet(extensions.map((entry) => entry.table), expectedExtensions), 'extension table set drift')
  check(exactSet(newTables.map((entry) => entry.table), expectedNewTables), 'new table set drift')
  check(exactSet(dictionaries.map((entry) => entry.id), Object.keys(expectedDictionaries)), 'dictionary id set drift')
  check(exactSet(invariants.map((entry) => entry.id), expectedInvariantIds), 'invariant id set drift')

  for (const [dictionaryId, expectedValues] of Object.entries(expectedDictionaries)) {
    const dictionary = dictionaries.find((entry) => entry.id === dictionaryId)
    check(dictionary?.storage === 'text_check_dictionary', `${dictionaryId} must use text_check_dictionary`)
    check(exactSet(dictionary?.values, expectedValues), `${dictionaryId} values drift`)
  }

  for (const entity of entities) {
    check(isSnakeCase(entity.logicalEntity), `invalid logical entity name ${entity.logicalEntity}`)
    check(Array.isArray(entity.physicalTables) && entity.physicalTables.length > 0, `${entity.logicalEntity} has no physical tables`)
    check(Boolean(entity.grain?.trim()), `${entity.logicalEntity} has no grain`)
    for (const table of entity.physicalTables ?? []) {
      check(isSnakeCase(table), `invalid table name ${table}`)
      check(liveExistingTables.has(table) || proposedNewTables.has(table), `${entity.logicalEntity} references unknown table ${table}`)
      check(classificationByTable.get(table) !== 'retirement_candidate', `${entity.logicalEntity} references retirement candidate ${table}`)
    }
  }

  for (const extension of extensions) {
    check(liveExistingTables.has(extension.table), `extension targets non-existing table ${extension.table}`)
    check(['retain', 'extend'].includes(classificationByTable.get(extension.table)), `extension targets unsafe classification ${extension.table}`)
    check(Array.isArray(extension.addColumns) && extension.addColumns.length > 0, `${extension.table} has no added columns`)
    check(exactSet(extension.addColumns.map((column) => column.name), extension.addColumns.map((column) => column.name)), `${extension.table} has duplicate column names`)
    for (const column of extension.addColumns ?? []) {
      check(isSnakeCase(column.name), `${extension.table} has invalid column ${column.name}`)
      if (column.dictionary) check(dictionaryIds.has(column.dictionary), `${extension.table}.${column.name} references unknown dictionary ${column.dictionary}`)
    }
    check(Boolean(extension.compatibility?.trim()), `${extension.table} has no compatibility rule`)
  }

  const referencedPhysicalTables = new Set(entities.flatMap((entry) => entry.physicalTables ?? []))
  for (const table of newTables) {
    check(isSnakeCase(table.table), `invalid new table name ${table.table}`)
    check(!liveExistingTables.has(table.table), `new table collides with accepted inventory ${table.table}`)
    check(referencedPhysicalTables.has(table.table), `new table is orphaned ${table.table}`)
    check(Boolean(table.grain?.trim()), `${table.table} has no grain`)
    check(Array.isArray(table.columns) && table.columns.length >= 5, `${table.table} has too few frozen columns`)
    check(exactSet(table.columns, table.columns), `${table.table} has duplicate columns`)
    check(table.columns?.includes('id'), `${table.table} is missing id`)
    check(table.columns?.includes('team_id'), `${table.table} is missing team_id`)
    check(table.columns?.includes('created_at'), `${table.table} is missing created_at`)
    for (const column of table.columns ?? []) check(isSnakeCase(column), `${table.table} has invalid column ${column}`)
    for (const [column, dictionary] of Object.entries(table.dictionaryBindings ?? {})) {
      check(table.columns?.includes(column), `${table.table} dictionary binding references unknown column ${column}`)
      check(dictionaryIds.has(dictionary), `${table.table}.${column} references unknown dictionary ${dictionary}`)
    }
    check(Array.isArray(table.constraints) && table.constraints.length >= 2, `${table.table} has insufficient constraints`)
  }

  for (const invariant of invariants) {
    check(Boolean(invariant.rule?.trim()), `${invariant.id} has no rule`)
    check(Array.isArray(invariant.objects) && invariant.objects.length > 0, `${invariant.id} has no objects`)
    for (const table of invariant.objects ?? []) {
      check(liveExistingTables.has(table) || proposedNewTables.has(table), `${invariant.id} references unknown table ${table}`)
    }
  }

  const safety = candidate.safetyBoundary ?? {}
  check(safety.additiveMigrationsOnly === true, 'additive-only safety boundary drift')
  check(safety.renameExistingTable === false, 'existing table rename must remain false')
  check(safety.dropExistingTable === false, 'existing table drop must remain false')
  check(safety.rewriteHistoricalMigration === false, 'historical migration rewrite must remain false')
  check(safety.bulkRewriteHistoricalRows === false, 'historical bulk rewrite must remain false')
  check(safety.productionWritePerformed === false, 'production write must remain false')
  check(safety.implementationAuthorizedByThisContract === false, 'contract must not self-authorize implementation')

  const security = candidate.securityRequirements ?? {}
  check(security.rlsForEveryNewOrExtendedExposedTable === true, 'RLS requirement missing')
  check(security.explicitGrantsForEveryNewOrExtendedExposedTable === true, 'explicit grants requirement missing')
  check(security.migrationBundlesTableRlsGrantAndPolicy === true, 'table security must ship in one migration')
  check(security.anonymousBusinessAccess === 'deny', 'anonymous business access must be denied')
  check(security.defaultClientWrites === 'deny_unless_named_transaction_rpc', 'default client-write rule drift')
  check(security.sensitiveWrites === 'idempotent_transaction_rpc', 'sensitive-write transaction rule drift')
  check(security.securityDefinerSchema === 'private', 'security-definer functions must be non-exposed')
  check(security.revokePublicExecute === true, 'PUBLIC execute revocation missing')
  check(security.clientMayContainServiceRole === false, 'service role must never reach the client')

  const indexes = candidate.indexRequirements ?? {}
  check(indexes.everyForeignKeyReviewed === true, 'foreign-key index review missing')
  check(indexes.commonScopeAndStatusFiltersIndexed === true, 'scope/status index requirement missing')
  check(indexes.expiryAndWorkQueueOrderingIndexed === true, 'expiry/work queue index requirement missing')
  check(indexes.partialUniqueInvariantsIndexed === true, 'partial unique invariant index requirement missing')
  check(indexes.queryPlanRequiredBeforeFinalIndexAcceptance === true, 'query plan gate missing')

  const status = candidate.status ?? {}
  check(status.existing103TableMapping === 'supervisor_frozen', 'existing mapping status drift')
  check(status.newPhysicalTableNames === 'supervisor_frozen', 'new table names are not frozen')
  check(status.newPhysicalFieldNames === 'supervisor_frozen', 'new field names are not frozen')
  check(status.dictionaryNamesAndValues === 'supervisor_frozen', 'dictionary names are not frozen')
  check(status.migrationSql === 'not_started', 'migration SQL must remain not started at P0')
  check(status.isolatedRuntimeValidation === 'pending', 'runtime validation must remain pending')

  const boundary = candidate.acceptanceBoundary ?? {}
  check(boundary.p0PhysicalNamingAccepted === true, 'P0 physical naming acceptance missing')
  check(boundary.databaseImplementationComplete === false, 'database implementation must remain incomplete')
  check(boundary.runtimeAccepted === false, 'runtime acceptance must remain false')
  check(boundary.g0OverallClaim === false, 'G0 must not be claimed')
  check(boundary.productionMigrationAuthorized === false, 'production migration must remain unauthorized')
  return failures
}

const baselineFailures = validate(contract)
const negativeCases = [
  ['destructive rename', (value) => { value.safetyBoundary.renameExistingTable = true }],
  ['new table collision', (value) => { value.newTables[0].table = 'profiles' }],
  ['missing logical entity', (value) => { value.entityMappings.pop() }],
  ['duplicate extension', (value) => { value.existingTableExtensions[1].table = value.existingTableExtensions[0].table }],
  ['role dictionary drift', (value) => { value.dictionaries.find((entry) => entry.id === 'primary_role_id').values.push('captain') }],
  ['missing required id', (value) => { value.newTables[0].columns = value.newTables[0].columns.filter((name) => name !== 'id') }],
  ['orphan new table', (value) => { value.entityMappings = value.entityMappings.map((entry) => ({ ...entry, physicalTables: entry.physicalTables.filter((name) => name !== 'case_media_assets') })) }],
  ['runtime falsely accepted', (value) => { value.acceptanceBoundary.runtimeAccepted = true }],
  ['G0 falsely claimed', (value) => { value.acceptanceBoundary.g0OverallClaim = true }],
  ['migration falsely started', (value) => { value.status.migrationSql = 'implemented' }],
  ['unknown invariant object', (value) => { value.invariantBindings[0].objects = ['unknown_table'] }],
  ['RLS disabled', (value) => { value.securityRequirements.rlsForEveryNewOrExtendedExposedTable = false }],
  ['query plan skipped', (value) => { value.indexRequirements.queryPlanRequiredBeforeFinalIndexAcceptance = false }],
]
let negativePassed = 0
for (const [name, mutate] of negativeCases) {
  const candidate = clone(contract)
  mutate(candidate)
  if (validate(candidate).length > 0) negativePassed += 1
  else baselineFailures.push(`negative self-test did not fail: ${name}`)
}

if (baselineFailures.length > 0) {
  console.error('P0_CORE_PHYSICAL_OBJECT_CONTRACT_DRIFT')
  for (const failure of baselineFailures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `P0_CORE_PHYSICAL_OBJECT_CONTRACT_OK existing=103 logical=${contract.entityMappings.length} extensions=${contract.existingTableExtensions.length} newTables=${contract.newTables.length} dictionaries=${contract.dictionaries.length} invariants=${contract.invariantBindings.length} negative=${negativePassed}/${negativeCases.length} productionWrites=0 runtimeAccepted=false`,
)
