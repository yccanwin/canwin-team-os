import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  getTemporaryDbEnvironment,
  loadRestoreRun,
  runExternal,
  runPgTool,
  runPsql,
  runSupabaseJson,
} from './temporary-db-access.mjs'
import { getManagedSchemaCustomizationSql, getReconciliation, sha256 } from './sealed-recovery-lib.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const run = loadRestoreRun(repoRoot)
const sourceRef = run.source.projectRef
const targetRef = run.target.projectRef
const cliPath = run.toolchain.supabaseCli.path
const psqlPath = run.toolchain.psql.path
const pgDumpPath = run.toolchain.pgDump.path
const pgDumpAllPath = resolve(dirname(pgDumpPath), 'pg_dumpall.exe')
const preflightDumpRoot = resolve('D:\\CanWin-Team-OS-4.0-Recovery-Preflight')
const forbiddenTableTriggerTogglePattern = /^ALTER TABLE(?: ONLY)? .+ (?:DISABLE|ENABLE) TRIGGER ALL;$/m

function fail(message) {
  console.error('[p0:sealed-preflight] BLOCKED ' + message)
  process.exit(1)
}

function parseJson(label, text) {
  try {
    return JSON.parse(text)
  } catch {
    fail(label + ' did not return valid JSON')
  }
}

function findServerKey(keys) {
  if (!Array.isArray(keys)) return null
  const candidates = []
  for (const item of keys) {
    if (!item || typeof item !== 'object') continue
    const label = String(item.name ?? item.type ?? item.role ?? '').toLowerCase()
    for (const field of ['api_key', 'key', 'value']) {
      const value = item[field]
      if (typeof value !== 'string') continue
      if (value.startsWith('sb_secret_')) candidates.unshift(value)
      else if (label.includes('service_role') || label === 'service') candidates.push(value)
    }
  }
  return candidates[0] ?? null
}

