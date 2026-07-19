import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const routineEvidencePath = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'public-routine-live-evidence.json')
const callerEvidencePath = resolve(repoRoot, 'docs', 'team-os-4.0', 'p0', 'public-routine-caller-crosscheck.json')
const sourceRoots = ['src', 'supabase/functions']
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])

function normalizedPath(path) {
  return relative(repoRoot, path).replaceAll('\\', '/')
}

function walk(path) {
  const entries = readdirSync(path).sort((left, right) => left.localeCompare(right, 'en'))
  return entries.flatMap((entry) => {
    const child = resolve(path, entry)
    return statSync(child).isDirectory() ? walk(child) : [child]
  })
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function collectSourceCallers(files) {
  const references = new Map()
  const dynamicCallSites = []
  let literalReferenceCount = 0

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const lines = source.split(/\r?\n/u)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const literalPattern = /\brpc\s*\(\s*(['"`])([a-z_][a-z0-9_]*)\1/gu
      for (const match of line.matchAll(literalPattern)) {
        const name = match[2]
        const locations = references.get(name) ?? []
        locations.push({ source: normalizedPath(file), line: index + 1 })
        references.set(name, locations)
        literalReferenceCount += 1
      }

      const dynamicPattern = /\brpc\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,|\))/gu
      for (const match of line.matchAll(dynamicPattern)) {
        dynamicCallSites.push({ source: normalizedPath(file), line: index + 1, firstArgument: match[1] })
      }
    }
  }

  for (const [name, locations] of references) {
    const unique = new Map(locations.map((location) => [`${location.source}:${location.line}`, location]))
    references.set(name, [...unique.values()].sort((left, right) =>
      left.source.localeCompare(right.source, 'en') || left.line - right.line))
  }

  return {
    references,
    literalReferenceCount,
    dynamicCallSites: dynamicCallSites.sort((left, right) =>
      left.source.localeCompare(right.source, 'en') || left.line - right.line),
  }
}

function buildEvidence(routineEvidence) {
  const files = sourceRoots
    .flatMap((root) => walk(resolve(repoRoot, root)))
    .filter((file) => sourceExtensions.has(extname(file)) && !file.endsWith('.d.ts'))
    .sort((left, right) => normalizedPath(left).localeCompare(normalizedPath(right), 'en'))
  const callers = collectSourceCallers(files)
  const liveRoutineNames = new Set(routineEvidence.routines.map((routine) => routine.name))
  const literalRpcNames = [...callers.references.keys()].sort((left, right) => left.localeCompare(right, 'en'))
  const orphanLiteralRpcNames = literalRpcNames.filter((name) => !liveRoutineNames.has(name))

  const routines = routineEvidence.routines.map((routine) => {
    const sourceCallers = callers.references.get(routine.name) ?? []
    return {
      signature: routine.signature,
      name: routine.name,
      liveCandidateClassification: routine.candidateClassification,
      effectiveExecuteRoles: routine.effectiveExecuteRoles,
      triggerFunction: routine.triggerUses.length > 0,
      sourceCallers,
      callerStatus: sourceCallers.length > 0
        ? 'runtime_literal_caller_found'
        : 'no_runtime_literal_caller_found',
      acceptanceStatus: 'candidate_unaccepted',
    }
  })

  const referencedSignatures = routines.filter((routine) => routine.sourceCallers.length > 0)
  const authenticatedWithoutCaller = routines.filter((routine) =>
    routine.effectiveExecuteRoles.includes('authenticated') && routine.sourceCallers.length === 0)
  const triggerFunctionsWithCaller = routines.filter((routine) =>
    routine.triggerFunction && routine.sourceCallers.length > 0)
  const anonWithCaller = routines.filter((routine) =>
    routine.effectiveExecuteRoles.includes('anon') && routine.sourceCallers.length > 0)

  return {
    schemaVersion: 1,
    evidenceType: 'local-runtime-routine-caller-crosscheck',
    generatedFromRoutineCaptureAtUtc: routineEvidence.capturedAtUtc,
    sourceRoots,
    sourceFileCount: files.length,
    sourceFiles: files.map(normalizedPath),
    limitations: [
      'literal rpc names are mapped; computed names require explicit wrapper review',
      'absence of a local caller does not prove a routine is unused externally',
      'same-name overloads share caller locations until argument-level runtime tests',
      'tests, historical migrations and documentation are not runtime caller roots',
    ],
    acceptanceStatus: 'candidate_unaccepted',
    supervisorAccepted: false,
    counts: {
      liveRoutineSignatures: routines.length,
      liveRoutineNames: liveRoutineNames.size,
      literalRpcReferences: callers.literalReferenceCount,
      literalRpcNames: literalRpcNames.length,
      orphanLiteralRpcNames: orphanLiteralRpcNames.length,
      dynamicRpcCallSites: callers.dynamicCallSites.length,
      referencedLiveRoutineSignatures: referencedSignatures.length,
      authenticatedExecutableWithoutRuntimeCaller: authenticatedWithoutCaller.length,
      triggerFunctionsWithRuntimeCaller: triggerFunctionsWithCaller.length,
      anonExecutableWithRuntimeCaller: anonWithCaller.length,
    },
    literalRpcNames,
    orphanLiteralRpcNames,
    dynamicRpcCallSites: callers.dynamicCallSites,
    routines,
  }
}

