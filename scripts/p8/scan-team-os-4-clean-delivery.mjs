import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index]
  const value = process.argv[index + 1]
  if (!flag?.startsWith('--') || !value || value.startsWith('--')) throw new Error(`invalid argument near ${flag ?? '<end>'}`)
  args.set(flag, value)
}

const artifactArgument = args.get('--artifact')
const evidenceArgument = args.get('--evidence')
if (!artifactArgument || !evidenceArgument) {
  throw new Error('usage: node scan-team-os-4-clean-delivery.mjs --artifact <unpacked-directory> --evidence <evidence-json>')
}

const artifactRoot = realpathSync(resolve(artifactArgument))
const evidencePath = resolve(evidenceArgument)
if (!statSync(artifactRoot).isDirectory()) throw new Error('artifact must be an unpacked directory')
if (evidencePath === artifactRoot || evidencePath.startsWith(`${artifactRoot}${sep}`)) {
  throw new Error('evidence output must be outside the artifact')
}

const allowedFiles = new Set(['VERSION', 'LICENSE', 'NOTICE', 'DELIVERY.json', 'MANIFEST.sha256'])
const allowedRoots = ['apps/team-os-4', 'packages/team-os-4-domain', 'platform/team-os-4']
const forbiddenSegments = new Set([
  '.git', '.github', '.codex-audit', 'node_modules', 'dist', 'coverage', '.cache',
  '.vite', '.temp', 'exports', 'snapshots', 'fixtures', '__fixtures__', 'evidence',
  'cache', 'mocks', '__mocks__', 'demo-data', 'seed-data',
])
const forbiddenExtensions = new Set([
  '.pem', '.key', '.p12', '.pfx', '.dump', '.backup', '.log', '.csv', '.tsv',
  '.jsonl', '.ndjson', '.parquet', '.xlsx', '.xls', '.png', '.jpg', '.jpeg',
  '.webp', '.gif', '.svg', '.map', '.zip', '.tar', '.gz', '.tgz', '.7z',
])
const exportedBusinessName = /(?:^|[-_.])(employees?|staff|customers?|orders?|finance|financial|ledgers?|logs?|cases?|auth[-_.]?users?|storage[-_.]?objects?)(?:[-_.]|$)/i
const exportLikeExtension = /\.(?:json|sql|csv|tsv|jsonl|ndjson|parquet|xlsx?|dump|backup)(?:\.gz)?$/i
const secretPatterns = [
  { name: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/ },
  { name: 'supabase-secret-key', pattern: /\bsb_(?:secret|service_role)_[A-Za-z0-9_-]{16,}\b/i },
  { name: 'postgres-uri-with-password', pattern: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/i },
  { name: 'assigned-secret', pattern: /\b(?:SUPABASE_SERVICE_ROLE_KEY|JWT_SECRET|DATABASE_PASSWORD|DB_PASSWORD|REFRESH_TOKEN|ACCESS_TOKEN|WEBHOOK_SECRET)\s*=\s*[^\s"']{8,}/i },
]

function portable(path) {
  return path.split(sep).join('/')
}

function ensureInside(root, path) {
  const rel = relative(root, path)
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return rel
  throw new Error(`path escapes artifact: ${path}`)
}

function isAllowlisted(path) {
  if (allowedFiles.has(path)) return true
  return allowedRoots.some((root) => path === root || path.startsWith(`${root}/`) || root.startsWith(`${path}/`))
}

function extensionOf(path) {
  const lower = path.toLowerCase()
  if (lower.endsWith('.sql.gz')) return '.sql.gz'
  return lower.slice(lower.lastIndexOf('.'))
}

const files = []
const violations = []

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name)
    const rel = portable(ensureInside(artifactRoot, absolute))
    const segments = rel.split('/')
    if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) {
      violations.push({ path: rel, rule: 'symbolic-links-forbidden' })
      continue
    }
    if (!isAllowlisted(rel)) violations.push({ path: rel, rule: 'outside-explicit-allowlist' })
    for (const segment of segments) {
      if (forbiddenSegments.has(segment.toLowerCase())) violations.push({ path: rel, rule: `forbidden-directory:${segment}` })
    }
    if (rel === 'supabase/migrations' || rel.startsWith('supabase/migrations/')) {
      violations.push({ path: rel, rule: 'team-os-3-migrations-forbidden' })
    }
    if (rel === 'tools/migrate-3-to-4' || rel.startsWith('tools/migrate-3-to-4/')) {
      violations.push({ path: rel, rule: 'migration-tool-must-be-separate-artifact' })
    }
    if (entry.isDirectory()) {
      visit(absolute)
      continue
    }
    if (!entry.isFile()) {
      violations.push({ path: rel, rule: 'non-regular-file-forbidden' })
      continue
    }
    const lowerBase = basename(rel).toLowerCase()
    const extension = extensionOf(rel)
    if ((lowerBase === '.env' || lowerBase.startsWith('.env.')) && rel !== 'apps/team-os-4/.env.example') {
      violations.push({ path: rel, rule: 'environment-file-forbidden' })
    }
    if (forbiddenExtensions.has(extension)) violations.push({ path: rel, rule: `forbidden-file-type:${extension}` })
    if (exportLikeExtension.test(rel) && exportedBusinessName.test(basename(rel))) {
      violations.push({ path: rel, rule: 'business-export-shape-forbidden' })
    }
    const bytes = readFileSync(absolute)
    const text = bytes.includes(0) ? null : bytes.toString('utf8')
    if (text !== null) {
      for (const secret of secretPatterns) {
        if (secret.pattern.test(text)) violations.push({ path: rel, rule: `credential-shape:${secret.name}` })
      }
      if (/^\s*(?:COPY|INSERT\s+INTO)\s+(?:auth\.)?users\b/im.test(text) && !rel.startsWith('platform/team-os-4/supabase/migrations/')) {
        violations.push({ path: rel, rule: 'auth-user-export-content-forbidden' })
      }
      if (/^\s*COPY\s+(?:employees?|customers?|orders?|financial_records?|cases?)\b/im.test(text)) {
        violations.push({ path: rel, rule: 'business-row-export-content-forbidden' })
      }
    }
    files.push({ path: rel, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
}

visit(artifactRoot)
for (const required of ['VERSION', 'LICENSE', 'NOTICE', 'DELIVERY.json', 'MANIFEST.sha256']) {
  if (!files.some((file) => file.path === required)) violations.push({ path: required, rule: 'required-inventory-missing' })
}
for (const root of allowedRoots) {
  if (!files.some((file) => file.path.startsWith(`${root}/`))) violations.push({ path: root, rule: 'required-delivery-root-empty-or-missing' })
}

files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
violations.sort((left, right) => left.path.localeCompare(right.path, 'en') || left.rule.localeCompare(right.rule, 'en'))
const manifest = files
  .filter((file) => file.path !== 'MANIFEST.sha256')
  .map((file) => `${file.sha256}  ${file.path}`)
  .join('\n') + '\n'
const existingManifest = files.some((file) => file.path === 'MANIFEST.sha256')
  ? readFileSync(resolve(artifactRoot, 'MANIFEST.sha256'), 'utf8')
  : null
if (existingManifest !== null && existingManifest !== manifest) {
  violations.push({ path: 'MANIFEST.sha256', rule: 'manifest-content-mismatch' })
}

const evidence = {
  schemaVersion: 1,
  phase: 'P8',
  artifactRoot,
  scannedAt: new Date().toISOString(),
  status: 'pending',
  accepted: false,
  fileCount: files.length,
  files,
  manifestSha256: createHash('sha256').update(manifest).digest('hex'),
  violations,
}
mkdirSync(dirname(evidencePath), { recursive: true })
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' })

if (violations.length > 0) {
  throw new Error(`clean-delivery scan rejected ${violations.length} violation(s); evidence remains pending at ${evidencePath}`)
}
console.log(manifest)
console.log(`Clean-delivery static scan found no violation; evidence remains pending at ${evidencePath}.`)
