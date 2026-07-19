import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertNoSecretLiterals,
  canonicalJson,
  collectStorageArchive,
  createProtectedKey,
  createServerClient,
  getReconciliation,
  getManagedSchemaCustomizationSql,
  getServerKey,
  packDirectory,
  parseJson,
  quoteSqlLiteral,
  quoteSqlUtf8Literal,
  sha256,
  storageSummary,
  writeEncryptedArtifact,
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
const args = process.argv.slice(2)
const valueAfter = (flag) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}
const valuesAfter = (flag) => args.flatMap((value, index) => value === flag ? [args[index + 1]] : [])

if (args.includes('--help')) {
  console.log('Usage: node scripts/p0/create-sealed-backup.mjs --freeze-started-at <ISO> --decision <name=role> --decision <name=role>')
  process.exit(0)
}

const freezeStartedAt = valueAfter('--freeze-started-at')
const decisionArguments = valuesAfter('--decision')
if (!freezeStartedAt || new Date(freezeStartedAt).toISOString() !== freezeStartedAt) {
  throw new Error('--freeze-started-at must be an exact ISO timestamp')
}
if (Date.parse(freezeStartedAt) > Date.now() || Date.now() - Date.parse(freezeStartedAt) > 30 * 60 * 1000) {
  throw new Error('write-freeze timestamp is not current')
}
if (decisionArguments.length !== 2 || decisionArguments.some((item) => typeof item !== 'string' || !item.includes('='))) {
  throw new Error('exactly two owner-confirmed role decisions are required')
}
const decisions = decisionArguments.map((item) => {
  const separator = item.lastIndexOf('=')
  return { name: item.slice(0, separator).trim(), roleCode: item.slice(separator + 1).trim() }
})
if (new Set(decisions.map((item) => item.name)).size !== 2 ||
    decisions.some((item) => !item.name || !['sales', 'admin'].includes(item.roleCode)) ||
    decisions.filter((item) => item.roleCode === 'sales').length !== 1 ||
    decisions.filter((item) => item.roleCode === 'admin').length !== 1) {
  throw new Error('role decisions do not match the frozen one-sales and one-admin contract')
}

const run = loadRestoreRun(repoRoot)
const sourceRef = run.source.projectRef
const targetRef = run.target.projectRef
const cliPath = run.toolchain.supabaseCli.path
const psqlPath = run.toolchain.psql.path
const pgDumpPath = run.toolchain.pgDump.path
const pgDumpAllPath = resolve(dirname(pgDumpPath), 'pg_dumpall.exe')
for (const path of [cliPath, psqlPath, pgDumpPath, pgDumpAllPath]) {
  if (!existsSync(path)) throw new Error('declared recovery executable is missing')
}

const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean)
  .filter((line) => !line.slice(3).replaceAll('\\', '/').startsWith('.codex-audit/'))
if (porcelain.length !== 0) throw new Error('tracked recovery implementation is not committed')
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
if (!/^[a-f0-9]{40}$/.test(gitCommit)) throw new Error('cannot resolve immutable Git commit')

