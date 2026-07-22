import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const wait = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds) })

const TARGET_REF = 'jgcrhoabvaowxnqksvkq'
const TARGET_URL = `https://${TARGET_REF}.supabase.co`
const FIXED_NODE = 'C:\\Program Files\\nodejs\\node.exe'
const FIXED_NPX_CLI = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js'
const ADMIN_API_URL = `https://${TARGET_REF}.supabase.co/auth/v1`
const REQUIRED_MIGRATIONS = ['20260722180000', '20260722181000', '20260722182000']
const REQUIRED_INDEXES = [
  'work_items_generation_identity',
  'work_items_assignee_status_due_idx',
  'work_items_server_queue_cursor_idx',
]
const SCENARIOS = ['default', 'filtered', 'waiting-renewal', 'second-page-deep-cursor', 'search']

const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`
const uuidArray = (values) => `array[${values.map((value) => `${sqlLiteral(value)}::uuid`).join(',')}]::uuid[]`

async function adminAuthRequest(method, path, body, serviceRoleKey) {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  }
  const response = await fetch(`${ADMIN_API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`G2_ADMIN_REQUEST_FAILED:${method}:${path}:${response.status}:${response.statusText}:${text}`)
  if (!text) return {}
  return JSON.parse(text)
}

async function adminCreateUser(serviceRoleKey, user) {
  // auth.admin.createUser
  return adminAuthRequest('POST', '/admin/users', user, serviceRoleKey)
}

async function adminDeleteUser(serviceRoleKey, userId) {
  // auth.admin.deleteUser
  return adminAuthRequest('DELETE', `/admin/users/${userId}`, null, serviceRoleKey)
}

function parseMarker(output, marker) {
  const markerIndex = output.indexOf(`${marker}:`)
  assert.ok(markerIndex >= 0, `${marker} marker missing`)
  const tail = output.slice(markerIndex + marker.length + 1)
  const start = tail.indexOf('{')
  assert.ok(start >= 0, `${marker} JSON missing`)
  let depth = 0
  let quoted = false
  let escaped = false
  for (let offset = start; offset < tail.length; offset += 1) {
    const character = tail[offset]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
    } else if (character === '"') quoted = true
    else if (character === '{') depth += 1
    else if (character === '}' && --depth === 0) return JSON.parse(tail.slice(start, offset + 1))
  }
  throw new Error(`${marker} JSON incomplete`)
}

function safeError(error, secrets) {
  let message = error instanceof Error ? error.message : String(error)
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, '[REDACTED]')
  return new Error(message)
}

function setupSql(context, profileIds) {
  return `\\set ON_ERROR_STOP on
select 'G2_SETUP:' || public.setup_g2_performance_fixture_v1(
  ${sqlLiteral(context.runId)}, ${sqlLiteral(context.companyId)}::uuid,
  ${sqlLiteral(TARGET_REF)}, ${sqlLiteral(context.businessDate)}::date,
  ${uuidArray(profileIds)}
)::text as evidence;
select 'G2_DB_IDENTITY:' || pg_catalog.jsonb_build_object(
  'targetProjectRef', run.target_project_ref,
  'runId', run.run_id,
  'status', run.status
)::text as evidence
from private.g2_performance_runs as run where run.run_id = ${sqlLiteral(context.runId)};
`
}

function analyzeSql() {
  return `\\set ON_ERROR_STOP on
analyze public.work_items;
select 'G2_ANALYZE:{"completed":true}' as evidence;
`
}

