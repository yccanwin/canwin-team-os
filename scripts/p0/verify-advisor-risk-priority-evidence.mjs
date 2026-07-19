import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const p0Root = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0')
const riskPath = resolve(p0Root, 'advisor-risk-priority-evidence.json')
const foreignKeyPath = resolve(p0Root, 'public-foreign-key-risk-live-evidence.json')
const routinePath = resolve(p0Root, 'public-routine-live-evidence.json')
const registerPath = resolve(p0Root, 'public-table-classification-register.json')

const expectedProjectRef = 'agygfhmkazcbqaqwmljb'
const expectedSecurityByLint = {
  auth_leaked_password_protection: 1,
  authenticated_security_definer_function_executable: 135,
  function_search_path_mutable: 1,
  rls_enabled_no_policy: 3,
  security_definer_view: 3,
}
const expectedPerformanceByLint = {
  auth_rls_initplan: 54,
  multiple_permissive_policies: 46,
  unindexed_foreign_keys: 205,
  unused_index: 10,
}
const expectedPriorityCounts = {
  'P1A-hot-chain': 137,
  'P1B-active-chain': 31,
  'P2-history-observation': 37,
}
const expectedAreaCounts = {
  access_identity: 16,
  crm_sales: 50,
  fulfillment_inventory: 23,
  import: 7,
  legacy_collaboration: 49,
  notification: 3,
  other: 7,
  performance_reconciliation: 18,
  quote_order_payment: 32,
}
const hotChainPattern = /^(access_|profile_|profiles$|team_|teams$|crm_|deal_|fulfillment_|order_performance_|official_reconciliation_|performance_|profit_)/u
const areaPatterns = [
  ['access_identity', /^(access_|profile_|profiles$|team_|teams$)/u],
  ['crm_sales', /^crm_/u],
  ['quote_order_payment', /^deal_/u],
  ['fulfillment_inventory', /^fulfillment_/u],
  ['performance_reconciliation', /^(order_performance_|official_reconciliation_|performance_|profit_)/u],
  ['notification', /^notification_/u],
  ['import', /^import_/u],
  ['legacy_collaboration', /^(achievement|announcement|asset|badge|calendar|finance_|goal_|inventory_|personal_|photo|sales_|skill|task|team_data|team_goal|timeline_|tool|user_skill|vote)/u],
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'))
}

function exactSet(actual, expected) {
  return Array.isArray(actual) && actual.length === new Set(actual).size &&
    JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected))
}

