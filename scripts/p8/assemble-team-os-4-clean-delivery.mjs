import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { accessSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index]
  const value = process.argv[index + 1]
  if (!flag?.startsWith('--') || !value || value.startsWith('--')) throw new Error(`invalid argument near ${flag ?? '<end>'}`)
  args.set(flag, value)
}

const outputArgument = args.get('--output')
const metadataArgument = args.get('--metadata')
if (!outputArgument || !metadataArgument) {
  throw new Error('usage: node assemble-team-os-4-clean-delivery.mjs --output <new-directory> --metadata <delivery-metadata-directory>')
}

const repoRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'))
const outputRoot = resolve(outputArgument)
const configuredMetadataRoot = resolve(metadataArgument)
if (lstatSync(configuredMetadataRoot).isSymbolicLink()) throw new Error('symbolic metadata root is forbidden')
const metadataRoot = realpathSync(configuredMetadataRoot)
if (!statSync(metadataRoot).isDirectory()) throw new Error('metadata must be a directory')
if (existsSync(outputRoot)) throw new Error('output directory must not already exist')
if (outputRoot === repoRoot) throw new Error('repository root cannot be used as output')
for (const root of ['apps/team-os-4', 'packages/team-os-4-domain', 'platform/team-os-4']) {
  const source = realpathSync(resolve(repoRoot, root))
  if (outputRoot === source || outputRoot.startsWith(`${source}${sep}`)) throw new Error(`output must be outside source root: ${root}`)
}

const sourceRoots = ['apps/team-os-4', 'packages/team-os-4-domain', 'platform/team-os-4']
const metadataFiles = ['VERSION', 'LICENSE', 'NOTICE']
const ignoredBuildDirectories = new Set([
  'node_modules', 'dist', 'coverage', '.cache', '.vite', '.temp', 'tmp',
  'exports', 'snapshots', 'evidence',
])
const forbiddenDirectories = new Set([
  '.git', '.github', '.codex-audit', 'fixtures', '__fixtures__', 'mocks', '__mocks__',
  'demo', 'demo-data', 'seed', 'seed-data',
])
const forbiddenExtensions = new Set([
  '.pem', '.key', '.p12', '.pfx', '.dump', '.backup', '.log', '.csv', '.tsv',
  '.jsonl', '.ndjson', '.parquet', '.xlsx', '.xls', '.png', '.jpg', '.jpeg',
  '.webp', '.gif', '.svg', '.map', '.zip', '.tar', '.gz', '.tgz', '.7z',
])

function isAllowlistedSourceFile(path) {
  if (/^apps\/team-os-4\/(?:\.env\.example|DEPLOYMENT-BOUNDARY\.md|VISUAL-FOUNDATION\.md|index\.html|package\.json|postcss\.config\.js|tsconfig\.json|vite\.config\.ts)$/.test(path)) return true
  if (/^apps\/team-os-4\/src\/.+\.(?:ts|tsx|css|d\.ts)$/.test(path)) return true
  if (/^packages\/team-os-4-domain\/(?:package\.json|README\.md|tsconfig\.json)$/.test(path)) return true
  if (/^packages\/team-os-4-domain\/src\/.+\.ts$/.test(path)) return true
  if (/^platform\/team-os-4\/supabase\/(?:config\.toml|seed\.sql|verify-foundation\.mjs)$/.test(path)) return true
  if (/^platform\/team-os-4\/supabase\/migrations\/[0-9]{14}_[a-z0-9_]+\.sql$/.test(path)) return true
  if (/^platform\/team-os-4\/supabase\/functions\/[a-z0-9-]+\/.+\.ts$/.test(path)) return true
  if (/^platform\/team-os-4\/tools\/bootstrap\/(?:package\.json|src\/.+\.mjs)$/.test(path)) return true
  return false
}

function portable(path) {
  return path.split(sep).join('/')
}

function extensionOf(path) {
  const lower = path.toLowerCase()
  if (lower.endsWith('.sql.gz')) return '.sql.gz'
  const dot = lower.lastIndexOf('.')
  return dot < 0 ? '' : lower.slice(dot)
}

function ensureInside(root, path, label) {
  const rel = relative(root, path)
  if (rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)) return rel
  throw new Error(`${label} path escapes its root: ${path}`)
}

