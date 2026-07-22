import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contractPath = resolve(repoRoot, 'scripts', 'p0', 'greenfield-root-contract.json')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const contract = readJson(contractPath)
const clone = (value) => structuredClone(value)

const expectedRoots = [
  ['application', 'apps/team-os-4'],
  ['domain', 'packages/team-os-4-domain'],
  ['database', 'platform/team-os-4/supabase'],
  ['migration_tool', 'tools/migrate-3-to-4'],
]
const expectedLegacyRoots = [
  ['legacy_application', 'src'],
  ['legacy_migrations', 'supabase/migrations'],
]

const normalizePath = (value) => value.replaceAll('\\', '/')
const exactSet = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === new Set(actual).size &&
  JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
const isInside = (parent, child) => {
  const childRelative = relative(parent, child)
  return childRelative === '' || (!childRelative.startsWith(`..${sep}`) && childRelative !== '..' && !isAbsolute(childRelative))
}
const resolvesInsideRepo = (relativePath) => isInside(repoRoot, resolve(repoRoot, relativePath))

function validateContract(candidate) {
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const roots = candidate.roots ?? []
  const legacyRoots = candidate.legacyReadOnlyRoots ?? []
  const scan = candidate.scan ?? {}
  const seed = candidate.blankSeed ?? {}
  const boundary = candidate.acceptanceBoundary ?? {}

  check(candidate.schemaVersion === 1, 'schema version must be 1')
  check(candidate.manifestType === 'canwin-team-os-4-greenfield-root-contract', 'manifest type drift')
  check(candidate.contractStatus === 'greenfield_roots_required_runtime_not_accepted', 'contract status drift')
  check(Array.isArray(candidate.sources) && candidate.sources.length === 2, 'contract sources must contain exactly two frozen documents')
  check(
    exactSet(candidate.sources, [
      'docs/CanWin-Team-OS-4.0-最终施工总方案.md',
      'docs/team-os-4.0/p0/10-empty-baseline-and-bootstrap-contract.md',
    ]),
    'contract source set drift',
  )

  check(roots.length === expectedRoots.length, 'greenfield root count drift')
  check(exactSet(roots.map((entry) => entry.id), expectedRoots.map(([id]) => id)), 'greenfield root id set drift')
  check(exactSet(roots.map((entry) => entry.path), expectedRoots.map(([, path]) => path)), 'greenfield root path set drift')
  for (const [id, path] of expectedRoots) {
    const root = roots.find((entry) => entry.id === id)
    check(root?.path === path, `${id} root path drift`)
    check(typeof root?.path === 'string' && resolvesInsideRepo(root.path), `${id} root escapes the repository`)
  }

  check(legacyRoots.length === expectedLegacyRoots.length, 'legacy root count drift')
  check(exactSet(legacyRoots.map((entry) => entry.id), expectedLegacyRoots.map(([id]) => id)), 'legacy root id set drift')
  check(exactSet(legacyRoots.map((entry) => entry.path), expectedLegacyRoots.map(([, path]) => path)), 'legacy root path set drift')
  for (const [id, path] of expectedLegacyRoots) {
    const root = legacyRoots.find((entry) => entry.id === id)
    check(root?.path === path, `${id} path drift`)
    check(root?.dependencyAllowed === false, `${id} dependency must remain forbidden`)
  }

  check(Array.isArray(scan.extensions) && scan.extensions.length >= 10, 'scan extension coverage is incomplete')
  check(scan.extensions?.every((entry) => /^\.[a-z0-9]+$/u.test(entry)), 'scan extensions must be lowercase dot extensions')
  check(exactSet(scan.extensions, scan.extensions ?? []), 'scan extensions contain duplicates')
  check(exactSet(scan.fileNames, ['.env.example', 'Dockerfile']), 'explicit scan file set drift')
  check(exactSet(scan.ignoredDirectories, ['.git', 'coverage', 'dist', 'node_modules']), 'ignored directory set drift')
  check(scan.maxScannedFileBytes === 1_048_576, 'maximum scanned file size drift')
  check(scan.symbolicLinksAllowed === false, 'symbolic links must remain forbidden')

  check(seed.path === 'platform/team-os-4/supabase/seed.sql', 'blank seed path drift')
  check(seed.mustBeCommentOnly === true, 'blank seed must remain comment-only')
  check(seed.businessRowsAllowed === 0, 'blank seed business row allowance must remain zero')
  check(seed.demoDataInstalledByDefault === false, 'demo data must remain disabled by default')
  check(
    exactSet(seed.forbiddenMarkers, [
      'CANWIN_TEAM',
      '翻身小队',
      'admin@yccanwin.com',
      'agygfhmkazcbqaqwmljb',
      'zdmuaqokndhhbarudhtw',
    ]),
    'blank seed forbidden marker set drift',
  )

  check(boundary.historicalG0OverallClaim === true, 'accepted historical G0 evidence must remain true')
  check(boundary.historicalAcceptedProgressPercent === 25, 'historical accepted progress must remain 25 percent')
  check(boundary.greenfieldG0OverallClaim === false, 'greenfield G0 must remain false before runtime acceptance')
  check(boundary.greenfieldG1OverallClaim === false, 'greenfield G1 must remain false before account and page acceptance')
  check(boundary.runtimeAccepted === false, 'root scaffolding must not claim runtime acceptance')
  check(boundary.productionWritePerformed === false, 'static root gate must perform no production write')
  check(boundary.networkCallsPerformed === false, 'static root gate must perform no network call')
  check(boundary.staticOnly === true, 'greenfield root gate must remain static-only')
  check(boundary.totalStaticRunnerUpdated === true, 'greenfield root gate must remain integrated in the total static runner')
  return failures
}

