import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contractPath = resolve(repoRoot, 'scripts', 'p0', 'project-ref-contract.json')
const configPath = resolve(repoRoot, 'supabase', 'config.toml')
const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
const configSource = readFileSync(configPath, 'utf8')
const configMatch = configSource.match(/^project_id\s*=\s*"([a-z0-9]+)"\s*$/m)
const exactKeys = (value, expected) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())

const checks = [
  ['schema version is supported', contract.schemaVersion === 1],
  ['project contract has exact fields', exactKeys(contract, [
    'schemaVersion', 'productionProjectRef', 'productionFrontendKey', 'testProjectRef',
    'testFrontendKey', 'testProjectStatus', 'previewBuildAllowed',
  ])],
  ['production project ref has valid syntax', /^[a-z0-9]{20}$/.test(contract.productionProjectRef ?? '')],
  ['supabase config declares one project id', Boolean(configMatch)],
  ['supabase config matches the production contract', configMatch?.[1] === contract.productionProjectRef],
  ['previewBuildAllowed is boolean', typeof contract.previewBuildAllowed === 'boolean'],
  ['production frontend key has exact fields', exactKeys(contract.productionFrontendKey, ['type', 'sha256'])],
  ['production frontend key type is declared', ['legacy-anon', 'publishable'].includes(contract.productionFrontendKey?.type)],
  ['production frontend key fingerprint is valid', /^[a-f0-9]{64}$/.test(contract.productionFrontendKey?.sha256 ?? '')],
]

const hasTestProject = typeof contract.testProjectRef === 'string' && contract.testProjectRef.length > 0
if (hasTestProject) {
  checks.push(
    ['test project ref has valid syntax', /^[a-z0-9]{20}$/.test(contract.testProjectRef)],
    ['test and production refs differ', contract.testProjectRef !== contract.productionProjectRef],
    ['test project status is supported', ['declared', 'restore-validated'].includes(contract.testProjectStatus)],
    ['test frontend key has exact fields', exactKeys(contract.testFrontendKey, ['type', 'sha256'])],
    ['test frontend key type is declared', ['legacy-anon', 'publishable'].includes(contract.testFrontendKey?.type)],
    ['test frontend key fingerprint is valid', /^[a-f0-9]{64}$/.test(contract.testFrontendKey?.sha256 ?? '')],
    ['production and test frontend fingerprints differ', contract.testFrontendKey?.sha256 !== contract.productionFrontendKey?.sha256],
    ['preview remains an explicit separate gate', contract.previewBuildAllowed === false],
  )
} else {
  checks.push(
    ['missing test project is represented as null', contract.testProjectRef === null],
    ['missing test project is reported honestly', contract.testProjectStatus === 'not-provisioned'],
    ['preview stays disabled without a test project', contract.previewBuildAllowed === false],
  )
}

let passed = 0
for (const [label, result] of checks) {
  if (result) {
    passed += 1
  } else {
    console.error('[p0:project-ref] FAIL ' + label)
  }
}

const productionContractValid = checks.slice(0, 9).every(([, result]) => result)
console.log(
  '[p0:project-ref] production_ref_contract=' +
    (productionContractValid ? 'valid' : 'invalid') +
    ' test_project_declared=' + hasTestProject,
)
console.log(
  '[p0:project-ref] summary discovered=' + checks.length + ' run=' + checks.length +
    ' passed=' + passed + ' failed=' + (checks.length - passed) + ' skipped=0',
)
if (!hasTestProject) {
  console.log('[p0:project-ref] readiness=BLOCKED reason=test-project-not-provisioned')
} else if (contract.testProjectStatus !== 'restore-validated') {
  console.log('[p0:project-ref] readiness=BLOCKED reason=isolated-restore-not-validated')
} else {
  console.log('[p0:project-ref] readiness=READY restore=validated preview=disabled')
}

if (passed !== checks.length) process.exit(1)
