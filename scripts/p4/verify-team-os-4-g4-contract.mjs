import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p4/team-os-4-g4-acceptance-contract.json'), 'utf8'))
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8').replace(/\s+/gu, ' ')
const migrationDir = resolve(repoRoot, 'platform/team-os-4/supabase/migrations')
const inventoryFiles = readdirSync(migrationDir).filter((name) => /inventory|fulfillment/u.test(name))
const inventorySql = inventoryFiles.map((name) => read(`platform/team-os-4/supabase/migrations/${name}`)).join(' ')
const appSource = `${read('apps/team-os-4/src/App.tsx')} ${read('apps/team-os-4/src/FulfillmentPages.tsx')}`
const migration = read('platform/team-os-4/supabase/migrations/20260722154500_add_g4_products_quotes_orders.sql')
const app = read('apps/team-os-4/src/App.tsx')
const pages = read('apps/team-os-4/src/CommercePages.tsx')
const reader = read('apps/team-os-4/src/lib/supabase-commerce-reader.ts')

assert.equal(contract.schemaVersion, 1)
assert.equal(contract.phase, 'G4')
assert.equal(contract.acceptedProgressBefore, 50)
assert.deepEqual(contract.checkpoints.map(({ progress, status }) => [progress, status]), [[55, 'pending'], [60, 'pending']])
assert.deepEqual(contract.checkpoints[0].required, [
  'product-catalog-and-versioned-prices',
  'quote-order-snapshot',
  'payment-gated-inventory-reservation',
  'service-and-fulfillment-transactions',
  'store-allocation-conservation',
])
assert.deepEqual(contract.checkpoints[1].required, [
  'sales-product-quote-order-pages',
  'warehouse-reserve-and-ship-pages',
  'implementation-fulfillment-pages',
  'operations-service-pages',
])
assert.deepEqual(contract.contracts.productTypes, ['software', 'hardware', 'service'])
assert.deepEqual(contract.contracts.frozenPrices, ['customer_sale_price', 'sales_internal_price', 'company_actual_cost'])
assert.equal(contract.contracts.quoteChangesInventory, false)
assert.deepEqual(contract.contracts.reservationRequires, ['formal_order', 'internal_payment_settled'])
assert.equal(contract.contracts.internalPaymentProof, 'server-ledger-or-immutable-payment-event-only')
assert.equal(contract.contracts.frontendBooleanCountsAsSettlement, false)
assert.equal(contract.contracts.storeAllocation, 'sum-store-allocations-equals-order-line-quantity')
assert.equal(contract.contracts.fulfillmentUnit, 'store+order_line')
assert.equal(contract.contracts.inventoryConservationRequired, true)
assert.deepEqual(contract.contracts.serverTransactionsRequired, ['reserve', 'ship', 'complete-fulfillment', 'cancel-or-reverse'])
assert.equal(contract.contracts.rlsRequired, true)
assert.equal(contract.contracts.clientDirectWritesAllowed, false)
assert.equal(contract.contracts.fixturesMocksOrDemoDataAllowed, false)
assert.deepEqual(contract.contracts.inventoryFulfillment, {
  tablesRequired: ['inventory_events', 'fulfillment_units', 'fulfillment_events'],
  eventsImmutable: true,
  fulfillmentIdentity: 'company_id+store_id+order_line_id',
  paymentGateStatus: 'pending',
})
assert.equal(contract.contracts.stableTestIds.length, 7)
assert.ok(!/internalPaymentSettled\s*[:=]\s*(?:true|false)/u.test(appSource), 'frontend boolean must not prove internal payment settlement')
if (inventoryFiles.length > 0) {
  for (const table of contract.contracts.inventoryFulfillment.tablesRequired) {
    assert.ok(inventorySql.includes(`create table public.${table} (`), `missing G4 table ${table}`)
  }
  assert.ok(inventorySql.includes('unique (company_id, store_id, order_line_id)'))
  assert.ok(!inventorySql.includes('create or replace function public.reserve_inventory_v1'))
  assert.ok(inventorySql.includes('enable row level security'))
  assert.ok(/prevent_[a-z_]*event[a-z_]*mutation/u.test(inventorySql))
}
assert.equal(contract.runtimeEvidence, 'pending')
assert.equal(contract.transactionEvidence, 'pending')
assert.equal(contract.g4Accepted, false)
for (const table of ['products', 'product_price_versions', 'quotes', 'quote_lines', 'orders', 'order_lines', 'order_line_store_allocations']) assert.ok(migration.includes(`create table public.${table} (`))
for (const price of contract.contracts.frozenPrices) assert.ok(migration.includes(`${price} numeric(14,2) not null`))
assert.ok(migration.includes('deferrable initially deferred'))
assert.ok(migration.includes('frozen_quote_snapshot jsonb not null'))
assert.ok(app.includes('<Route path="/catalog"'))
assert.ok(app.includes('<Route path="/orders"'))
for (const testId of ['catalog-page', 'orders-page', 'product-row', 'quote-row', 'order-row']) assert.ok(pages.includes(`data-testid="${testId}"`))
assert.ok(!/\b(?:fixture|mock|demo)(?:s|data)?\b/iu.test(`${app} ${pages} ${reader}`))

console.log('TEAM_OS_4_G4_CONTRACT_OK checkpoints=55,60 tables=7 prices=3 pages=2 quoteInventoryWrites=0 paymentGate=required allocationConservation=required runtime=pending transactions=pending gateIntegrated=0')