function databaseEvidenceSql(context, profileIds) {
  const first = profileIds[0]
  return `\\set ON_ERROR_STOP on
begin;
create temporary table g2_plans(id text primary key, explain jsonb not null) on commit drop;
create temporary table g2_proof(key text primary key, value jsonb not null) on commit drop;

do $proof$
declare v_state text; v_residue bigint;
begin
  begin
    insert into public.profile_regions(company_id, profile_id, region)
    values (${sqlLiteral(context.companyId)}::uuid, ${sqlLiteral(first)}::uuid, ${sqlLiteral(`g2-missing-${context.runId}`)});
    insert into public.leads(company_id,name,region,phone,source_business,source_key,cleanup_due_at)
    values (${sqlLiteral(context.companyId)}::uuid, 'G2 missing task rollback', ${sqlLiteral(`g2-missing-${context.runId}`)},
      '00000000000', 'g2_performance_rollback', ${sqlLiteral(context.runId)}, pg_catalog.now());
    perform public.claim_lead_v1(${sqlLiteral(context.companyId)}::uuid, ${sqlLiteral(first)}::uuid, ${sqlLiteral(`g2-missing-task:${context.runId}`)});
    raise exception 'missing-task claim unexpectedly succeeded';
  exception when others then v_state := sqlstate;
  end;
  select
    (select pg_catalog.count(*) from public.leads where company_id=${sqlLiteral(context.companyId)}::uuid and source_business='g2_performance_rollback' and source_key=${sqlLiteral(context.runId)})
    + (select pg_catalog.count(*) from public.profile_regions where company_id=${sqlLiteral(context.companyId)}::uuid and region=${sqlLiteral(`g2-missing-${context.runId}`)})
  into v_residue;
  insert into g2_proof values ('missingTaskRollback', pg_catalog.jsonb_build_object(
    'sqlstate', v_state, 'residueCount', v_residue
  ));
end $proof$;

create or replace function pg_temp.g2_explain(p_id text, p_sql text)
returns void language plpgsql as $fn$
declare v_plan json;
begin
  execute 'explain (analyze, buffers, format json) ' || p_sql into v_plan;
  insert into g2_plans values (p_id, v_plan::jsonb);
end $fn$;

select pg_temp.g2_explain('default', ${sqlLiteral(`select public.list_work_items_v1(p_company_id => '${context.companyId}', p_assignee_id => '${first}', p_limit => 100, p_business_date => '${context.businessDate}'::date)`)});
select pg_temp.g2_explain('filtered', ${sqlLiteral(`select public.list_work_items_v1(p_company_id => '${context.companyId}', p_assignee_id => '${first}', p_statuses => array['pending','in_progress']::text[], p_role_types => array['sales']::text[], p_limit => 100, p_business_date => '${context.businessDate}'::date)`)});
select pg_temp.g2_explain('waiting-renewal', ${sqlLiteral(`select public.list_work_items_v1(p_company_id => '${context.companyId}', p_assignee_id => '${first}', p_statuses => array['waiting']::text[], p_search => 'G2 performance', p_limit => 100, p_business_date => '${context.businessDate}'::date)`)});
select pg_temp.g2_explain('second-page-deep-cursor', ${sqlLiteral(`select public.list_work_items_v1(p_company_id => '${context.companyId}', p_assignee_id => '${first}', p_limit => 100, p_business_date => '${context.businessDate}'::date)`)});
select pg_temp.g2_explain('search', ${sqlLiteral(`select public.list_work_items_v1(p_company_id => '${context.companyId}', p_assignee_id => '${first}', p_search => 'item 4242', p_limit => 100, p_business_date => '${context.businessDate}'::date)`)});
select pg_temp.g2_explain('index-generation', ${sqlLiteral(`select id from public.work_items where company_id='${context.companyId}'::uuid and source_business='g2_performance' and source_id=(select source_id from public.work_items where company_id='${context.companyId}'::uuid and generation_rule='g2-performance:${context.runId}' limit 1) and generation_rule='g2-performance:${context.runId}'`)});
select pg_temp.g2_explain('index-status-due', ${sqlLiteral(`select id from public.work_items where company_id='${context.companyId}'::uuid and assignee_id='${first}'::uuid and status='pending' order by due_at limit 100`)});
select pg_temp.g2_explain('index-server-queue', ${sqlLiteral(`select id from public.work_items where company_id='${context.companyId}'::uuid and assignee_id='${first}'::uuid order by sort_rank,waiting_rank,sort_at,priority_rank,id limit 100`)});

select 'G2_DATABASE:' || pg_catalog.jsonb_build_object(
  'migrationVersions', (select pg_catalog.jsonb_agg(version order by version) from supabase_migrations.schema_migrations where version = any(array[${REQUIRED_MIGRATIONS.map(sqlLiteral).join(',')}])),
  'dataset', pg_catalog.jsonb_build_object(
    'workItemCount', (select pg_catalog.count(*) from public.work_items where company_id=${sqlLiteral(context.companyId)}::uuid and generation_rule=${sqlLiteral(`g2-performance:${context.runId}`)}),
    'activeProfileCount', (select pg_catalog.count(*) from public.profiles where company_id=${sqlLiteral(context.companyId)}::uuid and id=any(${uuidArray(profileIds)}) and is_active),
    'sourceBusiness', 'g2_performance', 'generationRule', ${sqlLiteral(`g2-performance:${context.runId}`)},
    'indexNames', (select pg_catalog.jsonb_agg(indexname order by indexname) from pg_catalog.pg_indexes where schemaname='public' and indexname=any(array[${REQUIRED_INDEXES.map(sqlLiteral).join(',')}]))
  ),
  'missingTaskRollback', (select value from g2_proof where key='missingTaskRollback'),
  'waitingPreflight', pg_catalog.jsonb_build_object(
    'invalidRows', (select pg_catalog.count(*) from public.work_items where company_id=${sqlLiteral(context.companyId)}::uuid and ((status='waiting' and (blocked_reason is null or pg_catalog.btrim(blocked_reason)='')) or (status<>'waiting' and blocked_reason is not null)))
  ),
  'queryPlans', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'explain',explain) order by id) from g2_plans)
)::text as evidence;
commit;
`
}

