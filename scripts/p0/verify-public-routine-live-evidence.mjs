import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const evidencePath = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'public-routine-live-evidence.json')
const tableEvidencePath = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'public-table-live-evidence.json')
const registerPath = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'public-table-classification-register.json')
const expectedProjectRef = 'agygfhmkazcbqaqwmljb'
const expectedMissingSearchPath = ['touch_updated_at()']
const expectedAnonExecutable = [
  'crm_is_valid_opportunity(target_grade text, target_annual_fee_viable boolean, target_key_person_contacted boolean, target_key_person_meeting_at timestamp with time zone)',
  'crm_reject_evidence_mutation()',
  'crm_validate_evidence_revocation()',
  'crm_validate_qualification_evidence()',
  'crm_validate_team_references()',
  'touch_updated_at()',
  'validate_notification_payload()',
]
const expectedNotServiceExecutable = [
  'refresh_order_performance_state(p_order_id uuid, p_reason text, p_trigger_type text, p_trigger_id uuid, p_idempotency_key uuid)',
]
const allowedClassifications = [
  'trigger_function_candidate',
  'anonymous_rpc_candidate',
  'authenticated_rpc_candidate',
  'internal_helper_candidate',
]

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

function expectedClassification(routine) {
  if (routine.triggerUses.length > 0) return 'trigger_function_candidate'
  if (routine.effectiveExecuteRoles.includes('anon')) return 'anonymous_rpc_candidate'
  if (routine.effectiveExecuteRoles.includes('authenticated')) return 'authenticated_rpc_candidate'
  return 'internal_helper_candidate'
}

