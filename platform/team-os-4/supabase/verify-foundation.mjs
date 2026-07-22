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

const foundationMigrations = readdirSync(migrationsDir)
  .filter((name) => /^\d{14}_initial_team_os_4_foundation\.sql$/.test(name))

if (foundationMigrations.length !== 1) {
  throw new Error(`expected one foundation migration, found ${foundationMigrations.length}`)
}

const migrationPath = join(migrationsDir, foundationMigrations[0])
const sql = readFileSync(migrationPath, 'utf8')
const seed = readFileSync(join(root, 'seed.sql'), 'utf8')
const config = readFileSync(join(root, 'config.toml'), 'utf8')

const withoutComments = (value) => value
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--[^\r\n]*/g, '')

const normalizedSql = withoutComments(sql).replace(/\s+/g, ' ').trim().toLowerCase()
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
}

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
    `TEAM_OS_4_FOUNDATION_OK migration=${foundationMigrations[0]} tables=7 rls=7 grants=7 privateFunctions=3 seedStatements=0 forbiddenReferences=0 migrationModeLock=passed`,
  )
}
