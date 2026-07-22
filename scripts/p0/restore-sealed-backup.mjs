import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalJson,
  createServerClient,
  getReconciliation,
  getServerKey,
  parseJson,
  quoteSqlLiteral,
  readEncryptedArtifact,
  readProtectedKey,
  restoreStorageArchive,
  sha256,
  verifyStorageArchive,
} from './sealed-recovery-lib.mjs'
import {
  getTemporaryDbEnvironment,
  loadRestoreRun,
  runExternal,
  runPgTool,
  runPsql,
  runSupabaseJson,
} from './temporary-db-access.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const applicationPrivateSchema = 'sales_os_private'
const forbiddenTableTriggerTogglePattern = /^ALTER TABLE(?: ONLY)? .+ (?:DISABLE|ENABLE) TRIGGER ALL;$/m
const requiredApplicationPrivateRoutines = [
  'refresh_order_performance_state_core',
  'refresh_performance_after_payment',
  'refresh_performance_after_reversal',
  'refresh_performance_after_cancellation',
]
const args = process.argv.slice(2)
const manifestIndex = args.indexOf('--manifest')
const manifestPath = manifestIndex >= 0 ? resolve(args[manifestIndex + 1] ?? '') : null
if (args.includes('--help')) {
  console.log('Usage: node scripts/p0/restore-sealed-backup.mjs --manifest <absolute-path>')
  process.exit(0)
}
if (!manifestPath || !existsSync(manifestPath)) throw new Error('--manifest must point to a sealed backup manifest')

const packageDirectory = dirname(manifestPath)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const runContract = loadRestoreRun(repoRoot)
if (manifest.template !== false || manifest.package?.sourceProjectRef !== runContract.source.projectRef ||
    manifest.restoreEvidence?.targetProjectRef !== runContract.target.projectRef) {
  throw new Error('backup package does not match the registered source and target')
}
runExternal({
  commandPath: process.execPath,
  args: [resolve(repoRoot, 'scripts', 'p0', 'verify-backup-package-runtime.mjs'), '--manifest', manifestPath],
  cwd: repoRoot,
})

const packageId = manifest.package.packageId
const keyPath = resolve('E:\\CanWin-Team-OS-4.0-Recovery-Keys', `${packageId}.dpapi`)
if (manifest.package.encryptionKeyReference !== `dpapi-file:///E:/CanWin-Team-OS-4.0-Recovery-Keys/${packageId}.dpapi`) {
  throw new Error('backup key reference is not the registered external DPAPI path')
}
const key = readProtectedKey({ repoRoot, keyPath })
const workingDirectory = mkdtempSync(resolve('D:\\CanWin-Team-OS-4.0-Recovery', `.restore-working-${packageId}-`))
const clearSensitiveWorkingState = () => {
  rmSync(workingDirectory, { recursive: true, force: true })
  key.fill(0)
}
process.once('exit', clearSensitiveWorkingState)
const evidencePath = resolve(packageDirectory, 'restore-evidence.json')
if (existsSync(evidencePath)) throw new Error('this sealed package already has restore evidence and cannot be attempted again')

