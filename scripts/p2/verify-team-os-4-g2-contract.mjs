import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8').replace(/\s+/gu, ' ')
const json = (path) => JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'))

const contract = json('scripts/p2/team-os-4-g2-acceptance-contract.json')
const foundation = read('platform/team-os-4/supabase/migrations/20260722130000_add_g2_work_items_and_business_events.sql')
const closure = read('platform/team-os-4/supabase/migrations/20260722144813_g2_backend_closure.sql')
const leadClosure = read('platform/team-os-4/supabase/migrations/20260722150801_g2_lead_claim_work_item_closure.sql')
const domain = read('packages/team-os-4-domain/src/work-item.ts')
const mapper = read('apps/team-os-4/src/domain/map-work-item-row.ts')
const selector = read('apps/team-os-4/src/domain/select-work-items.ts')
const reader = read('apps/team-os-4/src/lib/supabase-work-item-reader.ts')
const app = read('apps/team-os-4/src/App.tsx')
const scaleRunner = read('scripts/p2/run-team-os-4-g2-scale-acceptance.mjs')
const compactClosure = closure.replace(/\s+/gu, '')
const migrationNames = readdirSync(resolve(repoRoot, 'platform/team-os-4/supabase/migrations'))
  .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name))
  .sort()

assert.ok(migrationNames.indexOf('20260722144813_g2_backend_closure.sql') > migrationNames.indexOf('20260722130000_add_g2_work_items_and_business_events.sql'))
assert.ok(migrationNames.indexOf('20260722150801_g2_lead_claim_work_item_closure.sql') > migrationNames.indexOf('20260722150000_add_g3_leads_opportunities_and_claim.sql'))

const requiredBuckets = [
  'overdue_blocking',
  'due_today',
  'upcoming_business_date',
  'first_contact',
  'reclaim_soon',
  'renewal',
  'normal',
]
const requiredCursor = ['sort_rank', 'waiting_rank', 'sort_at', 'priority_rank', 'id']

assert.equal(contract.schemaVersion, 2)
assert.equal(contract.phase, 'G2')
assert.equal(contract.acceptedProgressBefore, 30)
assert.deepEqual(contract.checkpoints.map(({ progress, status }) => [progress, status]), [[35, 'pending'], [40, 'pending']])
assert.equal(contract.runtimeEvidence, 'pending')
assert.equal(contract.g2Accepted, false)
assert.equal(contract.contracts.uniqueGenerationKey, 'company_id+source_business+source_id+generation_rule')
assert.equal(contract.contracts.assigneeReassignment, 'updates-existing-work-item-without-generating-duplicate')
assert.equal(contract.contracts.businessCompletion.reminder, 'generic-completion-assignee-or-admin-only')
assert.equal(contract.contracts.businessCompletion.businessAction, 'owning-business-transaction-only')
assert.equal(contract.contracts.businessCompletion.atomicProofTransaction, 'claim_lead_v1')
assert.equal(contract.contracts.businessCompletion.idempotent, true)
assert.deepEqual(contract.contracts.serverQueue.sortBuckets, requiredBuckets)
assert.deepEqual(contract.contracts.serverQueue.cursor, requiredCursor)
assert.equal(contract.contracts.serverQueue.maximumPageSize, 100)
assert.equal(contract.contracts.serverQueue.clientResortAllowed, false)
assert.deepEqual(contract.contracts.waiting, {
  blockedReasonRequired: true,
  blockedReasonClearedOnExit: true,
  sortsFirstInsideBusinessBucket: true,
})

for (const table of ['work_items', 'business_events']) {
  assert.ok(foundation.includes(`create table public.${table} (`), `${table} table missing`)
  assert.ok(foundation.includes(`alter table public.${table} enable row level security;`), `${table} RLS missing`)
  assert.ok(foundation.includes(`revoke all on table public.${table} from anon, authenticated;`), `${table} revoke missing`)
}
assert.ok(foundation.includes('constraint work_items_generation_identity unique (company_id, source_business, source_id, generation_rule)'))
assert.ok(foundation.includes('create index work_items_assignee_status_due_idx'))