function exactObject(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

function countBy(values, field) {
  return Object.fromEntries(Object.entries(values.reduce((counts, value) => {
    const key = value[field]
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})).sort())
}

function tableClassMap(register) {
  const result = new Map()
  for (const [classification, names] of Object.entries(register.classifications ?? {})) {
    for (const name of names) result.set(name, classification)
  }
  return result
}

function expectedArea(tableName) {
  return areaPatterns.find(([, pattern]) => pattern.test(tableName))?.[0] ?? 'other'
}

function expectedPriority(tableName, classification) {
  if (classification === 'read_only' || classification === 'retirement_candidate') return 'P2-history-observation'
  return hotChainPattern.test(tableName) ? 'P1A-hot-chain' : 'P1B-active-chain'
}

function collectFailures(risk, foreignKeyEvidence, routineEvidence, register) {
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }

  check(risk.schemaVersion === 1, 'Unsupported risk-evidence schemaVersion.')
  check(risk.evidenceType === 'production-readonly-advisor-and-foreign-key-risk-priority', 'Risk evidence type drifted.')
  check(risk.projectRef === expectedProjectRef, 'Risk evidence project ref drifted.')
  check(Number.isFinite(Date.parse(risk.catalogCapturedAtUtc)) && Number.isFinite(Date.parse(risk.advisorAssembledAtUtc)), 'Risk evidence timestamps must be ISO-compatible.')
  check(risk.readOnly === true && risk.businessRowsRead === false && risk.writePerformed === false, 'Risk evidence must remain read-only and business-row-free.')
  check(risk.acceptanceStatus === 'candidate_unaccepted' && risk.supervisorAccepted === false, 'Risk evidence must remain unaccepted.')
  check(Array.isArray(risk.officialReferences) && risk.officialReferences.length === 4 && risk.officialReferences.every((url) => url.startsWith('https://supabase.com/')), 'Official Supabase reference set drifted.')
  check(Array.isArray(risk.limitations) && risk.limitations.length === 4, 'Risk-evidence limitations drifted.')

  const counts = risk.counts ?? {}
  check(counts.securityTotal === 143 && counts.performanceTotal === 315, 'Advisor totals must remain Security=143 / Performance=315.')
  check(counts.foreignKeys === 309 && counts.catalogCoveredForeignKeys === 104 && counts.advisorUnindexedForeignKeys === 205, 'Foreign-key totals must remain 309 / 104 covered / 205 unindexed.')
  check(exactObject(counts.securityByLint, expectedSecurityByLint), 'Security lint counts drifted.')
  check(exactObject(counts.performanceByLint, expectedPerformanceByLint), 'Performance lint counts drifted.')
  check(exactObject(counts.unindexedByPriority, expectedPriorityCounts), 'Unindexed priority counts drifted.')
  check(exactObject(counts.unindexedByBusinessArea, expectedAreaCounts), 'Unindexed business-area counts drifted.')

  const security = risk.securityFindings
  check(Array.isArray(security) && security.length === 143, 'Security evidence must contain 143 findings.')
  if (Array.isArray(security)) {
    check(exactObject(countBy(security, 'lint'), expectedSecurityByLint), 'Security finding array does not reconcile.')
    check(new Set(security.map((finding) => finding.cacheKey)).size === security.length, 'Security findings contain duplicate cache keys.')
    for (const finding of security) {
      check(finding.acceptanceStatus === 'candidate_unaccepted', `Security finding ${finding.cacheKey} must remain unaccepted.`)
      check(typeof finding.remediation === 'string' && finding.remediation.startsWith('https://supabase.com/'), `Security finding ${finding.cacheKey} has an invalid remediation URL.`)
    }

    const definerSignatures = security
      .filter((finding) => finding.lint === 'authenticated_security_definer_function_executable')
      .map((finding) => `${finding.object.name}(${finding.object.arguments})`)
    const expectedDefinerSignatures = routineEvidence.routines
      .filter((routine) => routine.securityDefiner && routine.effectiveExecuteRoles.includes('authenticated'))
      .map((routine) => routine.signature)
    check(exactSet(definerSignatures, expectedDefinerSignatures), 'Authenticated SECURITY DEFINER advisor signatures differ from live routine evidence.')
    check(exactSet(
      security.filter((finding) => finding.lint === 'security_definer_view').map((finding) => finding.object.name),
      ['assets_public', 'finance_public_summary', 'inventory_public_items'],
    ), 'Security-definer view set drifted.')
    check(exactSet(
      security.filter((finding) => finding.lint === 'rls_enabled_no_policy').map((finding) => finding.object.name),
      ['crm_lead_conversions', 'deal_catalog_version_requests', 'deal_package_admin_requests'],
    ), 'RLS-without-policy table set drifted.')
    check(exactSet(
      security.filter((finding) => finding.lint === 'function_search_path_mutable').map((finding) => finding.object.name),
      ['touch_updated_at'],
    ), 'Mutable search_path function set drifted.')
  }

  check(foreignKeyEvidence.evidenceType === 'production-readonly-public-foreign-key-catalog', 'Foreign-key evidence type drifted.')
  check(foreignKeyEvidence.projectRef === expectedProjectRef, 'Foreign-key evidence project ref drifted.')
  check(foreignKeyEvidence.readOnly === true && foreignKeyEvidence.businessRowsRead === false && foreignKeyEvidence.writePerformed === false, 'Foreign-key evidence must remain read-only and business-row-free.')
  check(foreignKeyEvidence.acceptanceStatus === 'candidate_unaccepted' && foreignKeyEvidence.supervisorAccepted === false, 'Foreign-key catalog evidence must remain unaccepted.')
  check(foreignKeyEvidence.counts?.foreignKeys === 309 && foreignKeyEvidence.counts?.catalogCovered === 104 && foreignKeyEvidence.counts?.catalogUncovered === 205 && foreignKeyEvidence.counts?.sourceTables === 100, 'Foreign-key catalog counts drifted.')
  const allForeignKeys = foreignKeyEvidence.foreignKeys
  check(Array.isArray(allForeignKeys) && allForeignKeys.length === 309, 'Foreign-key catalog evidence must contain 309 entries.')
  const foreignKeyByName = new Map()
  if (Array.isArray(allForeignKeys)) {
    for (const foreignKey of allForeignKeys) {
      const key = `${foreignKey.sourceTable}::${foreignKey.constraintName}`
      check(!foreignKeyByName.has(key), `Duplicate foreign-key key ${key}.`)
      foreignKeyByName.set(key, foreignKey)
      check(Array.isArray(foreignKey.sourceColumns) && foreignKey.sourceColumns.length > 0, `Foreign key ${key} has no source columns.`)
      check(Array.isArray(foreignKey.targetColumns) && foreignKey.targetColumns.length === foreignKey.sourceColumns.length, `Foreign key ${key} target columns do not reconcile.`)
      check(foreignKey.acceptanceStatus === 'candidate_unaccepted', `Foreign key ${key} must remain unaccepted.`)
    }
  }

  const unindexed = risk.unindexedForeignKeys
  check(Array.isArray(unindexed) && unindexed.length === 205, 'Risk evidence must contain 205 unindexed foreign keys.')
  const classes = tableClassMap(register)
  if (Array.isArray(unindexed)) {
    const keys = []
    for (const candidate of unindexed) {
      const key = `${candidate.sourceTable}::${candidate.constraintName}`
      keys.push(key)
      const catalog = foreignKeyByName.get(key)
      check(Boolean(catalog), `Unindexed candidate ${key} is absent from catalog evidence.`)
      if (!catalog) continue
      check(catalog.catalogCoveringIndex === false && candidate.catalogCoveringIndex === false, `Unindexed candidate ${key} incorrectly claims a covering index.`)
      check(JSON.stringify(candidate.sourceColumns) === JSON.stringify(catalog.sourceColumns), `Unindexed candidate ${key} source columns drifted.`)
      check(candidate.targetTable === catalog.targetTable && JSON.stringify(candidate.targetColumns) === JSON.stringify(catalog.targetColumns), `Unindexed candidate ${key} target drifted.`)
      check(candidate.tableClassification === classes.get(candidate.sourceTable), `Unindexed candidate ${key} table classification drifted.`)
      check(candidate.businessArea === expectedArea(candidate.sourceTable), `Unindexed candidate ${key} business area drifted.`)
      check(candidate.priorityCandidate === expectedPriority(candidate.sourceTable, candidate.tableClassification), `Unindexed candidate ${key} priority drifted.`)
      check(candidate.acceptanceStatus === 'candidate_unaccepted', `Unindexed candidate ${key} must remain unaccepted.`)
    }
    check(keys.length === new Set(keys).size, 'Unindexed candidates contain duplicate constraints.')
    const expectedUnindexedKeys = [...foreignKeyByName.entries()].filter(([, foreignKey]) => !foreignKey.catalogCoveringIndex).map(([key]) => key)
    check(exactSet(keys, expectedUnindexedKeys), 'Unindexed candidates differ from catalog uncovered foreign keys.')
    check(exactObject(countBy(unindexed, 'priorityCandidate'), expectedPriorityCounts), 'Priority array counts drifted.')
    check(exactObject(countBy(unindexed, 'businessArea'), expectedAreaCounts), 'Business-area array counts drifted.')
  }

  const otherPerformance = risk.otherPerformanceFindings
  check(Array.isArray(otherPerformance) && otherPerformance.length === 110, 'Other performance evidence must contain 110 findings.')
  if (Array.isArray(otherPerformance)) {
    check(exactObject(countBy(otherPerformance, 'lint'), {
      auth_rls_initplan: 54,
      multiple_permissive_policies: 46,
      unused_index: 10,
    }), 'Other performance finding counts drifted.')
    check(otherPerformance.every((finding) => finding.acceptanceStatus === 'candidate_unaccepted'), 'Performance findings must remain unaccepted.')
  }

  const serialized = JSON.stringify(risk) + JSON.stringify(foreignKeyEvidence)
  const forbiddenPatterns = [
    /eyJhbGciOi[A-Za-z0-9_-]{8,}/u,
    /sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/u,
    /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/iu,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=/iu,
  ]
  check(forbiddenPatterns.every((pattern) => !pattern.test(serialized)), 'Risk evidence contains a forbidden sensitive value.')
  return failures
}