function isCommentOnlySql(value) {
  const source = value.replace(/^\uFEFF/u, '')
  let index = 0
  while (index < source.length) {
    if (/\s/u.test(source[index])) {
      index += 1
      continue
    }
    if (source.startsWith('--', index)) {
      const lineEnd = source.indexOf('\n', index + 2)
      index = lineEnd === -1 ? source.length : lineEnd + 1
      continue
    }
    if (source.startsWith('/*', index)) {
      let depth = 1
      index += 2
      while (index < source.length && depth > 0) {
        if (source.startsWith('/*', index)) {
          depth += 1
          index += 2
        } else if (source.startsWith('*/', index)) {
          depth -= 1
          index += 2
        } else {
          index += 1
        }
      }
      if (depth !== 0) return false
      continue
    }
    return false
  }
  return true
}

function collectScannableFiles(rootPath, scan, failures) {
  const files = []
  const ignored = new Set(scan.ignoredDirectories)
  const extensions = new Set(scan.extensions)
  const fileNames = new Set(scan.fileNames)

  const visit = (currentPath) => {
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = resolve(currentPath, entry.name)
      const stat = lstatSync(entryPath)
      if (stat.isSymbolicLink()) {
        failures.push(`symbolic link is forbidden in greenfield roots: ${normalizePath(relative(repoRoot, entryPath))}`)
        continue
      }
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) visit(entryPath)
        continue
      }
      if (!entry.isFile()) continue
      if (fileNames.has(entry.name) || extensions.has(extname(entry.name).toLowerCase())) {
        if (stat.size > scan.maxScannedFileBytes) {
          failures.push(`scannable file exceeds size limit: ${normalizePath(relative(repoRoot, entryPath))}`)
          continue
        }
        files.push(entryPath)
      }
    }
  }
  visit(rootPath)
  return files
}