for (const fragment of [
  "add column sort_bucket text not null default 'normal'",
  'constraint work_items_waiting_reason_consistent',
  "status = 'waiting' and blocked_reason is not null",
  'add column sort_rank smallint generated always as',
  'add column waiting_rank smallint generated always as',
  'add column sort_at timestamptz generated always as',
  'add column priority_rank smallint generated always as',
  'create index work_items_server_queue_cursor_idx',
  'company_id, assignee_id, sort_rank, waiting_rank, sort_at, priority_rank, id',
]) assert.ok(closure.includes(fragment), `queue schema contract missing: ${fragment}`)

for (const bucket of requiredBuckets) {
  assert.ok(closure.includes(`'${bucket}'`), `SQL bucket missing: ${bucket}`)
  assert.ok(domain.includes(`'${bucket}'`), `domain bucket missing: ${bucket}`)
}
for (const cursorField of requiredCursor) {
  assert.ok(closure.includes(`'${cursorField}'`), `SQL cursor field missing: ${cursorField}`)
}

for (const fragment of [
  'create or replace function public.complete_work_item_v1(',
  "security definer set search_path = ''",
  "v_item.kind <> 'reminder'",
  'business-action work items can only close inside their owning business transaction',
  "p.id = v_item.assignee_id or r.role_key = 'admin'",
  'for update;',
  "update public.work_items set status = 'completed'",
  "insert into public.business_events ( company_id, work_item_id, event_type",
]) assert.ok(closure.includes(fragment), `reminder completion contract missing: ${fragment}`)

for (const fragment of [
  'create or replace function public.transition_work_item_v1(',
  "security definer set search_path = ''",
  "p_payload ->> 'blocked_reason'",
  "p_target_status = 'waiting' and v_blocked_reason is null",
  "blocked_reason = case when p_target_status = 'waiting' then v_blocked_reason else null end",
  "v_item.status in ('completed', 'cancelled')",
]) assert.ok(closure.includes(fragment), `transition contract missing: ${fragment}`)

for (const fragment of [
  'create or replace function public.create_work_item_v1(',
  "security definer set search_path = ''",
  'on conflict (company_id, source_business, source_id, generation_rule) do nothing',
  "e.event_type in ('created', 'assigned')",
  "'g2:create:' || pg_catalog.btrim(p_idempotency_key)",
  "'g2:assign:' || pg_catalog.btrim(p_idempotency_key)",
  "v_item.status in ('completed', 'cancelled')",
  "set assignee_id = p_assignee_id",
  "'status', 'reassigned'",
  "'previous_assignee_id', v_item.assignee_id",
]) assert.ok(closure.includes(fragment), `create/reassign contract missing: ${fragment}`)

const createSignature = 'public.create_work_item_v1(uuid,uuid,text,text,text,uuid,text,text,text,timestamptz,timestamptz,text,uuid,text,jsonb)'
for (const role of ['public', 'anon', 'authenticated']) {
  assert.ok(compactClosure.includes(`revokeallonfunction${createSignature}from${role};`), `create/reassign ${role} revoke missing`)
}
assert.ok(compactClosure.includes(`grantexecuteonfunction${createSignature}toservice_role;`), 'create/reassign service_role grant missing')

for (const functionSignature of [
  'public.complete_work_item_v1(uuid, uuid, text, uuid, jsonb)',
  'public.transition_work_item_v1(uuid, uuid, text, text, uuid, jsonb)',
]) {
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.ok(closure.includes(`revoke all on function ${functionSignature} from ${role};`), `${functionSignature} ${role} revoke missing`)
  }
  assert.ok(closure.includes(`grant execute on function ${functionSignature} to service_role;`), `${functionSignature} service grant missing`)
}