function cleanupSql(context) {
  return `\\set ON_ERROR_STOP on
with first_cleanup as materialized (
  select public.cleanup_g2_performance_fixture_v1(${sqlLiteral(context.runId)}, ${sqlLiteral(TARGET_REF)}) as value
), repeat_cleanup as materialized (
  select public.cleanup_g2_performance_fixture_v1(${sqlLiteral(context.runId)}, ${sqlLiteral(TARGET_REF)}) as value from first_cleanup
)
select 'G2_CLEANUP:' || pg_catalog.jsonb_build_object(
  'database', (select value from first_cleanup),
  'databaseRepeat', (select value from repeat_cleanup)
)::text as evidence;
select 'G2_REMAINING:' || pg_catalog.jsonb_build_object(
  'workItems', (select pg_catalog.count(*) from public.work_items where generation_rule=${sqlLiteral(`g2-performance:${context.runId}`)}),
  'profiles', (select pg_catalog.count(*) from public.profiles where display_name like ${sqlLiteral(`G2 performance ${context.runId} #%`)}),
  'manifestStatus', (select status from private.g2_performance_runs where run_id=${sqlLiteral(context.runId)})
)::text as evidence;
`
}

function conditionalCleanupSql(context) {
  return `\\set ON_ERROR_STOP on
