import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p3/team-os-4-g3-acceptance-contract.json'), 'utf8'))
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8').replace(/\s+/gu, ' ')
const migration = read('platform/team-os-4/supabase/migrations/20260722144500_add_g3_customers_brands_stores.sql')
const app = read('apps/team-os-4/src/App.tsx')
const page = read('apps/team-os-4/src/CustomerDirectoryPage.tsx')
const reader = read('apps/team-os-4/src/lib/supabase-customer-directory-reader.ts')
const salesMigration = read('platform/team-os-4/supabase/migrations/20260722150000_add_g3_leads_opportunities_and_claim.sql')
const salesPage = read('apps/team-os-4/src/SalesPipelinePage.tsx')

assert.equal(contract.schemaVersion, 1)
assert.equal(contract.phase, 'G3')
assert.equal(contract.acceptedProgressBefore, 40)
assert.deepEqual(contract.checkpoints.map(({ progress, status }) => [progress, status]), [[45, 'pending'], [50, 'pending']])
assert.deepEqual(contract.checkpoints[0].required, [
  'settlement-customer-brand-store-hierarchy',
  'crm-lifecycle-state-machine',
  'legacy-source-id-mapping-and-reconciliation',
])
assert.deepEqual(contract.checkpoints[1].required, [
  'sales-workspace',
  'customer-360',
  'fast-progression-with-recorded-reason',
  'server-filter-search-and-clear',
  'cross-region-assignment-and-denial',
])
assert.deepEqual(contract.contracts.hierarchy, ['settlement_customer', 'brand', 'store'])
assert.deepEqual(contract.contracts.crmLifecycle, ['lead', 'customer', 'opportunity', 'quote', 'order'])
assert.equal(contract.contracts.migrationMapping, 'immutable-source-id-to-target-id-with-disposition-and-reconciliation')
assert.deepEqual(contract.contracts.fastProgressionCannotSkip, ['customer-identity', 'quote-snapshot', 'payment', 'inventory', 'fulfillment'])
assert.equal(contract.contracts.crossRegion, 'create-to-region-pool-or-authorized-sales-never-silent-self-ownership')
assert.deepEqual(contract.contracts.leadOwnership, {
  states: ['owned', 'regional_pool'],
  cleanupAfterUnclaimedDays: 20,
  claimAndCleanupUseSameRowLock: true,
  claimWinsConcurrentCleanup: true,
  claimClearsCleanupAt: true,
  protectedBusinessRecordsPreventPhysicalDelete: true,
})
assert.deepEqual(contract.contracts.opportunityRelations, ['settlement_customer', 'store'])
assert.deepEqual(contract.contracts.stableTestIds, [
  'sales-lead-pool',
  'sales-lead-owned',
  'sales-opportunity-list',
  'customer-360',
])
assert.equal(contract.contracts.rlsRequired, true)
assert.equal(contract.contracts.clientDirectWritesAllowed, false)
assert.equal(contract.contracts.fixturesMocksOrDemoDataAllowed, false)
assert.equal(contract.runtimeEvidence, 'pending')
assert.equal(contract.migrationEvidence, 'pending')
assert.equal(contract.g3Accepted, false)
for (const table of ['customers', 'brands', 'stores']) {
  assert.ok(migration.includes(`create table public.${table} (`))
  assert.ok(migration.includes(`alter table public.${table} enable row level security;`))
  assert.ok(migration.includes(`revoke all on table public.${table} from anon, authenticated;`))
}
assert.ok(migration.includes('references public.customers(id, company_id)'))
assert.ok(migration.includes('references public.brands(id, company_id)'))
assert.ok(app.includes('<Route path="/customers"'))
assert.ok(page.includes('data-testid="customer-directory-list"'))
assert.ok(reader.includes("query('customers', 'id,company_id,name,region,sales_owner_id')"))
assert.ok(!/\b(?:fixture|mock|demo)(?:s|data)?\b/iu.test(`${app} ${page} ${reader}`))
for (const table of ['profile_regions', 'leads', 'opportunities']) assert.ok(salesMigration.includes(`create table public.${table} (`))
assert.ok(salesMigration.includes('for update skip locked'))
assert.ok(salesMigration.includes('cleanup_due_at = null'))
assert.ok(salesMigration.includes('opportunities_store_customer_guard'))
for (const testId of ['sales-lead-pool', 'sales-lead-owned', 'sales-opportunity-list']) assert.ok(salesPage.includes(`data-testid="${testId}"`))

console.log('TEAM_OS_4_G3_CONTRACT_OK checkpoints=45,50 hierarchy=3 tables=3 rls=3 customerRoute=present crmLifecycle=5 fakeData=forbidden runtime=pending migration=pending gateIntegrated=0')
