import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (name) => readFileSync(resolve(repoRoot, 'scripts', 'p0', name), 'utf8')
const backup = read('create-sealed-backup.mjs')
const restore = read('restore-sealed-backup.mjs')
const library = read('sealed-recovery-lib.mjs')
const databaseAccess = read('temporary-db-access.mjs')
const preflight = read('preflight-sealed-recovery.mjs')
const reconciliation = read('sealed-reconciliation.sql')
const runtimeTest = read('test-sealed-recovery-runtime.mjs')
const packageRuntime = read('verify-backup-package-runtime.mjs')
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
const checks = []
const check = (label, value) => checks.push([label, Boolean(value)])
const authDumpDefinition = backup.slice(
  backup.indexOf('const identitiesDumpText = pgText'),
  backup.indexOf('const authStorageSchemaDiffText'),
)

check('backup requires a current owner write-freeze timestamp', backup.includes("--freeze-started-at") && backup.includes('write-freeze timestamp is not current'))
check('backup requires exactly two owner role decisions', backup.includes('exactly two owner-confirmed role decisions are required'))
check('Chinese role decisions use ASCII-safe UTF8 literals', backup.includes('quoteSqlUtf8Literal(item.name)') && library.includes('quoteSqlUtf8Literal'))
check('inline Windows SQL rejects raw non-ASCII text', databaseAccess.includes('inline psql SQL must be ASCII-safe on Windows') && databaseAccess.includes("PGCLIENTENCODING: 'UTF8'"))
check('temporary Session Pooler metadata is project-bound and uses port 5432',
  databaseAccess.includes("readFileSync(resolve(workdir, 'supabase', '.temp', 'pooler-url')") &&
  databaseAccess.includes("decodeURIComponent(poolerUrl.username) !== expectedPoolerUser") &&
  databaseAccess.includes("PGPORT: '5432'") &&
  databaseAccess.includes("PGUSER: `${directEnvironment.PGUSER}.${projectRef}`"))
check('temporary Session Pooler access enables Supabase JIT authentication',
  databaseAccess.includes("PGOPTIONS: '-c jit=true'") &&
  preflight.match(/connectionMode: 'session-pooler'/g)?.length === 2 &&
  backup.match(/connectionMode: 'session-pooler'/g)?.length === 3 &&
  restore.match(/connectionMode: 'session-pooler'/g)?.length === 1)
check('all sealed-recovery child tools run with Supabase telemetry disabled',
  databaseAccess.slice(databaseAccess.indexOf('function run('), databaseAccess.indexOf('export function runExternal'))
    .includes("SUPABASE_TELEMETRY_DISABLED: '1'") &&
  databaseAccess.slice(databaseAccess.indexOf('function run('), databaseAccess.indexOf('export function runExternal'))
    .includes("DO_NOT_TRACK: '1'"))
check('sealed-recovery child tools allow bounded large encrypted SQL output',
  databaseAccess.includes('maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024'))
check('Windows dump preflight forbids the NUL device', !preflight.includes('--file=NUL'))
check('Windows dump preflight uses controlled non-empty D drive files',
  preflight.includes('D:\\\\CanWin-Team-OS-4.0-Recovery-Preflight') &&
  preflight.includes("mkdtempSync(join(preflightDumpRoot, '.dump-'))") &&
  preflight.includes("args: [...args, '--file', outputPath]") &&
  preflight.includes('statSync(outputPath).size <= 0') &&
  preflight.includes('isControlledDumpDirectory(preflightDumpDirectory)'))
check('backup uses an external DPAPI key', backup.includes('createProtectedKey') && backup.includes('dpapi-file:///E:/'))
check('backup encrypts every declared artifact', backup.includes('writeEncryptedArtifact') && backup.includes('artifacts/${relativePath}.enc'))
check('backup captures target-aware managed customizations', backup.includes('getManagedSchemaCustomizationSql') && backup.includes('targetPgEnvironment: targetDb'))
check('backup captures Auth users and identities without sessions', backup.includes("'--table=auth.users'") && backup.includes("'--table=auth.identities'") && !backup.includes("'--table=auth.sessions'"))
check('all production data dumps rely on session-level trigger suppression instead of protected table toggles',
  authDumpDefinition.includes("'--table=auth.users'") &&
  authDumpDefinition.includes("'--table=auth.identities'") &&
  !authDumpDefinition.includes("'--disable-triggers'") &&
  !backup.includes("'--disable-triggers'") &&
  backup.includes('dump contains forbidden table trigger toggles'))