with first_cleanup as materialized (
  select public.cleanup_g2_performance_fixture_v1(${sqlLiteral(context.runId)}, ${sqlLiteral(TARGET_REF)}) as value
  where exists(select 1 from private.g2_performance_runs where run_id=${sqlLiteral(context.runId)})
), repeat_cleanup as materialized (
  select public.cleanup_g2_performance_fixture_v1(${sqlLiteral(context.runId)}, ${sqlLiteral(TARGET_REF)}) as value from first_cleanup
)
select 'G2_CLEANUP:' || pg_catalog.jsonb_build_object(
  'database', (select value from first_cleanup),
  'databaseRepeat', (select value from repeat_cleanup)
)::text as evidence;
select 'G2_REMAINING:' || pg_catalog.jsonb_build_object(
  'workItems', (select pg_catalog.count(*) from public.work_items where generation_rule=${sqlLiteral(`g2-performance:${context.runId}`)}),
  'profiles', (select pg_catalog.count(*) from public.profiles where display_name like ${sqlLiteral(`G2 performance ${context.runId} #%`)}),
  'manifestStatus', (select status from private.g2_performance_runs where run_id=${sqlLiteral(context.runId)})
)::text as evidence;
`
}

function pageParameters(context, userId, scenario, cursor) {
  const parameters = {
    p_company_id: context.companyId,
    p_assignee_id: userId,
    p_limit: 100,
    p_business_date: cursor?.business_date ?? context.businessDate,
    p_cursor_rank: cursor?.sort_rank ?? null,
    p_cursor_waiting_rank: cursor?.waiting_rank ?? null,
    p_cursor_sort_at: cursor?.sort_at ?? null,
    p_cursor_priority_rank: cursor?.priority_rank ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_cursor_business_date: cursor?.business_date ?? null,
  }
  if (scenario === 'filtered') Object.assign(parameters, { p_statuses: ['pending', 'in_progress'], p_role_types: ['sales'] })
  if (scenario === 'waiting-renewal') Object.assign(parameters, { p_statuses: ['waiting'], p_search: 'G2 performance' })
  if (scenario === 'search') parameters.p_search = 'G2 performance'
  return parameters
}

export function assertAdapterContext(context) {
  assert.equal(context?.projectRef, TARGET_REF)
  assert.equal(context?.supabaseUrl, TARGET_URL)
  assert.match(context?.commit ?? '', /^[0-9a-f]{40}$/u)
  assert.match(context?.runId ?? '', /^g2-[a-z0-9][a-z0-9-]{5,80}$/u)
  assert.match(context?.businessDate ?? '', /^\d{4}-\d{2}-\d{2}$/u)
  assert.match(context?.companyId ?? '', /^[0-9a-f-]{36}$/u)
  assert.equal(context?.firstFailureStops, true)
  assert.equal(context?.attempts, 1)
  assert.equal(context?.concurrency, 30)
  assert.equal(context?.waves, 3)
  assert.ok(context?.credentials?.serviceRoleKey?.length >= 20)
  assert.ok(context?.credentials?.anonKey?.length >= 20)
}

export async function forceCleanupG2Acceptance(context) {
  assertAdapterContext(context)
  const secrets = [context.credentials.serviceRoleKey, context.credentials.anonKey]
  const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'platform', 'team-os-4')
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'team-os-4-g2-cleanup-'))
  try {
    const file = join(temporaryDirectory, 'cleanup.sql')
    writeFileSync(file, conditionalCleanupSql(context), { encoding: 'utf8', flag: 'wx' })
    const result = spawnSync(FIXED_NODE, [FIXED_NPX_CLI, 'supabase', 'db', 'query', '--linked', '--file', file], {
      cwd: projectDirectory, env: { ...process.env, CI: '1', NO_COLOR: '1' }, encoding: 'utf8', windowsHide: true,
      timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024,
    })
    if (result.error || result.status !== 0) throw safeError(new Error(`G2_FORCE_CLEANUP_DB_FAILED:${result.error?.message ?? `exit=${result.status}`}:${result.stderr}`), secrets)
    const remaining = parseMarker(result.stdout, 'G2_REMAINING')
    assert.equal(remaining.workItems, 0)
    assert.equal(remaining.profiles, 0)

    const matches = []
    for (let page = 1; ; page += 1) {
      const data = await adminAuthRequest('GET', `/admin/users?page=${page}&perPage=1000`, null, context.credentials.serviceRoleKey)
      matches.push(...(data.users ?? []).filter((user) =>
        user.app_metadata?.team_os_4_data_class === 'g2-performance' &&
        user.app_metadata?.team_os_4_run_id === context.runId &&
        user.app_metadata?.team_os_4_project_ref === TARGET_REF))
      if ((data.users ?? []).length < 1000) break
    }
    for (const user of matches) {
      await adminDeleteUser(context.credentials.serviceRoleKey, user.id)
    }
    return { databaseRemaining: remaining, authDeleted: matches.length }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

export async function runG2Acceptance(context) {
  assertAdapterContext(context)
  assert.ok(existsSync(FIXED_NODE), `fixed Node missing: ${FIXED_NODE}`)
  assert.ok(existsSync(FIXED_NPX_CLI), `fixed npx-cli missing: ${FIXED_NPX_CLI}`)
  const secrets = [context.credentials.serviceRoleKey, context.credentials.anonKey]
  const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'platform', 'team-os-4')
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'team-os-4-g2-'))
  const createdUsers = []
  let setup
  let dbIdentity
  let database
  let samples = []
  let stableCursor
  let rls
  let crossDayCursor
  let cleanupDatabase
  let cleanupRemaining
  let primaryError

  const query = (name, sql) => {
    const file = join(temporaryDirectory, `${name}.sql`)
    writeFileSync(file, sql, { encoding: 'utf8', flag: 'wx' })
    const result = spawnSync(FIXED_NODE, [FIXED_NPX_CLI, 'supabase', 'db', 'query', '--linked', '--file', file], {
      cwd: projectDirectory, env: { ...process.env, CI: '1', NO_COLOR: '1' }, encoding: 'utf8', windowsHide: true,
      timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024,
    })
    if (result.error || result.status !== 0) throw safeError(new Error(`G2_${name.toUpperCase()}_FAILED:${result.error?.message ?? `exit=${result.status}`}:${result.stderr}`), secrets)
    return result.stdout
  }

  try {
    for (let ordinal = 1; ordinal <= 30; ordinal += 1) {
      if (ordinal > 1) await wait(500)
      const email = `${context.runId}-${ordinal}@g2-performance.example.invalid`
      const password = randomBytes(32).toString('base64url')
      const user = await adminCreateUser(context.credentials.serviceRoleKey, {
        email, password, email_confirm: true,
        app_metadata: { team_os_4_data_class: 'g2-performance', team_os_4_run_id: context.runId, team_os_4_project_ref: TARGET_REF },
      })
      if (!user?.id) throw safeError(new Error('Auth user missing'), secrets)
      createdUsers.push({ ordinal, id: user.id, email, password })
    }
    const setupOutput = query('setup', setupSql(context, createdUsers.map(({ id }) => id)))
    setup = parseMarker(setupOutput, 'G2_SETUP')
    dbIdentity = parseMarker(setupOutput, 'G2_DB_IDENTITY')
    query('analyze', analyzeSql())
    database = parseMarker(query('database-evidence', databaseEvidenceSql(context, createdUsers.map(({ id }) => id))), 'G2_DATABASE')

    const sessions = []
    for (const user of createdUsers) {
      const client = createClient(TARGET_URL, context.credentials.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
      const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password })
      if (error) throw safeError(error, secrets)
      sessions.push({ ...user, client })
    }
    const cursors = new Map()
    let overlapCount = 0
    let businessDateMismatchCount = 0
    for (const session of sessions) {
      const first = await session.client.rpc('list_work_items_v1', pageParameters(context, session.id, 'default'))
      if (first.error) throw safeError(first.error, secrets)
      const cursor = first.data?.next_cursor
      assert.ok(cursor, `cursor missing for user ${session.ordinal}`)
      cursors.set(session.id, cursor)
      if (cursor.business_date !== context.businessDate) businessDateMismatchCount += 1
      const second = await session.client.rpc('list_work_items_v1', pageParameters(context, session.id, 'second-page-deep-cursor', cursor))
      if (second.error) throw safeError(second.error, secrets)
      const firstIds = new Set(first.data.items.map(({ id }) => id))
      overlapCount += second.data.items.filter(({ id }) => firstIds.has(id)).length
    }
    stableCursor = { usersChecked: 30, overlapCount, businessDateMismatchCount }

    const crossRls = await sessions[0].client.rpc('list_work_items_v1', pageParameters(context, sessions[1].id, 'default'))
    if (crossRls.error) throw safeError(crossRls.error, secrets)
    rls = { crossAssigneeVisible: crossRls.data.items.length }
    const expiredCursor = { ...cursors.get(sessions[0].id), business_date: new Date(`${context.businessDate}T00:00:00Z`).toISOString().slice(0, 10) }
    expiredCursor.business_date = new Date(Date.parse(`${context.businessDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    const expired = await sessions[0].client.rpc('list_work_items_v1', pageParameters(context, sessions[0].id, 'second-page-deep-cursor', expiredCursor))
    crossDayCursor = { sqlstate: expired.error?.code ?? null, rejected: expired.error?.code === '22023' }

    for (const scenario of SCENARIOS) {
      for (let wave = 1; wave <= context.waves; wave += 1) {
        const waveSamples = await Promise.all(sessions.map(async (session) => {
          const startedAtMs = performance.now()
          const cursor = scenario === 'second-page-deep-cursor' ? cursors.get(session.id) : null
          const result = await session.client.rpc('list_work_items_v1', pageParameters(context, session.id, scenario, cursor))
          const endedAtMs = performance.now()
          const durationMs = endedAtMs - startedAtMs
          return { scenario, wave, userOrdinal: session.ordinal, startedAtMs, endedAtMs, durationMs, ok: !result.error, rowCount: result.data?.items?.length ?? -1, errorCode: result.error?.code ?? null }
        }))
        if (waveSamples.some(({ ok }) => !ok)) throw new Error(`G2_SAMPLE_FAILED:${scenario}:wave-${wave}`)
        samples = samples.concat(waveSamples)
      }
    }
  } catch (error) {
    primaryError = safeError(error, secrets)
  } finally {
    const cleanupErrors = []
    try {
      const output = query('cleanup', setup ? cleanupSql(context) : conditionalCleanupSql(context))
      cleanupDatabase = parseMarker(output, 'G2_CLEANUP')
      cleanupRemaining = parseMarker(output, 'G2_REMAINING')
    } catch (error) { cleanupErrors.push(safeError(error, secrets)) }
    let authDeleted = 0
    for (const user of createdUsers) {
      try {
        await adminDeleteUser(context.credentials.serviceRoleKey, user.id)
        authDeleted += 1
      } catch (error) {
        cleanupErrors.push(safeError(error, secrets))
      }
    }
    let authRemaining = 0
    for (const user of createdUsers) {
      try {
        const data = await adminAuthRequest('GET', `/admin/users/${user.id}`, null, context.credentials.serviceRoleKey)
        if (data?.id) authRemaining += 1
      } catch (error) {
        if (!/not found|user not found/iu.test(error?.message ?? '')) cleanupErrors.push(safeError(error, secrets))
      }
    }
    cleanupRemaining = { ...(cleanupRemaining ?? {}), authUsers: authRemaining }
    cleanupDatabase = { ...(cleanupDatabase ?? {}), authDeleted }
    rmSync(temporaryDirectory, { recursive: true, force: true })
    if (cleanupErrors.length) {
      const cleanupFailure = new AggregateError(cleanupErrors, 'G2 cleanup failed')
      if (primaryError) throw new AggregateError([primaryError, cleanupFailure], 'G2 run and cleanup failed')
      throw cleanupFailure
    }
  }
  if (primaryError) throw primaryError

  return {
    schemaVersion: 1, projectRef: TARGET_REF, supabaseUrl: TARGET_URL,
    commit: context.commit, runId: context.runId, businessDate: context.businessDate,
    attempts: 1, failurePolicy: 'first-failure-stop', dbIdentity, setup,
    migrationVersions: database.migrationVersions,
    dataset: database.dataset,
    samples,
    queryPlans: database.queryPlans,
    proofs: {
      missingTaskRollback: database.missingTaskRollback,
      waitingPreflight: database.waitingPreflight,
      stableCursor,
      crossDayCursor,
      rls,
    },
    cleanup: {
      database: cleanupDatabase.database,
      databaseRepeat: cleanupDatabase.databaseRepeat,
      authDeleted: cleanupDatabase.authDeleted,
      remaining: cleanupRemaining,
      manifestStatus: cleanupRemaining.manifestStatus,
    },
  }
}

export const G2_PERFORMANCE_ADAPTER_CONTRACT = Object.freeze({
  targetRef: TARGET_REF, targetUrl: TARGET_URL, fixedNode: FIXED_NODE, fixedNpxCli: FIXED_NPX_CLI,
  requiredMigrations: REQUIRED_MIGRATIONS, requiredIndexes: REQUIRED_INDEXES,
  scenarios: SCENARIOS, concurrency: 30, waves: 3,
  authUsersViaAdminApiOnly: true, cleanupAlways: true, retries: 0,
})
