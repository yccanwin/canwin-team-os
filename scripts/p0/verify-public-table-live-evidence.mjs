import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const evidencePath = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'public-table-live-evidence.json')
const registerPath = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'public-table-classification-register.json')
const expectedProjectRef = 'agygfhmkazcbqaqwmljb'
const expectedZeroPolicyTables = [
  'crm_lead_conversions',
  'deal_catalog_version_requests',
  'deal_package_admin_requests',
]
const validPrivileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
const validClientRoles = ['anon', 'authenticated', 'service_role']

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function exactSet(actual, expected) {
  return Array.isArray(actual) && actual.length === new Set(actual).size &&
    JSON.stringify(sortedUnique(actual)) === JSON.stringify(sortedUnique(expected))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function collectFailures(evidence, register) {
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }

  check(evidence.schemaVersion === 1, 'Unsupported evidence schemaVersion.')
  check(evidence.evidenceType === 'production-readonly-public-table-catalog', 'Evidence type drifted.')
  check(evidence.projectRef === expectedProjectRef, 'Production project ref drifted.')
  check(Number.isInteger(evidence.serverVersionNum) && evidence.serverVersionNum >= 170000, 'Evidence must come from PostgreSQL 17 or later.')
  check(Number.isFinite(Date.parse(evidence.capturedAtUtc)), 'Evidence capture time must be ISO-compatible.')
  check(evidence.readOnly === true, 'Evidence must remain read-only.')
  check(evidence.writePerformed === false, 'Evidence must prove no write was performed.')
  check(evidence.businessRowsRead === false, 'Evidence must not read business row values.')
  check(evidence.acceptanceStatus === 'candidate_unaccepted', 'Evidence must remain candidate_unaccepted.')
  check(evidence.supervisorAccepted === false, 'Evidence must not claim supervisor acceptance.')
  check(exactSet(evidence.omissions, [
    'business row values',
    'exact count(*) scans',
    'function bodies',
    'policy expressions',
    'secrets and runtime configuration',
  ]), 'Evidence omissions drifted.')

  const counts = evidence.counts ?? {}
  const expectedCounts = {
    tables: 103,
    rlsEnabled: 103,
    explicitAclEntries: 2652,
    effectiveClientGrantEntries: 1532,
    policies: 229,
    triggerObjects: 29,
    indexes: 248,
    outgoingForeignKeys: 309,
  }
  check(
    JSON.stringify(Object.keys(counts).sort()) === JSON.stringify(Object.keys(expectedCounts).sort()),
    'Evidence count fields drifted.',
  )
  for (const [field, value] of Object.entries(expectedCounts)) {
    check(counts[field] === value, `Evidence count ${field} expected ${value}, got ${counts[field]}.`)
  }

  const tables = evidence.tables
  check(Array.isArray(tables) && tables.length === 103, 'Evidence must contain 103 table entries.')
  if (!Array.isArray(tables)) return failures
  const tableNames = tables.map((table) => table.tableName)
  check(tableNames.length === new Set(tableNames).size, 'Evidence contains duplicate table names.')
  check(JSON.stringify(tableNames) === JSON.stringify([...tableNames].sort((a, b) => a.localeCompare(b, 'en'))), 'Evidence tables must be sorted by name.')

  const classifiedNames = Object.values(register.classifications ?? {}).flat()
  check(exactSet(tableNames, classifiedNames), 'Live evidence table set differs from the four-way register.')

  let explicitAclEntries = 0
  let effectiveClientGrantEntries = 0
  let policies = 0
  let triggerObjects = 0
  let indexes = 0
  let outgoingForeignKeys = 0
  const zeroPolicyTables = []
  const tablesWithoutAuthenticated = []
  const tablesWithoutAnon = []
  const tablesWithoutServiceRole = []

  for (const table of tables) {
    check(typeof table.tableName === 'string' && table.tableName.length > 0, 'A table entry has no tableName.')
    check(typeof table.owner === 'string' && table.owner.length > 0, `Table ${table.tableName} has no owner.`)
    check(Number.isInteger(table.estimatedRows) && table.estimatedRows >= 0, `Table ${table.tableName} has an invalid row estimate.`)
    check(isObject(table.rls) && table.rls.enabled === true && typeof table.rls.forced === 'boolean', `Table ${table.tableName} must have RLS enabled with explicit force state.`)

    for (const field of [
      'explicitAcl', 'effectiveClientGrants', 'policies', 'triggers', 'indexes',
      'outgoingForeignKeys', 'incomingForeignKeys', 'dependentViews', 'catalogRoutineDependencies',
    ]) {
      check(Array.isArray(table[field]), `Table ${table.tableName} field ${field} must be an array.`)
    }
    if (![table.explicitAcl, table.effectiveClientGrants, table.policies, table.triggers, table.indexes, table.outgoingForeignKeys].every(Array.isArray)) continue

    explicitAclEntries += table.explicitAcl.length
    effectiveClientGrantEntries += table.effectiveClientGrants.length
    policies += table.policies.length
    triggerObjects += table.triggers.length
    indexes += table.indexes.length
    outgoingForeignKeys += table.outgoingForeignKeys.length
    if (table.policies.length === 0) zeroPolicyTables.push(table.tableName)

    for (const grant of table.effectiveClientGrants) {
      check(validClientRoles.includes(grant.role), `Table ${table.tableName} has unexpected effective role ${grant.role}.`)
      check(validPrivileges.includes(grant.privilege), `Table ${table.tableName} has unexpected privilege ${grant.privilege}.`)
    }
    const grantedRoles = new Set(table.effectiveClientGrants.map((grant) => grant.role))
    if (!grantedRoles.has('authenticated')) tablesWithoutAuthenticated.push(table.tableName)
    if (!grantedRoles.has('anon')) tablesWithoutAnon.push(table.tableName)
    if (!grantedRoles.has('service_role')) tablesWithoutServiceRole.push(table.tableName)

    for (const policy of table.policies) {
      check(typeof policy.name === 'string' && policy.name.length > 0, `Table ${table.tableName} has an unnamed policy.`)
      check(['permissive', 'restrictive'].includes(policy.mode), `Table ${table.tableName} has an invalid policy mode.`)
      check(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL'].includes(policy.command), `Table ${table.tableName} has an invalid policy command.`)
      check(Array.isArray(policy.roles) && policy.roles.length > 0, `Table ${table.tableName} has a policy without target roles.`)
      check(typeof policy.hasUsing === 'boolean' && typeof policy.hasCheck === 'boolean', `Table ${table.tableName} policy shape is incomplete.`)
      check(!('expression' in policy) && !('qual' in policy) && !('withCheckExpression' in policy), `Table ${table.tableName} must not embed policy expressions.`)
    }
    for (const trigger of table.triggers) {
      check(typeof trigger.name === 'string' && typeof trigger.functionName === 'string', `Table ${table.tableName} has incomplete trigger evidence.`)
      check(!('functionBody' in trigger), `Table ${table.tableName} must not embed trigger function bodies.`)
    }
    for (const index of table.indexes) {
      check(typeof index.name === 'string', `Table ${table.tableName} has an unnamed index.`)
      check(index.valid === true && index.ready === true && index.live === true, `Table ${table.tableName} has an invalid, unready or dead index ${index.name}.`)
    }
  }

  check(explicitAclEntries === counts.explicitAclEntries, 'Expanded ACL count does not reconcile.')
  check(effectiveClientGrantEntries === counts.effectiveClientGrantEntries, 'Effective client grant count does not reconcile.')
  check(policies === counts.policies, 'Policy count does not reconcile.')
  check(triggerObjects === counts.triggerObjects, 'Trigger count does not reconcile.')
  check(indexes === counts.indexes, 'Index count does not reconcile.')
  check(outgoingForeignKeys === counts.outgoingForeignKeys, 'Foreign-key count does not reconcile.')
  check(exactSet(zeroPolicyTables, expectedZeroPolicyTables), 'Zero-policy table set drifted.')
  check(exactSet(tablesWithoutAuthenticated, ['fulfillment_inventory_operations']), 'Authenticated table-grant boundary drifted.')
  check(tablesWithoutAnon.length === 11, `Expected 11 tables without anon grants, got ${tablesWithoutAnon.length}.`)
  check(tablesWithoutServiceRole.length === 0, 'Every table must retain service_role access in this snapshot.')

  const serialized = JSON.stringify(evidence)
  const forbiddenPatterns = [
    /eyJhbGciOi[A-Za-z0-9_-]{8,}/,
    /sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/,
    /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=/i,
  ]
  check(forbiddenPatterns.every((pattern) => !pattern.test(serialized)), 'Live evidence contains a forbidden sensitive value.')
  return failures
}

const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
const register = JSON.parse(readFileSync(registerPath, 'utf8'))
const failures = collectFailures(evidence, register)
if (failures.length) {
  console.error('P0_PUBLIC_TABLE_LIVE_EVIDENCE_DRIFT')
  for (const failure of failures) console.error('- ' + failure)
  process.exit(1)
}

const selfTests = [
  ['missing-table', (copy) => copy.tables.pop()],
  ['rls-disabled', (copy) => { copy.tables[0].rls.enabled = false }],
  ['false-acceptance', (copy) => { copy.supervisorAccepted = true }],
  ['business-row-read', (copy) => { copy.businessRowsRead = true }],
  ['policy-count-drift', (copy) => { copy.counts.policies -= 1 }],
  ['zero-policy-drift', (copy) => { copy.tables.find((table) => table.tableName === 'teams').policies = [] }],
  ['unexpected-role', (copy) => { copy.tables[0].effectiveClientGrants[0].role = 'owner' }],
  ['secret-value', (copy) => { copy.tables[0].owner = 'sb_secret_forbidden12345678' }],
]
for (const [name, mutate] of selfTests) {
  const copy = clone(evidence)
  mutate(copy)
  if (collectFailures(copy, register).length === 0) {
    console.error('P0_PUBLIC_TABLE_LIVE_EVIDENCE_SELFTEST_FAILED case=' + name)
    process.exit(1)
  }
}

console.log('P0_PUBLIC_TABLE_LIVE_EVIDENCE_SELFTEST_OK cases=' + selfTests.length)
console.log(
  'P0_PUBLIC_TABLE_LIVE_EVIDENCE_OK tables=103 rls=103 policies=229 triggers=29 indexes=248 ' +
    'outgoingFks=309 candidate=103 accepted=0 businessRowsRead=0 writes=0',
)
console.log(
  'P0_PUBLIC_TABLE_LIVE_EVIDENCE_GAPS_OPEN ' +
    'frontendFunctionEntrypoints=103 exactRowCounts=103 functionBodyDependencies=103 indexRiskDecisions=103 supervisorFreeze=103',
)
