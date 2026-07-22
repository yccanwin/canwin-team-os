import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p3/team-os-4-g3-acceptance-contract.json'), 'utf8'))
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8').replace(/\s+/gu, ' ')
const leadsMigration = read('platform/team-os-4/supabase/migrations/20260722150000_add_g3_leads_opportunities_and_claim.sql')
const customerPage = read('apps/team-os-4/src/CustomerDirectoryPage.tsx')
const customerReader = read('apps/team-os-4/src/lib/supabase-customer-directory-reader.ts')
const mapping = JSON.parse(readFileSync(resolve(repoRoot, 'tools/migrate-3-to-4/manifests/g3-crm-mapping.template.json'), 'utf8'))
const migration = read('platform/team-os-4/supabase/migrations/20260722144500_add_g3_customers_brands_stores.sql')
const app = read('apps/team-os-4/src/App.tsx')
const page = read('apps/team-os-4/src/CustomerDirectoryPage.tsx')
const reader = read('apps/team-os-4/src/lib/supabase-customer-directory-reader.ts')
const salesMigration = read('platform/team-os-4/supabase/migrations/20260722150000_add_g3_leads_opportunities_and_claim.sql')
const salesPage = read('apps/team-os-4/src/SalesPipelinePage.tsx')
const cleanupMigration = read('platform/team-os-4/supabase/migrations/20260722151500_add_g3_lead_cleanup.sql')
const customer360 = read('apps/team-os-4/src/Customer360Drawer.tsx')

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
assert.deepEqual(contract.contracts.leadCleanupAudit.retains, ['random_id', 'region', 'deleted_at', 'reason', 'job_version'])
assert.deepEqual(contract.contracts.leadCleanupAudit.forbids, ['phone', 'follow_up_body', 'customer_content'])
assert.equal(contract.contracts.leadCleanupAudit.timezone, 'Asia/Shanghai')
assert.equal(contract.contracts.leadCleanupAudit.idempotent, true)
assert.equal(contract.contracts.customer360DataSource, 'existing-supabase-customers-brands-stores-only')
assert.equal(contract.contracts.rlsRequired, true)
assert.equal(contract.contracts.clientDirectWritesAllowed, false)
assert.equal(contract.contracts.fixturesMocksOrDemoDataAllowed, false)
assert.equal(contract.runtimeEvidence, 'pending')
assert.equal(contract.migrationEvidence, 'pending')
assert.equal(contract.g3Accepted, false)
assert.ok(leadsMigration.includes('for update skip locked'))
assert.ok(leadsMigration.includes('cleanup_due_at = null'))
assert.ok(leadsMigration.includes('claim_idempotency_key'))
assert.ok(customerReader.includes("client.from(table).select(columns).eq('company_id', companyId)"))
assert.ok(customerPage.includes('data-testid="customer-directory-list"'))
assert.ok(customerPage.includes('data-testid="customer-row"'))
assert.ok(customerPage.includes('真实客户数据'))
assert.ok(!/\b(?:fixture|mock|demo)\b/iu.test(`${customerPage} ${customerReader}`))
assert.equal(mapping.status, 'pending')
assert.deepEqual(mapping.mappings.map((item) => item.targetEntity), ['customers', 'brands', 'stores', 'leads', 'opportunities'])
assert.ok(mapping.mappings.every((item) => item.sourceTable === null && item.sourceIdField === null && item.disposition === null))
assert.equal(mapping.dataRowsIncluded, 0)
assert.equal(mapping.importExecuted, false)
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
assert.ok(cleanupMigration.includes("time zone 'Asia/Shanghai'"))
assert.ok(cleanupMigration.includes('for update of l skip locked'))
assert.ok(cleanupMigration.includes('create table public.lead_cleanup_audit ('))
for (const forbidden of ['source_lead_id', 'phone', 'follow_up_body', 'customer_content']) assert.ok(!cleanupMigration.includes(forbidden))
assert.ok(customer360.includes('data-testid="customer-360"'))

console.log('TEAM_OS_4_G3_CONTRACT_OK checkpoints=45,50 hierarchy=3 tables=3 rls=3 customerRoute=present crmLifecycle=5 fakeData=forbidden runtime=pending migration=pending gateIntegrated=0')
