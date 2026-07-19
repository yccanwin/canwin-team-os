import { readFile, readdir } from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const inventoryPath = resolve(repoRoot, 'docs/team-os-4.0/p0/frontend-inventory.json')
const p1NavigationPath = resolve(repoRoot, 'docs/team-os-4.0/p0/p1-app-navigation-contract.json')
const failures = []

function fail(message) {
  failures.push(message)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function normalizedRelativePath(filePath) {
  return relative(repoRoot, filePath).split(sep).join('/')
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'))
}

function compareExactSet(label, actualValues, expectedValues) {
  const actual = sorted(new Set(actualValues))
  const expected = sorted(new Set(expectedValues))
  const missing = expected.filter((value) => !actual.includes(value))
  const unexpected = actual.filter((value) => !expected.includes(value))
  if (missing.length || unexpected.length) {
    fail(`${label} drift: missing=[${missing.join(', ')}] unexpected=[${unexpected.join(', ')}]`)
  }
}

function assertUnique(label, values) {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index)
  assert(duplicates.length === 0, `${label} contains duplicates: ${sorted(new Set(duplicates)).join(', ')}`)
}

async function readUtf8(relativePath) {
  return readFile(resolve(repoRoot, relativePath), 'utf8')
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (['node_modules', 'dist', 'build', 'coverage', '.git'].includes(entry.name)) continue
    const entryPath = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walkFiles(entryPath))
    else files.push(entryPath)
  }
  return files
}

function extractRouteRows(appSource) {
  const rows = []
  for (const line of appSource.split(/\r?\n/)) {
    const match = line.match(/<Route\s+path="([^"]+)"/)
    if (match) rows.push({ path: match[1], source: line })
  }
  return rows
}

function extractSection48Keys(planSource) {
  const start = planSource.indexOf('### 4.8 现有页面处理')
  const end = planSource.indexOf('\n## 5.', start)
  if (start < 0 || end < 0) {
    fail('Plan section 4.8 boundaries were not found.')
    return []
  }
  return planSource
    .slice(start, end)
    .split(/\r?\n/)
    .map((line) => line.match(/^\|\s*(.+?)\s*\|/)?.[1] ?? '')
    .map((cell) => cell.replaceAll('`', '').replaceAll(' ', ''))
    .filter((cell) => cell.startsWith('/'))
}

