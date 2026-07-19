import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifestPath = resolve(
  repoRoot,
  'docs',
  'team-os-4.0',
  'p0',
  'migration-sha256-manifest.json',
)

const issues = []
const check = (condition, message) => {
  if (!condition) issues.push(message)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  console.error('[p0:migration-manifest] cannot read manifest: ' + error.message)
  console.error('[p0:migration-manifest] summary discovered=0 run=0 passed=0 failed=1 skipped=0')
  process.exit(1)
}

const expectedCount = 70
const migrationDirectory = resolve(repoRoot, manifest.migrationDirectory ?? '')
const migrationFiles = readdirSync(migrationDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort()
const entries = Array.isArray(manifest.entries) ? manifest.entries : []

check(manifest.schemaVersion === 1, 'schemaVersion must be 1')
check(manifest.algorithm === 'sha256', 'algorithm must be sha256')
check(manifest.hashMode === 'utf8-lf', 'hashMode must be utf8-lf')
check(manifest.expectedCount === expectedCount, 'expectedCount must be ' + expectedCount)
check(manifest.migrationDirectory === 'supabase/migrations', 'migrationDirectory must be supabase/migrations')
check(/^[0-9a-f]{40}$/.test(manifest.generatedFromCommit ?? ''), 'generatedFromCommit must be a full Git commit id')
check(migrationFiles.length === expectedCount, 'discovered ' + migrationFiles.length + ' migration files; expected ' + expectedCount)
check(entries.length === expectedCount, 'manifest contains ' + entries.length + ' entries; expected ' + expectedCount)

const filePattern = /^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/
const discoveredVersions = new Set()
for (const file of migrationFiles) {
  const match = file.match(filePattern)
  check(Boolean(match), 'invalid migration filename: ' + file)
  if (match) {
    check(!discoveredVersions.has(match[1]), 'duplicate migration version: ' + match[1])
    discoveredVersions.add(match[1])
  }
}

const manifestByFile = new Map()
const manifestVersions = new Set()
for (const entry of entries) {
  check(entry && typeof entry === 'object', 'each manifest entry must be an object')
  if (!entry || typeof entry !== 'object') continue
  const match = typeof entry.file === 'string' ? entry.file.match(filePattern) : null
  check(Boolean(match), 'invalid manifest filename: ' + String(entry.file))
  check(typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.sha256), 'invalid sha256 for ' + String(entry.file))
  if (!match) continue
  check(entry.version === match[1], 'version does not match filename: ' + entry.file)
  check(!manifestByFile.has(entry.file), 'duplicate manifest filename: ' + entry.file)
  check(!manifestVersions.has(entry.version), 'duplicate manifest version: ' + entry.version)
  manifestByFile.set(entry.file, entry)
  manifestVersions.add(entry.version)
}

const manifestFiles = [...manifestByFile.keys()].sort()
check(
  JSON.stringify(manifestFiles) === JSON.stringify(migrationFiles),
  'manifest filenames must exactly match the migration directory',
)
check(
  JSON.stringify(entries.map((entry) => entry.file)) === JSON.stringify(manifestFiles),
  'manifest entries must be sorted by filename',
)

let hashChecksRun = 0
let hashChecksPassed = 0
for (const file of migrationFiles) {
  const entry = manifestByFile.get(file)
  if (!entry) continue
  hashChecksRun += 1
  const canonicalSource = readFileSync(resolve(migrationDirectory, file), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  const actualHash = createHash('sha256').update(canonicalSource, 'utf8').digest('hex')
  if (actualHash === entry.sha256) {
    hashChecksPassed += 1
  } else {
    issues.push('sha256 mismatch: ' + file)
  }
}

console.log(
  '[p0:migration-manifest] migration_files discovered=' + migrationFiles.length +
    ' manifest=' + entries.length + ' expected=' + expectedCount,
)
console.log(
  '[p0:migration-manifest] summary discovered=' + migrationFiles.length +
    ' run=' + hashChecksRun + ' passed=' + hashChecksPassed +
    ' failed=' + issues.length + ' skipped=0',
)

if (issues.length > 0) {
  for (const issue of issues) console.error('[p0:migration-manifest] FAIL ' + issue)
  process.exit(1)
}
