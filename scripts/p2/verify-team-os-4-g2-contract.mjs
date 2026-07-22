import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const absolute = (path) => resolve(repoRoot, path)
const readRaw = (path) => readFileSync(absolute(path), 'utf8')
const read = (path) => readRaw(path).replace(/\s+/gu, ' ')
const json = (path) => JSON.parse(readRaw(path))
const safeDecodePath = (value) => {
  if (typeof value !== 'string') return ''
  try { return decodeURIComponent(value) } catch { return value }
}

const normalizePathTextForMatch = (value) => {
  if (typeof value !== 'string') return ''
  return safeDecodePath(value)
    .replace(/\r\n?/gu, '\n')
    .replace(/%5c/giu, '/')
    .replace(/\\+/gu, '/')
    .replace(/\/+/gu, '/')
    .replace(/%20/giu, ' ')
    .replace(/["']/gu, '')
    .replace(/\\(["'])/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
}

const normalizePathTextForCheck = (value) => {
  if (typeof value !== 'string') return ''
  return normalizePathTextForMatch(value)
}

const normalizeScriptTextForPathMatch = (value) => {
  if (typeof value !== 'string') return ''
  return normalizePathTextForCheck(value)
}

const normalizePathMatchCandidates = (pathText) => {
  if (typeof pathText !== 'string' || !pathText.length) return []
  const raw = pathText.trim()
  const normalized = normalizePathTextForMatch(raw)
  const decoded = normalizePathTextForMatch(safeDecodePath(raw))
  const variants = new Set([
    normalized,
    decoded,
    raw.trim(),
    raw.replace(/\\/gu, '/'),
    raw.replace(/\\\\/gu, '/'),
    normalized.replace(/ /gu, '%20'),
    decoded.replace(/ /gu, '%20'),
    raw.replace(/%5[cC]/gu, '/'),
  ])
  const quotedVariants = []
  for (const variant of [...variants]) {
    if (!variant) continue
    quotedVariants.push(variant)
    quotedVariants.push(`"${variant}"`)
    quotedVariants.push(`'${variant}'`)
  }
  return [...new Set(quotedVariants.map(normalizePathTextForCheck))].filter((candidate) => candidate.length > 0)
}

const stripKnownExecutorPath = (sourceText) => {
  if (!sourceText) return ''
  const executorPathCandidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'c:\\program files\\nodejs\\node.exe',
    'C:/Program Files/nodejs/node.exe',
    'C:%5cProgram%20Files%5cnodejs%5cnode.exe',
    'C:/Program%20Files/nodejs/node.exe',
    'C:\\Program%20Files\\nodejs\\node.exe',
  ]
  let text = sourceText
  for (const candidate of executorPathCandidates) {
    text = removePathMarker(text, candidate)
  }
  return text
}

const containsPathMarker = (sourceText, pathText) => {
  const candidates = normalizePathMatchCandidates(pathText)
  if (!candidates.length) return false
  return candidates.some((candidate) => sourceText.includes(candidate))
}

const removePathMarker = (sourceText, pathText) => {
  let text = sourceText
  const candidates = normalizePathMatchCandidates(pathText)
  for (const candidate of candidates) {
    if (!candidate) continue
    text = text.split(candidate).join(' ')
  }
  return text
}

const contract = json('scripts/p2/team-os-4-g2-acceptance-contract.json')
const dependencies = contract.contracts.migrationDependencies
const migrationDirectory = 'platform/team-os-4/supabase/migrations'
const migrationNames = readdirSync(absolute(migrationDirectory))
  .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name))
  .sort()

for (const [key, name] of Object.entries(dependencies)) {
  if (key === 'strictOrderRequired') continue
  assert.match(name, /^\d{14}_[a-z0-9_]+\.sql$/u, `invalid ${key} migration name`)
  assert.ok(migrationNames.includes(name), `required migration missing: ${name}`)
}
assert.equal(dependencies.strictOrderRequired, true)
assert.ok(migrationNames.indexOf(dependencies.workItemFoundation) < migrationNames.indexOf(dependencies.backendClosure), 'work-item closure must follow its foundation')
assert.ok(migrationNames.indexOf(dependencies.leadFoundation) < migrationNames.indexOf(dependencies.leadWorkItemClosure), 'lead work-item closure must follow its foundation')

const foundation = read(`${migrationDirectory}/${dependencies.workItemFoundation}`)
const closureRaw = readRaw(`${migrationDirectory}/${dependencies.backendClosure}`)
const closure = closureRaw.replace(/\s+/gu, ' ')
const leadFoundation = read(`${migrationDirectory}/${dependencies.leadFoundation}`)
const leadClosure = read(`${migrationDirectory}/${dependencies.leadWorkItemClosure}`)
const performanceFixture = read(`${migrationDirectory}/${dependencies.performanceFixture}`)
const domain = read('packages/team-os-4-domain/src/work-item.ts')
const mapper = read('apps/team-os-4/src/domain/map-work-item-row.ts')
const selector = read('apps/team-os-4/src/domain/select-work-items.ts')
const reader = read('apps/team-os-4/src/lib/supabase-work-item-reader.ts')
const app = read('apps/team-os-4/src/App.tsx')
const scaleRunner = read('scripts/p2/run-team-os-4-g2-scale-acceptance.mjs')
const performanceAdapter = read('scripts/p2/run-team-os-4-g2-performance-adapter.mjs')
const normalizedPerformanceAdapter = normalizeScriptTextForPathMatch(performanceAdapter)
const fixedNodeExecutorPath = 'C:\\Program Files\\nodejs\\node.exe'
const fixedNpxCliPath = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js'
const adapterWithoutExecutorPath = stripKnownExecutorPath(normalizedPerformanceAdapter)
const compactClosure = closure.replace(/\s+/gu, '')
const normalizedFixedNode = normalizePathTextForMatch(fixedNodeExecutorPath)
const normalizedFixedNpx = normalizePathTextForMatch(fixedNpxCliPath)

const requiredBuckets = [
  'overdue_blocking', 'due_today', 'upcoming_business_date', 'first_contact',
  'reclaim_soon', 'renewal', 'normal',
]
const requiredCursor = ['sort_rank', 'waiting_rank', 'sort_at', 'priority_rank', 'id', 'business_date']

assert.equal(contract.schemaVersion, 3)
assert.equal(contract.phase, 'G2')
assert.equal(contract.acceptedProgressBefore, 30)
assert.deepEqual(contract.checkpoints.map(({ progress, status }) => [progress, status]), [[35, 'pending'], [40, 'pending']])
assert.equal(contract.runtimeEvidence, 'pending')
assert.equal(contract.g2Accepted, false)
assert.equal(contract.contracts.uniqueGenerationKey, 'company_id+source_business+source_id+generation_rule')
assert.equal(contract.contracts.assigneeReassignment, 'updates-existing-work-item-without-generating-duplicate')
assert.deepEqual(contract.contracts.businessCompletion, {
  reminder: 'generic-completion-assignee-or-admin-only',
  businessAction: 'owning-business-transaction-only',
  atomicProofTransaction: 'claim_lead_v1',
  claimCandidate: 'oldest-eligible-lead-with-matching-open-assigned-business-action',
  idempotent: true,
})
assert.deepEqual(contract.contracts.waiting, {
  blockedReasonRequired: true,
  blockedReasonClearedOnExit: true,
  sortsFirstInsideBusinessBucket: true,
  legacyPreflight: 'reject-invalid-without-rewrite',
  legacyPreflightError: 'G2_WAITING_PRECHECK_FAILED',
  validatedConstraintRequired: true,
})
assert.deepEqual(contract.contracts.serverQueue.sortBuckets, requiredBuckets)
assert.deepEqual(contract.contracts.serverQueue.cursor, requiredCursor)
assert.equal(contract.contracts.serverQueue.cursorBusinessDateFrozen, true)
assert.equal(contract.contracts.serverQueue.crossBusinessDateCursorRejected, true)
assert.equal(contract.contracts.serverQueue.maximumPageSize, 100)
assert.equal(contract.contracts.serverQueue.clientResortAllowed, false)

for (const table of ['work_items', 'business_events']) {
  assert.ok(foundation.includes(`create table public.${table} (`), `${table} table missing`)
  assert.ok(foundation.includes(`alter table public.${table} enable row level security;`), `${table} RLS missing`)
  assert.ok(foundation.includes(`revoke all on table public.${table} from anon, authenticated;`), `${table} revoke missing`)
}
assert.ok(foundation.includes('constraint work_items_generation_identity unique (company_id, source_business, source_id, generation_rule)'))
assert.ok(foundation.includes('create index work_items_assignee_status_due_idx'))

const waitingConstraintOffset = closureRaw.indexOf('add constraint work_items_waiting_reason_consistent')
assert.ok(waitingConstraintOffset > 0, 'waiting constraint missing')
const waitingPreflight = closureRaw.slice(0, waitingConstraintOffset)
for (const fragment of [
  'G2_WAITING_PRECHECK_FAILED', "status = 'waiting'", 'blocked_reason is null',
  'pg_catalog.btrim(blocked_reason)', "status <> 'waiting' and blocked_reason is not null",
]) assert.ok(waitingPreflight.includes(fragment), `waiting read-only preflight missing: ${fragment}`)
assert.ok(!/update\s+public\.work_items/iu.test(waitingPreflight), 'waiting preflight must not rewrite legacy rows')
assert.ok(!/work_items_waiting_reason_consistent[\s\S]{0,300}not\s+valid/iu.test(closureRaw), 'waiting constraint must be validated')

for (const fragment of [
  "add column sort_bucket text not null default 'normal'",
  'constraint work_items_waiting_reason_consistent',
  "status = 'waiting' and blocked_reason is not null",
  'add column sort_rank smallint generated always as',
  'add column waiting_rank smallint generated always as',
  'add column sort_at timestamptz generated always as',
  'add column priority_rank smallint generated always as',
  'create index work_items_server_bucket_cursor_idx',
  'company_id, assignee_id, sort_rank, waiting_rank, sort_at, priority_rank, id',
]) assert.ok(closure.includes(fragment), `queue schema contract missing: ${fragment}`)

for (const bucket of requiredBuckets) {
  assert.ok(closure.includes(`'${bucket}'`), `SQL bucket missing: ${bucket}`)
  assert.ok(domain.includes(`'${bucket}'`), `domain bucket missing: ${bucket}`)
}
for (const cursorField of requiredCursor) assert.ok(closure.includes(`'${cursorField}'`), `SQL cursor field missing: ${cursorField}`)

for (const fragment of [
  'create or replace function public.complete_work_item_v1(', "security definer set search_path = ''",
  "v_item.kind <> 'reminder'", 'business-action work items can only close inside their owning business transaction',
  "p.id = v_item.assignee_id or r.role_key = 'admin'", 'for update;',
  "update public.work_items set status = 'completed'", 'insert into public.business_events ( company_id, work_item_id, event_type',
]) assert.ok(closure.includes(fragment), `reminder completion contract missing: ${fragment}`)

for (const fragment of [
  'create or replace function public.transition_work_item_v1(', "p_payload ->> 'blocked_reason'",
  "p_target_status = 'waiting' and v_blocked_reason is null",
  "blocked_reason = case when p_target_status = 'waiting' then v_blocked_reason else null end",
  "v_item.status in ('completed', 'cancelled')",
]) assert.ok(closure.includes(fragment), `transition contract missing: ${fragment}`)

for (const fragment of [
  'create or replace function public.create_work_item_v1(',
  'on conflict (company_id, source_business, source_id, generation_rule) do nothing',
  "e.event_type in ('created', 'assigned')", "'g2:create:' || pg_catalog.btrim(p_idempotency_key)",
  "'g2:assign:' || pg_catalog.btrim(p_idempotency_key)", "v_item.status in ('completed', 'cancelled')",
  'set assignee_id = p_assignee_id', "'status', 'reassigned'", "'previous_assignee_id', v_item.assignee_id",
]) assert.ok(closure.includes(fragment), `create/reassign contract missing: ${fragment}`)

const createSignature = 'public.create_work_item_v1(uuid,uuid,text,text,text,uuid,text,text,text,timestamptz,timestamptz,text,uuid,text,jsonb)'
for (const role of ['public', 'anon', 'authenticated']) assert.ok(compactClosure.includes(`revokeallonfunction${createSignature}from${role};`), `create/reassign ${role} revoke missing`)
assert.ok(compactClosure.includes(`grantexecuteonfunction${createSignature}toservice_role;`), 'create/reassign service_role grant missing')

for (const functionSignature of [
  'public.complete_work_item_v1(uuid, uuid, text, uuid, jsonb)',
  'public.transition_work_item_v1(uuid, uuid, text, text, uuid, jsonb)',
]) {
  for (const role of ['public', 'anon', 'authenticated']) assert.ok(closure.includes(`revoke all on function ${functionSignature} from ${role};`), `${functionSignature} ${role} revoke missing`)
  assert.ok(closure.includes(`grant execute on function ${functionSignature} to service_role;`), `${functionSignature} service grant missing`)
}

for (const fragment of [
  'create function public.list_work_items_v1(', 'security invoker', 'p_limit integer default 50', 'p_limit > 100',
  'p_cursor_business_date date default null', 'p_business_date date default null', 'v_today_shanghai date',
  'cursor fields must be supplied together', "p_cursor_business_date <> v_today_shanghai",
  'cursor business date has expired in Asia/Shanghai; restart pagination',
  "pg_catalog.timezone('Asia/Shanghai', pg_catalog.statement_timestamp())", 'r.effective_sort_rank, r.waiting_rank, r.sort_at, r.priority_rank, r.id',
  "'business_date', v_business_date", "'next_cursor', case when v_has_more then v_next_cursor else null end",
  'to authenticated, service_role;',
]) assert.ok(closure.includes(fragment), `list RPC contract missing: ${fragment}`)

for (const fragment of ['create table public.leads (', 'create table public.profile_regions (', 'create or replace function public.claim_lead_v1(']) {
  assert.ok(leadFoundation.includes(fragment), `lead foundation missing: ${fragment}`)
}
const claimCandidateOffset = leadClosure.indexOf('from public.work_items as candidate_task')
const claimUpdateOffset = leadClosure.indexOf('update public.leads set owner_id = p_claimant_user_id')
assert.ok(claimCandidateOffset > 0 && claimCandidateOffset < claimUpdateOffset, 'eligible lead must be filtered by its task before ownership changes')
for (const fragment of [
  'create or replace function public.claim_lead_v1(', "candidate_task.source_business = 'lead'",
  'candidate_task.source_id = l.id', "candidate_task.generation_rule = 'claim_lead_v1'",
  "candidate_task.kind = 'business_action'", "candidate_task.role_type = 'sales'",
  'candidate_task.assignee_id = p_claimant_user_id', "candidate_task.status in ('pending', 'in_progress', 'waiting')",
  'order by l.cleanup_due_at asc nulls last, l.created_at asc, l.id asc',
  'lead claim requires its generated business-action work item', "update public.work_items set status = 'completed'",
  "'business_transaction', 'claim_lead_v1'", "v_event_key := 'g2:claim_lead:'", "'work_item_closed', v_work_item_closed",
]) assert.ok(leadClosure.includes(fragment), `atomic business closure missing: ${fragment}`)
for (const role of ['public', 'anon', 'authenticated']) assert.ok(leadClosure.includes(`revoke all on function public.claim_lead_v1(uuid, uuid, text) from ${role};`))
assert.ok(leadClosure.includes('grant execute on function public.claim_lead_v1(uuid, uuid, text) to service_role;'))

for (const fragment of [
  'WORK_ITEM_STATE_TRANSITIONS', "return kind === 'reminder'", 'WORK_ITEM_SORT_BUCKET_RANK',
  'readonly waitingRank: 0 | 1', 'readonly businessDate: string', 'left.waitingRank - right.waitingRank',
]) assert.ok(domain.includes(fragment), `shared domain contract missing: ${fragment}`)
for (const fragment of [
  "requiredInteger(row, 'waiting_rank', 0, 1)", "item.status === 'waiting' ? waitingRank !== 0 : waitingRank !== 1",
  "businessDate: requiredString(row, 'business_date')", 'nextCursor: mapWorkItemCursor(row.next_cursor)',
]) assert.ok(mapper.includes(fragment), `mapper contract missing: ${fragment}`)
for (const fragment of [
  ".rpc('list_work_items_v1'", 'p_cursor_waiting_rank: cursor?.waitingRank ?? null',
  'p_cursor_business_date: cursor?.businessDate ?? null', 'p_business_date: cursor?.businessDate ?? query.businessDate',
  "timeZone: 'Asia/Shanghai'", 'isServerOrderedWorkItemPage(page)',
]) assert.ok(reader.includes(fragment), `reader contract missing: ${fragment}`)
assert.ok(!selector.includes('.sort('), 'client work-item selector must preserve server ordering')

for (const responseField of [
  'id', 'company_id', 'source_business', 'source_id', 'role_type', 'assignee_id', 'kind', 'title',
  'priority', 'status', 'planned_at', 'due_at', 'next_step', 'blocked_reason', 'generation_rule',
  'completed_at', 'sort_bucket', 'sort_rank', 'waiting_rank', 'sort_at', 'priority_rank',
]) assert.ok(closure.includes(`'${responseField}'`), `list response field missing: ${responseField}`)
for (const testId of ['work-items-workbench', 'work-items-progress', 'work-items-calendar']) assert.ok(app.includes(`data-testid="${testId}"`) || app.includes('data-testid={`work-items-${surface}`}'))

assert.deepEqual(contract.contracts.remoteRunner.requiredEvidence, [
  'migration-state', 'waiting-preflight', 'missing-task-rollback', 'cleanup-idempotency', 'stable-cursor',
  'cross-day-cursor-rejection', 'rls', 'dataset-manifest', 'query-plans', 'response-percentiles', 'cleanup',
])
assert.equal(contract.contracts.remoteRunner.defaultMode, 'read-only-preflight')
assert.equal(contract.contracts.remoteRunner.remoteCallsWithoutExecute, 0)
assert.equal(contract.contracts.remoteRunner.executeRequiresExplicitRemoteWriteApproval, true)
assert.equal(contract.contracts.remoteRunner.firstFailureStops, true)
assert.equal(contract.contracts.remoteRunner.allowedProjectRef, 'jgcrhoabvaowxnqksvkq')
assert.equal(contract.contracts.remoteRunner.allowedSupabaseUrl, 'https://jgcrhoabvaowxnqksvkq.supabase.co')
assert.equal(contract.contracts.remoteRunner.fixedAdapter, 'scripts/p2/run-team-os-4-g2-performance-adapter.mjs')
assert.equal(contract.contracts.remoteRunner.evidenceRoot, '.codex-audit/team-os-4/g2')
assert.ok(!contract.contracts.remoteRunner.requiredArguments.includes('adapter'))
assert.ok(contract.contracts.remoteRunner.requiredArguments.includes('company-id'))
for (const fragment of [
  'export const SCALE_ACCEPTANCE_PLAN', 'workItemCount: 100_000', 'activeUserCount: 30',
  "'20260722180000_g2_backend_closure.sql'", "'20260722181000_g2_lead_claim_work_item_closure.sql'", "'20260722182000_add_g2_performance_fixture_and_index.sql'",
  "'sort_rank'", "'waiting_rank'", "'sort_at'", "'priority_rank'", "'id'", "'business_date'",
  'maximumListP95Ms: 2_000', 'TEAM_OS_4_G2_REMOTE_READ_ONLY_PREFLIGHT', 'remoteCalls=0', 'accepted=false',
  "flags.has('allow-remote-writes')", 'TEAM_OS_4_G2_REMOTE_ACCEPTANCE:', 'runG2Acceptance',
  "failurePolicy, 'first-failure-stop'", "attempts, 1", 'P95 exceeds 2000ms',
  "flag: 'wx'", 'GREENFIELD_PROJECT_REF', 'verifyGitCommit', 'assertNoSecretValues', 'forceCleanupG2Acceptance',
]) assert.ok(scaleRunner.includes(fragment), `remote runner contract missing: ${fragment}`)
assert.ok(!scaleRunner.includes('G2 scale execution adapter is not authorized or configured'), 'remote runner must no longer be a fixed pending stub')

for (const fragment of [
  'rename to work_items_server_queue_cursor_idx', 'create table private.g2_performance_runs',
  "target_project_ref = 'jgcrhoabvaowxnqksvkq'", 'setup_g2_performance_fixture_v1',
  'cleanup_g2_performance_fixture_v1', "source_business = 'g2_performance'",
  "generation_rule = 'g2-performance:' || run_id", 'cardinality(profile_ids) = 30',
  'work_item_count = 100000', 'auth_cleanup_required',
]) assert.ok(performanceFixture.includes(fragment), `performance fixture contract missing: ${fragment}`)
for (const fragment of [
  'export async function runG2Acceptance', 'export async function forceCleanupG2Acceptance',
  'npx-cli.js', "'--linked'",
  'auth.admin.createUser', 'auth.admin.deleteUser', 'setup_g2_performance_fixture_v1',
  'cleanup_g2_performance_fixture_v1', 'explain (analyze, buffers, format json)',
  'startedAtMs', 'endedAtMs', 'missingTaskRollback',
]) assert.ok(
  adapterWithoutExecutorPath.includes(fragment.toLowerCase().replace(/["']/gu, '')),
  `performance adapter contract missing: ${fragment}`,
)
assert.ok(
  containsPathMarker(normalizedPerformanceAdapter, normalizedFixedNode),
  'performance adapter fixed Node executor path missing',
)
assert.ok(
  containsPathMarker(adapterWithoutExecutorPath, normalizedFixedNpx),
  'performance adapter fixed npx-cli path missing',
)
assert.ok(!/insert\s+into\s+auth\.users/iu.test(performanceAdapter), 'performance adapter must never write auth.users through SQL')

console.log('TEAM_OS_4_G2_CONTRACT_OK schema=3 backend=static-only migrations=strict-order waiting=readonly-preflight cursor=business-date-frozen businessCompletion=atomic-claim-lead remoteRunner=explicit-opt-in runtimeEvidence=pending accepted=false')