check('backup preserves public and application-private ACL statements',
  backup.includes("'--schema=public', `--schema=${applicationPrivateSchema}`, '--schema-only', '--no-owner', '--no-comments'") &&
  !backup.includes("`--schema=${applicationPrivateSchema}`, '--schema-only', '--no-owner', '--no-privileges'"))
check('backup seals the function-only application private schema',
  backup.includes("const applicationPrivateSchema = 'sales_os_private'") &&
  backup.includes("'dataRelations'") &&
  backup.includes('application private schema is outside the sealed function-only recovery contract') &&
  backup.includes('CREATE SCHEMA sales_os_private;') &&
  backup.includes('application private schema dump omits a required performance routine'))
check('backup strips only immutable Supabase platform-owned default privileges',
  backup.includes('schema dump contains an unclassified default-privilege owner') &&
  backup.includes('FOR ROLE (?:postgres|supabase_admin)') &&
  backup.includes('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA') &&
  backup.includes('schema dump retains an unchangeable Supabase platform default privilege'))
check('backup appends exact routine definitions and application ACLs',
  backup.includes('exactRoutineDefinitionsSql') &&
  backup.includes('pg_get_functiondef(p.oid)') &&
  backup.includes('DO $canwin_exact_routine$') &&
  backup.includes('-- CANWIN EXACT ROUTINE RESOLUTION PATH') &&
  backup.includes("set_config('search_path', 'public, sales_os_private, pg_catalog', false)") &&
  backup.includes('exactRelationAclSql') &&
  backup.includes('exactRoutineAclSql') &&
  backup.includes('exactPrivateSchemaAclSql') &&
  backup.includes('-- CANWIN EXACT APPLICATION ACLS'))
check('backup uses line-ending-safe COPY for public and migration data',
  backup.includes("'--schema=public', '--data-only'") &&
  backup.includes("'--schema=supabase_migrations', '--data-only'") &&
  !backup.includes("'--rows-per-insert=100'") &&
  backup.includes('data dumps are not using line-ending-safe COPY format'))
check('backup verifies source database and Storage stability', backup.includes('sourceBefore.sha256 !== sourceAfter.sha256') && backup.includes('production Storage changed'))
check('backup refreshes short-lived credentials before final freeze reconciliation',
  backup.indexOf('const sourceFinalDb = getTemporaryDbEnvironment') < backup.indexOf('const sourceAfter = getReconciliation') &&
  backup.includes('pgEnvironment: sourceFinalDb') &&
  backup.includes('stage=final-credential-refreshed'))
check('backup remains production read-only', !/sourceDb[^\n]{0,160}\b(?:insert|update|delete|create|alter|drop)\b/i.test(backup))
check('backup records early connection failures and clears sensitive working state',
  backup.indexOf('try {') < backup.indexOf('const sourceDb = getTemporaryDbEnvironment') &&
  backup.includes("stage: 'sealed-backup'") &&
  backup.includes('rmSync(workingDirectory, { recursive: true, force: true })') &&
  backup.includes('if (key) key.fill(0)'))

check('managed trigger difference is frozen exactly', library.includes("auth.users.on_auth_user_created") && library.includes("public") && library.includes("handle_new_user"))
check('managed customization serialization locks and qualifies application dependencies',
  library.match(/with search_path_locked as materialized/g)?.length === 2 &&
  library.includes("set_config('search_path','',true)") &&
  library.includes("policySql.includes('FROM public.profiles')") &&
  library.includes("triggerSql.includes('EXECUTE FUNCTION public.handle_new_user()')") &&
  library.includes('managed customization SQL contains an unqualified application dependency'))
check('managed trigger DDL is restored after public function availability', restore.indexOf("files.schema") < restore.indexOf("files.policies") && restore.indexOf("files.data") < restore.indexOf("files.policies"))
check('database restore is a single transaction', restore.includes("'--single-transaction'") && restore.includes("'ON_ERROR_STOP=1'"))
check('runtime package gate decrypts every data dump and rejects protected trigger toggles',
  packageRuntime.includes('readProtectedKey') &&
  packageRuntime.includes('readEncryptedArtifact') &&
  packageRuntime.includes('artifact: manifest.database?.dataDump') &&
  packageRuntime.includes('artifact: manifest.database?.migrationHistoryDataDump') &&
  packageRuntime.includes('all data dumps omit protected table trigger toggles'))