function forbiddenReferenceReasons(filePath, value, legacyRoots) {
  const reasons = []
  const normalized = normalizePath(value)
  const compact = normalized.replace(/\s+/gu, ' ')
  const legacyAbsolute = new Map(
    legacyRoots.map((entry) => [entry.id, normalizePath(resolve(repoRoot, entry.path))]),
  )
  const checkResolvedCandidate = (candidate) => {
    if (!candidate || candidate.includes('${')) return
    const pathOnly = candidate.split(/[?#]/u, 1)[0]
    if (!pathOnly.startsWith('.') && !/^[A-Za-z]:\//u.test(pathOnly) && !pathOnly.startsWith('/')) return
    const resolvedCandidate = resolve(dirname(filePath), pathOnly)
    for (const legacy of legacyRoots) {
      if (isInside(resolve(repoRoot, legacy.path), resolvedCandidate)) {
        reasons.push(`${legacy.id} relative reference ${candidate}`)
      }
    }
  }

  for (const match of normalized.matchAll(/(["'`])([^\r\n"'`]{1,500})\1/gu)) checkResolvedCandidate(match[2])
  for (const match of normalized.matchAll(/(?:^|[\s=(:,])((?:\.\.\/)+(?:src|supabase\/migrations)(?:\/[A-Za-z0-9_.*@/-]+)?)/gmu)) {
    checkResolvedCandidate(match[1])
  }

  for (const [id, absolutePath] of legacyAbsolute) {
    if (compact.includes(absolutePath)) reasons.push(`${id} absolute reference`)
  }
  if (/(?:^|["'`\s(=,:])supabase\/migrations(?:\/|(?=["'`\s),;:\]}]|$))/imu.test(normalized)) {
    reasons.push('legacy_migrations literal reference')
  }
  if (/\b(?:repoRoot|repositoryRoot)\b[\s\S]{0,160}?["'`]src["'`]/imu.test(value)) {
    reasons.push('legacy_application repository-root reference')
  }
  if (/\b(?:repoRoot|repositoryRoot)\b[\s\S]{0,200}?["'`]supabase["'`][\s\S]{0,80}?["'`]migrations["'`]/imu.test(value)) {
    reasons.push('legacy_migrations repository-root reference')
  }
  return [...new Set(reasons)]
}

function validateRepository(candidate) {
  const failures = []
  const roots = candidate.roots ?? []
  const legacyRoots = candidate.legacyReadOnlyRoots ?? []
  const sourcePaths = candidate.sources ?? []
  const scannedFiles = []

  for (const sourcePath of sourcePaths) {
    if (!existsSync(resolve(repoRoot, sourcePath))) failures.push(`frozen source is missing: ${sourcePath}`)
  }
  for (const legacy of legacyRoots) {
    const legacyPath = resolve(repoRoot, legacy.path)
    if (!existsSync(legacyPath) || !lstatSync(legacyPath).isDirectory()) failures.push(`legacy read-only root is missing: ${legacy.path}`)
  }
  for (const root of roots) {
    const rootPath = resolve(repoRoot, root.path)
    if (!existsSync(rootPath)) {
      failures.push(`greenfield root is missing: ${root.path}`)
      continue
    }
    const rootStat = lstatSync(rootPath)
    if (!rootStat.isDirectory()) {
      failures.push(`greenfield root is not a directory: ${root.path}`)
      continue
    }
    if (rootStat.isSymbolicLink()) {
      failures.push(`greenfield root must not be a symbolic link: ${root.path}`)
      continue
    }
    const realRoot = realpathSync(rootPath)
    if (!isInside(repoRoot, realRoot)) {
      failures.push(`greenfield root resolves outside the repository: ${root.path}`)
      continue
    }
    for (const legacy of legacyRoots) {
      if (isInside(resolve(repoRoot, legacy.path), realRoot) || isInside(realRoot, resolve(repoRoot, legacy.path))) {
        failures.push(`greenfield root overlaps legacy root: ${root.path} -> ${legacy.path}`)
      }
    }
    scannedFiles.push(...collectScannableFiles(rootPath, candidate.scan, failures))
  }

  for (const filePath of scannedFiles) {
    const content = readFileSync(filePath, 'utf8')
    if (content.includes('\u0000')) {
      failures.push(`configured text file contains NUL bytes: ${normalizePath(relative(repoRoot, filePath))}`)
      continue
    }
    for (const reason of forbiddenReferenceReasons(filePath, content, legacyRoots)) {
      failures.push(`${normalizePath(relative(repoRoot, filePath))}: ${reason}`)
    }
  }

  const seedPath = resolve(repoRoot, candidate.blankSeed?.path ?? '')
  if (!existsSync(seedPath) || !lstatSync(seedPath).isFile()) {
    failures.push(`blank seed is missing: ${candidate.blankSeed?.path ?? '<unset>'}`)
  } else {
    const seed = readFileSync(seedPath, 'utf8')
    if (!isCommentOnlySql(seed)) failures.push('blank seed contains executable SQL')
    const lowerSeed = seed.toLocaleLowerCase('en-US')
    for (const marker of candidate.blankSeed?.forbiddenMarkers ?? []) {
      if (lowerSeed.includes(marker.toLocaleLowerCase('en-US'))) failures.push(`blank seed contains forbidden historical marker: ${marker}`)
    }
  }
  return { failures, scannedFileCount: scannedFiles.length }
}

const failures = validateContract(contract)
const repositoryResult = validateRepository(contract)
failures.push(...repositoryResult.failures)

const contractNegativeCases = [
  ['historical G0 erased', (value) => { value.acceptanceBoundary.historicalG0OverallClaim = false }],
  ['historical progress inflated', (value) => { value.acceptanceBoundary.historicalAcceptedProgressPercent = 30 }],
  ['greenfield G0 falsely claimed', (value) => { value.acceptanceBoundary.greenfieldG0OverallClaim = true }],
  ['greenfield G1 falsely claimed', (value) => { value.acceptanceBoundary.greenfieldG1OverallClaim = true }],
  ['legacy application dependency enabled', (value) => { value.legacyReadOnlyRoots[0].dependencyAllowed = true }],
  ['legacy migration dependency enabled', (value) => { value.legacyReadOnlyRoots[1].dependencyAllowed = true }],
  ['seed data allowed', (value) => { value.blankSeed.businessRowsAllowed = 1 }],
  ['runner integration erased', (value) => { value.acceptanceBoundary.totalStaticRunnerUpdated = false }],
]
let negativePassed = 0
for (const [name, mutate] of contractNegativeCases) {
  const candidate = clone(contract)
  mutate(candidate)
  if (validateContract(candidate).length > 0) negativePassed += 1
  else failures.push(`contract negative self-test did not fail: ${name}`)
}

const syntheticFile = resolve(repoRoot, 'apps', 'team-os-4', 'package.json')
const scanNegativeCases = [
  ['relative legacy application', '{"alias":"../../src/legacy.ts"}'],
  ['relative legacy migrations', '{"chain":"../../supabase/migrations"}'],
  ['computed legacy application', "resolve(repoRoot, 'src')"],
  ['computed legacy migrations', "resolve(repoRoot, 'supabase', 'migrations')"],
]
let scanNegativePassed = 0
for (const [name, source] of scanNegativeCases) {
  if (forbiddenReferenceReasons(syntheticFile, source, contract.legacyReadOnlyRoots).length > 0) scanNegativePassed += 1
  else failures.push(`reference negative self-test did not fail: ${name}`)
}
const scanPositiveCases = [
  ['local application source', "import './src/main.ts'"],
  ['greenfield migrations', '{"migrations":"../../platform/team-os-4/supabase/migrations"}'],
]
let scanPositivePassed = 0
for (const [name, source] of scanPositiveCases) {
  if (forbiddenReferenceReasons(syntheticFile, source, contract.legacyReadOnlyRoots).length === 0) scanPositivePassed += 1
  else failures.push(`reference positive self-test failed: ${name}`)
}
const seedNegativeCases = [
  'insert into public.teams(id) values (\'CANWIN_TEAM\');',
  '/* header */\nselect 1;',
  '/* unterminated',
]
let seedNegativePassed = 0
for (const source of seedNegativeCases) {
  if (!isCommentOnlySql(source)) seedNegativePassed += 1
  else failures.push('blank-seed negative self-test did not fail')
}
const seedPositiveCases = [
  '',
  '-- intentionally empty\n',
  '/* outer /* nested */ comment */\n',
]
let seedPositivePassed = 0
for (const source of seedPositiveCases) {
  if (isCommentOnlySql(source)) seedPositivePassed += 1
  else failures.push('blank-seed positive self-test failed')
}

if (failures.length > 0) {
  console.error('P0_GREENFIELD_ROOT_CONTRACT_DRIFT')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `P0_GREENFIELD_ROOT_CONTRACT_OK roots=${contract.roots.length} scannedFiles=${repositoryResult.scannedFileCount} seedStatements=0 historicalG0=true greenfieldG0=false progress=25 runtimeAccepted=false productionWrites=0 networkCalls=0 negative=${negativePassed}/${contractNegativeCases.length} referenceNegative=${scanNegativePassed}/${scanNegativeCases.length} referencePositive=${scanPositivePassed}/${scanPositiveCases.length} seedNegative=${seedNegativePassed}/${seedNegativeCases.length} seedPositive=${seedPositivePassed}/${seedPositiveCases.length}`,
)
