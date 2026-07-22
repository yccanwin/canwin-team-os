import { strict as assert } from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p2/team-os-4-g2-acceptance-contract.json'), 'utf8'))
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8').replace(/\s+/gu, ' ')
const migration = read('platform/team-os-4/supabase/migrations/20260722130000_add_g2_work_items_and_business_events.sql')
const completionMigration = read('platform/team-os-4/supabase/migrations/20260722133000_add_complete_work_item_v1.sql')
const model = read('apps/team-os-4/src/domain/work-item.ts')
const selector = read('apps/team-os-4/src/domain/select-work-items.ts')
const query = read('apps/team-os-4/src/domain/work-item-query.ts')
const mapper = read('apps/team-os-4/src/domain/map-work-item-row.ts')
const appSource = read('apps/team-os-4/src/App.tsx')
const readerSource = read('apps/team-os-4/src/lib/supabase-work-item-reader.ts')
const createMigration = read('platform/team-os-4/supabase/migrations/20260722140000_add_create_work_item_v1.sql')
const scheduleMigration = read('platform/team-os-4/supabase/migrations/20260722141500_add_g2_schedule_events.sql')
const scaleRunner = read('scripts/p2/run-team-os-4-g2-scale-acceptance.mjs')
const transitionPath = resolve(repoRoot, 'platform/team-os-4/supabase/migrations/20260722134500_add_transition_work_item_v1.sql')
const transitionMigration = existsSync(transitionPath)
  ? readFileSync(transitionPath, 'utf8').replace(/\s+/gu, ' ')
  : null

assert.equal(contract.schemaVersion, 1)
assert.equal(contract.phase, 'G2')
assert.equal(contract.acceptedProgressBefore, 30)
assert.deepEqual(contract.checkpoints.map(({ progress, status }) => [progress, status]), [[35, 'pending'], [40, 'pending']])
assert.deepEqual(contract.checkpoints[0].required, [
  'work-item-unique-generation-key',
  'work-item-state-machine',
  'business-completion-idempotency',
])
assert.deepEqual(contract.checkpoints[1].required, [
  'workspace-progress-calendar-single-source',
  'mobile-workspace-progress-calendar-acceptance',
])
assert.deepEqual(contract.contracts.stateMachine, ['pending', 'in_progress', 'waiting', 'completed', 'cancelled'])
assert.equal(contract.contracts.uniqueGenerationKey, 'company_id+source_business+source_id+generation_rule')
assert.equal(contract.contracts.assigneeReassignment, 'updates-existing-work-item-without-generating-duplicate')
assert.ok(!contract.contracts.uniqueGenerationKey.includes('assignee'))
assert.deepEqual(contract.contracts.singleSourceEntrypoints, ['workspace', 'progress-center', 'calendar'])
assert.equal(contract.contracts.mobileRequired, true)
assert.deepEqual(contract.contracts.stableTestIds, ['work-items-workbench', 'work-items-progress', 'work-items-calendar'])
assert.equal(contract.contracts.sharedReader, 'SupabaseWorkItemReader')
assert.equal(contract.contracts.sharedSelector, 'selectWorkItems')
assert.equal(contract.contracts.fixturesAndMocksAllowed, false)
assert.deepEqual(contract.contracts.calendarSources, {
  workItems: 'view-only-no-copy',
  scheduleEvents: 'independent-events-with-optional-work-item-link',
  duplicateTaskGenerationAllowed: false,
})
assert.deepEqual(contract.contracts.scheduleEventTypes, ['meeting', 'visit', 'break', 'personal'])
assert.equal(contract.contracts.scheduleEventVisibility, 'owner-or-admin-rls')
assert.deepEqual(contract.contracts.calendarSourceTestIds, ['work-items-calendar', 'schedule-events-calendar'])
assert.equal(contract.contracts.scaleAcceptance.workItemCount, 100000)
assert.deepEqual(contract.contracts.scaleAcceptance.requiredIndexes, ['work_items_generation_identity', 'work_items_assignee_status_due_idx'])
assert.deepEqual(contract.contracts.scaleAcceptance.requiredEvidence, ['dataset-manifest', 'query-plan', 'stable-sort', 'response-percentiles'])
assert.equal(contract.contracts.scaleAcceptance.status, 'pending')
assert.equal(contract.contracts.scaleAcceptance.scriptPresenceCountsAsPassed, false)
assert.equal(contract.runtimeEvidence, 'pending')
assert.equal(contract.g2Accepted, false)

