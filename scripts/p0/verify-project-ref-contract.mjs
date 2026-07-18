import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contractPath = resolve(repoRoot, 'scripts', 'p0', 'project-ref-contract.json')
const configPath = resolve(repoRoot, 'supabase', 'config.toml')
const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
const configSource = readFileSync(configPath, 'utf8')
const configMatch = configSource.match(/^project_id\s*=\s*"([a-z0-9]+)"\s*$/m)

const checks = [
  ['schema version is supported', contract.schemaVersion === 1],
  ['production project ref has valid syntax', /^[a-z0-9]{20}$/.test(contract.productionProjectRef ?? '')],
  ['supabase config declares one project id', Boolean(configMatch)],
  ['supabase config matches the production contract', configMatch?.[1] === contract.productionProjectRef],
  ['previewBuildAllowed is boolean', typeof contract.previewBuildAllowed === 'boolean'],
]

const hasTestProject = typeof contract.testProjectRef === 'string' && contract.testProjectRef.length > 0
if (hasTestProject) {
  checks.push(
    ['test project ref has valid syntax', /^[a-z0-9]{20}$/.test(contract.testProjectRef)],
    ['test and production refs differ', contract.testProjectRef !== contract.productionProjectRef],
    ['test project status is declared', contract.testProjectStatus === 'declared'],
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

const productionContractValid = checks.slice(0, 5).every(([, result]) => result)
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
}

if (passed !== checks.length) process.exit(1)