function collectFailures(evidence, tableEvidence, register) {
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }

  check(evidence.schemaVersion === 1, 'Unsupported evidence schemaVersion.')
  check(evidence.evidenceType === 'production-readonly-public-routine-catalog', 'Evidence type drifted.')
  check(evidence.projectRef === expectedProjectRef, 'Production project ref drifted.')
  check(Number.isInteger(evidence.serverVersionNum) && evidence.serverVersionNum >= 170000, 'Evidence must come from PostgreSQL 17 or later.')
  check(Number.isFinite(Date.parse(evidence.capturedAtUtc)), 'Capture time must be ISO-compatible.')
  check(evidence.readOnly === true && evidence.writePerformed === false, 'Routine evidence must remain read-only and write-free.')
  check(evidence.businessRowsRead === false && evidence.functionBodiesReturned === false, 'Routine evidence must not return business rows or function bodies.')
  check(evidence.acceptanceStatus === 'candidate_unaccepted' && evidence.supervisorAccepted === false, 'Routine evidence must remain unaccepted.')
  check(exactSet(evidence.limitations, [
    'boolean markers are candidate evidence, not proof of authorization correctness',
    'pg_depend does not reveal every PL/pgSQL or dynamic SQL dependency',
    'frontend and Edge Function callers require local source cross-check',
    'function bodies, policy expressions, secrets and business rows are omitted',
  ]), 'Routine evidence limitations drifted.')

  const expectedCounts = {
    routines: 162,
    securityDefiner: 148,
    authenticatedSecurityDefiner: 135,
    missingSearchPath: 1,
    triggerFunctions: 19,
    triggerObjectsUsingPublicRoutines: 27,
    publicRoutineTriggerUsesOnPublicTables: 26,
    publicRoutineTriggerUsesOnNonPublicTables: 1,
    publicTableTriggerObjects: 29,
    publicTableTriggerObjectsUsingNonPublicRoutines: 3,
    triggerFunctionsAuthenticatedExecutable: 18,
    anonExecutable: 7,
    authenticatedExecutable: 149,
    serviceRoleExecutable: 161,
    sqlLanguage: 23,
    plpgsqlLanguage: 139,
    explicitAclEntries: 484,
    catalogRelationDependencyEntries: 0,
  }
  const counts = evidence.counts ?? {}
  check(
    JSON.stringify(Object.keys(counts).sort()) === JSON.stringify(Object.keys(expectedCounts).sort()),
    'Routine evidence count fields drifted.',
  )
  for (const [field, expected] of Object.entries(expectedCounts)) {
    check(counts[field] === expected, `Routine count ${field} expected ${expected}, got ${counts[field]}.`)
  }
  check(register.catalogSnapshot?.counts?.publicRoutines === counts.routines, 'Routine total differs from the table classification register.')
  check(register.livePerRoutineEvidence?.candidateRoutineCount === counts.routines, 'Routine evidence total differs from the live routine register.')
  check(register.livePerRoutineEvidence?.capturedAtUtc === evidence.capturedAtUtc, 'Routine evidence capture time differs from the live routine register.')
  check(register.livePerRoutineEvidence?.securityDefinerCount === counts.securityDefiner, 'Security-definer count differs from the live routine register.')
  check(register.livePerRoutineEvidence?.authenticatedSecurityDefinerCount === counts.authenticatedSecurityDefiner, 'Authenticated security-definer count differs from the live routine register.')
  check(register.livePerRoutineEvidence?.supervisorAcceptedRoutineCount === 0, 'Live routine register must remain unaccepted.')
  check(tableEvidence.counts?.triggerObjects === counts.publicTableTriggerObjects, 'Public-table trigger total differs from table evidence.')

  const expectedClassifications = {
    triggerFunction: 19,
    anonymousRpc: 2,
    authenticatedRpc: 129,
    internalHelper: 12,
  }
  check(
    Object.entries(expectedClassifications).every(([field, expected]) => evidence.candidateClassifications?.[field] === expected) &&
      Object.keys(evidence.candidateClassifications ?? {}).length === Object.keys(expectedClassifications).length,
    'Candidate classification counts drifted.',
  )

  const routines = evidence.routines
  check(Array.isArray(routines) && routines.length === 162, 'Routine evidence must contain 162 entries.')
  if (!Array.isArray(routines)) return failures
  const signatures = routines.map((routine) => routine.signature)
  check(signatures.length === new Set(signatures).size, 'Routine signatures contain duplicates.')

  let securityDefiner = 0
  let authenticatedSecurityDefiner = 0
  let explicitAclEntries = 0
  let triggerFunctions = 0
  let triggerObjectsUsingPublicRoutines = 0
  let triggerFunctionsAuthenticatedExecutable = 0
  let catalogRelationDependencyEntries = 0
  const missingSearchPath = []
  const anonExecutable = []
  const notServiceExecutable = []
  const classificationCounts = Object.fromEntries(allowedClassifications.map((name) => [name, 0]))

  for (const routine of routines) {
    check(typeof routine.signature === 'string' && routine.signature === `${routine.name}(${routine.identityArguments})`, `Routine signature shape drifted: ${routine.signature}.`)
    check(['function', 'procedure'].includes(routine.routineType), `Routine ${routine.signature} has invalid routineType.`)
    check(['sql', 'plpgsql'].includes(routine.language), `Routine ${routine.signature} has unexpected language.`)
    check(typeof routine.owner === 'string' && routine.owner.length > 0, `Routine ${routine.signature} has no owner.`)
    check(typeof routine.securityDefiner === 'boolean' && typeof routine.leakproof === 'boolean', `Routine ${routine.signature} privilege flags are incomplete.`)
    check(Array.isArray(routine.searchPathSettings), `Routine ${routine.signature} searchPathSettings must be an array.`)
    check(Array.isArray(routine.explicitAcl), `Routine ${routine.signature} explicitAcl must be an array.`)
    check(Array.isArray(routine.effectiveExecuteRoles), `Routine ${routine.signature} effectiveExecuteRoles must be an array.`)
    check(Array.isArray(routine.triggerUses), `Routine ${routine.signature} triggerUses must be an array.`)
    check(Array.isArray(routine.catalogRelationDependencies), `Routine ${routine.signature} catalogRelationDependencies must be an array.`)
    if (![routine.searchPathSettings, routine.explicitAcl, routine.effectiveExecuteRoles, routine.triggerUses, routine.catalogRelationDependencies].every(Array.isArray)) continue

    check(exactSet(routine.effectiveExecuteRoles, routine.effectiveExecuteRoles.filter((role) => ['anon', 'authenticated', 'service_role'].includes(role))), `Routine ${routine.signature} has an unexpected effective execute role.`)
    check(allowedClassifications.includes(routine.candidateClassification), `Routine ${routine.signature} has an unknown classification.`)
    check(routine.candidateClassification === expectedClassification(routine), `Routine ${routine.signature} classification does not match its live exposure.`)
    check(routine.acceptanceStatus === 'candidate_unaccepted', `Routine ${routine.signature} must remain unaccepted.`)

    const definition = routine.definitionEvidence ?? {}
    check(/^[a-f0-9]{32}$/.test(definition.md5 ?? ''), `Routine ${routine.signature} has an invalid definition fingerprint.`)
    check(Number.isInteger(definition.length) && definition.length > 0, `Routine ${routine.signature} has an invalid definition length.`)
    for (const marker of [
      'usesAuthUid', 'usesAuthJwt', 'usesRequestJwt', 'usesTeamScopeMarker', 'usesRoleGuardMarker',
      'usesDynamicSqlMarker', 'writesDataMarker', 'raisesExceptionMarker', 'bodyReturned',
    ]) {
      check(typeof definition[marker] === 'boolean', `Routine ${routine.signature} marker ${marker} must be boolean.`)
    }
    check(definition.bodyReturned === false, `Routine ${routine.signature} must not return its body.`)
    check(!('definition' in routine) && !('functionBody' in routine) && !('source' in routine), `Routine ${routine.signature} embeds forbidden body/source text.`)

    if (routine.securityDefiner) securityDefiner += 1
    if (routine.securityDefiner && routine.effectiveExecuteRoles.includes('authenticated')) authenticatedSecurityDefiner += 1
    explicitAclEntries += routine.explicitAcl.length
    catalogRelationDependencyEntries += routine.catalogRelationDependencies.length
    if (routine.searchPathSettings.length === 0) missingSearchPath.push(routine.signature)
    if (routine.effectiveExecuteRoles.includes('anon')) anonExecutable.push(routine.signature)
    if (!routine.effectiveExecuteRoles.includes('service_role')) notServiceExecutable.push(routine.signature)
    if (routine.triggerUses.length > 0) {
      triggerFunctions += 1
      triggerObjectsUsingPublicRoutines += routine.triggerUses.length
      if (routine.effectiveExecuteRoles.includes('authenticated')) triggerFunctionsAuthenticatedExecutable += 1
    }
    classificationCounts[routine.candidateClassification] += 1
  }

  check(securityDefiner === counts.securityDefiner, 'SECURITY DEFINER count does not reconcile.')
  check(authenticatedSecurityDefiner === counts.authenticatedSecurityDefiner, 'Authenticated SECURITY DEFINER count does not reconcile.')
  check(explicitAclEntries === counts.explicitAclEntries, 'Routine ACL count does not reconcile.')
  check(triggerFunctions === counts.triggerFunctions, 'Trigger-function count does not reconcile.')
  check(triggerObjectsUsingPublicRoutines === counts.triggerObjectsUsingPublicRoutines, 'Trigger-use count does not reconcile.')
  check(triggerFunctionsAuthenticatedExecutable === counts.triggerFunctionsAuthenticatedExecutable, 'Authenticated trigger-function count does not reconcile.')
  check(catalogRelationDependencyEntries === counts.catalogRelationDependencyEntries, 'Catalog relation-dependency count does not reconcile.')
  check(exactSet(missingSearchPath, expectedMissingSearchPath), 'Missing search_path signature drifted.')
  check(exactSet(anonExecutable, expectedAnonExecutable), 'Anonymous executable signature set drifted.')
  check(exactSet(notServiceExecutable, expectedNotServiceExecutable), 'service_role executable boundary drifted.')
  check(classificationCounts.trigger_function_candidate === 19, 'Trigger classification count drifted.')
  check(classificationCounts.anonymous_rpc_candidate === 2, 'Anonymous RPC classification count drifted.')
  check(classificationCounts.authenticated_rpc_candidate === 129, 'Authenticated RPC classification count drifted.')
  check(classificationCounts.internal_helper_candidate === 12, 'Internal helper classification count drifted.')

  const serialized = JSON.stringify(evidence)
  const forbiddenPatterns = [
    /eyJhbGciOi[A-Za-z0-9_-]{8,}/,
    /sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/,
    /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=/i,
  ]
  check(forbiddenPatterns.every((pattern) => !pattern.test(serialized)), 'Routine evidence contains a forbidden sensitive value.')
  return failures
}