const artifactEntries = [
  ['database.rolesDump', manifest.database.rolesDump],
  ['database.schemaDump', manifest.database.schemaDump],
  ['database.dataDump', manifest.database.dataDump],
  ['database.migrationHistorySchemaDump', manifest.database.migrationHistorySchemaDump],
  ['database.migrationHistoryDataDump', manifest.database.migrationHistoryDataDump],
  ['database.authStorageSchemaDiff', manifest.database.authStorageSchemaDiff],
  ['database.schemaInventory', manifest.database.schemaInventory],
  ['auth.identitiesDump', manifest.auth.identitiesDump],
  ['auth.identityRoleMapping', manifest.auth.identityRoleMapping],
  ['auth.settingsManifest', manifest.auth.settingsManifest],
  ['storage.bucketsManifest', manifest.storage.bucketsManifest],
  ['storage.objectsManifest', manifest.storage.objectsManifest],
  ['storage.objectsArchive', manifest.storage.objectsArchive],
  ['functions.manifest', manifest.functions.manifest],
  ['functions.sourceArchive', manifest.functions.sourceArchive],
  ['cron.manifest', manifest.cron.manifest],
  ['featureFlags.manifest', manifest.featureFlags.manifest],
  ['release.frontendArtifact', manifest.release.frontendArtifact],
  ['reconciliation.tableRowCounts', manifest.reconciliation.tableRowCounts],
  ['reconciliation.keyAmounts', manifest.reconciliation.keyAmounts],
  ['reconciliation.inventory', manifest.reconciliation.inventory],
]
const decrypted = new Map()
for (const [label, artifact] of artifactEntries) {
  decrypted.set(label, readEncryptedArtifact({ packageDirectory, artifact, key }))
}
const authIdentitiesDump = decrypted.get('auth.identitiesDump')
const publicDataDump = decrypted.get('database.dataDump').toString('utf8')
const migrationDataDump = decrypted.get('database.migrationHistoryDataDump').toString('utf8')
for (const [label, sql] of [
  ['public data', publicDataDump],
  ['migration history data', migrationDataDump],
  ['Auth data', authIdentitiesDump],
]) {
  if (forbiddenTableTriggerTogglePattern.test(sql.toString('utf8'))) {
    throw new Error('sealed ' + label + ' dump contains forbidden table trigger toggles')
  }
}
if (!/^COPY public\./m.test(publicDataDump) || /^INSERT INTO public\./m.test(publicDataDump) ||
    !/^COPY supabase_migrations\.schema_migrations/m.test(migrationDataDump)) {
  throw new Error('sealed data dumps are not using line-ending-safe COPY format')
}
const applicationSchemaDump = decrypted.get('database.schemaDump').toString('utf8')
if ((applicationSchemaDump.match(/CREATE SCHEMA sales_os_private;/g) ?? []).length !== 1 ||
    requiredApplicationPrivateRoutines.some((name) => !applicationSchemaDump.includes(`CREATE FUNCTION ${applicationPrivateSchema}.${name}(`)) ||
    /^CREATE (?:TABLE|SEQUENCE|MATERIALIZED VIEW) sales_os_private\./m.test(applicationSchemaDump)) {
  throw new Error('sealed application schema is outside the function-only recovery contract')
}
if (/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin /m.test(applicationSchemaDump)) {
  throw new Error('sealed schema contains an unchangeable Supabase platform default privilege')
}
const sealedSchemaInventory = parseJson('sealed schema inventory', decrypted.get('database.schemaInventory').toString('utf8'))
if (!Number.isSafeInteger(Number(sealedSchemaInventory.supabaseAdminPublicDefaultPrivilegeRows)) ||
    Number(sealedSchemaInventory.supabaseAdminPublicDefaultPrivilegeRows) <= 0 ||
    !/^[a-f0-9]{32}$/.test(sealedSchemaInventory.supabaseAdminPublicDefaultPrivilegesMd5 ?? '')) {
  throw new Error('sealed Supabase platform default-privilege baseline is invalid')
}
const sealedExactRoutineCount = (applicationSchemaDump.match(/DO \$canwin_exact_routine\$/g) ?? []).length
if (!applicationSchemaDump.includes('-- CANWIN EXACT ROUTINE DEFINITIONS') ||
    !applicationSchemaDump.includes('-- CANWIN EXACT APPLICATION ACLS') ||
    !applicationSchemaDump.includes("-- CANWIN EXACT ROUTINE RESOLUTION PATH\nSELECT pg_catalog.set_config('search_path', 'public, sales_os_private, pg_catalog', false);") ||
    applicationSchemaDump.indexOf("SELECT pg_catalog.set_config('search_path', 'public, sales_os_private, pg_catalog', false);") >
      applicationSchemaDump.indexOf('-- CANWIN EXACT ROUTINE DEFINITIONS') ||
    applicationSchemaDump.indexOf("SELECT pg_catalog.set_config('search_path', '', false);", applicationSchemaDump.indexOf('-- CANWIN EXACT ROUTINE DEFINITIONS')) <
      applicationSchemaDump.indexOf('-- CANWIN EXACT ROUTINE DEFINITIONS') ||
    sealedExactRoutineCount !== Number(sealedSchemaInventory.publicRoutines) + Number(sealedSchemaInventory.salesOsPrivateRoutines)) {
  throw new Error('sealed schema does not contain the exact routine and ACL overlay')
}
const managedCustomizationSql = decrypted.get('database.authStorageSchemaDiff').toString('utf8')
if (!managedCustomizationSql.includes('FROM public.profiles') || managedCustomizationSql.includes('FROM profiles') ||
    !managedCustomizationSql.includes('public.has_permission(') ||
    !managedCustomizationSql.includes('public.current_profile_role(') ||
    !managedCustomizationSql.includes('EXECUTE FUNCTION public.handle_new_user()')) {
  throw new Error('sealed managed customization SQL contains an unqualified application dependency')
}

