import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { canonicalJson, getServerKey, quoteSqlLiteral } from './sealed-recovery-lib.mjs'
import {
  getTemporaryDbEnvironment,
  loadRestoreRun,
  runPgTool,
  runPsql,
  runSupabaseJson,
} from './temporary-db-access.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const run = loadRestoreRun(repoRoot)
const targetRef = run.target.projectRef
const cliPath = run.toolchain.supabaseCli.path
const psqlPath = run.toolchain.psql.path
const candidatePath = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'candidates', 'security-invoker-views.sql')
const evidenceRoot = resolve('D:\\CanWin-Team-OS-4.0-Security-Validation')
const roles = ['sales', 'implementation', 'operations', 'finance', 'admin']
const views = ['finance_public_summary', 'inventory_public_items', 'assets_public']
const mainTeam = 'CANWIN_TEAM'
const otherTeam = 'CANWIN_P0_SECURITY_OTHER'
const fixtureCategory = 'P0_SECURITY_FIXTURE'
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const candidateSql = readFileSync(candidatePath, 'utf8')
const candidateSha256 = sha256(candidateSql)
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const runId = `p0-security-invoker-${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${gitCommit.slice(0, 10)}`
const evidenceDirectory = resolve(evidenceRoot, runId)
const validationEvidencePath = resolve(evidenceDirectory, 'validation-evidence.json')
const failurePath = resolve(evidenceDirectory, 'failure.json')

if (run.state !== 'succeeded' || run.target.environment !== 'isolated-test' || run.target.previewBuildAllowed !== false) {
  throw new Error('sealed restore acceptance is not ready for isolated security validation')
}
if (targetRef !== 'zdmuaqokndhhbarudhtw' || run.source.projectRef === targetRef) {
  throw new Error('security validation target does not match the frozen isolated project')
}
const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean)
  .filter((line) => !line.slice(3).replaceAll('\\', '/').startsWith('.codex-audit/'))
if (porcelain.length !== 0) throw new Error('tracked security validation implementation is not committed')
if (!/^[a-f0-9]{40}$/.test(gitCommit)) throw new Error('cannot resolve immutable Git commit')
if (existsSync(evidenceDirectory)) throw new Error('security validation run id already exists')
mkdirSync(evidenceRoot, { recursive: true })
mkdirSync(evidenceDirectory, { recursive: false })

let db = null
const parseJson = (label, text) => {
  try { return JSON.parse(text) } catch { throw new Error(label + ' did not return valid JSON') }
}
const sqlJson = (label, sql) => parseJson(label, runPsql({
  psqlPath,
  pgEnvironment: db,
  sql,
  retryReadOnlySessionPooler: true,
}))
const objectSnapshot = () => sqlJson('security object snapshot', `select jsonb_build_object(
  'views',(select jsonb_agg(jsonb_build_object(
    'name',c.relname,'owner',pg_get_userbyid(c.relowner),'definition',pg_get_viewdef(c.oid,true),
    'reloptions',coalesce((select jsonb_agg(x order by x) from unnest(coalesce(c.reloptions,array[]::text[])) x),'[]'::jsonb),
    'acl',coalesce((select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else r.rolname end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by case when a.grantee=0 then 'PUBLIC' else r.rolname end,a.privilege_type,a.is_grantable) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a left join pg_catalog.pg_roles r on r.oid=a.grantee),'[]'::jsonb),
    'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod)) order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)
  ) order by c.relname) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('finance_public_summary','inventory_public_items','assets_public')),
  'policies',(select jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check) order by tablename,policyname) from pg_catalog.pg_policies where schemaname='public' and policyname in('finance roles read finance records','finance roles manage finance records','inventory roles read inventory items','asset roles read assets')),
  'privileges',(select jsonb_agg(jsonb_build_object(
    'view',v,'anonSelect',has_table_privilege('anon',format('public.%I',v),'SELECT'),
    'authenticatedSelect',has_table_privilege('authenticated',format('public.%I',v),'SELECT'),
    'authenticatedInsert',has_table_privilege('authenticated',format('public.%I',v),'INSERT'),
    'authenticatedUpdate',has_table_privilege('authenticated',format('public.%I',v),'UPDATE'),
    'authenticatedDelete',has_table_privilege('authenticated',format('public.%I',v),'DELETE')
  ) order by v) from unnest(array['finance_public_summary','inventory_public_items','assets_public']) v)
)::text;`)