const timestampId = new Date().toISOString().replaceAll(/[-:.]/g, '').replace('Z', 'Z')
const packageId = `canwin-team-os-4-p0-${timestampId}-${gitCommit.slice(0, 10)}`
const packageRoot = 'D:\\CanWin-Team-OS-4.0-Recovery'
const keyRoot = 'E:\\CanWin-Team-OS-4.0-Recovery-Keys'
const packageDirectory = resolve(packageRoot, packageId)
const keyPath = resolve(keyRoot, `${packageId}.dpapi`)
mkdirSync(packageRoot, { recursive: true })
mkdirSync(keyRoot, { recursive: true })
mkdirSync(packageDirectory, { recursive: false })
const workingDirectory = mkdtempSync(join(packageRoot, `.working-${packageId}-`))
const keyReference = `dpapi-file:///E:/CanWin-Team-OS-4.0-Recovery-Keys/${packageId}.dpapi`
let key = null
let manifest
try {
  key = createProtectedKey({ repoRoot, keyPath })
  const reconciliationSql = readFileSync(resolve(repoRoot, 'scripts', 'p0', 'sealed-reconciliation.sql'), 'utf8')
  const querySha256 = sha256(reconciliationSql)
  const sourceDb = getTemporaryDbEnvironment({ cliPath, projectRef: sourceRef, connectionMode: 'session-pooler' })
  const targetDb = getTemporaryDbEnvironment({ cliPath, projectRef: targetRef, connectionMode: 'session-pooler' })
  const sourceBefore = getReconciliation({ psqlPath, pgEnvironment: sourceDb, sql: reconciliationSql })
  const snapshotAt = new Date().toISOString()
  const artifactTime = () => new Date().toISOString()
  const artifact = (relativePath, plaintext, options) => writeEncryptedArtifact({
    packageDirectory,
    relativePath: `artifacts/${relativePath}.enc`,
    plaintext,
    key,
    keyReference,
    createdAt: artifactTime(),
    ...options,
  })
  const pgText = (commandPath, toolArgs) => runPgTool({
    commandPath,
    pgEnvironment: sourceDb,
    args: toolArgs,
    timeout: 300000,
  }).stdout
  console.log('[p0:sealed-backup] stage=baseline-ready productionWrites=0')

  const rolesDumpText = pgText(pgDumpAllPath, [
    '--roles-only', '--no-role-passwords', '--no-privileges', '--no-comments', '--role=postgres',
  ])
  assertNoSecretLiterals('roles dump', rolesDumpText)

  let schemaDumpText = pgText(pgDumpPath, [
    '--schema=public', '--schema-only', '--no-owner', '--no-comments', '--encoding=UTF8', '--role=postgres',
  ])
  const createSchemaMatches = schemaDumpText.match(/CREATE SCHEMA public;/g) ?? []
  if (createSchemaMatches.length !== 1) throw new Error('public schema dump shape is not recognized')
  schemaDumpText = schemaDumpText.replace('CREATE SCHEMA public;', 'CREATE SCHEMA IF NOT EXISTS public;')
  schemaDumpText = schemaDumpText.replace(/^ALTER SCHEMA public OWNER TO .*;\r?\n/gm, '')

  const dataDumpText = pgText(pgDumpPath, [
    '--schema=public', '--data-only', '--inserts', '--rows-per-insert=100', '--disable-triggers',
    '--no-owner', '--no-privileges', '--encoding=UTF8', '--role=postgres',
  ])
  let migrationSchemaDumpText = pgText(pgDumpPath, [
    '--schema=supabase_migrations', '--schema-only', '--no-owner', '--no-privileges', '--no-comments', '--encoding=UTF8', '--role=postgres',
  ])
  const migrationSchemaMatches = migrationSchemaDumpText.match(/CREATE SCHEMA supabase_migrations;/g) ?? []
  if (migrationSchemaMatches.length !== 1) throw new Error('migration history schema dump shape is not recognized')
  migrationSchemaDumpText = migrationSchemaDumpText
    .replace('CREATE SCHEMA supabase_migrations;', 'CREATE SCHEMA IF NOT EXISTS supabase_migrations;')
    .replace(/^ALTER SCHEMA supabase_migrations OWNER TO .*;\r?\n/gm, '')
  const migrationDataDumpText = pgText(pgDumpPath, [
    '--schema=supabase_migrations', '--data-only', '--inserts', '--rows-per-insert=100', '--disable-triggers',
    '--no-owner', '--no-privileges', '--encoding=UTF8', '--role=postgres',
  ])
  const identitiesDumpText = pgText(pgDumpPath, [
    '--schema=auth', '--table=auth.users', '--table=auth.identities', '--data-only', '--column-inserts',
    '--disable-triggers', '--no-owner', '--no-privileges', '--encoding=UTF8', '--role=postgres',
  ])
  const authStorageSchemaDiffText = getManagedSchemaCustomizationSql({
    psqlPath,
    sourcePgEnvironment: sourceDb,
    targetPgEnvironment: targetDb,
  }).sql
  console.log('[p0:sealed-backup] stage=database-dumps-ready productionWrites=0')

  const schemaInventory = parseJson('schema inventory', runPsql({
    psqlPath,
    pgEnvironment: sourceDb,
    sql: `select jsonb_build_object(
      'serverVersion',current_setting('server_version_num')::int,
      'publicTables',(select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p')),
      'publicRoutines',(select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
      'publicPolicies',(select count(*) from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),
      'storagePolicies',(select count(*) from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='storage')
    )::text;`,
  }))

  const requestedNamesSql = decisions.map((item) => quoteSqlUtf8Literal(item.name)).join(',')
  const roleRows = parseJson('role mapping', runPsql({
    psqlPath,
    pgEnvironment: sourceDb,
    sql: `select coalesce(jsonb_agg(jsonb_build_object(
      'profileId',p.id,'teamId',p.team_id,'name',p.name,'status',p.status,
      'existingRoleCodes',coalesce((select jsonb_agg(ar.code order by ar.code) from public.profile_access_roles par join public.access_roles ar on ar.id=par.role_id and ar.team_id=par.team_id where par.profile_id=p.id and par.team_id=p.team_id),'[]'::jsonb)
    ) order by p.name),'[]'::jsonb)::text from public.profiles p where p.status='active' and p.name in (${requestedNamesSql});`,
  }))
  if (!Array.isArray(roleRows) || roleRows.length !== 2) throw new Error('owner role decisions do not uniquely match two active profiles')
  const primaryCodes = new Set(['owner', 'admin', 'sales', 'implementation', 'operations', 'finance'])
  const roleMapping = decisions.map((decision) => {
    const matches = roleRows.filter((row) => row.name === decision.name)
    if (matches.length !== 1) throw new Error('an owner role decision is not a unique active profile')
    if (matches[0].existingRoleCodes.some((code) => primaryCodes.has(code))) {
      throw new Error('an owner role decision no longer targets a profile without a primary role')
    }
    return { ...matches[0], targetRoleCode: decision.roleCode }
  })
  for (const item of roleMapping) {
    const available = Number(runPsql({
      psqlPath,
      pgEnvironment: sourceDb,
      sql: `select count(*) from public.access_roles where team_id=${quoteSqlLiteral(item.teamId)} and code=${quoteSqlLiteral(item.targetRoleCode)};`,
    }))
    if (available !== 1) throw new Error('requested target role is unavailable')
  }

  const sourceServerKey = getServerKey({ cliPath, projectRef: sourceRef })
  const sourceClient = createServerClient(sourceRef, sourceServerKey)
  const storageArchive = await collectStorageArchive(sourceClient)
  const sourceStorageSummary = storageSummary(storageArchive)
  const storageObjectsManifest = storageArchive.objects.map(({ base64, ...item }) => item)

  const functionsManifest = runSupabaseJson({ cliPath, args: ['functions', 'list', '--project-ref', sourceRef] })
  const functionWorkdir = resolve(workingDirectory, 'function-download')
  mkdirSync(resolve(functionWorkdir, 'supabase', 'functions'), { recursive: true })
  if (functionsManifest.length > 0) {
    runExternal({
      commandPath: cliPath,
      args: ['functions', 'download', '--project-ref', sourceRef, '--use-api', '--workdir', functionWorkdir, '--yes'],
      cwd: functionWorkdir,
      timeout: 180000,
    })
  }
  const functionSourceArchive = packDirectory(resolve(functionWorkdir, 'supabase', 'functions'))
  for (const file of functionSourceArchive.files) {
    assertNoSecretLiterals('Function source archive', Buffer.from(file.base64, 'base64').toString('utf8'))
  }
  console.log('[p0:sealed-backup] stage=storage-functions-ready productionWrites=0')

  const cronExists = runPsql({
    psqlPath,
    pgEnvironment: sourceDb,
    sql: `select case when to_regclass('cron.job') is null then 'false' else 'true' end;`,
  }) === 'true'
  const cronJobs = cronExists ? parseJson('cron manifest', runPsql({
    psqlPath,
    pgEnvironment: sourceDb,
    sql: `select coalesce(jsonb_agg(to_jsonb(j) order by j.jobid),'[]'::jsonb)::text from cron.job j;`,
  })) : []
  const featureFlags = parseJson('feature flag manifest', runPsql({
    psqlPath,
    pgEnvironment: sourceDb,
    sql: `select coalesce(jsonb_agg(to_jsonb(f) order by f.team_id,f.key),'[]'::jsonb)::text from public.feature_flags f;`,
  }))
  const frontendArchive = packDirectory(resolve(repoRoot, 'dist'), { rejectEnvironmentFiles: true })

  const database = {
    rolesDump: artifact('database-roles.sql', rolesDumpText, { contentType: 'application/sql', format: 'postgresql-plain-sql', tool: 'pg_dumpall', toolVersion: '18.4' }),
    schemaDump: artifact('database-public-schema.sql', schemaDumpText, { contentType: 'application/sql', format: 'postgresql-plain-sql', tool: 'pg_dump', toolVersion: '18.4' }),
    dataDump: artifact('database-public-data.sql', dataDumpText, { contentType: 'application/sql', format: 'postgresql-plain-sql', tool: 'pg_dump', toolVersion: '18.4' }),
    migrationHistorySchemaDump: artifact('migration-history-schema.sql', migrationSchemaDumpText, { contentType: 'application/sql', format: 'postgresql-plain-sql', tool: 'pg_dump', toolVersion: '18.4' }),
    migrationHistoryDataDump: artifact('migration-history-data.sql', migrationDataDumpText, { contentType: 'application/sql', format: 'postgresql-plain-sql', tool: 'pg_dump', toolVersion: '18.4' }),
    authStorageSchemaDiff: artifact('auth-storage-custom-policies.sql', authStorageSchemaDiffText, { contentType: 'application/sql', format: 'postgresql-policy-sql', tool: 'psql', toolVersion: '18.4' }),
    schemaInventory: artifact('schema-inventory.json', canonicalJson(schemaInventory), { contentType: 'application/json', format: 'canonical-json', tool: 'psql', toolVersion: '18.4' }),
  }
  const auth = {
    recoveryScope: { managedAuthSchemaDataIncluded: true, passwordHashesIncluded: true, sessionsRestored: false, sourceJwtSecretCopied: false },
    identitiesDump: artifact('auth-users-identities.sql', identitiesDumpText, { contentType: 'application/sql', format: 'postgresql-column-inserts', tool: 'pg_dump', toolVersion: '18.4' }),
    identityRoleMapping: artifact('identity-role-mapping.json', canonicalJson(roleMapping), { contentType: 'application/json', format: 'canonical-json', tool: 'node', toolVersion: process.version }),
    settingsManifest: artifact('auth-settings-manifest.json', canonicalJson({ schemaVersion: 1, copiedValues: false, passwordHashesInIdentityDump: true, sessionsExcluded: true, jwtSecretExcluded: true }), { contentType: 'application/json', format: 'canonical-json', tool: 'node', toolVersion: process.version }),
    counts: {
      authUsers: Number(sourceBefore.value.auth.users),
      authIdentities: Number(sourceBefore.value.auth.identities),
      profiles: Number(sourceBefore.value.auth.profiles),
      roleAssignments: Number(sourceBefore.value.auth.roleAssignments),
      orphanProfiles: Number(sourceBefore.value.auth.orphanProfiles),
      orphanRoleAssignments: Number(sourceBefore.value.auth.orphanRoleAssignments),
    },
  }
  const storage = {
    bucketsManifest: artifact('storage-buckets.json', canonicalJson(storageArchive.buckets), { contentType: 'application/json', format: 'canonical-json', tool: 'supabase-storage-api', toolVersion: '@supabase/supabase-js' }),
    objectsManifest: artifact('storage-objects.json', canonicalJson(storageObjectsManifest), { contentType: 'application/json', format: 'canonical-json', tool: 'supabase-storage-api', toolVersion: '@supabase/supabase-js' }),
    objectsArchive: artifact('storage-objects-archive.json', canonicalJson(storageArchive), { contentType: 'application/json', format: 'base64-json-bundle', tool: 'supabase-storage-api', toolVersion: '@supabase/supabase-js' }),
    counts: { buckets: sourceStorageSummary.buckets, objects: sourceStorageSummary.objects, bytes: sourceStorageSummary.bytes },
  }
  const functions = {
    restoreSafety: { deployEnabled: false, externalDeliveryEnabled: false, secretValuesIncluded: false },
    manifest: artifact('functions-manifest.json', canonicalJson(functionsManifest), { contentType: 'application/json', format: 'canonical-json', tool: 'supabase-cli', toolVersion: '2.109.1' }),
    sourceArchive: artifact('functions-source-archive.json', canonicalJson(functionSourceArchive), { contentType: 'application/json', format: 'base64-json-bundle', tool: 'supabase-cli', toolVersion: '2.109.1' }),
    count: functionsManifest.length,
  }
  const cron = {
    restoreSafety: { enabled: false, cursorIncluded: true, backfillConfigIncluded: true },
    manifest: artifact('cron-manifest.json', canonicalJson(cronJobs), { contentType: 'application/json', format: 'canonical-json', tool: 'psql', toolVersion: '18.4' }),
    count: cronJobs.length,
    timezone: 'Asia/Shanghai',
  }
  const featureFlagSection = {
    manifest: artifact('feature-flags.json', canonicalJson(featureFlags), { contentType: 'application/json', format: 'canonical-json', tool: 'psql', toolVersion: '18.4' }),
    count: featureFlags.length,
  }
  const release = {
    gitCommit,
    frontendArtifact: artifact('frontend-dist.json', canonicalJson(frontendArchive), { contentType: 'application/json', format: 'base64-json-bundle', tool: 'vite', toolVersion: '8.0.12' }),
    buildToolVersion: 'vite 8.0.12',
  }

  const sourceFinalDb = getTemporaryDbEnvironment({
    cliPath,
    projectRef: sourceRef,
    connectionMode: 'session-pooler',
  })
  console.log('[p0:sealed-backup] stage=final-credential-refreshed productionWrites=0')
  const sourceAfter = getReconciliation({
    psqlPath,
    pgEnvironment: sourceFinalDb,
    sql: reconciliationSql,
  })
  if (sourceBefore.sha256 !== sourceAfter.sha256) throw new Error('production changed during the verified backup window')
  const storageAfter = storageSummary(await collectStorageArchive(sourceClient))
  if (canonicalJson(sourceStorageSummary) !== canonicalJson(storageAfter)) throw new Error('production Storage changed during the verified backup window')
  const functionsAfter = runSupabaseJson({ cliPath, args: ['functions', 'list', '--project-ref', sourceRef] })
  if (canonicalJson(functionsManifest) !== canonicalJson(functionsAfter)) throw new Error('production Functions changed during the verified backup window')
  console.log('[p0:sealed-backup] stage=freeze-reconciled productionWrites=0')
  const freezeEndedAt = new Date().toISOString()
  const createdAt = new Date().toISOString()
  const retentionUntil = new Date(Date.parse(createdAt) + 72 * 60 * 60 * 1000).toISOString()
  const keyAmounts = sourceBefore.value.keyAmounts
  const inventory = sourceBefore.value.inventory
  const reconciliation = {
    asOf: snapshotAt,
    querySha256,
    decimalPrecision: 2,
    sourceBeforeSha256: sourceBefore.sha256,
    sourceAfterSha256: sourceAfter.sha256,
    targetAfterSha256: null,
    tableRowCounts: artifact('reconciliation-table-row-counts.json', canonicalJson(sourceBefore.value.publicTables), { contentType: 'application/json', format: 'canonical-json', tool: 'psql', toolVersion: '18.4' }),
    keyAmounts: {
      ...artifact('reconciliation-key-amounts.json', canonicalJson({ keyAmounts, rawLedgers: sourceBefore.value.rawLedgers }), { contentType: 'application/json', format: 'canonical-json', tool: 'psql', toolVersion: '18.4' }),
      currency: keyAmounts.currency,
      customerPayments: Number(keyAmounts.customerPayments),
      internalPayables: Number(keyAmounts.internalPayables),
      salesProfit: Number(keyAmounts.salesProfit),
      points: Number(keyAmounts.points),
      laborEarnings: Number(keyAmounts.laborEarnings),
    },
    inventory: {
      ...artifact('reconciliation-inventory.json', canonicalJson(inventory), { contentType: 'application/json', format: 'canonical-json', tool: 'psql', toolVersion: '18.4' }),
      onHand: Number(inventory.onHand),
      reserved: Number(inventory.reserved),
      shipped: Number(inventory.shipped),
    },
  }
  const template = JSON.parse(readFileSync(resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'backup-restore-manifest.template.json'), 'utf8'))
  manifest = {
    ...template,
    template: false,
    package: {
      packageId, createdAt, sourceEnvironment: 'production', sourceProjectRef: sourceRef,
      gitCommit, sourceSnapshotAt: snapshotAt, freezeStartedAt, freezeEndedAt,
      encrypted: true, encryptionKeyReference: keyReference, retentionUntil,
    },
    database,
    auth,
    storage,
    functions,
    cron,
    featureFlags: featureFlagSection,
    environment: template.environment,
    release,
    reconciliation,
    restoreEvidence: { ...template.restoreEvidence, targetProjectRef: targetRef },
  }
  const manifestPath = resolve(packageDirectory, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  runExternal({
    commandPath: process.execPath,
    args: [resolve(repoRoot, 'scripts', 'p0', 'verify-backup-package-runtime.mjs'), '--manifest', manifestPath],
    cwd: repoRoot,
  })
  console.log(`[p0:sealed-backup] COMPLETED package=${packageDirectory} artifacts=21 publicTables=${Object.keys(sourceBefore.value.publicTables).length} authUsers=${auth.counts.authUsers} storageObjects=${storage.counts.objects}`)
  console.log(`[p0:sealed-backup] manifestSha256=${sha256(readFileSync(manifestPath))} secretsPrinted=0 productionWrites=0 formalRestoreAttempt=0`)
} catch (error) {
  const failurePath = resolve(packageDirectory, 'failure.json')
  writeFileSync(failurePath, JSON.stringify({
    status: 'failed',
    at: new Date().toISOString(),
    stage: 'sealed-backup',
    message: String(error?.message ?? error).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[REDACTED]'),
    productionWrites: 0,
    formalRestoreAttempt: 0,
    automaticRetry: false,
  }, null, 2) + '\n')
  throw error
} finally {
  rmSync(workingDirectory, { recursive: true, force: true })
  if (key) key.fill(0)
}