for (const fragment of [
  'create function public.list_work_items_v1(',
  'security invoker',
  'p_limit integer default 50',
  'p_limit > 100',
  'cursor fields must be supplied together',
  "pg_catalog.timezone('Asia/Shanghai', w.due_at)",
  'r.effective_sort_rank, r.waiting_rank, r.sort_at, r.priority_rank, r.id',
  "'next_cursor', case when v_has_more then v_next_cursor else null end",
  'to authenticated, service_role;',
]) assert.ok(closure.includes(fragment), `list RPC contract missing: ${fragment}`)

for (const fragment of [
  'create or replace function public.claim_lead_v1(',
  "security definer set search_path = ''",
  "w.source_business = 'lead'",
  "w.generation_rule = 'claim_lead_v1'",
  "v_item.kind <> 'business_action'",
  'lead claim requires its generated business-action work item',
  "update public.leads set owner_id = p_claimant_user_id",
  "update public.work_items set status = 'completed'",
  "'business_transaction', 'claim_lead_v1'",
  "v_event_key := 'g2:claim_lead:'",
  "'work_item_closed', v_work_item_closed",
]) assert.ok(leadClosure.includes(fragment), `atomic business closure missing: ${fragment}`)
for (const role of ['public', 'anon', 'authenticated']) {
  assert.ok(leadClosure.includes(`revoke all on function public.claim_lead_v1(uuid, uuid, text) from ${role};`))
}
assert.ok(leadClosure.includes('grant execute on function public.claim_lead_v1(uuid, uuid, text) to service_role;'))

for (const fragment of [
  'WORK_ITEM_STATE_TRANSITIONS',
  "return kind === 'reminder'",
  'WORK_ITEM_SORT_BUCKET_RANK',
  'readonly waitingRank: 0 | 1',
  'left.waitingRank - right.waitingRank',
]) assert.ok(domain.includes(fragment), `shared domain contract missing: ${fragment}`)
for (const fragment of [
  "requiredInteger(row, 'waiting_rank', 0, 1)",
  "item.status === 'waiting' ? waitingRank !== 0 : waitingRank !== 1",
  'nextCursor: mapWorkItemCursor(row.next_cursor)',
]) assert.ok(mapper.includes(fragment), `mapper contract missing: ${fragment}`)
for (const fragment of [
  ".rpc('list_work_items_v1'",
  'p_cursor_waiting_rank: cursor?.waitingRank ?? null',
  "timeZone: 'Asia/Shanghai'",
  'isServerOrderedWorkItemPage(page)',
]) assert.ok(reader.includes(fragment), `reader contract missing: ${fragment}`)
assert.ok(!selector.includes('.sort('), 'client work-item selector must preserve server ordering')
for (const responseField of [
  'id', 'company_id', 'source_business', 'source_id', 'role_type', 'assignee_id',
  'kind', 'title', 'priority', 'status', 'planned_at', 'due_at', 'next_step',
  'blocked_reason', 'generation_rule', 'completed_at', 'sort_bucket', 'sort_rank',
  'waiting_rank', 'sort_at', 'priority_rank',
]) assert.ok(closure.includes(`'${responseField}'`), `list response field missing: ${responseField}`)
for (const testId of ['work-items-workbench', 'work-items-progress', 'work-items-calendar']) {
  assert.ok(app.includes(`data-testid="${testId}"`) || app.includes('data-testid={`work-items-${surface}`}'))
}

assert.ok(scaleRunner.includes('workItemCount: 100_000'))
assert.ok(scaleRunner.includes('remoteCalls=0'))
assert.ok(scaleRunner.includes('accepted=false'))
assert.ok(scaleRunner.includes("throw new Error('G2 scale execution adapter is not authorized or configured')"))

console.log('TEAM_OS_4_G2_CONTRACT_OK schema=2 backend=static-only buckets=7 waiting=guarded cursor=stable reminderCompletion=guarded businessCompletion=atomic-claim-lead runtimeEvidence=pending accepted=false')