let serverKey = null
let publishableKey = null
let baseline = null
const testUsers = []
const fixtureIds = {
  mainFinance: randomUUID(), otherFinance: randomUUID(),
  mainInventory: randomUUID(), otherInventory: randomUUID(),
  mainAsset: randomUUID(), otherAsset: randomUUID(),
}
const suffix = randomBytes(8).toString('hex')
let formalAttemptStarted = false
try {
  db = getTemporaryDbEnvironment({ cliPath, projectRef: targetRef, connectionMode: 'session-pooler' })
  baseline = sqlJson('security baseline', `select jsonb_build_object(
    'authUsers',(select count(*) from auth.users),
    'bannedRealUsers',(select count(*) from auth.users where banned_until>now()+interval '99 years'),
    'existingTestUsers',(select count(*) from auth.users where raw_app_meta_data @> '{"canwin_p0_security_test":true}'::jsonb),
    'otherTeamRows',(select count(*) from public.teams where id='${otherTeam}'),
    'fixtureRows',(select (select count(*) from public.finance_records where category='${fixtureCategory}')+(select count(*) from public.inventory_items where sku like 'P0-SEC-%')+(select count(*) from public.assets where category='${fixtureCategory}'))
  )::text;`)
  if (Number(baseline.authUsers) !== 7 || Number(baseline.bannedRealUsers) !== 7 ||
      Number(baseline.existingTestUsers) !== 0 || Number(baseline.otherTeamRows) !== 0 || Number(baseline.fixtureRows) !== 0) {
    throw new Error('isolated target is not at the accepted pre-security-test baseline')
  }
  serverKey = getServerKey({ cliPath, projectRef: targetRef })
  const keys = runSupabaseJson({ cliPath, args: ['projects', 'api-keys', '--project-ref', targetRef, '--reveal'] })
  const publishable = keys.find((item) => item?.type === 'publishable' && item?.disabled !== true) ??
    keys.find((item) => item?.name === 'anon' && item?.disabled !== true)
  publishableKey = publishable?.api_key ?? publishable?.key ?? publishable?.value ?? null
  if (typeof publishableKey !== 'string' || publishableKey.length < 20) throw new Error('target publishable key is unavailable')
  const adminClient = createClient(`https://${targetRef}.supabase.co`, serverKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  for (const role of roles) {
    const email = `p0-security-${role}-${suffix}@example.invalid`
    const passwordBytes = randomBytes(32)
    const password = passwordBytes.toString('base64url') + 'Aa1!'
    const created = await adminClient.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { canwin_p0_security_test: true, role },
      user_metadata: { name: `P0_SECURITY_${role}_${suffix}` },
    })
    passwordBytes.fill(0)
    if (created.error || !created.data.user?.id) throw new Error('cannot create an isolated synthetic identity for ' + role)
    testUsers.push({ role, email, password, id: created.data.user.id })
  }

  const roleAssignments = testUsers.map((item) => `
    update public.profiles set team_id=${quoteSqlLiteral(mainTeam)},role='member',status='active' where id=${quoteSqlLiteral(item.id)}::uuid;
    insert into public.profile_access_roles(team_id,profile_id,role_id,assigned_by)
    select ${quoteSqlLiteral(mainTeam)},${quoteSqlLiteral(item.id)}::uuid,ar.id,null from public.access_roles ar
    where ar.team_id=${quoteSqlLiteral(mainTeam)} and ar.code=${quoteSqlLiteral(item.role)};`).join('\n')
  runPsql({ psqlPath, pgEnvironment: db, sql: `begin;
    insert into public.teams(id,name,slug) values('${otherTeam}','P0 Security Other Team','p0-security-other');
    ${roleAssignments}
    insert into public.finance_records(id,team_id,record_type,amount,category,date,note) values
      ('${fixtureIds.mainFinance}'::uuid,'${mainTeam}','income',123.45,'${fixtureCategory}','2099-01-01','P0 security same team'),
      ('${fixtureIds.otherFinance}'::uuid,'${otherTeam}','income',987.65,'${fixtureCategory}','2099-01-01','P0 security other team');
    insert into public.inventory_items(id,team_id,name,sku,quantity,unit,public_status,low_stock_threshold,unit_cost,supplier,sensitive_note) values
      ('${fixtureIds.mainInventory}'::uuid,'${mainTeam}','P0 Security Inventory Main','P0-SEC-MAIN-${suffix}',5,'item','available',1,999,'secret-supplier','secret-note'),
      ('${fixtureIds.otherInventory}'::uuid,'${otherTeam}','P0 Security Inventory Other','P0-SEC-OTHER-${suffix}',7,'item','available',1,999,'secret-supplier','secret-note');
    insert into public.assets(id,team_id,name,category,description,purchase_date,amount,sensitive_note,status) values
      ('${fixtureIds.mainAsset}'::uuid,'${mainTeam}','P0 Security Asset Main ${suffix}','${fixtureCategory}','public description','2099-01-01',999,'secret-note','active'),
      ('${fixtureIds.otherAsset}'::uuid,'${otherTeam}','P0 Security Asset Other ${suffix}','${fixtureCategory}','public description','2099-01-01',999,'secret-note','active');
    commit;` })

  const setup = sqlJson('security fixture acceptance', `select jsonb_build_object(
    'syntheticUsers',(select count(*) from auth.users where raw_app_meta_data @> '{"canwin_p0_security_test":true}'::jsonb),
    'syntheticProfiles',(select count(*) from public.profiles where name like 'P0_SECURITY_%_${suffix}'),
    'syntheticPrimaryRoles',(select count(*) from public.profile_access_roles par join public.profiles p on p.id=par.profile_id join public.access_roles ar on ar.id=par.role_id where p.name like 'P0_SECURITY_%_${suffix}' and ar.code in('sales','implementation','operations','finance','admin')),
    'fixtureRows',(select (select count(*) from public.finance_records where category='${fixtureCategory}')+(select count(*) from public.inventory_items where sku like 'P0-SEC-%-${suffix}')+(select count(*) from public.assets where category='${fixtureCategory}')),
    'realUsersStillBanned',(select count(*) from auth.users where not(raw_app_meta_data @> '{"canwin_p0_security_test":true}'::jsonb) and banned_until>now()+interval '99 years')
  )::text;`)
  if (Number(setup.syntheticUsers) !== 5 || Number(setup.syntheticProfiles) !== 5 ||
      Number(setup.syntheticPrimaryRoles) !== 5 || Number(setup.fixtureRows) !== 6 || Number(setup.realUsersStillBanned) !== 7) {
    throw new Error('synthetic security fixture setup is incomplete')
  }

  const beforeObjects = objectSnapshot()
  const startedAt = new Date().toISOString()
  writeFileSync(resolve(evidenceDirectory, 'pre-execution-snapshot.json'), JSON.stringify({
    schemaVersion: 1, targetProjectRef: targetRef, capturedAt: startedAt,
    gitCommit, candidateSha256, baseline, setup, objects: beforeObjects,
    productionWrites: 0, secretsIncluded: false,
  }, null, 2) + '\n', { flag: 'wx' })

  formalAttemptStarted = true
  runPgTool({
    commandPath: psqlPath,
    pgEnvironment: db,
    args: ['--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1', '--single-transaction', '--file', candidatePath],
    timeout: 180000,
  })

  const afterObjects = objectSnapshot()
  for (const view of afterObjects.views ?? []) {
    if (!(view.reloptions ?? []).includes('security_invoker=true')) throw new Error(view.name + ' is not security invoker')
  }
  for (const privilege of afterObjects.privileges ?? []) {
    if (privilege.anonSelect !== false || privilege.authenticatedSelect !== true || privilege.authenticatedInsert !== false || privilege.authenticatedUpdate !== false || privilege.authenticatedDelete !== false) {
      throw new Error(privilege.view + ' has an unsafe post-candidate ACL')
    }
  }
  const policies = new Map((afterObjects.policies ?? []).map((item) => [item.name, item]))
  if (!policies.get('finance roles read finance records')?.using?.includes('has_access_role') ||
      !policies.get('finance roles manage finance records')?.using?.includes('has_access_role') ||
      !policies.get('finance roles manage finance records')?.check?.includes('has_access_role') ||
      !policies.get('inventory roles read inventory items')?.using?.includes('is_team_member') ||
      !policies.get('asset roles read assets')?.using?.includes('is_team_member')) {
    throw new Error('post-candidate policy contract does not match the frozen 4.0 read model')
  }

  const publicClient = createClient(`https://${targetRef}.supabase.co`, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const anonymous = []
  for (const view of views) {
    const result = await publicClient.from(view).select('*').limit(1)
    anonymous.push({ view, denied: Boolean(result.error), errorCode: result.error?.code ?? null })
    if (!result.error) throw new Error('anonymous view access was not denied for ' + view)
  }

  const apiResults = []
  const expectedColumns = {
    finance_public_summary: ['team_id', 'month', 'record_type', 'category', 'total_amount', 'record_count'],
    inventory_public_items: ['id', 'team_id', 'name', 'sku', 'quantity', 'unit', 'public_status', 'low_stock_threshold', 'updated_at'],
    assets_public: ['id', 'team_id', 'name', 'category', 'description', 'purchase_date', 'status', 'image_url', 'created_by', 'created_at', 'updated_at'],
  }
  for (const user of testUsers) {
    const client = createClient(`https://${targetRef}.supabase.co`, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const signedIn = await client.auth.signInWithPassword({ email: user.email, password: user.password })
    user.password = null
    if (signedIn.error || !signedIn.data.session?.access_token) throw new Error('cannot sign in isolated synthetic ' + user.role + ' identity')
    for (const view of views) {
      let sameQuery = client.from(view).select('*').eq('team_id', mainTeam)
      let otherQuery = client.from(view).select('*').eq('team_id', otherTeam)
      if (view === 'finance_public_summary') {
        sameQuery = sameQuery.eq('category', fixtureCategory)
        otherQuery = otherQuery.eq('category', fixtureCategory)
      } else if (view === 'inventory_public_items') {
        sameQuery = sameQuery.eq('sku', `P0-SEC-MAIN-${suffix}`)
        otherQuery = otherQuery.eq('sku', `P0-SEC-OTHER-${suffix}`)
      } else {
        sameQuery = sameQuery.eq('name', `P0 Security Asset Main ${suffix}`)
        otherQuery = otherQuery.eq('name', `P0 Security Asset Other ${suffix}`)
      }
      const same = await sameQuery
      const other = await otherQuery
      const writeProbe = await client.from(view).delete().eq('team_id', 'CANWIN_P0_SECURITY_WRITE_DENY')
      if (same.error || other.error) throw new Error(user.role + ' direct API read failed for ' + view)
      const expectedSame = view === 'finance_public_summary' ? (['finance', 'admin'].includes(user.role) ? 1 : 0) : 1
      if ((same.data ?? []).length !== expectedSame || (other.data ?? []).length !== 0 || !writeProbe.error) {
        throw new Error(user.role + ' direct API authorization mismatch for ' + view)
      }
      if ((same.data ?? []).length === 1) {
        const actualColumns = Object.keys(same.data[0]).sort()
        if (canonicalJson(actualColumns) !== canonicalJson([...expectedColumns[view]].sort())) {
          throw new Error(view + ' returned a field outside the frozen public projection')
        }
      }
      apiResults.push({
        role: user.role, view, sameTeamRows: (same.data ?? []).length,
        otherTeamRows: (other.data ?? []).length, writeDenied: Boolean(writeProbe.error),
        writeErrorCode: writeProbe.error?.code ?? null,
      })
    }
    await client.auth.signOut()
  }

  const completedAt = new Date().toISOString()
  const evidence = {
    schemaVersion: 1,
    evidenceType: 'canwin-team-os-4-p0-security-invoker-isolated-validation',
    runId, targetProjectRef: targetRef, gitCommit, candidateSha256,
    status: 'validated-awaiting-advisor-and-rollback', formalAttemptStarted: true, attempts: 1,
    startedAt, completedAt, anonymous, apiResults, beforeObjectsSha256: sha256(canonicalJson(beforeObjects)),
    afterObjects, syntheticUserIds: testUsers.map(({ role, id }) => ({ role, id })), fixtureIds,
    fixtureSuffix: suffix, productionWrites: 0, realUsersLoginEnabled: false,
    previewEnabled: false, outboundEnabled: false, secretsPrinted: 0, secretsWritten: 0,
  }
  writeFileSync(validationEvidencePath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' })
  console.log(`[p0:security-invoker] VALIDATED target=${targetRef} views=3 roles=5 anonymousDenied=3 crossTeamRows=0 writesDenied=15 attempts=1`)
  console.log(`[p0:security-invoker] evidence=${validationEvidencePath} evidenceSha256=${sha256(readFileSync(validationEvidencePath))} productionWrites=0 secretsPrinted=0`)
} catch (error) {
  writeFileSync(failurePath, JSON.stringify({
    schemaVersion: 1, status: 'failed', at: new Date().toISOString(), runId,
    targetProjectRef: targetRef, gitCommit, candidateSha256, formalAttemptStarted,
    attempts: formalAttemptStarted ? 1 : 0,
    message: String(error?.message ?? error).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[REDACTED]'),
    syntheticUserIds: testUsers.map(({ role, id }) => ({ role, id })), fixtureIds,
    targetPreserved: true, retryAllowed: false, productionWrites: 0, secretsPrinted: 0, secretsWritten: 0,
  }, null, 2) + '\n', { flag: 'wx' })
  throw error
} finally {
  for (const user of testUsers) user.password = null
  serverKey = null
  publishableKey = null
}
