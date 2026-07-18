import { readFile, readdir } from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const contractPath = resolve(repoRoot, 'docs/team-os-4.0/p0/frontend-disposition-crosscheck.json')
const failures = []

function fail(message) {
  failures.push(message)
}

function assert(condition, message) {
  if (!condition) fail(message)
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

function normalizedRelativePath(filePath) {
  return relative(repoRoot, filePath).split(sep).join('/')
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

function extractRoutePaths(appSource) {
  const paths = []
  for (const line of appSource.split(/\r?\n/)) {
    const match = line.match(/<Route\s+path="([^"]+)"/)
    if (match) paths.push(match[1])
  }
  return paths
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
    inputs.push({ source: sourcePath, accept })
  }
  return inputs
}

function compatibilityAction(state) {
  if (state.startsWith('retain_')) return 'retain'
  if (state === 'merge_compatibility') return 'merge'
  if (state === 'redirect') return 'redirect'
  if (state === 'hide_read_only') return 'hide_read_only'
  if (state === 'retire_disable_write') return 'retire'
  return null
}

function basePath(target) {
  return target.split(/[?#]/, 1)[0]
}

const contract = JSON.parse(await readFile(contractPath, 'utf8'))
const inventory = JSON.parse(await readUtf8(contract.sources.frontendInventory))
const navigation = JSON.parse(await readUtf8(contract.sources.p1NavigationContract))
const counts = contract.expectedCounts

assert(contract.schemaVersion === 1, `Unsupported contract schemaVersion: ${contract.schemaVersion}`)
assert(contract.contractStatus === 'p0_candidate_not_accepted', `Contract status must remain p0_candidate_not_accepted, got ${contract.contractStatus}.`)
assert(contract.scope.includes('does not implement P1'), 'Scope must state that P1 is not implemented.')
assert(contract.acceptanceBoundary?.candidateOnly === true, 'Candidate-only boundary must remain true.')
assert(contract.acceptanceBoundary?.runtimeAccepted === false, 'Runtime acceptance must remain false.')
assert(contract.acceptanceBoundary?.p1UiComplete === false, 'P1 UI completion must remain false.')
assert(contract.acceptanceBoundary?.productionStorageChanged === false, 'Production Storage must remain unchanged.')
assert(contract.acceptanceBoundary?.routeDeletionAuthorized === false, 'Route deletion must remain unauthorized.')

assert(counts.routes === inventory.expectedCounts.currentRoutes, 'Route count must inherit the frontend inventory count.')
assert(counts.section48Items === inventory.expectedCounts.section48Mappings, 'Section 4.8 count must inherit the frontend inventory count.')
assert(counts.fileInputs === inventory.expectedCounts.fileInputs, 'File-input count must inherit the frontend inventory count.')
assert(counts.storageNamespaces === inventory.expectedCounts.storageNamespaces, 'Storage namespace count must inherit the frontend inventory count.')

const pageActions = new Set(contract.allowedCandidateActions.pages)
const routeActions = new Set(contract.allowedCandidateActions.routes)
const uploadActions = new Set(contract.allowedCandidateActions.uploadEntrances)
const storageActions = new Set(contract.allowedCandidateActions.storageNamespaces)
compareExactSet('Allowed page actions', pageActions, ['retain', 'merge', 'redirect', 'retire', 'hide_read_only'])
compareExactSet('Allowed route actions', routeActions, ['retain', 'merge', 'redirect', 'retire', 'hide_read_only'])
compareExactSet('Allowed upload actions', uploadActions, ['close', 'close_migrate_candidate', 'retain_bulk_import_exemption'])
compareExactSet('Allowed Storage actions', storageActions, ['close', 'close_migrate_candidate'])

const inventoryMappings = new Map(inventory.section48Mappings.map((mapping) => [mapping.id, mapping]))
const sectionDispositions = new Map(contract.section48Dispositions.map((entry) => [entry.mappingId, entry]))
assertUnique('section48Dispositions.mappingId', contract.section48Dispositions.map((entry) => entry.mappingId))
assert(contract.section48Dispositions.length === counts.section48Items, `Expected ${counts.section48Items} section 4.8 dispositions, got ${contract.section48Dispositions.length}.`)
compareExactSet('Section 4.8 mapping IDs', sectionDispositions.keys(), inventoryMappings.keys())
for (const disposition of contract.section48Dispositions) {
  assert(pageActions.has(disposition.candidateAction), `Section 4.8 item ${disposition.mappingId} has unknown action ${disposition.candidateAction}.`)
  assert(Boolean(disposition.reason), `Section 4.8 item ${disposition.mappingId} has no reason.`)
}

const planSource = await readUtf8(contract.sources.plan)
const planKeys = extractSection48Keys(planSource)
assert(planKeys.length === counts.section48Items, `Plan section 4.8 expected ${counts.section48Items} rows, got ${planKeys.length}.`)
compareExactSet('Plan section 4.8 keys', planKeys, inventory.section48Mappings.map((mapping) => mapping.planKey))

const pageInventorySource = await readUtf8(contract.sources.pageInventory)
assert(pageInventorySource.includes('总方案 4.8 的 22/22 项'), 'Page inventory lost its 22/22 section 4.8 marker.')
assert(pageInventorySource.includes('当前源码 36/36 个显式 Route'), 'Page inventory lost its 36/36 route marker.')

const inventoryRoutes = new Map(inventory.currentRoutes.map((route) => [route.path, route]))
const routeDispositions = new Map(contract.routeDispositions.map((route) => [route.path, route]))
const navigationRoutes = new Map(navigation.legacyRouteCompatibility.map((route) => [route.path, route]))
assertUnique('routeDispositions.path', contract.routeDispositions.map((route) => route.path))
assert(contract.routeDispositions.length === counts.routes, `Expected ${counts.routes} route dispositions, got ${contract.routeDispositions.length}.`)
compareExactSet('Route disposition paths', routeDispositions.keys(), inventoryRoutes.keys())
compareExactSet('Navigation compatibility paths', navigationRoutes.keys(), inventoryRoutes.keys())

for (const route of contract.routeDispositions) {
  const inventoryRoute = inventoryRoutes.get(route.path)
  const navigationRoute = navigationRoutes.get(route.path)
  assert(routeActions.has(route.candidateAction), `Route ${route.path} has unknown action ${route.candidateAction}.`)
  assert(route.mappingId === inventoryRoute?.section48MappingId, `Route ${route.path} mapping differs from frontend inventory.`)
  assert(route.candidateAction === compatibilityAction(navigationRoute?.compatibilityState ?? ''), `Route ${route.path} action differs from the P1 navigation contract.`)
  assert(route.canonicalTarget === navigationRoute?.canonicalTarget, `Route ${route.path} canonical target differs from the P1 navigation contract.`)
  assert(Boolean(route.reason), `Route ${route.path} has no reason.`)
  assert(inventoryRoutes.has(basePath(route.canonicalTarget)), `Route ${route.path} points to unknown canonical base path ${basePath(route.canonicalTarget)}.`)
}

const mappedRoutePaths = inventory.section48Mappings.flatMap((mapping) => mapping.currentRoutes)
const additionalRoutePaths = inventory.currentRoutes.filter((route) => route.section48MappingId === null).map((route) => route.path)
assertUnique('Section 4.8 mapped routes', mappedRoutePaths)
compareExactSet(
  'Mapped route coverage',
  mappedRoutePaths,
  inventory.currentRoutes.filter((route) => route.section48MappingId !== null).map((route) => route.path),
)
for (const mapping of inventory.section48Mappings) {
  for (const routePath of mapping.currentRoutes) {
    assert(routeDispositions.get(routePath)?.mappingId === mapping.id, `Route ${routePath} is orphaned from section 4.8 mapping ${mapping.id}.`)
  }
}
for (const routePath of additionalRoutePaths) {
  const inventoryRoute = inventoryRoutes.get(routePath)
  assert(Boolean(inventoryRoute?.additionalReason), `Additional route ${routePath} has no inventory reason.`)
  assert(Boolean(routeDispositions.get(routePath)?.reason), `Additional route ${routePath} has no disposition reason.`)
}

const appSource = await readUtf8(contract.sources.routes)
const sourceRoutePaths = extractRoutePaths(appSource)
assert(sourceRoutePaths.length === counts.routes, `Source expected ${counts.routes} routes, got ${sourceRoutePaths.length}.`)
compareExactSet('Source route paths', sourceRoutePaths, routeDispositions.keys())

const fileDispositions = new Map(contract.fileInputDispositions.map((entry) => [entry.fileInputId, entry]))
const inventoryInputs = new Map(inventory.fileInputs.map((entry) => [entry.id, entry]))
assertUnique('fileInputDispositions.fileInputId', contract.fileInputDispositions.map((entry) => entry.fileInputId))
assert(contract.fileInputDispositions.length === counts.fileInputs, `Expected ${counts.fileInputs} file-input dispositions, got ${contract.fileInputDispositions.length}.`)
compareExactSet('File-input disposition IDs', fileDispositions.keys(), inventoryInputs.keys())

const srcFiles = (await walkFiles(resolve(repoRoot, 'src'))).filter((filePath) => extname(filePath) === '.tsx')
const actualFileInputs = []
for (const filePath of srcFiles) {
  const sourcePath = normalizedRelativePath(filePath)
  const source = await readFile(filePath, 'utf8')
  actualFileInputs.push(...extractFileInputs(source, sourcePath))
}
const inputOrdinals = new Map()
const actualInputKeys = actualFileInputs.map((input) => {
  const ordinal = (inputOrdinals.get(input.source) ?? 0) + 1
  inputOrdinals.set(input.source, ordinal)
  return `${input.source}#${ordinal}|${input.accept ?? '<none>'}`
})
assert(actualFileInputs.length === counts.fileInputs, `Source expected ${counts.fileInputs} file inputs, got ${actualFileInputs.length}.`)
compareExactSet(
  'Source file inputs',
  actualInputKeys,
  inventory.fileInputs.map((input) => `${input.source}#${input.ordinalInFile}|${input.accept ?? '<none>'}`),
)

const bulkExemptionIds = new Set(inventory.bulkImportExemptions.map((entry) => entry.fileInputId))
const targetSlots = new Set(inventory.targetMediaSlots.map((entry) => entry.slot))
for (const disposition of contract.fileInputDispositions) {
  const input = inventoryInputs.get(disposition.fileInputId)
  assert(uploadActions.has(disposition.candidateAction), `File input ${disposition.fileInputId} has unknown action ${disposition.candidateAction}.`)
  assert(inventoryRoutes.has(disposition.pageRoute), `File input ${disposition.fileInputId} references unknown page route ${disposition.pageRoute}.`)
  assert(disposition.storageNamespace === input?.storageNamespace, `File input ${disposition.fileInputId} Storage namespace differs from frontend inventory.`)
  assert(Boolean(disposition.reason), `File input ${disposition.fileInputId} has no reason.`)
  if (input?.classification === 'bulk_import') {
    assert(disposition.candidateAction === 'retain_bulk_import_exemption', `Bulk import ${disposition.fileInputId} must retain only the explicit exemption.`)
    assert(disposition.storageNamespace === null, `Bulk import ${disposition.fileInputId} must not use media Storage.`)
    assert(bulkExemptionIds.has(disposition.fileInputId), `Bulk import ${disposition.fileInputId} has no inventory exemption.`)
  } else {
    assert(['close', 'close_migrate_candidate'].includes(disposition.candidateAction), `Legacy media input ${disposition.fileInputId} must close new writes.`)
    assert(Boolean(disposition.storageNamespace), `Legacy media input ${disposition.fileInputId} has no Storage namespace.`)
  }
  if (disposition.candidateAction === 'close_migrate_candidate') {
    assert(targetSlots.has(disposition.targetSlot), `Migration input ${disposition.fileInputId} references unknown target slot ${disposition.targetSlot}.`)
  }
}

const mediaInventorySource = await readUtf8(contract.sources.mediaInventory)
assert(mediaInventorySource.includes('共有 7 个 `<input type="file">`'), 'Media inventory lost its seven-file-input marker.')

const nonFileEntrances = new Map(contract.nonFileWriteEntrances.map((entry) => [entry.id, entry]))
assertUnique('nonFileWriteEntrances.id', contract.nonFileWriteEntrances.map((entry) => entry.id))
assert(contract.nonFileWriteEntrances.length === counts.nonFileWriteEntrances, `Expected ${counts.nonFileWriteEntrances} non-file write entrances, got ${contract.nonFileWriteEntrances.length}.`)
for (const entrance of contract.nonFileWriteEntrances) {
  assert(entrance.candidateAction === 'close', `Non-file entrance ${entrance.id} must close new writes.`)
  assert(inventoryRoutes.has(entrance.pageRoute), `Non-file entrance ${entrance.id} references unknown page route ${entrance.pageRoute}.`)
  assert(Boolean(entrance.reason), `Non-file entrance ${entrance.id} has no reason.`)
  const source = await readUtf8(entrance.source)
  if (entrance.storageNamespace) {
    assert(source.includes(entrance.storageNamespace), `Non-file entrance ${entrance.id} lost Storage marker ${entrance.storageNamespace}.`)
  }
}
const avatarEntrance = inventory.avatarUrlWriteEntrances[0]
assert(nonFileEntrances.get('member-avatar-url')?.source === avatarEntrance.source, 'Avatar URL entrance source differs from frontend inventory.')
assert(nonFileEntrances.get('member-avatar-url')?.storageNamespace === null, 'Avatar URL entrance must not invent a Storage namespace.')

const inventoryNamespaces = new Map(inventory.storageNamespaces.map((entry) => [entry.namespace, entry]))
const namespaceDispositions = new Map(contract.storageNamespaceDispositions.map((entry) => [entry.namespace, entry]))
assertUnique('storageNamespaceDispositions.namespace', contract.storageNamespaceDispositions.map((entry) => entry.namespace))
assert(contract.storageNamespaceDispositions.length === counts.storageNamespaces, `Expected ${counts.storageNamespaces} Storage dispositions, got ${contract.storageNamespaceDispositions.length}.`)
compareExactSet('Storage namespace dispositions', namespaceDispositions.keys(), inventoryNamespaces.keys())

const linkedFileInputIds = []
const linkedNonFileEntranceIds = []
for (const disposition of contract.storageNamespaceDispositions) {
  const inventoryNamespace = inventoryNamespaces.get(disposition.namespace)
  assert(storageActions.has(disposition.candidateAction), `Storage namespace ${disposition.namespace} has unknown action ${disposition.candidateAction}.`)
  assert(disposition.historicalReadMode === 'preserve_candidate', `Storage namespace ${disposition.namespace} must preserve historical reads as a candidate.`)
  assert(disposition.fileInputIds.length + disposition.nonFileEntranceIds.length > 0, `Storage namespace ${disposition.namespace} is orphaned from all write entrances.`)
  assert(Boolean(disposition.reason), `Storage namespace ${disposition.namespace} has no reason.`)
  compareExactSet(
    `Storage namespace ${disposition.namespace} file-input links`,
    disposition.fileInputIds,
    contract.fileInputDispositions.filter((entry) => entry.storageNamespace === disposition.namespace).map((entry) => entry.fileInputId),
  )
  compareExactSet(
    `Storage namespace ${disposition.namespace} non-file links`,
    disposition.nonFileEntranceIds,
    contract.nonFileWriteEntrances.filter((entry) => entry.storageNamespace === disposition.namespace).map((entry) => entry.id),
  )
  linkedFileInputIds.push(...disposition.fileInputIds)
  linkedNonFileEntranceIds.push(...disposition.nonFileEntranceIds)
  for (const sourcePath of inventoryNamespace?.sources ?? []) {
    const source = await readUtf8(sourcePath)
    const singleQuoted = `'${disposition.namespace}'`
    const doubleQuoted = `"${disposition.namespace}"`
    assert(source.includes(singleQuoted) || source.includes(doubleQuoted), `Storage namespace ${disposition.namespace} lost its literal source marker in ${sourcePath}.`)
  }
  if (disposition.candidateAction === 'close_migrate_candidate') {
    assert(targetSlots.has(disposition.targetSlot), `Storage namespace ${disposition.namespace} references unknown target slot ${disposition.targetSlot}.`)
  }
}
assertUnique('Storage linked file inputs', linkedFileInputIds)
assertUnique('Storage linked non-file entrances', linkedNonFileEntranceIds)
compareExactSet(
  'Storage-linked file inputs',
  linkedFileInputIds,
  contract.fileInputDispositions.filter((entry) => entry.storageNamespace !== null).map((entry) => entry.fileInputId),
)
compareExactSet(
  'Storage-linked non-file entrances',
  linkedNonFileEntranceIds,
  contract.nonFileWriteEntrances.filter((entry) => entry.storageNamespace !== null).map((entry) => entry.id),
)

for (const namespace of inventoryNamespaces.keys()) {
  assert(mediaInventorySource.includes(`\`${namespace}\``), `Media inventory lost namespace ${namespace}.`)
}

if (failures.length) {
  console.error('P0_FRONTEND_DISPOSITION_CROSSCHECK_DRIFT')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    `P0_FRONTEND_DISPOSITION_CROSSCHECK_OK routes=${counts.routes} section48=${counts.section48Items} fileInputs=${counts.fileInputs} storageNamespaces=${counts.storageNamespaces} nonFileWrites=${counts.nonFileWriteEntrances} orphans=0 candidateAccepted=0`,
  )
}