function extractFileInputs(source, sourcePath) {
  const inputs = []
  const occurrencePattern = /type\s*=\s*["']file["']/g
  let match
  while ((match = occurrencePattern.exec(source)) !== null) {
    const start = source.lastIndexOf('<input', match.index)
    const end = source.indexOf('/>', match.index)
    if (start < 0 || end < 0) {
      fail(`Cannot resolve <input> boundaries for ${sourcePath} at offset ${match.index}.`)
      continue
    }
    const tag = source.slice(start, end + 2)
    const accept = tag.match(/accept\s*=\s*["']([^"']+)["']/)?.[1] ?? null
    const line = source.slice(0, match.index).split(/\r?\n/).length
    inputs.push({ source: sourcePath, accept, line })
  }
  return inputs
}

function extractLiteralStorageCalls(source) {
  const calls = []
  const callPattern = /\b(resolveMediaUrl|resolveMediaUrls|resolveStorageAttachments)\s*\(/g
  let match
  while ((match = callPattern.exec(source)) !== null) {
    const openIndex = source.indexOf('(', match.index)
    let depth = 1
    let quote = null
    let escaped = false
    let argument = ''
    const argumentsFound = []

    for (let index = openIndex + 1; index < source.length; index += 1) {
      const character = source[index]
      if (quote) {
        argument += character
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === quote) quote = null
        continue
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character
        argument += character
        continue
      }
      if (character === '(' || character === '[' || character === '{') {
        depth += 1
        argument += character
        continue
      }
      if (character === ')' || character === ']' || character === '}') {
        depth -= 1
        if (depth === 0) {
          argumentsFound.push(argument.trim())
          callPattern.lastIndex = index + 1
          break
        }
        argument += character
        continue
      }
      if (character === ',' && depth === 1) {
        argumentsFound.push(argument.trim())
        argument = ''
        continue
      }
      argument += character
    }

    const literal = argumentsFound[1]?.match(/^['"]([^'"]+)['"]$/)?.[1]
    if (literal) calls.push({ helper: match[1], namespace: literal })
  }
  return calls
}

const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'))
const p1Navigation = JSON.parse(await readFile(p1NavigationPath, 'utf8'))
const counts = inventory.expectedCounts

assert(inventory.schemaVersion === 1, `Unsupported inventory schemaVersion: ${inventory.schemaVersion}`)
assertUnique('currentRoutes.path', inventory.currentRoutes.map((route) => route.path))
assertUnique('section48Mappings.id', inventory.section48Mappings.map((mapping) => mapping.id))
assertUnique('section48Mappings.planKey', inventory.section48Mappings.map((mapping) => mapping.planKey))
assertUnique('fileInputs.id', inventory.fileInputs.map((input) => input.id))
assertUnique('storageNamespaces.namespace', inventory.storageNamespaces.map((entry) => entry.namespace))

assert(inventory.currentRoutes.length === counts.currentRoutes, `Inventory route count expected ${counts.currentRoutes}, got ${inventory.currentRoutes.length}.`)
assert(inventory.section48Mappings.length === counts.section48Mappings, `Inventory section 4.8 count expected ${counts.section48Mappings}, got ${inventory.section48Mappings.length}.`)
assert(inventory.fileInputs.length === counts.fileInputs, `Inventory file-input count expected ${counts.fileInputs}, got ${inventory.fileInputs.length}.`)
assert(inventory.storageNamespaces.length === counts.storageNamespaces, `Inventory Storage namespace count expected ${counts.storageNamespaces}, got ${inventory.storageNamespaces.length}.`)
assert(inventory.avatarUrlWriteEntrances.length === counts.avatarUrlWriteEntrances, `Inventory avatar URL count expected ${counts.avatarUrlWriteEntrances}, got ${inventory.avatarUrlWriteEntrances.length}.`)
assert(inventory.bulkImportExemptions.length === counts.bulkImportExemptions, `Inventory bulk-import exemption count expected ${counts.bulkImportExemptions}, got ${inventory.bulkImportExemptions.length}.`)

const mappingIds = new Set(inventory.section48Mappings.map((mapping) => mapping.id))
for (const route of inventory.currentRoutes) {
  assert(route.section48MappingId === null || mappingIds.has(route.section48MappingId), `Route ${route.path} references unknown section48MappingId ${route.section48MappingId}.`)
  assert(route.section48MappingId !== null || route.additionalReason, `Route ${route.path} is outside section 4.8 but has no additionalReason.`)
}

const appSource = await readUtf8(inventory.sources.routes)
const routeRows = extractRouteRows(appSource)
assert(routeRows.length === counts.currentRoutes, `Source route count expected ${counts.currentRoutes}, got ${routeRows.length}.`)
compareExactSet('Route paths', routeRows.map((route) => route.path), inventory.currentRoutes.map((route) => route.path))
assert(p1Navigation.contractStatus === 'p1_repair_candidate_pending_remote_runtime', 'P1 navigation repair candidate status drifted.')
compareExactSet(
  'P1 compatibility route paths',
  p1Navigation.legacyRouteCompatibility.map((route) => route.path),
  inventory.currentRoutes.map((route) => route.path),
)
for (const expectedRoute of inventory.currentRoutes) {
  const actualRoute = routeRows.find((route) => route.path === expectedRoute.path)
  const compatibility = p1Navigation.legacyRouteCompatibility.find((route) => route.path === expectedRoute.path)
  assert(compatibility?.inventoryMappingId === expectedRoute.section48MappingId, `Route ${expectedRoute.path} P1 mapping differs from the frozen P0 inventory.`)
  if (compatibility?.compatibilityState === 'redirect') {
    assert(
      actualRoute?.source.includes('<Navigate') &&
        actualRoute.source.includes(`to="${compatibility.canonicalTarget}"`) &&
        actualRoute.source.includes('replace'),
      `Route ${expectedRoute.path} no longer redirects to ${compatibility.canonicalTarget}.`,
    )
  } else if (compatibility?.compatibilityState === 'close_route_preserve_data') {
    assert(actualRoute?.source.includes('ClosedLegacyRoute'), `Route ${expectedRoute.path} no longer closes the legacy page while preserving data.`)
  } else {
    assert(actualRoute?.source.includes(expectedRoute.elementToken), `Route ${expectedRoute.path} no longer contains retained element token ${expectedRoute.elementToken}.`)
  }
}

const planSource = await readUtf8(inventory.sources.plan)
const planKeys = extractSection48Keys(planSource)
assert(planKeys.length === counts.section48Mappings, `Plan section 4.8 row count expected ${counts.section48Mappings}, got ${planKeys.length}.`)
compareExactSet('Plan section 4.8 keys', planKeys, inventory.section48Mappings.map((mapping) => mapping.planKey))

const srcFiles = (await walkFiles(resolve(repoRoot, 'src')))
  .filter((filePath) => ['.ts', '.tsx'].includes(extname(filePath)))

const actualFileInputs = []
for (const filePath of srcFiles.filter((candidate) => extname(candidate) === '.tsx')) {
  const sourcePath = normalizedRelativePath(filePath)
  const source = await readFile(filePath, 'utf8')
  actualFileInputs.push(...extractFileInputs(source, sourcePath))
}
actualFileInputs.sort((left, right) => left.source.localeCompare(right.source, 'en') || left.line - right.line)

const inputOrdinals = new Map()
for (const input of actualFileInputs) {
  const ordinal = (inputOrdinals.get(input.source) ?? 0) + 1
  inputOrdinals.set(input.source, ordinal)
  input.ordinalInFile = ordinal
}

assert(actualFileInputs.length === counts.fileInputs, `Source file-input count expected ${counts.fileInputs}, got ${actualFileInputs.length}.`)
compareExactSet(
  'File inputs',
  actualFileInputs.map((input) => `${input.source}#${input.ordinalInFile}|${input.accept ?? '<none>'}`),
  inventory.fileInputs.map((input) => `${input.source}#${input.ordinalInFile}|${input.accept ?? '<none>'}`),
)

const actualStorageCalls = []
for (const filePath of srcFiles.filter((candidate) => normalizedRelativePath(candidate).startsWith('src/services/'))) {
  const sourcePath = normalizedRelativePath(filePath)
  const source = await readFile(filePath, 'utf8')
  for (const call of extractLiteralStorageCalls(source)) actualStorageCalls.push({ ...call, source: sourcePath })
}
const actualStorageNamespaces = new Set(actualStorageCalls.map((call) => call.namespace))
assert(actualStorageNamespaces.size === counts.storageNamespaces, `Source Storage namespace count expected ${counts.storageNamespaces}, got ${actualStorageNamespaces.size}.`)
compareExactSet('Storage namespaces', actualStorageNamespaces, inventory.storageNamespaces.map((entry) => entry.namespace))
for (const entry of inventory.storageNamespaces) {
  for (const source of entry.sources) {
    assert(actualStorageCalls.some((call) => call.namespace === entry.namespace && call.source === source), `Storage namespace ${entry.namespace} no longer has a literal call in ${source}.`)
  }
}

const storageNamespaceSet = new Set(inventory.storageNamespaces.map((entry) => entry.namespace))
for (const input of inventory.fileInputs) {
  assert(input.storageNamespace === null || storageNamespaceSet.has(input.storageNamespace), `File input ${input.id} references unknown Storage namespace ${input.storageNamespace}.`)
}

for (const entry of inventory.avatarUrlWriteEntrances) {
  const source = await readUtf8(entry.source)
  const serviceSource = await readUtf8(entry.serviceSource)
  for (const marker of entry.requiredMarkers) assert(source.includes(marker), `Avatar URL entry ${entry.id} lost marker ${marker} in ${entry.source}.`)
  assert(serviceSource.includes('avatar_url'), `Avatar URL entry ${entry.id} no longer maps to avatar_url in ${entry.serviceSource}.`)
}

const bulkImports = inventory.fileInputs.filter((input) => input.classification === 'bulk_import')
assert(bulkImports.length === counts.bulkImportExemptions, `Expected ${counts.bulkImportExemptions} bulk-import file input, got ${bulkImports.length}.`)
for (const exemption of inventory.bulkImportExemptions) {
  const input = inventory.fileInputs.find((candidate) => candidate.id === exemption.fileInputId)
  assert(input?.classification === 'bulk_import', `Bulk-import exemption ${exemption.id} references a non-bulk input.`)
  assert(input?.storageNamespace === null, `Bulk-import exemption ${exemption.id} must not reference media Storage.`)
  const source = await readUtf8(exemption.source)
  assert(source.includes(exemption.requiredMarker), `Bulk-import exemption ${exemption.id} lost marker ${exemption.requiredMarker}.`)
}

if (failures.length) {
  console.error('P0_FRONTEND_INVENTORY_DRIFT')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    `P0_FRONTEND_INVENTORY_OK routes=${counts.currentRoutes} section48=${counts.section48Mappings} fileInputs=${counts.fileInputs} storageNamespaces=${counts.storageNamespaces} avatarUrl=${counts.avatarUrlWriteEntrances} bulkImport=${counts.bulkImportExemptions}`,
  )
}