for (const table of ['work_items', 'business_events']) {
  assert.ok(migration.includes(`create table public.${table} (`))
  assert.ok(migration.includes(`alter table public.${table} enable row level security;`))
  assert.ok(migration.includes(`revoke all on table public.${table} from anon, authenticated;`))
}
assert.ok(migration.includes('unique (company_id, source_business, source_id, generation_rule)'))
assert.ok(migration.includes('constraint work_items_generation_identity'))
assert.ok(migration.includes('create index work_items_assignee_status_due_idx'))
assert.ok(migration.includes("status text not null default 'pending'"))
assert.ok(migration.includes("status in ('pending', 'in_progress', 'waiting', 'completed', 'cancelled')"))
assert.ok(model.includes("export type WorkItemSurface = 'workbench' | 'progress' | 'calendar'"))
assert.ok(model.includes("export type WorkItemStatus = 'pending' | 'in_progress' | 'waiting' | 'completed' | 'cancelled'"))
assert.ok(selector.includes('export function selectWorkItems('))
assert.ok(selector.includes("selection.surface === 'progress'"))
assert.ok(selector.includes("selection.surface === 'calendar'"))
assert.ok(query.includes('One read boundary shared by workbench, progress and calendar.'))
assert.ok(query.includes('load(query: WorkItemQuery): Promise<readonly WorkItem[]>'))
assert.ok(readerSource.includes('class SupabaseWorkItemReader implements WorkItemReader'))
assert.ok(appSource.includes('data-testid="work-items-workbench"'))
assert.ok(appSource.includes('data-testid={`work-items-${surface}`}'))
assert.ok(!/\b(?:fixture|mock)(?:s|data)?\b/iu.test(`${appSource} ${readerSource} ${selector}`))
assert.ok(mapper.includes("requiredString(row, 'role_type')"))
assert.ok(mapper.includes("requiredString(row, 'source_id')"))
assert.ok(completionMigration.includes('create or replace function public.complete_work_item_v1('))
assert.ok(completionMigration.includes('for update;'))
assert.ok(completionMigration.includes("set search_path = ''"))
assert.ok(completionMigration.includes('to service_role;'))
assert.ok(completionMigration.includes("event_type = 'completed'"))
assert.ok(completionMigration.includes("v_item.status = 'completed'"))
assert.ok(completionMigration.includes("'idempotent', true"))
assert.ok(completionMigration.includes("update public.work_items set status = 'completed'"))
assert.ok(completionMigration.includes('insert into public.business_events'))
for (const role of ['public', 'anon', 'authenticated']) {
  assert.ok(completionMigration.includes(`revoke all on function public.complete_work_item_v1(uuid, uuid, text, uuid, jsonb) from ${role};`))
}
for (const [property, column] of [
  ['id', 'id'], ['companyId', 'company_id'], ['sourceBusiness', 'source_business'],
  ['sourceRecordId', 'source_id'], ['assigneeId', 'assignee_id'], ['plannedAt', 'planned_at'],
  ['dueAt', 'due_at'], ['nextStep', 'next_step'], ['blockedReason', 'blocked_reason'],
  ['generationRule', 'generation_rule'], ['completedAt', 'completed_at'],
]) assert.ok(mapper.includes(`${property}: `) && mapper.includes(`row, '${column}'`), `mapper field drift: ${property}`)
for (const column of ['role_type', 'kind', 'priority', 'status']) {
  assert.ok(mapper.includes(`requiredString(row, '${column}')`), `mapper discriminator drift: ${column}`)
}
if (transitionMigration !== null) {
  for (const fragment of [
    'create or replace function public.transition_work_item_v1(',
    "p_target_status = 'completed'",
    "p_target_status not in ('in_progress', 'waiting', 'cancelled')",
    'for update;',
    "v_item.status in ('completed', 'cancelled')",
    'insert into public.business_events',
    'grant execute on function public.transition_work_item_v1(uuid, uuid, text, text, uuid, jsonb) to service_role;',
  ]) assert.ok(transitionMigration.includes(fragment), `transition contract missing: ${fragment}`)
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.ok(transitionMigration.includes(`revoke all on function public.transition_work_item_v1(uuid, uuid, text, text, uuid, jsonb) from ${role};`))
  }
}
for (const [name, source] of [
  ['create_work_item_v1', createMigration],
  ['transition_work_item_v1', transitionMigration ?? ''],
  ['complete_work_item_v1', completionMigration],
]) {
  assert.ok(source.includes(`create or replace function public.${name}(`), `${name} transaction missing`)
  assert.ok(source.includes('security definer') && source.includes("set search_path = ''"), `${name} security boundary missing`)
  assert.ok(source.includes('idempotency_key') && source.includes("'idempotent'"), `${name} idempotency contract missing`)
  for (const role of ['public', 'anon', 'authenticated']) assert.ok(source.includes(`from ${role};`), `${name} ${role} revoke missing`)
  assert.ok(source.includes('to service_role;'), `${name} service_role grant missing`)
}
assert.ok(scheduleMigration.includes('create table public.schedule_events ('))
assert.ok(scheduleMigration.includes("event_type in ('meeting', 'visit', 'break', 'personal')"))
assert.ok(scheduleMigration.includes('work_item_id uuid'))
assert.ok(scheduleMigration.includes('references public.work_items(id, company_id)'))
assert.ok(scheduleMigration.includes('alter table public.schedule_events enable row level security;'))
assert.ok(scheduleMigration.includes('create policy schedule_events_select_owner_or_admin'))
assert.ok(scheduleMigration.includes('owner_id = (select auth.uid())'))
assert.ok(scheduleMigration.includes('without creating a duplicate task'))
for (const testId of contract.contracts.calendarSourceTestIds) assert.ok(appSource.includes(`data-testid="${testId}"`))
assert.ok(scaleRunner.includes('workItemCount: 100_000'))
assert.ok(scaleRunner.includes('remoteCalls=0'))
assert.ok(scaleRunner.includes('queryPlan=not-run'))
assert.ok(scaleRunner.includes('stableSort=not-run'))
assert.ok(scaleRunner.includes('accepted=false'))
assert.ok(scaleRunner.includes("throw new Error('G2 scale execution adapter is not authorized or configured')"))

console.log(`TEAM_OS_4_G2_CONTRACT_OK checkpoints=35,40 status=pending tables=2 rls=2 uniqueKey=passed defaultStatus=pending completionTransaction=static mapper=static transition=${transitionMigration === null ? 'pending' : 'static'} surfaces=3 singleReader=passed runtimeEvidence=pending gateIntegrated=0`)