function validateRegularFile(absolute, destinationPath) {
  const info = lstatSync(absolute)
  if (info.isSymbolicLink()) throw new Error(`symbolic link is forbidden: ${destinationPath}`)
  if (!info.isFile()) throw new Error(`non-regular file is forbidden: ${destinationPath}`)
  const lowerName = destinationPath.split('/').at(-1).toLowerCase()
  if ((lowerName === '.env' || lowerName.startsWith('.env.')) && destinationPath !== 'apps/team-os-4/.env.example') {
    throw new Error(`environment file is forbidden: ${destinationPath}`)
  }
  const extension = extensionOf(destinationPath)
  if (forbiddenExtensions.has(extension)) throw new Error(`forbidden file type ${extension}: ${destinationPath}`)
}

const plannedFiles = []

function collectDirectory(sourceDirectory, sourceRoot, destinationDirectory) {
  const resolvedDirectory = realpathSync(sourceDirectory)
  ensureInside(sourceRoot, resolvedDirectory, 'source')
  for (const entry of readdirSync(resolvedDirectory, { withFileTypes: true })) {
    const sourcePath = resolve(resolvedDirectory, entry.name)
    const destinationPath = `${destinationDirectory}/${entry.name}`
    if (entry.isSymbolicLink() || lstatSync(sourcePath).isSymbolicLink()) {
      throw new Error(`symbolic link is forbidden: ${destinationPath}`)
    }
    if (forbiddenDirectories.has(entry.name.toLowerCase())) throw new Error(`forbidden directory: ${destinationPath}`)
    if (entry.isDirectory()) {
      if (ignoredBuildDirectories.has(entry.name.toLowerCase())) continue
      if (destinationPath === 'platform/team-os-4/tools/acceptance-accounts') continue
      collectDirectory(sourcePath, sourceRoot, destinationPath)
      continue
    }
    validateRegularFile(sourcePath, destinationPath)
    if (!isAllowlistedSourceFile(destinationPath)) throw new Error(`source file is outside the explicit allowlist: ${destinationPath}`)
    if (destinationPath === 'supabase/migrations' || destinationPath.startsWith('supabase/migrations/')) {
      throw new Error(`Team OS 3 migration is forbidden: ${destinationPath}`)
    }
    if (destinationPath === 'tools/migrate-3-to-4' || destinationPath.startsWith('tools/migrate-3-to-4/')) {
      throw new Error(`migration tool must remain a separate artifact: ${destinationPath}`)
    }
    plannedFiles.push({ sourcePath, destinationPath })
  }
}

for (const root of sourceRoots) {
  const configuredRoot = resolve(repoRoot, root)
  if (lstatSync(configuredRoot).isSymbolicLink()) throw new Error(`symbolic source root is forbidden: ${root}`)
  const sourceRoot = realpathSync(configuredRoot)
  collectDirectory(sourceRoot, sourceRoot, root)
}
for (const name of metadataFiles) {
  const sourcePath = resolve(metadataRoot, name)
  if (!existsSync(sourcePath)) throw new Error(`required delivery metadata is missing: ${name}`)
  ensureInside(metadataRoot, sourcePath, 'metadata')
  validateRegularFile(sourcePath, name)
  accessSync(sourcePath, fsConstants.R_OK)
  plannedFiles.push({ sourcePath, destinationPath: name })
}

plannedFiles.sort((left, right) => left.destinationPath.localeCompare(right.destinationPath, 'en'))
const duplicates = plannedFiles.filter((file, index) => index > 0 && file.destinationPath === plannedFiles[index - 1].destinationPath)
if (duplicates.length) throw new Error(`duplicate delivery path: ${duplicates[0].destinationPath}`)
if (!plannedFiles.some((file) => file.destinationPath.startsWith('apps/team-os-4/'))) throw new Error('app delivery root is empty')
if (!plannedFiles.some((file) => file.destinationPath.startsWith('packages/team-os-4-domain/'))) throw new Error('domain delivery root is empty')
if (!plannedFiles.some((file) => file.destinationPath.startsWith('platform/team-os-4/'))) throw new Error('platform delivery root is empty')

mkdirSync(outputRoot, { recursive: false })
const manifestLines = []
for (const file of plannedFiles) {
  const destination = resolve(outputRoot, file.destinationPath)
  ensureInside(outputRoot, destination, 'output')
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(file.sourcePath, destination, fsConstants.COPYFILE_EXCL)
  const bytes = readFileSync(destination)
  manifestLines.push(`${createHash('sha256').update(bytes).digest('hex')}  ${portable(file.destinationPath)}`)
}
const manifest = `${manifestLines.join('\n')}\n`
writeFileSync(resolve(outputRoot, 'MANIFEST.sha256'), manifest, { flag: 'wx' })

console.log(JSON.stringify({
  artifact: outputRoot,
  status: 'assembled-not-accepted',
  fileCount: plannedFiles.length + 1,
  manifestSha256: createHash('sha256').update(manifest).digest('hex'),
}, null, 2))
