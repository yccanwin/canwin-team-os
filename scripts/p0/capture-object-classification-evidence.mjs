import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getTemporaryDbEnvironment,
  loadRestoreRun,
  runPsql,
} from './temporary-db-access.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const p0Path = (...segments) => resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', ...segments)
const scriptPath = (...segments) => resolve(repoRoot, 'scripts', 'p0', ...segments)
const outputPath = p0Path('object-classification-isolated-evidence.json')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]))
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function parseJsonPsqlOutput(output) {
  const line = output.split(/\r?\n/u).find((entry) => entry.trim().startsWith('{'))
  if (!line) throw new Error('read-only psql output did not contain JSON evidence')
  return JSON.parse(line)
}

function walkFiles(root, extensions) {
  if (!existsSync(root)) return []
  const found = []
  const visit = (path) => {
    for (const name of readdirSync(path).sort()) {
      const candidate = resolve(path, name)
      const stat = statSync(candidate)
      if (stat.isDirectory()) visit(candidate)
      else if (extensions.some((extension) => name.endsWith(extension))) found.push(candidate)
    }
  }
  visit(root)
  return found
}

function lineNumberAt(text, index) {
  let line = 1
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1
  }
  return line
}

function statementSlice(text, start) {
  const semicolon = text.indexOf(';', start)
  const end = semicolon >= 0 && semicolon - start <= 2400 ? semicolon + 1 : Math.min(text.length, start + 2400)
  return text.slice(start, end)
}

