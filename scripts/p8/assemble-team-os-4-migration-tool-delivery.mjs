import { createHash } from 'node:crypto'
import { access, copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sourceRoot = resolve(repoRoot, 'tools/migrate-3-to-4')
const SHA256 = /^[a-f0-9]{40}$/
const VERSION = /^4\.0\.\d+(?:-[0-9A-Za-z.-]+)?$/
const FORBIDDEN_PATH = /(?:^|\/)(?:\.env(?:\..*)?|node_modules|dist|\.vite|\.temp|exports?|snapshots?|fixtures?|evidence|backups?|cache|data|auth-users|storage-objects)(?:\/|$)/i
const FORBIDDEN_EXTENSION = /\.(?:pem|key|p12|pfx|dump|backup|sql\.gz|log|png|jpe?g|webp|gif|svg)$/i
const FORBIDDEN_VALUE = /(?:(?:service[_-]?role|anon[_-]?key|publishable[_-]?key|jwt[_-]?secret|database[_-]?password|password|private[_-]?key|access[_-]?token|refresh[_-]?token|webhook[_-]?secret|authorization)\s*["']?\s*[:=]\s*["']?[^\s"',;}]{8,}|bearer\s+[A-Za-z0-9._~-]{8,}|postgres(?:ql)?:\/\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,})/i
const ALLOWED_SOURCE_MODULES = new Set([
  'auth.ts',
  'backup-recovery-evidence.ts',
  'batch.ts',
  'forensic-evidence.ts',
  'freeze-evidence.ts',
  'ledger.ts',
  'manifest.ts',
  'orchestrator.ts',
  'reconciliation.ts',
  'signed-snapshot.ts',
  'storage-manifest.ts',
])

function usage() {
  throw new Error('usage: node scripts/p8/assemble-team-os-4-migration-tool-delivery.mjs --template <delivery-template.json> --output <new-directory>')
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || !value) usage()
    values.set(name, value)
  }
  if (values.size !== 2 || !values.has('--template') || !values.has('--output')) usage()
  return { templatePath: resolve(values.get('--template')), outputRoot: resolve(values.get('--output')) }
}

function normalizeRelative(root, absolutePath) {
  const path = relative(root, absolutePath).split(sep).join('/')
  if (!path || path === '..' || path.startsWith('../')) throw new Error('path escapes the allowed root')
  return path
}

function isAllowedSource(path) {
  return path === 'package.json' || path === 'README.md' || path === 'tsconfig.json' ||
    (path.startsWith('src/') && ALLOWED_SOURCE_MODULES.has(path.slice(4))) ||
    /^manifests\/[A-Za-z0-9._-]+\.template\.json$/.test(path)
}

async function collectFiles(directory) {
  const collected = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error('symbolic links are forbidden in delivery source')
    if (entry.isDirectory()) collected.push(...await collectFiles(absolute))
    else if (entry.isFile()) collected.push(absolute)
    else throw new Error('unsupported filesystem entry in delivery source')
  }
  return collected
}

function validateTemplate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('delivery template must be an object')
  const expected = ['schemaVersion', 'product', 'artifactKind', 'version', 'code_commit', 'built_at', 'license_text', 'notice_text']
  const actual = Object.keys(value).sort()
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw new Error('delivery template fields are invalid')
  if (value.schemaVersion !== 1 || value.product !== 'CanWin Team OS 4.0') throw new Error('delivery template identity is invalid')
  if (value.artifactKind !== 'separate-offline-one-shot-migration-tool') throw new Error('delivery artifact kind is invalid')
  if (!VERSION.test(value.version) || !SHA256.test(value.code_commit)) throw new Error('delivery version or commit is invalid')
  if (!Number.isFinite(Date.parse(value.built_at))) throw new Error('delivery build time is invalid')
  const validLegalText = (text) => typeof text === 'string' && text.trim().length > 0 && text.length <= 1_000_000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
  if (!validLegalText(value.license_text)) throw new Error('license text is invalid')
  if (!validLegalText(value.notice_text)) throw new Error('notice text is invalid')
  if (FORBIDDEN_VALUE.test(JSON.stringify(value))) throw new Error('delivery template contains a credential value')
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function assertNewOutput(outputRoot) {
  try {
    await access(outputRoot)
    throw new Error('output directory already exists; delivery assembly requires a new directory')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (outputRoot === sourceRoot || outputRoot.startsWith(`${sourceRoot}${sep}`)) throw new Error('output directory must not be inside migration tool source')
}

const { templatePath, outputRoot } = parseArguments(process.argv.slice(2))
await assertNewOutput(outputRoot)
const template = JSON.parse(await readFile(templatePath, 'utf8'))
validateTemplate(template)

const sourceFiles = await collectFiles(sourceRoot)
const selected = []
for (const absolute of sourceFiles) {
  const path = normalizeRelative(sourceRoot, absolute)
  if (!isAllowedSource(path)) continue
  if (FORBIDDEN_PATH.test(path) || FORBIDDEN_EXTENSION.test(path)) throw new Error(`forbidden delivery source path: ${path}`)
  const bytes = await readFile(absolute)
  if (FORBIDDEN_VALUE.test(bytes.toString('utf8'))) throw new Error(`credential value detected in delivery source: ${path}`)
  selected.push({ absolute, path, bytes })
}
if (!selected.length) throw new Error('migration tool delivery allowlist selected no files')

await mkdir(outputRoot, { recursive: false })
for (const file of selected) {
  const target = resolve(outputRoot, file.path)
  await mkdir(dirname(target), { recursive: true })
  await copyFile(file.absolute, target)
}

const deliveryMetadata = {
  schemaVersion: 1,
  product: template.product,
  artifactKind: template.artifactKind,
  version: template.version,
  code_commit: template.code_commit,
  built_at: template.built_at,
  license_file: 'LICENSE',
  notice_file: 'NOTICE',
  source_root: 'tools/migrate-3-to-4',
  contains_exported_business_data: false,
  contains_credentials: false,
}
const generated = new Map([
  ['VERSION', Buffer.from(`${template.version}\n`, 'utf8')],
  ['LICENSE', Buffer.from(`${template.license_text.trimEnd()}\n`, 'utf8')],
  ['NOTICE', Buffer.from(`${template.notice_text.trimEnd()}\n`, 'utf8')],
  ['DELIVERY.json', Buffer.from(`${JSON.stringify(deliveryMetadata, null, 2)}\n`, 'utf8')],
])
for (const [path, bytes] of generated) await writeFile(resolve(outputRoot, path), bytes, { flag: 'wx' })

const inventory = [
  ...selected.map((file) => ({ path: file.path, bytes: file.bytes })),
  ...[...generated].map(([path, bytes]) => ({ path, bytes })),
].sort((left, right) => left.path.localeCompare(right.path))
const manifest = inventory.map((file) => `${digest(file.bytes)}  ${file.path}`).join('\n') + '\n'
await writeFile(resolve(outputRoot, 'MANIFEST.sha256'), manifest, { flag: 'wx' })

const result = {
  artifactKind: template.artifactKind,
  outputDirectory: outputRoot,
  fileCount: inventory.length + 1,
  manifestSha256: digest(manifest),
  exportedBusinessDataFiles: 0,
  credentialFiles: 0,
}
console.log(JSON.stringify(result))