const cliPath = runContract.toolchain.supabaseCli.path
const psqlPath = runContract.toolchain.psql.path
const sourceRef = runContract.source.projectRef
const targetRef = runContract.target.projectRef
const targetDb = getTemporaryDbEnvironment({ cliPath, projectRef: targetRef, connectionMode: 'session-pooler' })
  const targetState = parseJson('target state', runPsql({
  psqlPath,
  pgEnvironment: targetDb,
  retryReadOnlySessionPooler: true,
  sql: `select jsonb_build_object(
    'publicTables',(select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p')),
    'authUsers',(select count(*) from auth.users),
    'storageBuckets',(select count(*) from storage.buckets),
    'storageObjects',(select count(*) from storage.objects),
    'applicationPrivateObjects',
      (select count(*) from pg_catalog.pg_namespace where nspname='sales_os_private') +
      (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='sales_os_private') +
      (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='sales_os_private')
  )::text;`,
}))
  const targetMigrationTableExists = runPsql({
    psqlPath,
    pgEnvironment: targetDb,
    retryReadOnlySessionPooler: true,
    sql: `select case when to_regclass('supabase_migrations.schema_migrations') is null then 'false' else 'true' end;`,
  }) === 'true'
  targetState.migrationRows = targetMigrationTableExists ? Number(runPsql({
    psqlPath,
    pgEnvironment: targetDb,
    retryReadOnlySessionPooler: true,
    sql: 'select count(*) from supabase_migrations.schema_migrations;',
  })) : 0
if (Object.values(targetState).some((value) => Number(value) !== 0)) {
  throw new Error('isolated target is no longer empty; formal attempt was not started')
}
const targetPlatformDefaultPrivileges = parseJson('target platform default privileges', runPsql({
  psqlPath,
  pgEnvironment: targetDb,
  retryReadOnlySessionPooler: true,
  sql: `select jsonb_build_object(
    'rows',(select count(*) from pg_catalog.pg_default_acl d join pg_catalog.pg_roles r on r.oid=d.defaclrole left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace where r.rolname='supabase_admin' and n.nspname='public'),
    'md5',(select md5(coalesce(string_agg(r.rolname||'|'||coalesce(n.nspname,'')||'|'||d.defaclobjtype::text||'|'||d.defaclacl::text,E'\n' order by r.rolname,n.nspname,d.defaclobjtype),'')) from pg_catalog.pg_default_acl d join pg_catalog.pg_roles r on r.oid=d.defaclrole left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace where r.rolname='supabase_admin' and n.nspname='public')
  )::text;`,
}))
if (Number(targetPlatformDefaultPrivileges.rows) !== Number(sealedSchemaInventory.supabaseAdminPublicDefaultPrivilegeRows) ||
    targetPlatformDefaultPrivileges.md5 !== sealedSchemaInventory.supabaseAdminPublicDefaultPrivilegesMd5) {
  throw new Error('isolated target Supabase platform default privileges differ from the sealed source baseline')
}
const targetFunctions = runSupabaseJson({ cliPath, args: ['functions', 'list', '--project-ref', targetRef] })
const targetSecrets = runSupabaseJson({ cliPath, args: ['secrets', 'list', '--project-ref', targetRef] })
if (targetFunctions.length !== 0 || targetSecrets.length !== 0) {
  throw new Error('isolated target Functions or secrets are no longer empty')
}
const targetServerKey = getServerKey({ cliPath, projectRef: targetRef })
const targetClient = createServerClient(targetRef, targetServerKey)
const preflightBuckets = await targetClient.storage.listBuckets()
if (preflightBuckets.error || (preflightBuckets.data ?? []).length !== 0) {
  throw new Error('isolated target Storage API is not empty or unavailable')
}