async function collectStorage(client) {
  const bucketsResult = await client.storage.listBuckets()
  if (bucketsResult.error) throw new Error('cannot list Storage buckets: ' + bucketsResult.error.message)
  const records = []
  async function walk(bucketId, prefix = '') {
    let offset = 0
    while (true) {
      const result = await client.storage.from(bucketId).list(prefix, {
        limit: 100,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (result.error) throw new Error('cannot list Storage objects')
      const items = result.data ?? []
      for (const item of items) {
        const path = prefix ? `${prefix}/${item.name}` : item.name
        if (item.id === null) await walk(bucketId, path)
        else {
          const downloaded = await client.storage.from(bucketId).download(path)
          if (downloaded.error) throw new Error('cannot download a Storage object during preflight')
          const bytes = Buffer.from(await downloaded.data.arrayBuffer())
          records.push({ bucketId, path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
        }
      }
      if (items.length < 100) break
      offset += items.length
    }
  }
  for (const bucket of bucketsResult.data ?? []) await walk(bucket.id)
  return {
    buckets: bucketsResult.data?.length ?? 0,
    objects: records.length,
    bytes: records.reduce((sum, item) => sum + item.bytes, 0),
    aggregateSha256: createHash('sha256')
      .update(records.sort((a, b) => `${a.bucketId}/${a.path}`.localeCompare(`${b.bucketId}/${b.path}`, 'en'))
        .map((item) => `${item.bucketId}/${item.path}|${item.bytes}|${item.sha256}`).join('\n'))
      .digest('hex'),
  }
}

if (sourceRef === targetRef) fail('source and target project refs are identical')
for (const [name, path] of [['Supabase CLI', cliPath], ['psql', psqlPath], ['pg_dump', pgDumpPath], ['pg_dumpall', pgDumpAllPath]]) {
  if (typeof path !== 'string' || !existsSync(path) || !statSync(path).isFile()) fail(name + ' path is not ready')
}

const sourceDb = getTemporaryDbEnvironment({ cliPath, projectRef: sourceRef, connectionMode: 'session-pooler' })
const targetDb = getTemporaryDbEnvironment({ cliPath, projectRef: targetRef, connectionMode: 'session-pooler' })
const platformSql = `
with columns as (
  select table_schema,count(*)::int as column_count,
    md5(string_agg(format('%s.%s|%s|%s|%s|%s',table_name,column_name,data_type,udt_name,is_nullable,coalesce(column_default,'')),E'\\n' order by table_name,ordinal_position)) as columns_md5
  from information_schema.columns where table_schema in ('auth','storage') group by table_schema
), tables as (
  select n.nspname,count(*)::int as table_count,md5(string_agg(c.relname,E'\\n' order by c.relname)) as tables_md5
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('auth','storage') and c.relkind in ('r','p') group by n.nspname
)
select json_build_object(
  'serverVersion',current_setting('server_version_num')::int,
  'publicTables',(select count(*)::int from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),
  'salesOsPrivateSchemas',(select count(*)::int from pg_catalog.pg_namespace where nspname='sales_os_private'),
  'salesOsPrivateDataRelations',(select count(*)::int from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='sales_os_private' and c.relkind in('r','p','S','m')),
  'salesOsPrivateRoutines',(select count(*)::int from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='sales_os_private'),
  'salesOsPrivatePublicTriggerFunctions',(select count(*)::int from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace tn on tn.oid=c.relnamespace join pg_catalog.pg_proc p on p.oid=t.tgfoid join pg_catalog.pg_namespace pn on pn.oid=p.pronamespace where tn.nspname='public' and pn.nspname='sales_os_private' and not t.tgisinternal),
  'supabaseAdminPublicDefaultPrivilegeRows',(select count(*)::int from pg_catalog.pg_default_acl d join pg_catalog.pg_roles r on r.oid=d.defaclrole left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace where r.rolname='supabase_admin' and n.nspname='public'),
  'supabaseAdminPublicDefaultPrivilegesMd5',(select md5(coalesce(string_agg(r.rolname||'|'||coalesce(n.nspname,'')||'|'||d.defaclobjtype::text||'|'||d.defaclacl::text,E'\n' order by r.rolname,n.nspname,d.defaclobjtype),'')) from pg_catalog.pg_default_acl d join pg_catalog.pg_roles r on r.oid=d.defaclrole left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace where r.rolname='supabase_admin' and n.nspname='public'),
  'authUsers',(select count(*)::int from auth.users),
  'storageObjects',(select count(*)::int from storage.objects),
  'storageBuckets',(select count(*)::int from storage.buckets),
  'databaseBytes',pg_database_size(current_database()),
  'authTables',(select table_count from tables where nspname='auth'),
  'authTablesMd5',(select tables_md5 from tables where nspname='auth'),
  'authColumns',(select column_count from columns where table_schema='auth'),
  'authColumnsMd5',(select columns_md5 from columns where table_schema='auth'),
  'storageTables',(select table_count from tables where nspname='storage'),
  'storageTablesMd5',(select tables_md5 from tables where nspname='storage'),
  'storageColumns',(select column_count from columns where table_schema='storage'),
  'storageColumnsMd5',(select columns_md5 from columns where table_schema='storage'),
  'extensions',(select json_agg(json_build_object('name',extname,'version',extversion) order by extname) from pg_catalog.pg_extension)
)::text;`
const source = parseJson('source platform query', runPsql({ psqlPath, pgEnvironment: sourceDb, sql: platformSql }))
const target = parseJson('target platform query', runPsql({ psqlPath, pgEnvironment: targetDb, sql: platformSql }))
const optionalTableCount = (pgEnvironment, qualifiedName) => {
  const exists = runPsql({
    psqlPath,
    pgEnvironment,
    sql: `select case when to_regclass('${qualifiedName}') is null then 'false' else 'true' end;`,
  }) === 'true'
  return exists ? Number(runPsql({ psqlPath, pgEnvironment, sql: `select count(*) from ${qualifiedName};` })) : 0
}
source.migrationRows = optionalTableCount(sourceDb, 'supabase_migrations.schema_migrations')
target.migrationRows = optionalTableCount(targetDb, 'supabase_migrations.schema_migrations')

if (source.publicTables !== 103) fail('production public table count drifted')
if (source.salesOsPrivateSchemas !== 1 || source.salesOsPrivateDataRelations !== 0 || source.salesOsPrivateRoutines < 4 || source.salesOsPrivatePublicTriggerFunctions !== 3) fail('production application private schema is outside the function-only recovery contract')
if (target.publicTables !== 0 || target.salesOsPrivateSchemas !== 0 || target.salesOsPrivateDataRelations !== 0 || target.salesOsPrivateRoutines !== 0 || target.authUsers !== 0 || target.storageBuckets !== 0 || target.storageObjects !== 0 || target.migrationRows !== 0) fail('isolated target is not empty')
for (const field of [
  'serverVersion', 'authTables', 'authTablesMd5', 'authColumns', 'authColumnsMd5',
  'storageTables', 'storageTablesMd5', 'storageColumns', 'storageColumnsMd5',
  'supabaseAdminPublicDefaultPrivilegeRows', 'supabaseAdminPublicDefaultPrivilegesMd5',
]) {
  if (source[field] !== target[field]) fail('source and target platform schema differ at ' + field)
}
if (JSON.stringify(source.extensions) !== JSON.stringify(target.extensions)) fail('source and target extensions differ')

const managedSql = `
with triggers as (
  select n.nspname,count(*)::int as trigger_count,
    md5(coalesce(string_agg(pg_get_triggerdef(t.oid,true),E'\\n' order by c.relname,t.tgname),'')) as trigger_md5
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and n.nspname in ('auth','storage') group by n.nspname
), policies as (
  select n.nspname,count(*)::int as policy_count,
    md5(coalesce(string_agg(p.polname||'|'||p.polcmd::text||'|'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),E'\\n' order by c.relname,p.polname),'')) as policy_md5
  from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('auth','storage') group by n.nspname
)
select jsonb_build_object(
  'authTriggers',coalesce((select trigger_count from triggers where nspname='auth'),0),
  'authTriggersMd5',coalesce((select trigger_md5 from triggers where nspname='auth'),md5('')),
  'storageTriggers',coalesce((select trigger_count from triggers where nspname='storage'),0),
  'storageTriggersMd5',coalesce((select trigger_md5 from triggers where nspname='storage'),md5('')),
  'authPolicies',coalesce((select policy_count from policies where nspname='auth'),0),
  'authPoliciesMd5',coalesce((select policy_md5 from policies where nspname='auth'),md5('')),
  'storagePolicies',coalesce((select policy_count from policies where nspname='storage'),0),
  'storagePoliciesMd5',coalesce((select policy_md5 from policies where nspname='storage'),md5(''))
)::text;`
const sourceManaged = parseJson('source managed schema query', runPsql({ psqlPath, pgEnvironment: sourceDb, sql: managedSql }))
const targetManaged = parseJson('target managed schema query', runPsql({ psqlPath, pgEnvironment: targetDb, sql: managedSql }))
for (const field of ['storageTriggers', 'storageTriggersMd5', 'authPolicies', 'authPoliciesMd5']) {
  if (sourceManaged[field] !== targetManaged[field]) fail('source and target managed schema differ at ' + field)
}
if (targetManaged.storagePolicies !== 0 || sourceManaged.storagePolicies < 1) fail('custom Storage policy boundary is not ready')
const managedCustomization = getManagedSchemaCustomizationSql({
  psqlPath,
  sourcePgEnvironment: sourceDb,
  targetPgEnvironment: targetDb,
})
if (!managedCustomization.sql.includes('create policy ') ||
    !managedCustomization.sql.includes('CREATE TRIGGER on_auth_user_created') ||
    managedCustomization.sql.includes('undefined')) fail('authorized managed schema customizations cannot be serialized')

const reconciliationSql = readFileSync(resolve(repoRoot, 'scripts', 'p0', 'sealed-reconciliation.sql'), 'utf8')
const sourceReconciliation = getReconciliation({ psqlPath, pgEnvironment: sourceDb, sql: reconciliationSql })
if (Object.keys(sourceReconciliation.value.publicTables ?? {}).length !== source.publicTables) fail('exact reconciliation table inventory drifted')

const dump = (commandPath, args, timeout = 300000) => runPgTool({ commandPath, pgEnvironment: sourceDb, args, timeout }).stdout
const schemaDump = dump(pgDumpPath, ['--schema=public', '--schema=sales_os_private', '--schema-only', '--no-owner', '--no-comments', '--encoding=UTF8', '--role=postgres'])
if ((schemaDump.match(/CREATE SCHEMA public;/g) ?? []).length !== 1) fail('public schema dump shape is unsupported')
if ((schemaDump.match(/CREATE SCHEMA sales_os_private;/g) ?? []).length !== 1 || !schemaDump.includes('FUNCTION sales_os_private.refresh_order_performance_state_core(')) fail('application private schema dump is incomplete')
if (!schemaDump.includes('FUNCTION public.handle_new_user()')) fail('authorized Auth linkage function is absent from the public schema dump')
const sourceDefaultAclCount = Number(runPsql({
  psqlPath,
  pgEnvironment: sourceDb,
  sql: `select count(*) from pg_catalog.pg_default_acl d join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public';`,
}))
if (sourceDefaultAclCount > 0 && !schemaDump.includes('ALTER DEFAULT PRIVILEGES')) fail('source default privileges are absent from the public schema dump')
const sourceAclRoles = parseJson('source ACL role inventory', runPsql({
  psqlPath,
  pgEnvironment: sourceDb,
  sql: `with role_oids as (
    select distinct a.grantee from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl) a where n.nspname='public' and c.relacl is not null
    union select distinct a.grantee from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(p.proacl) a where n.nspname='public' and p.proacl is not null
    union select distinct a.grantee from pg_catalog.pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
  ) select coalesce(jsonb_agg(r.rolname order by r.rolname),'[]'::jsonb)::text from role_oids o join pg_catalog.pg_roles r on r.oid=o.grantee;`,
}))
const targetRoles = new Set(parseJson('target role inventory', runPsql({
  psqlPath,
  pgEnvironment: targetDb,
  sql: `select coalesce(jsonb_agg(rolname order by rolname),'[]'::jsonb)::text from pg_catalog.pg_roles;`,
})))
if (sourceAclRoles.some((role) => !targetRoles.has(role))) fail('target is missing a role referenced by source ACLs')

function isControlledDumpDirectory(path) {
  const absolute = resolve(path)
  return dirname(absolute).toLowerCase() === preflightDumpRoot.toLowerCase() &&
    basename(absolute).startsWith('.dump-')
}

function writePreflightDump(commandPath, args, outputPath) {
  const outputDirectory = dirname(resolve(outputPath))
  if (!isControlledDumpDirectory(outputDirectory)) {
    throw new Error('preflight dump output escaped the controlled directory')
  }
  runPgTool({
    commandPath,
    pgEnvironment: sourceDb,
    args: [...args, '--file', outputPath],
    timeout: 300000,
  })
  if (!existsSync(outputPath) || !statSync(outputPath).isFile() || statSync(outputPath).size <= 0) {
    throw new Error('preflight dump did not create a non-empty real file')
  }
  if (forbiddenTableTriggerTogglePattern.test(readFileSync(outputPath, 'utf8'))) {
    throw new Error('preflight dump contains forbidden table trigger toggles')
  }
}

mkdirSync(preflightDumpRoot, { recursive: true })
const preflightDumpDirectory = mkdtempSync(join(preflightDumpRoot, '.dump-'))
if (!isControlledDumpDirectory(preflightDumpDirectory)) fail('preflight dump directory is outside the controlled D drive root')
let dumpPreflightError = null
try {
  writePreflightDump(
    pgDumpAllPath,
    ['--roles-only', '--no-role-passwords', '--no-privileges', '--no-comments', '--role=postgres'],
    join(preflightDumpDirectory, 'roles.sql'),
  )
  writePreflightDump(
    pgDumpPath,
    ['--schema=public', '--data-only', '--inserts', '--rows-per-insert=100', '--no-owner', '--no-privileges', '--encoding=UTF8', '--role=postgres'],
    join(preflightDumpDirectory, 'public-data.sql'),
  )
  writePreflightDump(
    pgDumpPath,
    ['--schema=auth', '--table=auth.users', '--table=auth.identities', '--data-only', '--column-inserts', '--no-owner', '--no-privileges', '--encoding=UTF8', '--role=postgres'],
    join(preflightDumpDirectory, 'auth-durable-data.sql'),
  )
} catch (error) {
  dumpPreflightError = error
} finally {
  if (!isControlledDumpDirectory(preflightDumpDirectory)) {
    throw new Error('refusing to remove an uncontrolled preflight dump directory')
  }
  rmSync(preflightDumpDirectory, { recursive: true, force: true })
}
if (dumpPreflightError) fail('real-file dump preflight failed: ' + dumpPreflightError.message)

const migrationSchemaDump = dump(pgDumpPath, ['--schema=supabase_migrations', '--schema-only', '--no-owner', '--no-privileges', '--no-comments', '--encoding=UTF8', '--role=postgres'])
if ((migrationSchemaDump.match(/CREATE SCHEMA supabase_migrations;/g) ?? []).length !== 1) fail('migration history schema dump shape is unsupported')
let migrationDumpPreflightError = null
const migrationDumpDirectory = mkdtempSync(join(preflightDumpRoot, '.dump-'))
if (!isControlledDumpDirectory(migrationDumpDirectory)) fail('migration dump directory is outside the controlled D drive root')
try {
  writePreflightDump(
    pgDumpPath,
    ['--schema=supabase_migrations', '--data-only', '--inserts', '--rows-per-insert=100', '--no-owner', '--no-privileges', '--encoding=UTF8', '--role=postgres'],
    join(migrationDumpDirectory, 'migration-data.sql'),
  )
} catch (error) {
  migrationDumpPreflightError = error
} finally {
  if (!isControlledDumpDirectory(migrationDumpDirectory)) {
    throw new Error('refusing to remove an uncontrolled migration dump directory')
  }
  rmSync(migrationDumpDirectory, { recursive: true, force: true })
}
if (migrationDumpPreflightError) fail('real-file migration dump preflight failed: ' + migrationDumpPreflightError.message)

const apiKeys = runSupabaseJson({
  cliPath,
  args: ['projects', 'api-keys', '--project-ref', sourceRef, '--reveal'],
})
const serverKey = findServerKey(apiKeys)
if (!serverKey) fail('no server-side Storage key is available')
const storage = await collectStorage(createClient(`https://${sourceRef}.supabase.co`, serverKey, {
  auth: { autoRefreshToken: false, persistSession: false },
}))
if (storage.objects !== source.storageObjects) fail('downloadable Storage objects do not reconcile to database metadata')

const sourceFunctions = runSupabaseJson({ cliPath, args: ['functions', 'list', '--project-ref', sourceRef] })
const targetFunctions = runSupabaseJson({ cliPath, args: ['functions', 'list', '--project-ref', targetRef] })
const targetSecrets = runSupabaseJson({ cliPath, args: ['secrets', 'list', '--project-ref', targetRef] })
if (!Array.isArray(targetFunctions) || targetFunctions.length !== 0) fail('isolated target already has Edge Functions')
if (!Array.isArray(targetSecrets) || targetSecrets.length !== 0) fail('isolated target already has Function secrets')

const functionWorkdir = mkdtempSync(join(tmpdir(), 'canwin-p0-functions-preflight-'))
try {
  if (sourceFunctions.length > 0) {
    mkdirSync(resolve(functionWorkdir, 'supabase', 'functions'), { recursive: true })
    runExternal({
      commandPath: cliPath,
      args: ['functions', 'download', '--project-ref', sourceRef, '--use-api', '--workdir', functionWorkdir, '--yes'],
      cwd: functionWorkdir,
      timeout: 180000,
    })
    const functionRoot = resolve(functionWorkdir, 'supabase', 'functions')
    const downloaded = existsSync(functionRoot) ? readdirSync(functionRoot, { withFileTypes: true }).filter((item) => item.isDirectory()).length : 0
    if (downloaded < sourceFunctions.length) fail('deployed Function source download is incomplete')
  }
} finally {
  rmSync(functionWorkdir, { recursive: true, force: true })
}

console.log(
  '[p0:sealed-preflight] READY sourceTables=' + source.publicTables +
  ' sourceAuthUsers=' + source.authUsers + ' sourceDatabaseBytes=' + source.databaseBytes +
  ' storageBuckets=' + storage.buckets + ' storageObjects=' + storage.objects +
  ' storageBytes=' + storage.bytes + ' sourceFunctions=' + sourceFunctions.length +
  ' targetTables=0 targetAuthUsers=0 targetStorageObjects=0 targetFunctions=0 targetSecrets=0',
)
console.log(
  '[p0:sealed-preflight] platformCompatibility=EXACT authTables=' + source.authTables +
  ' authColumns=' + source.authColumns + ' storageTables=' + source.storageTables +
  ' storageColumns=' + source.storageColumns + ' storagePolicies=' + sourceManaged.storagePolicies +
  ' reconciliationSha256=' + sourceReconciliation.sha256 + ' querySha256=' + sha256(reconciliationSql) +
  ' authTriggerCustomizations=' + managedCustomization.triggerDiff.sourceOnly.length +
  ' dumpShapes=roles/public/auth/migrations functionsDownload=PASS secretsPrinted=0 writes=temporary-login-role-only formalAttempt=0',
)
