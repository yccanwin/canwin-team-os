import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const registerPath = resolve(repoRoot, 'docs/team-os-4.0/p0/public-table-classification-register.json')
const ledgerPath = resolve(repoRoot, 'docs/team-os-4.0/p0/01-database-object-classification.md')
const catalogQueryPath = resolve(repoRoot, 'scripts/p0/catalog-snapshot.sql')
const schemaPath = resolve(repoRoot, 'supabase/schema.sql')
const migrationsPath = resolve(repoRoot, 'supabase/migrations')

const classificationMap = new Map([
  ['保留', 'retain'],
  ['扩展', 'extend'],
  ['只读', 'read_only'],
  ['淘汰候选', 'retirement_candidate'],
])

const expectedClassificationCounts = {
  retain: 47,
  extend: 37,
  read_only: 17,
  retirement_candidate: 2,
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function compareExactSet(failures, label, actualValues, expectedValues) {
  const actual = sortedUnique(actualValues)
  const expected = sortedUnique(expectedValues)
  const missing = expected.filter((value) => !actual.includes(value))
  const unexpected = actual.filter((value) => !expected.includes(value))
  if (missing.length || unexpected.length) {
    failures.push(`${label} mismatch: missing=[${missing.join(', ')}] unexpected=[${unexpected.join(', ')}]`)
  }
}

function parseLedger(markdown) {
  const rows = []
  const rowPattern = /^\|\s*(\d+)\s*\|\s*`([a-z_][a-z0-9_]*)`\s*\|\s*([^|]+?)\s*\|\s*(保留|扩展|只读|淘汰候选)\s*\|/u
  for (const line of markdown.split(/\r?\n/u)) {
    const match = line.match(rowPattern)
    if (!match) continue
    rows.push({
      ordinal: Number(match[1]),
      name: match[2],
      module: match[3].trim(),
      candidateClassification: classificationMap.get(match[4]),
    })
  }
  return rows
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/--[^\r\n]*(?=\r?$)/gmu, '')
}

function discoverCreatedTables(sqlTexts) {
  const names = []
  const createPattern = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/giu
  for (const sql of sqlTexts) {
    for (const match of stripSqlComments(sql).matchAll(createPattern)) names.push(match[1])
  }
  return sortedUnique(names)
}

function flattenedClassifications(register) {
  return Object.entries(register.classifications ?? {}).flatMap(([classification, names]) =>
    (Array.isArray(names) ? names : []).map((name) => ({ name, classification })),
  )
}

