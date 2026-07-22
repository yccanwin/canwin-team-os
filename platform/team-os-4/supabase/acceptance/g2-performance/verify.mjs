import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const supabaseRoot = resolve(here, '..', '..')
const read = (path) => readFileSync(resolve(supabaseRoot, path), 'utf8')
const compact = (value) => value.replace(/\s+/gu, ' ')

const foundation = compact(read('migrations/20260722130000_add_g2_work_items_and_business_events.sql'))
const backend = compact(read('migrations/20260722180000_g2_backend_closure.sql'))
const fixture = compact(read('migrations/20260722182000_add_g2_performance_fixture_and_index.sql'))
const setup = compact(read('acceptance/g2-performance/setup.sql'))
const cleanup = compact(read('acceptance/g2-performance/cleanup.sql'))

assert.ok(foundation.includes('constraint work_items_generation_identity unique (company_id, source_business, source_id, generation_rule)'))
assert.ok(foundation.includes('create index work_items_assignee_status_due_idx'))
assert.ok(fixture.includes('alter index public.work_items_server_bucket_cursor_idx rename to work_items_server_queue_cursor_idx;'))
assert.ok(backend.includes('create index work_items_server_bucket_cursor_idx'))
for (const column of ['company_id', 'assignee_id', 'sort_rank', 'waiting_rank', 'sort_at', 'priority_rank', 'id']) {
  assert.ok(backend.includes(column), `queue index/list cursor column missing: ${column}`)
}

for (const fragment of [
  'create table private.g2_performance_runs',
  'create or replace function public.setup_g2_performance_fixture_v1(',
  'create or replace function public.cleanup_g2_performance_fixture_v1(',
  'cardinality(p_profile_ids) <> 30',
  'from pg_catalog.generate_series(1, 100000)',
  "'g2_performance'",
  "'g2-performance:' || p_run_id",
  "target_project_ref = 'jgcrhoabvaowxnqksvkq'",
  "raw_app_meta_data ->> 'team_os_4_data_class' = 'g2-performance'",
  "raw_app_meta_data ->> 'team_os_4_run_id' = p_run_id",
  "raw_app_meta_data ->> 'team_os_4_project_ref' = p_target_project_ref",
  'security definer set search_path =',
  'from public, anon, authenticated;',
  'to service_role;',
]) assert.ok(fixture.includes(fragment), `fixture contract missing: ${fragment}`)

assert.ok(setup.includes('public.setup_g2_performance_fixture_v1('))
assert.ok(setup.includes('active_performance_profiles'))
assert.ok(setup.includes('performance_work_items'))
assert.ok(cleanup.includes('public.cleanup_g2_performance_fixture_v1('))
assert.ok(cleanup.includes('remaining_performance_work_items'))
assert.ok(cleanup.includes('remaining_performance_profiles'))

const all = `${fixture} ${setup} ${cleanup}`
assert.ok(!/(?:insert\s+into|delete\s+from|update)\s+auth\.users/iu.test(all), 'fixture SQL must not mutate auth.users')
assert.ok(!all.includes('g1_acceptance'), 'fixture must not target permanent G1 acceptance data')
assert.ok(!all.includes('agygfhmkazcbqaqwmljb'), 'known production project must not appear in the fixture')

console.log('TEAM_OS_4_G2_PERFORMANCE_FIXTURE_STATIC_OK indexes=3 profiles=30 workItems=100000 authSqlWrites=0 remoteCalls=0')