const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
const tableEvidence = JSON.parse(readFileSync(tableEvidencePath, 'utf8'))
const register = JSON.parse(readFileSync(registerPath, 'utf8'))
const failures = collectFailures(evidence, tableEvidence, register)
if (failures.length) {
  console.error('P0_PUBLIC_ROUTINE_LIVE_EVIDENCE_DRIFT')
  for (const failure of failures) console.error('- ' + failure)
  process.exit(1)
}

const selfTests = [
  ['missing-routine', (copy) => copy.routines.pop()],
  ['false-acceptance', (copy) => { copy.supervisorAccepted = true }],
  ['body-returned', (copy) => { copy.routines[0].definitionEvidence.bodyReturned = true }],
  ['security-definer-count-drift', (copy) => { copy.counts.securityDefiner -= 1 }],
  ['classification-drift', (copy) => { copy.routines[0].candidateClassification = 'internal_helper_candidate' }],
  ['anonymous-execute-drift', (copy) => { copy.routines[0].effectiveExecuteRoles.push('anon') }],
  ['search-path-drift', (copy) => { copy.routines[0].searchPathSettings = [] }],
  ['secret-value', (copy) => { copy.routines[0].owner = 'sb_secret_forbidden12345678' }],
]
for (const [name, mutate] of selfTests) {
  const copy = clone(evidence)
  mutate(copy)
  if (collectFailures(copy, tableEvidence, register).length === 0) {
    console.error('P0_PUBLIC_ROUTINE_LIVE_EVIDENCE_SELFTEST_FAILED case=' + name)
    process.exit(1)
  }
}

console.log('P0_PUBLIC_ROUTINE_LIVE_EVIDENCE_SELFTEST_OK cases=' + selfTests.length)
console.log(
  'P0_PUBLIC_ROUTINE_LIVE_EVIDENCE_OK routines=162 securityDefiner=148 authenticatedSecurityDefiner=135 ' +
    'triggerFunctions=19 anonExecutable=7 missingSearchPath=1 candidate=162 accepted=0 businessRowsRead=0 writes=0 bodiesReturned=0',
)
console.log(
  'P0_PUBLIC_ROUTINE_LIVE_EVIDENCE_GAPS_OPEN callerCrosscheckCandidate=162 authorizationReview=162 ' +
    'functionBodyDependencyReview=162 sixIdentityRuntimeTests=162 supervisorFreeze=162',
)