function collectFailures(register, context) {
  const failures = []
  const fail = (condition, message) => {
    if (!condition) failures.push(message)
  }

  const expectedSources = {
    humanLedger: 'docs/team-os-4.0/p0/01-database-object-classification.md',
    catalogSnapshotQuery: 'scripts/p0/catalog-snapshot.sql',
    catalogSnapshotRunbook: 'docs/team-os-4.0/p0/backend-catalog-snapshot-runbook.md',
    livePerTableEvidenceSql: 'scripts/p0/public-table-live-evidence.sql',
    livePerTableEvidence: 'docs/team-os-4.0/p0/public-table-live-evidence.json',
    localSchema: 'supabase/schema.sql',
    localMigrations: 'supabase/migrations',
  }
  const expectedCatalogCounts = {
    publicTables: 103,
    publicViews: 11,
    publicRoutines: 162,
    publicPolicies: 229,
    publicIndexes: 248,
    publicTriggerObjects: 29,
    publicTriggerEventRows: 46,
    appliedMigrations: 69,
  }

  fail(register.schemaVersion === 1, `Unsupported schemaVersion ${register.schemaVersion}.`)
  fail(register.registerStatus === 'candidate_unaccepted', 'Register must remain candidate_unaccepted.')
  fail(register.g0?.status === 'not_achieved' && register.g0?.claim === false, 'Register must not claim G0.')
  fail(register.catalogSnapshot?.status === 'recorded_readonly_not_freeze_accepted', 'Catalog snapshot status must remain read-only and unaccepted.')
  fail(register.catalogSnapshot?.freezeAccepted === false, 'Catalog snapshot must not claim freeze acceptance.')
  fail(register.catalogSnapshot?.rawArtifactInRepository === false, 'Register must not imply the controlled raw catalog artifact is in the repository.')
  for (const [key, expected] of Object.entries(expectedSources)) {
    fail(register.sources?.[key] === expected, `Source ${key} must remain ${expected}.`)
  }
  for (const [key, expected] of Object.entries(expectedCatalogCounts)) {
    fail(register.catalogSnapshot?.counts?.[key] === expected, `Catalog count ${key} expected ${expected}, got ${register.catalogSnapshot?.counts?.[key]}.`)
  }

  const liveEvidence = register.livePerTableEvidence ?? {}
  fail(liveEvidence.status === 'candidate_captured_unaccepted', 'Live per-table evidence must remain a candidate.')
  fail(liveEvidence.projectRef === 'agygfhmkazcbqaqwmljb', 'Live evidence project ref drifted.')
  fail(Number.isFinite(Date.parse(liveEvidence.capturedAtUtc)), 'Live evidence capture time must be ISO-compatible.')
  fail(liveEvidence.metadataOnly === true && liveEvidence.businessRowsRead === false && liveEvidence.writePerformed === false, 'Live evidence must remain metadata-only and write-free.')
  fail(liveEvidence.candidateTableCount === 103 && liveEvidence.supervisorAcceptedTableCount === 0, 'Live evidence must remain 103 candidate / 0 accepted.')
  compareExactSet(
    failures,
    'live evidence field coverage',
    liveEvidence.fieldCoverage ?? [],
    ['tableName', 'owner', 'estimatedRows', 'rls', 'grants', 'policies', 'triggers', 'indexes', 'foreignKeys', 'dependentViews', 'catalogRoutineDependencies'],
  )
  compareExactSet(
    failures,
    'remaining per-table evidence',
    liveEvidence.remainingPerTableEvidence ?? [],
    ['frontendFunctionReadWriteEntrypoints', 'exactRowCountWhereRequired', 'functionBodyDependencies', 'indexRiskDecision', 'classificationCrossReview', 'supervisorFreezeAcceptance'],
  )

  const counts = register.expectedCounts ?? {}
  fail(counts.publicTables === 103, `Expected publicTables=103, got ${counts.publicTables}.`)
  fail(counts.retain === 47 && counts.extend === 37 && counts.readOnly === 17 && counts.retirementCandidate === 2, 'Expected classification counts drifted.')
  fail(counts.candidate === 103 && counts.accepted === 0, 'Candidate/accepted counts must remain 103/0.')

  const acceptance = register.classificationAcceptance ?? {}
  fail(acceptance.status === 'candidate_unaccepted', 'Classification acceptance status must remain candidate_unaccepted.')
  fail(acceptance.appliesTo === 'all_manifest_tables', 'Classification status must cover all manifest tables.')
  fail(acceptance.candidateTableCount === 103 && acceptance.acceptedTableCount === 0, 'Classification acceptance counts must remain 103/0.')
  fail(Array.isArray(acceptance.acceptedTableNames) && acceptance.acceptedTableNames.length === 0, 'No table may be marked accepted.')
  fail(Array.isArray(acceptance.acceptanceEvidence) && acceptance.acceptanceEvidence.length === 0, 'No freeze evidence is accepted yet.')

  const flattened = flattenedClassifications(register)
  const manifestNames = flattened.map((entry) => entry.name)
  fail(flattened.length === 103, `Expected 103 classified entries, got ${flattened.length}.`)
  fail(new Set(manifestNames).size === manifestNames.length, 'Classification lists contain duplicate table names.')

  for (const [classification, expectedCount] of Object.entries(expectedClassificationCounts)) {
    const names = register.classifications?.[classification]
    fail(Array.isArray(names), `Classification ${classification} must be an array.`)
    fail(Array.isArray(names) && names.length === expectedCount, `Classification ${classification} expected ${expectedCount}, got ${names?.length}.`)
  }

  compareExactSet(failures, 'register vs 01 ledger table set', manifestNames, context.ledgerRows.map((row) => row.name))
  compareExactSet(failures, 'register vs local SQL table set', manifestNames, context.localTableNames)
  fail(context.ledgerRows.length === 103, `01 ledger expected 103 rows, got ${context.ledgerRows.length}.`)
  fail(context.localTableNames.length === 103, `Local SQL expected 103 tables, got ${context.localTableNames.length}.`)
  fail(context.migrationCount === 69, `Local migration file count expected 69, got ${context.migrationCount}.`)
  fail(context.ledgerRows.every((row, index) => row.ordinal === index + 1), '01 ledger ordinals must be exactly 1..103.')

  const manifestClassByName = new Map(flattened.map((entry) => [entry.name, entry.classification]))
  for (const row of context.ledgerRows) {
    fail(manifestClassByName.get(row.name) === row.candidateClassification, `Classification drift for ${row.name}.`)
  }

  const audit = register.openGaps?.requiredPerTableAudit ?? {}
  fail(audit.status === 'partial_live_metadata_captured', 'Required per-table audit must record partial live metadata coverage.')
  fail(audit.completedTableCount === 0 && audit.pendingTableCount === 103, 'Required per-table audit counts must remain 0/103 complete/pending.')
  fail(Array.isArray(audit.requiredFields) && audit.requiredFields.length === 17, 'Required per-table audit must list all 17 fields from 01.')

  const related = register.openGaps?.relatedObjects ?? {}
  const functionGap = related.functions ?? {}
  fail(functionGap.status === 'catalog_dependency_candidate_function_body_audit_pending', 'Function gap status drifted.')
  fail(functionGap.scope === 'all_manifest_tables', 'Function gap must cover all manifest tables.')
  fail(functionGap.pendingTableCount === 103 && functionGap.candidateCatalogMappingCount === 103 && functionGap.acceptedTableMappingCount === 0, 'Function mapping counts must remain 103 pending / 103 catalog candidate / 0 accepted.')
  for (const kind of ['policies', 'triggers']) {
    const gap = related[kind] ?? {}
    fail(gap.status === 'candidate_mapped_unaccepted', `${kind} mapping must remain candidate_mapped_unaccepted.`)
    fail(gap.scope === 'all_manifest_tables', `${kind} mapping gap must explicitly cover all manifest tables.`)
    fail(gap.pendingTableCount === 0 && gap.candidateTableMappingCount === 103 && gap.acceptedTableMappingCount === 0, `${kind} mapping counts must remain 0 pending / 103 candidate / 0 accepted.`)
  }
  fail(related.functions?.catalogObjectCount === 162, 'Function catalog count must remain 162.')
  fail(related.policies?.catalogObjectCount === 229, 'Policy catalog count must remain 229.')
  fail(related.triggers?.catalogObjectCount === 29 && related.triggers?.catalogEventRowCount === 46, 'Trigger catalog counts must remain 29 objects / 46 event rows.')
  compareExactSet(
    failures,
    'known zero-policy decision-pending tables',
    related.policies?.knownZeroPolicyDecisionPendingTableNames ?? [],
    ['crm_lead_conversions', 'deal_catalog_version_requests', 'deal_package_admin_requests'],
  )

  for (const marker of [
    '> 状态：103/103 候选分类和逐表现网元数据取证完成，监理冻结未验收',
    '> 当前口径：表名发现 103/103；拟分类 103/103；逐表元数据 103/103；冻结验收 0/103。',
    '在这些字段未完成和交叉审查前，不得报告“103 张表四分类完成”。',
  ]) {
    fail(context.ledgerMarkdown.includes(marker), `01 candidate/unaccepted marker drifted: ${marker}`)
  }

  for (const marker of [
    "'summary_counts' as section",
    "'relations' as section",
    "'routines' as section",
    "'policies' as section",
    "'trigger_objects' as section",
  ]) {
    fail(context.catalogQuery.includes(marker), `Catalog snapshot query marker missing: ${marker}`)
  }

  return failures
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

const register = JSON.parse(await readFile(registerPath, 'utf8'))
const ledgerMarkdown = await readFile(ledgerPath, 'utf8')
const catalogQuery = await readFile(catalogQueryPath, 'utf8')
const migrationFiles = (await readdir(migrationsPath)).filter((name) => name.endsWith('.sql')).sort()
const sqlTexts = [
  await readFile(schemaPath, 'utf8'),
  ...await Promise.all(migrationFiles.map((name) => readFile(resolve(migrationsPath, name), 'utf8'))),
]
const context = {
  ledgerMarkdown,
  ledgerRows: parseLedger(ledgerMarkdown),
  catalogQuery,
  localTableNames: discoverCreatedTables(sqlTexts),
  migrationCount: migrationFiles.length,
}

const baseFailures = collectFailures(register, context)
if (baseFailures.length) {
  console.error('P0_TABLE_CLASSIFICATION_REGISTER_DRIFT')
  for (const failure of baseFailures) console.error(`- ${failure}`)
  process.exit(1)
}

const selfTests = [
  ['missing-table', (copy) => copy.classifications.retain.pop()],
  ['duplicate-table', (copy) => { copy.classifications.extend[0] = copy.classifications.retain[0] }],
  ['classification-drift', (copy) => { copy.classifications.read_only.push(copy.classifications.extend.pop()) }],
  ['false-acceptance', (copy) => { copy.classificationAcceptance.acceptedTableCount = 1; copy.classificationAcceptance.acceptedTableNames = ['teams'] }],
  ['false-g0', (copy) => { copy.g0.status = 'achieved'; copy.g0.claim = true }],
  ['hidden-function-gap', (copy) => { copy.openGaps.relatedObjects.functions.status = 'complete' }],
  ['false-live-acceptance', (copy) => { copy.livePerTableEvidence.supervisorAcceptedTableCount = 103 }],
  ['zero-policy-gap-drift', (copy) => { copy.openGaps.relatedObjects.policies.knownZeroPolicyDecisionPendingTableNames.pop() }],
]

for (const [name, mutate] of selfTests) {
  const changed = clone(register)
  mutate(changed)
  if (collectFailures(changed, context).length === 0) {
    console.error(`P0_TABLE_CLASSIFICATION_REGISTER_SELFTEST_FAILED case=${name}`)
    process.exit(1)
  }
}

console.log(`P0_TABLE_CLASSIFICATION_REGISTER_SELFTEST_OK cases=${selfTests.length}`)
console.log('P0_TABLE_CLASSIFICATION_REGISTER_OK tables=103 retain=47 extend=37 readOnly=17 retirementCandidate=2 candidate=103 accepted=0')
console.log('P0_TABLE_CLASSIFICATION_GAPS_OPEN requiredAudit=103 functions=103 policies=0 triggers=0 zeroPolicyDecisions=3 g0=false databaseCalls=0')