const sourceReconciliation = {
  publicTables: parseJson('source row counts', decrypted.get('reconciliation.tableRowCounts').toString('utf8')),
  keyBundle: parseJson('source key amounts', decrypted.get('reconciliation.keyAmounts').toString('utf8')),
  inventory: parseJson('source inventory', decrypted.get('reconciliation.inventory').toString('utf8')),
}
const roleMapping = parseJson('role mapping', decrypted.get('auth.identityRoleMapping').toString('utf8'))
const storageArchive = parseJson('Storage archive', decrypted.get('storage.objectsArchive').toString('utf8'))
if (!Array.isArray(roleMapping) || roleMapping.length !== 2 ||
    roleMapping.filter((item) => item.targetRoleCode === 'sales').length !== 1 ||
    roleMapping.filter((item) => item.targetRoleCode === 'admin').length !== 1) {
  throw new Error('encrypted owner role mapping is invalid')
}
const reconciliationSql = readFileSync(resolve(repoRoot, 'scripts', 'p0', 'sealed-reconciliation.sql'), 'utf8')
if (sha256(reconciliationSql) !== manifest.reconciliation.querySha256) {
  throw new Error('versioned reconciliation query does not match the sealed package')
}

const events = []
let formalAttemptStarted = false
let currentStage = 'preflight'
const writeEvidence = (status, extra = {}) => {
  writeFileSync(evidencePath, JSON.stringify({
    schemaVersion: 1,
    evidenceType: 'canwin-team-os-4-p0-sealed-restore',
    runId: `${packageId}-restore-1`,
    packageId,
    sourceProjectRef: sourceRef,
    targetProjectRef: targetRef,
    status,
    formalAttemptStarted,
    attempts: formalAttemptStarted ? 1 : 0,
    maxAttempts: 1,
    noAutomaticRetry: true,
    currentStage,
    updatedAt: new Date().toISOString(),
    events,
    ...extra,
  }, null, 2) + '\n')
}
const record = (stage, status, details = {}) => {
  events.push({ stage, status, at: new Date().toISOString(), ...details })
  currentStage = stage
  writeEvidence('running')
}