const risk = JSON.parse(readFileSync(riskPath, 'utf8'))
const foreignKeyEvidence = JSON.parse(readFileSync(foreignKeyPath, 'utf8'))
const routineEvidence = JSON.parse(readFileSync(routinePath, 'utf8'))
const register = JSON.parse(readFileSync(registerPath, 'utf8'))
const failures = collectFailures(risk, foreignKeyEvidence, routineEvidence, register)
if (failures.length) {
  console.error('P0_ADVISOR_RISK_PRIORITY_EVIDENCE_DRIFT')
  for (const failure of failures) console.error('- ' + failure)
  process.exit(1)
}

const selfTests = [
  ['false-acceptance', (copy) => { copy.supervisorAccepted = true }],
  ['missing-security-finding', (copy) => { copy.securityFindings.pop() }],
  ['missing-unindexed-foreign-key', (copy) => { copy.unindexedForeignKeys.pop() }],
  ['priority-drift', (copy) => { copy.unindexedForeignKeys[0].priorityCandidate = 'P2-history-observation' }],
  ['covering-index-drift', (copy) => { copy.unindexedForeignKeys[0].catalogCoveringIndex = true }],
  ['count-drift', (copy) => { copy.counts.performanceTotal -= 1 }],
  ['secret-value', (copy) => { copy.unindexedForeignKeys[0].priorityReason = 'sb_secret_forbidden12345678' }],
]
for (const [name, mutate] of selfTests) {
  const copy = clone(risk)
  mutate(copy)
  if (collectFailures(copy, foreignKeyEvidence, routineEvidence, register).length === 0) {
    console.error('P0_ADVISOR_RISK_PRIORITY_EVIDENCE_SELFTEST_FAILED case=' + name)
    process.exit(1)
  }
}

console.log('P0_ADVISOR_RISK_PRIORITY_EVIDENCE_SELFTEST_OK cases=' + selfTests.length)
console.log(
  'P0_ADVISOR_RISK_PRIORITY_EVIDENCE_OK security=143 performance=315 foreignKeys=309 covered=104 unindexed=205 ' +
    'priority=P1A:137,P1B:31,P2:37 businessRowsRead=0 writes=0 accepted=0',
)
console.log(
  'P0_ADVISOR_RISK_PRIORITY_EVIDENCE_GAPS_OPEN queryPlans=205 lockEvidence=205 writeImpact=205 ' +
    'sixIdentitySecurityTests=143 supervisorFreeze=458',
)