function validateEvidence(evidence) {
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }
  check(evidence.schemaVersion === 1, 'Unsupported caller evidence schemaVersion.')
  check(evidence.evidenceType === 'local-runtime-routine-caller-crosscheck', 'Caller evidence type drifted.')
  check(evidence.acceptanceStatus === 'candidate_unaccepted' && evidence.supervisorAccepted === false, 'Caller evidence must remain unaccepted.')
  check(evidence.counts?.liveRoutineSignatures === 162, 'Caller evidence must cover 162 live routine signatures.')
  check(Array.isArray(evidence.routines) && evidence.routines.length === 162, 'Caller evidence routine array must contain 162 entries.')
  check(Array.isArray(evidence.orphanLiteralRpcNames) && evidence.orphanLiteralRpcNames.length === 0, 'Runtime source references a missing live routine.')
  check(evidence.counts?.orphanLiteralRpcNames === 0, 'Orphan RPC count must remain zero.')
  check(Array.isArray(evidence.dynamicRpcCallSites), 'Dynamic RPC call sites must be explicit.')
  check(Array.isArray(evidence.sourceFiles) && evidence.sourceFiles.length === evidence.sourceFileCount, 'Source file inventory does not reconcile.')
  check(Array.isArray(evidence.literalRpcNames) && evidence.literalRpcNames.length === evidence.counts?.literalRpcNames, 'Literal RPC name count does not reconcile.')
  check(evidence.counts?.literalRpcReferences >= evidence.counts?.literalRpcNames, 'Literal reference count cannot be below unique name count.')
  if (Array.isArray(evidence.routines)) {
    const signatures = evidence.routines.map((routine) => routine.signature)
    check(signatures.length === new Set(signatures).size, 'Caller evidence has duplicate routine signatures.')
    for (const routine of evidence.routines) {
      check(['runtime_literal_caller_found', 'no_runtime_literal_caller_found'].includes(routine.callerStatus), `Routine ${routine.signature} has invalid caller status.`)
      check(routine.acceptanceStatus === 'candidate_unaccepted', `Routine ${routine.signature} must remain unaccepted.`)
      check(Array.isArray(routine.sourceCallers), `Routine ${routine.signature} sourceCallers must be an array.`)
      check(routine.callerStatus === (routine.sourceCallers.length > 0 ? 'runtime_literal_caller_found' : 'no_runtime_literal_caller_found'), `Routine ${routine.signature} caller status disagrees with source evidence.`)
    }
  }
  return failures
}

const routineEvidence = JSON.parse(readFileSync(routineEvidencePath, 'utf8'))
const generated = buildEvidence(routineEvidence)
const generatedFailures = validateEvidence(generated)
if (generatedFailures.length) {
  console.error('P0_ROUTINE_CALLER_CROSSCHECK_GENERATION_FAILED')
  for (const failure of generatedFailures) console.error('- ' + failure)
  process.exit(1)
}

if (process.argv.includes('--print')) {
  process.stdout.write(JSON.stringify(generated) + '\n')
  process.exit(0)
}

const recorded = JSON.parse(readFileSync(callerEvidencePath, 'utf8'))
const recordedFailures = validateEvidence(recorded)
if (recordedFailures.length || JSON.stringify(recorded) !== JSON.stringify(generated)) {
  console.error('P0_ROUTINE_CALLER_CROSSCHECK_DRIFT')
  for (const failure of recordedFailures) console.error('- ' + failure)
  if (JSON.stringify(recorded) !== JSON.stringify(generated)) console.error('- Recorded caller mapping differs from current runtime source.')
  process.exit(1)
}

const selfTests = [
  ['false-acceptance', (copy) => { copy.supervisorAccepted = true }],
  ['orphan-rpc', (copy) => { copy.orphanLiteralRpcNames = ['missing_rpc']; copy.counts.orphanLiteralRpcNames = 1 }],
  ['missing-routine', (copy) => copy.routines.pop()],
  ['caller-status-drift', (copy) => { copy.routines[0].callerStatus = copy.routines[0].callerStatus === 'runtime_literal_caller_found' ? 'no_runtime_literal_caller_found' : 'runtime_literal_caller_found' }],
]
for (const [name, mutate] of selfTests) {
  const copy = JSON.parse(JSON.stringify(recorded))
  mutate(copy)
  if (validateEvidence(copy).length === 0) {
    console.error('P0_ROUTINE_CALLER_CROSSCHECK_SELFTEST_FAILED case=' + name)
    process.exit(1)
  }
}

console.log('P0_ROUTINE_CALLER_CROSSCHECK_SELFTEST_OK cases=' + selfTests.length)
console.log(
  'P0_ROUTINE_CALLER_CROSSCHECK_OK files=' + recorded.sourceFileCount +
    ' literalReferences=' + recorded.counts.literalRpcReferences +
    ' literalNames=' + recorded.counts.literalRpcNames +
    ' orphanNames=0 dynamicSites=' + recorded.counts.dynamicRpcCallSites +
    ' referencedSignatures=' + recorded.counts.referencedLiveRoutineSignatures,
)
console.log(
  'P0_ROUTINE_CALLER_CROSSCHECK_REVIEW_REQUIRED authenticatedWithoutRuntimeCaller=' +
    recorded.counts.authenticatedExecutableWithoutRuntimeCaller +
    ' triggerFunctionsWithRuntimeCaller=' + recorded.counts.triggerFunctionsWithRuntimeCaller +
    ' anonExecutableWithRuntimeCaller=' + recorded.counts.anonExecutableWithRuntimeCaller,
)