function captureLocalEntrypoints(tableNames) {
  const tableSet = new Set(tableNames)
  const roots = [resolve(repoRoot, 'src'), resolve(repoRoot, 'supabase', 'functions')]
  const files = roots.flatMap((root) => walkFiles(root, ['.ts', '.tsx', '.js', '.jsx', '.mjs']))
  const tableEntrypoints = Object.fromEntries(tableNames.map((name) => [name, []]))
  const rpcCallsites = []
  const dynamicDatabaseFromSites = []
  let literalTableFromCallCount = 0
  let databaseFromCallCount = 0

  for (const path of files) {
    const text = readFileSync(path, 'utf8')
    const file = relative(repoRoot, path).replaceAll('\\', '/')
    const fromCallPattern = /\.from\(\s*(['"])([a-z_][a-z0-9_]*)\1\s*\)/gu
    for (const match of text.matchAll(fromCallPattern)) {
      const prefix = text.slice(Math.max(0, match.index - 20), match.index)
      if (/storage\s*$/u.test(prefix)) continue
      databaseFromCallCount += 1
      if (!tableSet.has(match[2])) continue
      literalTableFromCallCount += 1
      const statement = statementSlice(text, match.index)
      const operations = sortedUnique(
        [...statement.matchAll(/\.(select|insert|update|upsert|delete)\s*\(/gu)].map((entry) => entry[1]),
      )
      tableEntrypoints[match[2]].push({
        file,
        line: lineNumberAt(text, match.index),
        operations: operations.length ? operations : ['builder_only_or_unknown'],
      })
    }

    const anyFromPattern = /\.from\(\s*([^'"\s][^)]*)\)/gu
    for (const match of text.matchAll(anyFromPattern)) {
      const prefix = text.slice(Math.max(0, match.index - 20), match.index)
      if (/Array$/u.test(prefix) || /storage\s*$/u.test(prefix)) continue
      dynamicDatabaseFromSites.push({ file, line: lineNumberAt(text, match.index) })
    }

    const rpcPattern = /\.rpc\(\s*(['"])([a-z_][a-z0-9_]*)\1/gu
    for (const match of text.matchAll(rpcPattern)) {
      rpcCallsites.push({
        file,
        line: lineNumberAt(text, match.index),
        routineName: match[2],
      })
    }
  }

  for (const entries of Object.values(tableEntrypoints)) {
    entries.sort((left, right) => left.file.localeCompare(right.file, 'en') || left.line - right.line)
  }

  return {
    sourceFileCount: files.length,
    databaseFromCallCount,
    literalManifestTableFromCallCount: literalTableFromCallCount,
    dynamicDatabaseFromSiteCount: dynamicDatabaseFromSites.length,
    dynamicDatabaseFromSites,
    rpcCallsiteCount: rpcCallsites.length,
    rpcCallsites: rpcCallsites.sort((left, right) => left.routineName.localeCompare(right.routineName, 'en') || left.file.localeCompare(right.file, 'en') || left.line - right.line),
    tables: tableNames.map((tableName) => ({ tableName, entrypoints: tableEntrypoints[tableName] })),
  }
}

function sqlLiteral(value) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(value)) throw new Error('unsafe SQL identifier in classification register')
  return `'${value}'`
}

function sqlIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(value)) throw new Error('unsafe SQL identifier in classification register')
  return `"${value}"`
}

function buildExactCountSql(tableNames, projectRef) {
  const rows = tableNames.map((name) =>
    `select ${sqlLiteral(name)}::text as table_name, count(*)::bigint as exact_rows from public.${sqlIdentifier(name)}`,
  ).join('\nunion all\n')
  return `begin read only;
with exact_counts as (
${rows}
)
select jsonb_build_object(
  'projectRef',${sqlLiteral(projectRef)},
  'capturedAtUtc',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'transactionReadOnly',current_setting('transaction_read_only')::boolean,
  'businessRowsReturned',false,
  'writePerformed',false,
  'tables',(select jsonb_agg(jsonb_build_object('tableName',table_name,'exactRows',exact_rows) order by table_name) from exact_counts)
)::text;
rollback;`
}

function buildRoutineDependencySql(tableNames, projectRef) {
  const tableRows = tableNames.map((name) => `(${sqlLiteral(name)})`).join(',\n    ')
  return `begin read only;
with table_names(table_name) as (
  values
    ${tableRows}
), routines as (
  select
    p.oid,
    p.proname as routine_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_functiondef(p.oid) as definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind in('f','p')
), routine_targets as (
  select distinct n.nspname as routine_schema,p.proname as routine_name
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','sales_os_private') and p.prokind in('f','p')
), dependency_candidates as (
  select
    r.oid,
    t.table_name,
    lower(r.definition) ~ ('(from|join)[[:space:]]+(public[.])?[\"]?' || t.table_name || '[\"]?([^a-z0-9_]|$)') as read_marker,
    lower(r.definition) ~ ('insert[[:space:]]+into[[:space:]]+(public[.])?[\"]?' || t.table_name || '[\"]?([^a-z0-9_]|$)') as insert_marker,
    lower(r.definition) ~ ('update[[:space:]]+(only[[:space:]]+)?(public[.])?[\"]?' || t.table_name || '[\"]?([^a-z0-9_]|$)') as update_marker,
    lower(r.definition) ~ ('delete[[:space:]]+from[[:space:]]+(public[.])?[\"]?' || t.table_name || '[\"]?([^a-z0-9_]|$)') as delete_marker,
    lower(r.definition) ~ ('merge[[:space:]]+into[[:space:]]+(public[.])?[\"]?' || t.table_name || '[\"]?([^a-z0-9_]|$)') as merge_marker
  from routines r
  cross join table_names t
  where lower(r.definition) ~ ('(^|[^a-z0-9_])(public[.])?[\"]?' || t.table_name || '[\"]?([^a-z0-9_]|$)')
), routine_dependency_candidates as (
  select r.oid,t.routine_schema,t.routine_name
  from routines r
  cross join routine_targets t
  where t.routine_name<>r.routine_name
    and lower(r.definition) ~ ('(^|[^a-z0-9_])(' || t.routine_schema || '[.])?[\"]?' || t.routine_name || '[\"]?[[:space:]]*[(]')
), routine_rows as (
  select
    r.oid,
    r.routine_name,
    r.identity_arguments,
    md5(r.definition) as definition_md5,
    length(r.definition) as definition_length,
    lower(r.definition) ~ '\\mexecute\\M' as dynamic_sql_marker,
    (select count(*) from pg_catalog.regexp_matches(
      lower(r.definition),
      '(^|[^a-z0-9_])(public[.])?[\"]?' || r.routine_name || '[\"]?[[:space:]]*[(]',
      'g'
    )) > 1 as same_name_body_call_marker,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'tableName',d.table_name,
        'readMarker',d.read_marker,
        'insertMarker',d.insert_marker,
        'updateMarker',d.update_marker,
        'deleteMarker',d.delete_marker,
        'mergeMarker',d.merge_marker,
        'operationUnknown',not(d.read_marker or d.insert_marker or d.update_marker or d.delete_marker or d.merge_marker)
      ) order by d.table_name)
      from dependency_candidates d where d.oid=r.oid
    ),'[]'::jsonb) as table_dependencies,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'schema',d.routine_schema,
        'name',d.routine_name
      ) order by d.routine_schema,d.routine_name)
      from routine_dependency_candidates d where d.oid=r.oid
    ),'[]'::jsonb) as routine_dependencies
  from routines r
)
select jsonb_build_object(
  'projectRef',${sqlLiteral(projectRef)},
  'capturedAtUtc',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'transactionReadOnly',current_setting('transaction_read_only')::boolean,
  'functionBodiesReturned',false,
  'businessRowsRead',false,
  'writePerformed',false,
  'routines',(select jsonb_agg(jsonb_build_object(
    'signature',routine_name || '(' || identity_arguments || ')',
    'definitionMd5',definition_md5,
    'definitionLength',definition_length,
    'dynamicSqlMarker',dynamic_sql_marker,
    'sameNameBodyCallMarker',same_name_body_call_marker,
    'tableDependencies',table_dependencies,
    'routineDependencies',routine_dependencies
  ) order by routine_name,identity_arguments) from routine_rows)
)::text;
rollback;`
}

const register = readJson(p0Path('public-table-classification-register.json'))
const productionRoutineEvidence = readJson(p0Path('public-routine-live-evidence.json'))
const projectContract = readJson(scriptPath('project-ref-contract.json'))
const restoreRun = loadRestoreRun(repoRoot)
const tableNames = sortedUnique(Object.values(register.classifications).flat())

if (tableNames.length !== 103) throw new Error(`classification register expected 103 tables, got ${tableNames.length}`)
if (restoreRun.state !== 'succeeded' || restoreRun.target?.projectRef !== projectContract.testProjectRef) {
  throw new Error('isolated restore baseline is not the current succeeded test project')
}
if (restoreRun.target.previewBuildAllowed !== false || projectContract.previewBuildAllowed !== false) {
  throw new Error('classification evidence requires a closed test project with preview disabled')
}

const cliPath = restoreRun.toolchain?.supabaseCli?.path
const psqlPath = restoreRun.toolchain?.psql?.path
if (!cliPath || !psqlPath || !existsSync(cliPath) || !existsSync(psqlPath)) {
  throw new Error('frozen Supabase CLI or psql toolchain path is unavailable')
}

console.log('[p0:classification-capture] stage=local-source-scan')
const sourceEntrypoints = captureLocalEntrypoints(tableNames)
if (sourceEntrypoints.dynamicDatabaseFromSiteCount !== 0) {
  throw new Error(`dynamic database table callsites require manual review count=${sourceEntrypoints.dynamicDatabaseFromSiteCount}`)
}

console.log('[p0:classification-capture] stage=temporary-readonly-credential')
const pgEnvironment = getTemporaryDbEnvironment({
  cliPath,
  projectRef: projectContract.testProjectRef,
  connectionMode: 'session-pooler',
})

console.log('[p0:classification-capture] stage=exact-counts productionWrites=0 testWrites=0')
const exactCounts = parseJsonPsqlOutput(runPsql({
  psqlPath,
  pgEnvironment,
  sql: buildExactCountSql(tableNames, projectContract.testProjectRef),
  timeout: 180000,
  retryReadOnlySessionPooler: true,
}))

console.log('[p0:classification-capture] stage=routine-dependencies productionWrites=0 testWrites=0')
const routineDependencies = parseJsonPsqlOutput(runPsql({
  psqlPath,
  pgEnvironment,
  sql: buildRoutineDependencySql(tableNames, projectContract.testProjectRef),
  timeout: 180000,
  retryReadOnlySessionPooler: true,
}))

const countNames = sortedUnique(exactCounts.tables.map((entry) => entry.tableName))
if (!exactCounts.transactionReadOnly || exactCounts.writePerformed || exactCounts.businessRowsReturned ||
    countNames.length !== 103 || JSON.stringify(countNames) !== JSON.stringify(tableNames)) {
  throw new Error('isolated exact-count evidence is not read-only or table-complete')
}

const productionBySignature = new Map(productionRoutineEvidence.routines.map((entry) => [entry.signature, entry]))
const isolatedBySignature = new Map(routineDependencies.routines.map((entry) => [entry.signature, entry]))
if (!routineDependencies.transactionReadOnly || routineDependencies.writePerformed ||
    routineDependencies.businessRowsRead || routineDependencies.functionBodiesReturned ||
    isolatedBySignature.size !== 162 || productionBySignature.size !== 162) {
  throw new Error('isolated routine dependency evidence is not read-only or routine-complete')
}

const fingerprintMismatches = []
for (const [signature, production] of productionBySignature) {
  const isolated = isolatedBySignature.get(signature)
  if (!isolated || isolated.definitionMd5 !== production.definitionEvidence.md5 ||
      isolated.definitionLength !== production.definitionEvidence.length) {
    fingerprintMismatches.push(signature)
  }
}
if (fingerprintMismatches.length) {
  throw new Error(`restored routine fingerprint mismatch count=${fingerprintMismatches.length}`)
}

const evidence = canonicalJson({
  schemaVersion: 1,
  evidenceType: 'isolated-restored-object-classification-evidence',
  projectRef: projectContract.testProjectRef,
  projectStatus: projectContract.testProjectStatus,
  closedEnvironment: true,
  previewBuildAllowed: false,
  productionProjectRef: projectContract.productionProjectRef,
  productionReadPerformed: false,
  productionWritePerformed: false,
  testWritePerformed: false,
  credentialsPersisted: false,
  secretsReturned: false,
  businessRowsReturned: false,
  functionBodiesReturned: false,
  capturedAtUtc: routineDependencies.capturedAtUtc,
  sources: {
    tableRegister: 'docs/team-os-4.0/p0/public-table-classification-register.json',
    productionTableMetadata: 'docs/team-os-4.0/p0/public-table-live-evidence.json',
    productionRoutineMetadata: 'docs/team-os-4.0/p0/public-routine-live-evidence.json',
    restoredBaseline: 'docs/team-os-4.0/p0/restore-run.p0-test.json',
    runtimeCodeRoots: ['src', 'supabase/functions'],
  },
  validation: {
    manifestTableCount: tableNames.length,
    exactCountTableCount: exactCounts.tables.length,
    restoredRoutineCount: routineDependencies.routines.length,
    productionRoutineCount: productionRoutineEvidence.routines.length,
    routineFingerprintMatchCount: productionRoutineEvidence.routines.length - fingerprintMismatches.length,
    routineFingerprintMismatchCount: fingerprintMismatches.length,
    sourceFileCount: sourceEntrypoints.sourceFileCount,
    dynamicDatabaseFromSiteCount: sourceEntrypoints.dynamicDatabaseFromSiteCount,
  },
  exactCounts: exactCounts.tables,
  sourceEntrypoints,
  routineDependencies: routineDependencies.routines,
})

const serialized = `${JSON.stringify(evidence, null, 2)}\n`
writeFileSync(outputPath, serialized, 'utf8')
console.log(
  '[p0:classification-capture] OK tables=' + evidence.exactCounts.length +
  ' routines=' + evidence.routineDependencies.length +
  ' routineFingerprints=' + evidence.validation.routineFingerprintMatchCount +
  ' sourceFiles=' + evidence.validation.sourceFileCount +
  ' dynamicTableSites=' + evidence.validation.dynamicDatabaseFromSiteCount +
  ' sha256=' + sha256Text(serialized) +
  ' productionWrites=0 testWrites=0 secrets=0 businessRowsReturned=0 functionBodiesReturned=0',
)