check('runtime package gate validates COPY data and exact schema overlays',
  packageRuntime.includes('dataDumpsUseCopyFormat') &&
  packageRuntime.includes('exactRoutineAndAclOverlayIsComplete') &&
  packageRuntime.includes('-- CANWIN EXACT ROUTINE RESOLUTION PATH') &&
  packageRuntime.includes("set_config('search_path', 'public, sales_os_private, pg_catalog', false)") &&
  packageRuntime.includes('public and migration data dumps use line-ending-safe COPY format') &&
  packageRuntime.includes('exact routine definition and application ACL overlay is complete'))
check('runtime package gate decrypts and validates the application private schema',
  packageRuntime.includes("artifact: manifest.database?.schemaDump") &&
  packageRuntime.includes("artifact: manifest.database?.schemaInventory") &&
  packageRuntime.includes('application private schema dump is complete and function-only') &&
  packageRuntime.includes('application private schema inventory has no unsealed data relations'))
check('runtime package gate validates the immutable platform default-privilege baseline',
  packageRuntime.includes('supabaseAdminPublicDefaultPrivilegeRows') &&
  packageRuntime.includes('supabaseAdminPublicDefaultPrivilegesMd5') &&
  packageRuntime.includes('Supabase platform default privileges are baseline-only and sealed by fingerprint'))
check('runtime package gate validates schema-qualified managed customization dependencies',
  packageRuntime.includes('managedCustomizationDependenciesAreQualified') &&
  packageRuntime.includes('managed customization dependencies are schema-qualified'))
check('restore rejects protected trigger toggles in every data dump before target access',
  restore.includes("['public data', publicDataDump]") &&
  restore.includes("['migration history data', migrationDataDump]") &&
  restore.indexOf('dump contains forbidden table trigger toggles') <
    restore.indexOf('const targetDb = getTemporaryDbEnvironment'))
check('restore rejects an incomplete application private schema before target access',
  restore.indexOf('sealed application schema is outside the function-only recovery contract') <
    restore.indexOf('const targetDb = getTemporaryDbEnvironment'))
check('restore rejects non-COPY data or incomplete exact schema overlays before target access',
  restore.includes('sealed data dumps are not using line-ending-safe COPY format') &&
  restore.includes('sealed schema does not contain the exact routine and ACL overlay') &&
  restore.includes('-- CANWIN EXACT ROUTINE RESOLUTION PATH') &&
  restore.includes("set_config('search_path', 'public, sales_os_private, pg_catalog', false)") &&
  restore.indexOf('sealedExactRoutineCount') < restore.indexOf('const targetDb = getTemporaryDbEnvironment'))
check('restore requires the isolated target application private schema to be absent',
  restore.includes("'applicationPrivateObjects'") &&
  restore.includes("nspname='sales_os_private'") &&
  restore.indexOf('applicationPrivateObjects') < restore.indexOf('formalAttemptStarted = true'))
check('restore compares immutable platform default privileges before the formal attempt',
  restore.includes('target platform default privileges') &&
  restore.includes('isolated target Supabase platform default privileges differ from the sealed source baseline') &&
  restore.indexOf('targetPlatformDefaultPrivileges') < restore.indexOf('formalAttemptStarted = true'))
check('restore rejects unqualified managed customization dependencies before target access',
  restore.includes('sealed managed customization SQL contains an unqualified application dependency') &&
  restore.indexOf('managedCustomizationSql') < restore.indexOf('const targetDb = getTemporaryDbEnvironment'))
check('target default table privileges are revoked before schema restore', restore.includes('alter default privileges in schema public revoke all on tables from anon, authenticated'))
check('real restored users are banned in the database transaction', restore.includes("update auth.users set banned_until = now() + interval '100 years'"))
check('Functions and secrets remain absent', restore.includes('finalFunctions.length !== 0') && restore.includes('finalSecrets.length !== 0'))
check('Cron remains disabled', restore.includes("target cron execution is not disabled"))
check('first failure preserves target and forbids retry', restore.includes('targetPreserved: true') && restore.includes('retryAllowed: false'))
check('role overlay is limited to one sales and one admin', restore.includes("targetRoleCode === 'sales'") && restore.includes("targetRoleCode === 'admin'") && restore.includes('decisionsApplied: 2'))

