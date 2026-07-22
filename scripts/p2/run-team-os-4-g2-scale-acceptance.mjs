import { strict as assert } from 'node:assert'
import { mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { forceCleanupG2Acceptance, runG2Acceptance } from './run-team-os-4-g2-performance-adapter.mjs'

export const GREENFIELD_PROJECT_REF = 'jgcrhoabvaowxnqksvkq'
export const GREENFIELD_URL = `https://${GREENFIELD_PROJECT_REF}.supabase.co`
export const FIXED_ADAPTER = 'scripts/p2/run-team-os-4-g2-performance-adapter.mjs'
const CONFIRMATION = `TEAM_OS_4_G2_REMOTE_ACCEPTANCE:${GREENFIELD_PROJECT_REF}`
const AUDIT_ROOT = '.codex-audit/team-os-4/g2'
const SCENARIOS = Object.freeze(['default', 'filtered', 'waiting-renewal', 'second-page-deep-cursor', 'search'])
const REQUIRED_INDEXES = Object.freeze([
  'work_items_generation_identity',
  'work_items_assignee_status_due_idx',
  'work_items_server_queue_cursor_idx',
])
const REQUIRED_MIGRATIONS = Object.freeze(['20260722180000', '20260722181000', '20260722182000'])
const CONCURRENCY = 30
const WAVES = 3
const SAMPLE_COUNT_PER_SCENARIO = CONCURRENCY * WAVES

export const SCALE_ACCEPTANCE_PLAN = Object.freeze({
  requiredMigrations: Object.freeze([
    '20260722180000_g2_backend_closure.sql',
    '20260722181000_g2_lead_claim_work_item_closure.sql',
    '20260722182000_add_g2_performance_fixture_and_index.sql',
  ]),
  cursorFields: Object.freeze(['sort_rank', 'waiting_rank', 'sort_at', 'priority_rank', 'id', 'business_date']),
  workItemCount: 100_000,
  activeUserCount: 30,
  concurrency: CONCURRENCY,
  waves: WAVES,
  sampleCountPerScenario: SAMPLE_COUNT_PER_SCENARIO,
  maximumListP95Ms: 2_000,
  requiredIndexes: REQUIRED_INDEXES,
  defaultMode: 'read-only-preflight',
  firstFailureStops: true,
})

function parseArguments(argv) {
  const values = new Map()
  const flags = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument: ${token}`)
    if (/(?:key|token|secret|password|adapter)/iu.test(token)) throw new Error(`forbidden CLI argument: ${token}`)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) flags.add(token.slice(2))
    else {
      values.set(token.slice(2), next)
      index += 1
    }
  }
  return { values, flags }
}

function requiredValue(arguments_, name) {
  const value = arguments_.values.get(name)
  if (!value) throw new Error(`missing required --${name}`)
  return value
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

export function percentile(values, quantile) {
  assert.ok(Array.isArray(values) && values.length > 0, 'percentile requires raw samples')
  const sorted = values.map(Number).sort((left, right) => left - right)
  assert.ok(sorted.every((value) => Number.isFinite(value) && value >= 0), 'raw sample must be a non-negative finite number')
  const position = (sorted.length - 1) * quantile
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function collectIndexNames(value, names = new Set()) {
  if (Array.isArray(value)) value.forEach((entry) => collectIndexNames(entry, names))
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'Index Name' && typeof entry === 'string') names.add(entry)
      collectIndexNames(entry, names)
    }
  }
  return names
}

function containsActualPlanNode(value) {
  if (Array.isArray(value)) return value.some(containsActualPlanNode)
  if (!value || typeof value !== 'object') return false
  if (typeof value['Node Type'] === 'string' && Number.isFinite(value['Actual Total Time'])) return true
  return Object.values(value).some(containsActualPlanNode)
}

function verifyGitCommit(repoRoot, commit) {
  const git = (args) => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true })
  const head = git(['rev-parse', 'HEAD'])
  assert.equal(head.status, 0, 'git rev-parse HEAD failed')
  assert.equal(head.stdout.trim(), commit, 'commit must equal the current Git HEAD')
  const object = git(['rev-parse', '--verify', `${commit}^{commit}`])
  assert.equal(object.status, 0, 'commit is not a real Git commit')
  assert.equal(object.stdout.trim(), commit, 'resolved Git commit drift')
  const ancestor = git(['merge-base', '--is-ancestor', commit, 'HEAD'])
  assert.equal(ancestor.status, 0, 'commit is not an ancestor of HEAD')
}

export function assertNoSecretValues(value, secrets, path = 'evidence') {
  const secretValues = [...secrets].filter((secret) => typeof secret === 'string' && secret.length >= 8)
  const visit = (entry, currentPath) => {
    if (typeof entry === 'string') {
      for (const secret of secretValues) assert.ok(!entry.includes(secret), `${currentPath} contains a secret value`)
      assert.ok(!/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}/u.test(entry), `${currentPath} contains JWT-like material`)
      assert.ok(!/(?:postgres(?:ql)?:\/\/|service_role\s*[:=]|password\s*[:=])/iu.test(entry), `${currentPath} contains credential-like material`)
      return
    }
    if (Array.isArray(entry)) entry.forEach((item, index) => visit(item, `${currentPath}[${index}]`))
    else if (entry && typeof entry === 'object') Object.entries(entry).forEach(([key, item]) => visit(item, `${currentPath}.${key}`))
  }
  visit(value, path)
}

export function resolveEvidencePath(repoRoot, candidate, runId) {
  const auditRoot = resolve(repoRoot, AUDIT_ROOT)
  const evidencePath = resolve(repoRoot, candidate)
  const within = relative(auditRoot, evidencePath)
  assert.ok(within !== '' && !within.startsWith(`..${sep}`) && within !== '..' && !resolve(within).startsWith(sep), 'evidence-out must stay inside .codex-audit/team-os-4/g2')
  assert.equal(evidencePath, resolve(auditRoot, `${runId}.json`), 'evidence-out must be the exact run-id evidence file')
  return evidencePath
}

export function validateRawEvidence(raw, expected) {
  assert.equal(raw?.schemaVersion, 1, 'raw adapter schema drift')
  assert.equal(raw?.projectRef, GREENFIELD_PROJECT_REF, 'adapter project ref drift')
  assert.equal(raw?.supabaseUrl, GREENFIELD_URL, 'adapter URL drift')
  assert.equal(raw?.commit, expected.commit, 'adapter commit drift')
  assert.equal(raw?.runId, expected.runId, 'adapter run-id drift')
  assert.equal(raw?.businessDate, expected.businessDate, 'adapter business-date drift')
  assert.equal(raw?.attempts, 1, 'formal acceptance must have exactly one attempt')
  assert.equal(raw?.failurePolicy, 'first-failure-stop', 'first-failure policy drift')
  assert.equal(raw?.dbIdentity?.targetProjectRef, GREENFIELD_PROJECT_REF, 'database project evidence drift')
  assert.equal(raw?.setup?.target_project_ref, GREENFIELD_PROJECT_REF, 'setup project evidence drift')
  assert.equal(raw?.setup?.work_item_count, 100_000, 'fixture work-item count drift')
  assert.equal(raw?.setup?.active_profile_count, 30, 'fixture active-profile count drift')
  assert.equal(raw?.dataset?.workItemCount, 100_000, 'database work-item count drift')
  assert.equal(raw?.dataset?.activeProfileCount, 30, 'database profile count drift')
  assert.deepEqual([...raw.migrationVersions].sort(), [...REQUIRED_MIGRATIONS].sort(), 'migration evidence drift')

  assert.ok(Array.isArray(raw.samples), 'raw samples missing')
  const performance = []
  for (const scenario of SCENARIOS) {
    const scenarioSamples = raw.samples.filter((sample) => sample.scenario === scenario)
    assert.equal(scenarioSamples.length, SAMPLE_COUNT_PER_SCENARIO, `${scenario} raw sample count drift`)
    for (let wave = 1; wave <= WAVES; wave += 1) {
      const waveSamples = scenarioSamples.filter((sample) => sample.wave === wave)
      assert.equal(waveSamples.length, CONCURRENCY, `${scenario} wave ${wave} concurrency drift`)
      assert.deepEqual(waveSamples.map(({ userOrdinal }) => userOrdinal).sort((a, b) => a - b), Array.from({ length: CONCURRENCY }, (_, index) => index + 1), `${scenario} wave ${wave} user coverage drift`)
      const latestStart = Math.max(...waveSamples.map(({ startedAtMs }) => startedAtMs))
      const earliestEnd = Math.min(...waveSamples.map(({ endedAtMs }) => endedAtMs))
      assert.ok(latestStart < earliestEnd, `${scenario} wave ${wave} requests did not overlap at concurrency 30`)
    }
    assert.ok(scenarioSamples.every((sample) => sample.ok === true && Number.isInteger(sample.rowCount) && sample.rowCount > 0), `${scenario} contains failed, empty, or unverifiable samples`)
    const durations = scenarioSamples.map(({ durationMs }) => durationMs)
    const metrics = {
      id: scenario,
      concurrency: CONCURRENCY,
      sampleCount: durations.length,
      p50Ms: percentile(durations, 0.50),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
    }
    assert.ok(metrics.p95Ms <= SCALE_ACCEPTANCE_PLAN.maximumListP95Ms, `${scenario} P95 exceeds 2000ms`)
    performance.push(metrics)
  }

  assert.ok(Array.isArray(raw.queryPlans) && raw.queryPlans.length >= SCENARIOS.length + REQUIRED_INDEXES.length, 'raw EXPLAIN plan set incomplete')
  const observedIndexes = new Set()
  for (const plan of raw.queryPlans) {
    assert.ok(plan && typeof plan.id === 'string' && Array.isArray(plan.explain), 'EXPLAIN JSON shape invalid')
    assert.ok(containsActualPlanNode(plan.explain), `EXPLAIN ANALYZE node missing: ${plan.id}`)
    collectIndexNames(plan.explain, observedIndexes)
  }
  for (const indexName of REQUIRED_INDEXES) assert.ok(observedIndexes.has(indexName), `required index not observed in EXPLAIN: ${indexName}`)

  assert.equal(raw.proofs?.missingTaskRollback?.sqlstate, 'P0002', 'missing-task rollback SQLSTATE drift')
  assert.equal(raw.proofs?.missingTaskRollback?.residueCount, 0, 'missing-task rollback left fixture residue')
  assert.equal(raw.proofs?.waitingPreflight?.invalidRows, 0, 'waiting preflight found invalid fixture rows')
  assert.equal(raw.proofs?.stableCursor?.usersChecked, 30, 'stable cursor user coverage drift')
  assert.equal(raw.proofs?.stableCursor?.overlapCount, 0, 'cursor duplicated rows')
  assert.equal(raw.proofs?.stableCursor?.businessDateMismatchCount, 0, 'cursor business-date drift')
  assert.equal(raw.proofs?.rls?.crossAssigneeVisible, 0, 'RLS exposed another assignee queue')
  assert.equal(raw.proofs?.crossDayCursor?.sqlstate, '22023', 'cross-day cursor SQLSTATE drift')
  assert.equal(raw.proofs?.crossDayCursor?.rejected, true, 'cross-day cursor was not rejected')
  assert.equal(raw.cleanup?.database?.deleted_work_items, 100_000, 'database cleanup item count drift')
  assert.equal(raw.cleanup?.database?.deleted_profiles, 30, 'database cleanup profile count drift')
  assert.equal(raw.cleanup?.databaseRepeat?.idempotent, true, 'database cleanup idempotency missing')
  assert.equal(raw.cleanup?.remaining?.workItems, 0, 'fixture work items remain')
  assert.equal(raw.cleanup?.remaining?.profiles, 0, 'fixture profiles remain')
  assert.equal(raw.cleanup?.remaining?.authUsers, 0, 'temporary Auth users remain')
  assert.equal(raw.cleanup?.authDeleted, 30, 'temporary Auth delete count drift')
  assert.equal(raw.cleanup?.manifestStatus, 'cleaned', 'fixture manifest did not seal cleanup')
  return { performance, observedIndexes: [...observedIndexes].sort() }
}

async function execute(arguments_, environment, repoRoot) {
  assert.ok(arguments_.flags.has('allow-remote-writes'), 'missing explicit --allow-remote-writes')
  const projectRef = requiredValue(arguments_, 'project-ref')
  const expectedProjectRef = requiredValue(arguments_, 'expected-project-ref')
  const commit = requiredValue(arguments_, 'commit')
  const businessDate = requiredValue(arguments_, 'business-date')
  const runId = requiredValue(arguments_, 'run-id')
  const companyId = requiredValue(arguments_, 'company-id')
  const evidenceArgument = requiredValue(arguments_, 'evidence-out')
  const confirmation = requiredValue(arguments_, 'confirmation')
  assert.equal(projectRef, GREENFIELD_PROJECT_REF, 'runner is restricted to the Team OS 4.0 greenfield project')
  assert.equal(expectedProjectRef, GREENFIELD_PROJECT_REF, 'expected project ref drift')
  assert.equal(environment.TEAM_OS_4_G2_SUPABASE_URL, GREENFIELD_URL, 'Supabase URL and project ref mismatch')
  assert.match(commit, /^[0-9a-f]{40}$/u, 'commit must be a full Git hash')
  assert.ok(isCalendarDate(businessDate), 'business date must be a real YYYY-MM-DD date')
  assert.match(runId, /^g2-[a-z0-9][a-z0-9-]{5,80}$/u, 'invalid G2 run-id')
  assert.match(companyId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, 'invalid company id')
  assert.equal(confirmation, CONFIRMATION, 'confirmation phrase mismatch')
  const evidencePath = resolveEvidencePath(repoRoot, evidenceArgument, runId)
  verifyGitCommit(repoRoot, commit)
  const secrets = new Set([
    environment.TEAM_OS_4_G2_SERVICE_ROLE_KEY,
    environment.TEAM_OS_4_G2_ANON_KEY,
    environment.SUPABASE_ACCESS_TOKEN,
  ])
  for (const [name, value] of [
    ['TEAM_OS_4_G2_SERVICE_ROLE_KEY', environment.TEAM_OS_4_G2_SERVICE_ROLE_KEY],
    ['TEAM_OS_4_G2_ANON_KEY', environment.TEAM_OS_4_G2_ANON_KEY],
    ['SUPABASE_ACCESS_TOKEN', environment.SUPABASE_ACCESS_TOKEN],
  ]) assert.ok(typeof value === 'string' && value.length >= 20, `${name} is required`)

  const adapterContext = Object.freeze({
    projectRef, supabaseUrl: GREENFIELD_URL, commit, businessDate, runId, companyId,
    firstFailureStops: true, attempts: 1, concurrency: CONCURRENCY, waves: WAVES,
    credentials: Object.freeze({
      serviceRoleKey: environment.TEAM_OS_4_G2_SERVICE_ROLE_KEY,
      anonKey: environment.TEAM_OS_4_G2_ANON_KEY,
    }),
  })
  mkdirSync(dirname(evidencePath), { recursive: true })
  writeFileSync(evidencePath, '', { encoding: 'utf8', flag: 'wx' })
  let raw
  try {
    raw = await runG2Acceptance(adapterContext)
  } catch (error) {
    try { await forceCleanupG2Acceptance(adapterContext) } catch { /* adapter error remains primary; cleanup is already attempted internally */ }
    if (statSync(evidencePath).size === 0) unlinkSync(evidencePath)
    const safe = error instanceof Error ? error.message : String(error)
    assertNoSecretValues(safe, secrets, 'adapterError')
    throw new Error(safe)
  }
  try {
    assertNoSecretValues(raw, secrets, 'rawEvidence')
    const recomputed = validateRawEvidence(raw, { commit, businessDate, runId })
    const passed = (details) => ({ status: 'passed', details })
    const evidence = {
    schemaVersion: 2,
    phase: 'G2', projectRef, supabaseUrl: GREENFIELD_URL, commit, businessDate, runId,
    adapter: FIXED_ADAPTER,
    failurePolicy: 'first-failure-stop', attempts: 1,
    dataset: raw.dataset,
    performance: recomputed.performance,
    evidence: {
      'migration-state': passed(raw.migrationVersions),
      'waiting-preflight': passed(raw.proofs.waitingPreflight),
      'missing-task-rollback': passed(raw.proofs.missingTaskRollback),
      'cleanup-idempotency': passed(raw.cleanup.databaseRepeat),
      'stable-cursor': passed(raw.proofs.stableCursor),
      'cross-day-cursor-rejection': passed(raw.proofs.crossDayCursor),
      rls: passed(raw.proofs.rls),
      'dataset-manifest': passed(raw.dataset),
      'query-plans': passed({ indexes: recomputed.observedIndexes, plans: raw.queryPlans }),
      'response-percentiles': passed(recomputed.performance),
      cleanup: passed(raw.cleanup),
    },
    accepted: true,
    }
    assertNoSecretValues(evidence, secrets)
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
    const safeMessage = `TEAM_OS_4_G2_REMOTE_ACCEPTED runId=${runId} projectRef=${projectRef} samples=${raw.samples.length} evidence=${relative(repoRoot, evidencePath)}`
    assertNoSecretValues(safeMessage, secrets, 'console')
    console.log(safeMessage)
  } catch (error) {
    if (statSync(evidencePath).size === 0) unlinkSync(evidencePath)
    throw error
  }
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
  const arguments_ = parseArguments(argv)
  if (!arguments_.flags.has('execute')) {
    console.log(`TEAM_OS_4_G2_REMOTE_READ_ONLY_PREFLIGHT executable=true adapter=${FIXED_ADAPTER} projectRef=${GREENFIELD_PROJECT_REF} remoteCalls=0 accepted=false`)
    return
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  await execute(arguments_, environment, repoRoot)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
