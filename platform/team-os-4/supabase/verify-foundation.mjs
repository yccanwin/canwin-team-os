import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(root, 'migrations')
const expectedTables = [
  'companies',
  'primary_roles',
  'capabilities',
  'profiles',
  'profile_capabilities',
  'system_runtime_state',
  'initialization_audit',
]
const expectedPrivateFunctions = [
  'is_active_company_member',
  'is_company_admin',
  'prevent_initialization_audit_mutation',
]
const expectedMigrations = [
  '20260722034027_initial_team_os_4_foundation.sql',
  '20260722035617_add_foundation_foreign_key_indexes.sql',
  '20260722042037_add_controlled_bootstrap_and_permanent_seal.sql',
]
const expectedForeignKeyIndexes = [
  ['profiles_primary_role_company_fk_idx', 'profiles', 'primary_role_id,company_id'],
  ['profile_capabilities_profile_company_fk_idx', 'profile_capabilities', 'profile_id,company_id'],
  ['profile_capabilities_capability_company_fk_idx', 'profile_capabilities', 'capability_id,company_id'],
  ['profile_capabilities_granted_by_fk_idx', 'profile_capabilities', 'granted_by'],
  ['system_runtime_state_changed_by_fk_idx', 'system_runtime_state', 'changed_by'],
  ['initialization_audit_actor_user_id_fk_idx', 'initialization_audit', 'actor_user_id'],
]

const migrations = readdirSync(migrationsDir)
  .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
  .sort()

if (JSON.stringify(migrations.slice(0, expectedMigrations.length)) !== JSON.stringify(expectedMigrations)) {
  throw new Error(`foundation migration prefix/order drift: ${migrations.join(',')}`)
}

const migrationPath = join(migrationsDir, expectedMigrations[0])
const sql = readFileSync(migrationPath, 'utf8')
const foreignKeyIndexSql = readFileSync(join(migrationsDir, expectedMigrations[1]), 'utf8')
const bootstrapSql = readFileSync(join(migrationsDir, expectedMigrations[2]), 'utf8')
const seed = readFileSync(join(root, 'seed.sql'), 'utf8')
const config = readFileSync(join(root, 'config.toml'), 'utf8')

const withoutComments = (value) => value
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--[^\r\n]*/g, '')

const normalizedSql = withoutComments(sql).replace(/\s+/g, ' ').trim().toLowerCase()
const normalizedForeignKeyIndexSql = withoutComments(foreignKeyIndexSql)
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()
const normalizedBootstrapSql = withoutComments(bootstrapSql).replace(/\s+/g, ' ').trim().toLowerCase()
const failures = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const matches = (pattern, value = normalizedSql) => [...value.matchAll(pattern)]