for (const token of [
  'publicTableContentMd5', 'usersContentMd5', 'identitiesContentMd5',
  'publicColumnsMd5', 'publicConstraintsMd5', 'publicIndexesMd5',
  'publicTableAclMd5', 'publicRoutinesMd5', 'publicPoliciesMd5',
  'publicTriggersMd5', 'managedCustomizationsMd5', 'defaultPrivilegesMd5',
  'salesOsPrivateSchemaAclMd5', 'salesOsPrivateDataRelations',
  'salesOsPrivateRoutines', 'salesOsPrivateRoutinesMd5',
  'publicRoutines',
]) {
  check('reconciliation includes ' + token, reconciliation.includes("'" + token + "'"))
}
check('reconciliation excludes the intentional Auth ban timestamp', reconciliation.includes("to_jsonb(u) - 'banned_until'"))
check('reconciliation contains no raw non-ASCII command literals', !/[^\x00-\x7F]/.test(reconciliation))
check('local synthetic restore uses session-level trigger suppression without Auth table toggles',
  runtimeTest.includes('set session_replication_role = replica') &&
  runtimeTest.includes('synthetic data dump contains protected table trigger toggles') &&
  !runtimeTest.includes("'--disable-triggers'"))
check('remote preflight rejects table trigger toggles from every real-file dump',
  !preflight.includes("'--disable-triggers'") &&
  preflight.includes('preflight dump contains forbidden table trigger toggles'))
check('remote preflight and synthetic restore use line-ending-safe COPY data',
  preflight.includes('preflight data dump is not using line-ending-safe COPY format') &&
  !preflight.includes("'--rows-per-insert=100'") &&
  runtimeTest.includes('synthetic data dumps do not use line-ending-safe COPY format') &&
  !runtimeTest.includes("'--rows-per-insert=100'"))
check('local synthetic restore models the application private trigger dependency',
  runtimeTest.includes('create schema sales_os_private') &&
  runtimeTest.includes("'--schema=sales_os_private'") &&
  runtimeTest.includes('execute function sales_os_private.refresh_sample()') &&
  runtimeTest.includes("result !== '1|1|1|1|1|1|1'"))
check('local PostgreSQL skip is explicit and owner-authorized', runtimeTest.includes('owner-authorized-windows-account-encoding') && runtimeTest.includes('--skip-local-postgres'))
check('remote preflight inventories the application private schema on both projects',
  preflight.includes("'salesOsPrivateSchemas'") &&
  preflight.includes("'salesOsPrivateDataRelations'") &&
  preflight.includes("'salesOsPrivateRoutines'") &&
  preflight.includes("'--schema=sales_os_private'") &&
  preflight.includes('production application private schema is outside the function-only recovery contract'))
check('remote preflight compares immutable platform default privileges',
  preflight.includes("'supabaseAdminPublicDefaultPrivilegeRows'") &&
  preflight.includes("'supabaseAdminPublicDefaultPrivilegesMd5'") &&
  preflight.includes('source[field] !== target[field]'))
check('package exposes runtime, preflight, backup and restore commands', [
  'test:p0:sealed-recovery-runtime', 'preflight:p0:sealed-recovery',
  'backup:p0:sealed-recovery', 'restore:p0:sealed-recovery',
].every((name) => typeof packageJson.scripts?.[name] === 'string'))

const forbidden = [
  /sb_secret_[A-Za-z0-9_-]{8,}/,
  /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]
check('recovery sources contain no embedded secret values', forbidden.every((pattern) =>
  !pattern.test(backup + restore + library + databaseAccess + runtimeTest)))

let passed = 0
for (const [label, result] of checks) {
  if (result) passed += 1
  else console.error('[p0:sealed-contract] FAIL ' + label)
}
console.log('[p0:sealed-contract] summary discovered=' + checks.length + ' run=' + checks.length + ' passed=' + passed + ' failed=' + (checks.length - passed) + ' skipped=0')
if (passed !== checks.length) process.exit(1)