try {
  formalAttemptStarted = true
  record('database', 'started', { attempt: 1 })
  const files = {
    pre: resolve(workingDirectory, '00-pre.sql'),
    auth: resolve(workingDirectory, '10-auth.sql'),
    schema: resolve(workingDirectory, '20-application-schema.sql'),
    data: resolve(workingDirectory, '30-public-data.sql'),
    migrationSchema: resolve(workingDirectory, '35-migration-history-schema.sql'),
    migrations: resolve(workingDirectory, '40-migration-history-data.sql'),
    policies: resolve(workingDirectory, '50-storage-policies.sql'),
    post: resolve(workingDirectory, '90-post.sql'),
  }
  writeFileSync(files.pre, "set role postgres;\nalter default privileges in schema public revoke all on tables from anon, authenticated;\nset session_replication_role = replica;\n", { flag: 'wx' })
  writeFileSync(files.auth, authIdentitiesDump, { flag: 'wx' })
  writeFileSync(files.schema, decrypted.get('database.schemaDump'), { flag: 'wx' })
  writeFileSync(files.data, decrypted.get('database.dataDump'), { flag: 'wx' })
  writeFileSync(files.migrationSchema, decrypted.get('database.migrationHistorySchemaDump'), { flag: 'wx' })
  writeFileSync(files.migrations, decrypted.get('database.migrationHistoryDataDump'), { flag: 'wx' })
  writeFileSync(files.policies, managedCustomizationSql, { flag: 'wx' })
  writeFileSync(files.post, "update auth.users set banned_until = now() + interval '100 years';\nset session_replication_role = origin;\n", { flag: 'wx' })
  runPgTool({
    commandPath: psqlPath,
    pgEnvironment: targetDb,
    args: [
      '--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1', '--single-transaction',
      '--file', files.pre, '--file', files.auth, '--file', files.schema,
      '--file', files.data, '--file', files.migrationSchema, '--file', files.migrations, '--file', files.policies, '--file', files.post,
    ],
    timeout: 600000,
  })
  record('database', 'completed', { atomic: true, realUsersBanned: manifest.auth.counts.authUsers })

  record('storage', 'started')
  await restoreStorageArchive(targetClient, storageArchive)
  const targetStorage = await verifyStorageArchive(targetClient, storageArchive)
  record('storage', 'completed', targetStorage)

  record('reconciliation-before-role-overlay', 'started')
  const targetBase = getReconciliation({
    psqlPath,
    pgEnvironment: targetDb,
    sql: reconciliationSql,
    retryReadOnlySessionPooler: true,
  })
  if (targetBase.sha256 !== manifest.reconciliation.sourceBeforeSha256) {
    throw new Error('base target reconciliation does not equal the sealed production snapshot')
  }
  record('reconciliation-before-role-overlay', 'completed', { targetSha256: targetBase.sha256 })

  record('owner-role-overlay', 'started', { decisions: 2 })
  const decisionSql = roleMapping.map((item) => `
    if (select count(*) from public.profiles where id=${quoteSqlLiteral(item.profileId)}::uuid and team_id=${quoteSqlLiteral(item.teamId)} and status='active') <> 1 then
      raise exception 'ROLE_PROFILE_NOT_READY';
    end if;
    if exists(
      select 1 from public.profile_access_roles par join public.access_roles ar on ar.id=par.role_id and ar.team_id=par.team_id
      where par.profile_id=${quoteSqlLiteral(item.profileId)}::uuid and par.team_id=${quoteSqlLiteral(item.teamId)}
        and ar.code in ('owner','admin','sales','implementation','operations','finance')
    ) then raise exception 'ROLE_PRIMARY_ALREADY_EXISTS'; end if;
    insert into public.profile_access_roles(team_id,profile_id,role_id,assigned_by)
    select ${quoteSqlLiteral(item.teamId)},${quoteSqlLiteral(item.profileId)}::uuid,ar.id,null
    from public.access_roles ar
    where ar.team_id=${quoteSqlLiteral(item.teamId)} and ar.code=${quoteSqlLiteral(item.targetRoleCode)};
    if not found then raise exception 'ROLE_CODE_NOT_READY'; end if;`).join('\n')
  runPsql({
    psqlPath,
    pgEnvironment: targetDb,
    sql: `do $owner_roles$ begin ${decisionSql} end $owner_roles$;`,
  })
  const roleAcceptance = parseJson('role overlay acceptance', runPsql({
    psqlPath,
    pgEnvironment: targetDb,
    retryReadOnlySessionPooler: true,
    sql: `select jsonb_agg(jsonb_build_object('profileId',p.id,'roleCode',ar.code) order by p.id)::text
      from public.profiles p join public.profile_access_roles par on par.profile_id=p.id and par.team_id=p.team_id
      join public.access_roles ar on ar.id=par.role_id and ar.team_id=par.team_id
      where p.id in (${roleMapping.map((item) => `${quoteSqlLiteral(item.profileId)}::uuid`).join(',')})
        and ar.code in ('sales','admin');`,
  }))
  if (!Array.isArray(roleAcceptance) || roleAcceptance.length !== 2) throw new Error('owner role overlay acceptance failed')
  record('owner-role-overlay', 'completed', { decisionsApplied: 2, sales: 1, admin: 1, productionRoleWrites: 0 })

  record('final-reconciliation', 'started')
  const targetFinal = getReconciliation({
    psqlPath,
    pgEnvironment: targetDb,
    sql: reconciliationSql,
    retryReadOnlySessionPooler: true,
  })
  const expectedFinal = structuredClone(targetBase.value)
  expectedFinal.publicTables.profile_access_roles = Number(expectedFinal.publicTables.profile_access_roles) + 2
  expectedFinal.auth.roleAssignments = Number(expectedFinal.auth.roleAssignments) + 2
  delete expectedFinal.publicTableContentMd5.profile_access_roles
  const actualFinal = structuredClone(targetFinal.value)
  delete actualFinal.publicTableContentMd5.profile_access_roles
  if (canonicalJson(expectedFinal) !== canonicalJson(actualFinal)) {
    throw new Error('final target differs outside the two authorized role assignments')
  }
  const bannedUsers = Number(runPsql({
    psqlPath,
    pgEnvironment: targetDb,
    retryReadOnlySessionPooler: true,
    sql: `select count(*) from auth.users where banned_until > now() + interval '99 years';`,
  }))
  if (bannedUsers !== manifest.auth.counts.authUsers) throw new Error('restored real users are not all disabled')
  const finalFunctions = runSupabaseJson({ cliPath, args: ['functions', 'list', '--project-ref', targetRef] })
  const finalSecrets = runSupabaseJson({ cliPath, args: ['secrets', 'list', '--project-ref', targetRef] })
  if (finalFunctions.length !== 0 || finalSecrets.length !== 0) throw new Error('target outbound Function isolation changed')
  const cronExists = runPsql({
    psqlPath,
    pgEnvironment: targetDb,
    retryReadOnlySessionPooler: true,
    sql: `select case when to_regclass('cron.job') is null then 'false' else 'true' end;`,
  }) === 'true'
  const cronCount = cronExists ? Number(runPsql({
    psqlPath,
    pgEnvironment: targetDb,
    retryReadOnlySessionPooler: true,
    sql: `select count(*) from cron.job;`,
  })) : 0
  if (cronCount !== 0) throw new Error('target cron execution is not disabled')
  record('final-reconciliation', 'completed', {
    baseTargetSha256: targetBase.sha256,
    finalTargetSha256: targetFinal.sha256,
    exactPublicTables: Object.keys(sourceReconciliation.publicTables).length,
    authorizedRoleDelta: 2,
    bannedUsers,
    targetFunctions: 0,
    targetFunctionSecrets: 0,
    targetCronJobs: 0,
  })
  currentStage = 'complete'
  writeEvidence('completed', {
    completedAt: new Date().toISOString(),
    acceptance: {
      productionWrites: 0,
      targetBaseMatchesSealedSource: true,
      authorizedRoleAssignmentsApplied: 2,
      realUserLoginAllowed: false,
      externalDeliveryAllowed: false,
      storageBytesMatch: true,
      functionsDeployed: 0,
      cronJobsEnabled: 0,
    },
  })
  console.log(`[p0:sealed-restore] COMPLETED target=${targetRef} tables=${Object.keys(sourceReconciliation.publicTables).length} authUsers=${manifest.auth.counts.authUsers} storageObjects=${manifest.storage.counts.objects} roleDecisions=2`)
  console.log(`[p0:sealed-restore] baseSha256=${targetBase.sha256} finalSha256=${targetFinal.sha256} loginEnabled=0 outboundEnabled=0 attempts=1 secretsPrinted=0`)
} catch (error) {
  const message = String(error?.message ?? error)
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[REDACTED]')
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, 'sb_[REDACTED]')
  events.push({ stage: currentStage, status: 'failed', at: new Date().toISOString(), message })
  writeEvidence('failed', {
    failedAt: new Date().toISOString(),
    failure: { stage: currentStage, message, targetPreserved: true, automaticCleanup: false, retryAllowed: false },
  })
  throw error
} finally {
  clearSensitiveWorkingState()
  process.removeListener('exit', clearSensitiveWorkingState)
}