const createdTables = matches(/\bcreate table public\.([a-z][a-z0-9_]*)\s*\(/g)
  .map((match) => match[1])
const rlsTables = matches(/\balter table public\.([a-z][a-z0-9_]*) enable row level security\s*;/g)
  .map((match) => match[1])
const privateFunctions = matches(/\bcreate or replace function private\.([a-z][a-z0-9_]*)\s*\(/g)
  .map((match) => match[1])
const foreignKeyIndexes = matches(
  /\bcreate index ([a-z][a-z0-9_]*)\s+on public\.([a-z][a-z0-9_]*)\s*\(([^)]+)\)\s*;/g,
  normalizedForeignKeyIndexSql,
).map((match) => [
  match[1],
  match[2],
  match[3].replace(/\s+/g, ''),
])

check(
  JSON.stringify(createdTables) === JSON.stringify(expectedTables),
  `public table set/order drift: ${createdTables.join(',')}`,
)
check(
  JSON.stringify(rlsTables) === JSON.stringify(expectedTables),
  `RLS table set/order drift: ${rlsTables.join(',')}`,
)
check(
  JSON.stringify(privateFunctions) === JSON.stringify(expectedPrivateFunctions),
  `private function set/order drift: ${privateFunctions.join(',')}`,
)
check(
  JSON.stringify(foreignKeyIndexes) === JSON.stringify(expectedForeignKeyIndexes),
  `foundation foreign-key index set/order drift: ${JSON.stringify(foreignKeyIndexes)}`,
)

for (const table of expectedTables) {
  const escaped = escapeRegExp(table)
  check(
    new RegExp(`\\brevoke all on table public\\.${escaped} from anon, authenticated\\s*;`).test(normalizedSql),
    `${table}: explicit anon/authenticated revoke missing`,
  )
  check(
    new RegExp(`\\bgrant select on table public\\.${escaped} to authenticated\\s*;`).test(normalizedSql),
    `${table}: explicit authenticated SELECT grant missing`,
  )
  check(
    new RegExp(`\\bgrant [^;]+ on table public\\.${escaped} to service_role\\s*;`).test(normalizedSql),
    `${table}: explicit service_role grant missing`,
  )
}

check(
  /\bgrant update \(display_name\) on table public\.profiles to authenticated\s*;/.test(normalizedSql),
  'profiles: display_name-only UPDATE grant missing',
)
check(
  /\brevoke all on schema private from public\s*;/.test(normalizedSql),
  'private schema PUBLIC revoke missing',
)
for (const name of expectedPrivateFunctions) {
  check(
    new RegExp(`\\brevoke all on function private\\.${escapeRegExp(name)}\\([^)]*\\) from public\\s*;`).test(normalizedSql),
    `${name}: PUBLIC execute revoke missing`,
  )
}
for (const name of ['is_active_company_member', 'is_company_admin']) {
  const start = normalizedSql.indexOf(`create or replace function private.${name}(`)
  const end = normalizedSql.indexOf('$function$;', start)
  const body = start >= 0 && end > start ? normalizedSql.slice(start, end) : ''
  check(body.includes('security definer'), `${name}: SECURITY DEFINER missing`)
  check(body.includes("set search_path = ''"), `${name}: empty search_path missing`)
}

const executableSeed = withoutComments(seed).trim()
check(executableSeed === '', 'seed.sql must contain no executable SQL')
check(/\[db\.seed\][\s\S]*enabled\s*=\s*true/.test(config), 'config: seed must be enabled')
check(/sql_paths\s*=\s*\["\.\/seed\.sql"\]/.test(config), 'config: seed path drift')
check(/\[auth\][\s\S]*enable_signup\s*=\s*false/.test(config), 'config: public signup must remain disabled')

const forbiddenReferences = [
  ['user_metadata', /user_metadata/i],
  ['raw_user_meta_data', /raw_user_meta_data/i],
  ['CANWIN_TEAM', /canwin_team/i],
  ['翻身小队', /翻身小队/],
  ['old root src', /(?:^|[\s'"`])(?:\.\.\/)*src\//im],
  ['old migrations root', /(?:^|[\s'"`])(?:\.\.\/)*supabase\/migrations\//im],
]
for (const [label, pattern] of forbiddenReferences) {
  check(!pattern.test(sql), `forbidden reference present: ${label}`)
  check(!pattern.test(foreignKeyIndexSql), `foreign-key index migration forbidden reference present: ${label}`)
  check(!pattern.test(bootstrapSql), `bootstrap migration forbidden reference present: ${label}`)
}

check(
  /create or replace function private\.bootstrap_team_os_4\([\s\S]*?\)\s*returns jsonb\s*language plpgsql\s*security definer\s*set search_path = ''/.test(normalizedBootstrapSql),
  'controlled bootstrap function or security boundary missing',
)
check(
  /pg_advisory_xact_lock\(/.test(normalizedBootstrapSql),
  'bootstrap transaction lock missing',
)
for (const role of ['public', 'anon', 'authenticated']) {
  check(
    new RegExp(`revoke all on function private\\.bootstrap_team_os_4\\([^)]+\\) from ${role}\\s*;`).test(normalizedBootstrapSql),
    `bootstrap ${role} revoke missing`,
  )
}
check(
  /grant execute on function private\.bootstrap_team_os_4\([^)]+\) to service_role\s*;/.test(normalizedBootstrapSql),
  'bootstrap service_role grant missing',
)
check(
  /revoke execute on function private\.bootstrap_team_os_4\([^)]+\) from service_role\s*;/.test(normalizedBootstrapSql),
  'bootstrap permanent self-seal missing',
)
check(
  /create or replace function public\.bootstrap_team_os_4_deployment\([\s\S]*?\)\s*returns jsonb\s*language sql\s*security invoker\s*set search_path = ''/.test(normalizedBootstrapSql),
  'bootstrap Data API deployment bridge boundary missing',
)
for (const role of ['public', 'anon', 'authenticated']) {
  check(
    new RegExp(`revoke all on function public\\.bootstrap_team_os_4_deployment\\([^)]+\\) from ${role}\\s*;`).test(normalizedBootstrapSql),
    `bootstrap deployment bridge ${role} revoke missing`,
  )
}
check(
  /grant execute on function public\.bootstrap_team_os_4_deployment\([^)]+\) to service_role\s*;/.test(normalizedBootstrapSql),
  'bootstrap deployment bridge service_role grant missing',
)
check(
  /revoke execute on function public\.bootstrap_team_os_4_deployment\([^)]+\) from service_role\s*;/.test(normalizedBootstrapSql),
  'bootstrap deployment bridge permanent seal missing',
)
check(
  !/(password|service[_ -]?role|access[_ -]?token|refresh[_ -]?token|database[_ -]?url)\s+(text|varchar)/.test(normalizedBootstrapSql),
  'bootstrap accepts a credential-like input',
)
check(
  /values \( v_company_id, true, true, false, false, false, p_admin_user_id \)/.test(normalizedBootstrapSql),
  'sealed migration-mode runtime state missing',
)
check(
  /v_role_count <> 5 or v_capability_count <> 2/.test(normalizedBootstrapSql),
  'bootstrap dictionary cardinality assertion missing',
)

check(
  /\bmigration_mode boolean not null default true\b/.test(normalizedSql),
  'migration_mode must default true',
)
for (const flag of [
  'business_writes_enabled',
  'background_jobs_enabled',
  'outbound_effects_enabled',
]) {
  check(
    new RegExp(`\\b${flag} boolean not null default false\\b`).test(normalizedSql),
    `${flag} must default false`,
  )
  check(
    normalizedSql.includes(`not ${flag}`),
    `${flag} is not covered by a fail-closed constraint`,
  )
}
check(
  /constraint runtime_state_migration_is_closed check\s*\(\s*not migration_mode\s*or\s*\(\s*not business_writes_enabled\s*and not background_jobs_enabled\s*and not outbound_effects_enabled\s*\)\s*\)/.test(normalizedSql),
  'migration-mode three-way hard lock missing',
)
check(
  /create trigger initialization_audit_append_only before update or delete on public\.initialization_audit/.test(normalizedSql),
  'initialization audit append-only trigger missing',
)
check(
  /raise exception 'initialization audit is append-only' using errcode = '55000'/.test(normalizedSql),
  'initialization audit mutation blocker missing',
)

if (failures.length > 0) {
  for (const failure of failures) console.error(`FOUNDATION_FAIL ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    `TEAM_OS_4_FOUNDATION_OK migrations=${expectedMigrations.length} tables=7 rls=7 grants=7 privateFunctions=3 foreignKeyIndexes=6 bootstrap=sealed seedStatements=0 forbiddenReferences=0 migrationModeLock=passed`,
  )
}
