import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p5/team-os-4-g5-acceptance-contract.json'), 'utf8'))
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8').replace(/\s+/gu, ' ')
const ledgers = read('platform/team-os-4/supabase/migrations/20260722163000_add_g5_financial_ledgers.sql')
const refunds = read('platform/team-os-4/supabase/migrations/20260722164500_add_g5_refund_events.sql')
const financePages = read('apps/team-os-4/src/FinancePages.tsx')
const migration = ledgers
const app = read('apps/team-os-4/src/App.tsx')
const pages = read('apps/team-os-4/src/FinancePages.tsx')
const reader = read('apps/team-os-4/src/lib/supabase-finance-reader.ts')

assert.equal(contract.schemaVersion, 1)
assert.equal(contract.phase, 'G5')
assert.equal(contract.acceptedProgressBefore, 60)
assert.deepEqual(contract.checkpoints.map(({ progress, status }) => [progress, status]), [[65, 'pending'], [70, 'pending']])
assert.deepEqual(contract.checkpoints[0].required, [
  'customer-receipts-and-refunds',
  'internal-payables-and-settlement',
  'sales-and-company-profit-ledgers',
  'labor-earning-ledger',
  'reversal-conservation',
])
assert.deepEqual(contract.checkpoints[1].required, [
  'finance-workspace',
  'personal-earnings-page',
  'field-level-finance-permissions',
  'finance-exception-and-reconciliation-views',
])
assert.deepEqual(contract.contracts.immutableEvents, ['receipt', 'internal-payment', 'profit', 'labor-earning', 'refund', 'reversal'])
assert.equal(contract.contracts.reversalMutatesOriginal, false)
assert.equal(contract.contracts.reversalCreatesOppositeEvent, true)
assert.deepEqual(contract.contracts.conservationRequired, ['customer-cash', 'internal-payable', 'sales-profit', 'company-profit', 'labor-earning'])
assert.equal(contract.contracts.acceptedLaborEarningAutoClawback, false)
assert.equal(contract.contracts.acceptedLaborEarningCorrection, 'explicit-reviewed-adjustment-event-only')
assert.deepEqual(contract.contracts.globalFinanceVisibleTo, ['finance', 'admin'])
assert.equal(contract.contracts.personalEarningsVisibleTo, 'self-only-unless-finance-or-admin')
assert.equal(contract.contracts.clientDirectLedgerWritesAllowed, false)
assert.equal(contract.contracts.fixturesMocksOrDemoDataAllowed, false)
assert.equal(contract.contracts.stableTestIds.length, 7)
assert.ok(refunds.includes('create table public.refund_events ('))
assert.ok(refunds.includes("event_type in ('requested', 'approved', 'confirmed', 'reversed')"))
assert.ok(refunds.includes("event_type = 'reversed' and reversal_of_id is not null"))
assert.ok(refunds.includes('create table public.refund_responsibility_splits ('))
assert.ok(refunds.includes('refund responsibility total % must equal refund amount %'))
assert.ok(refunds.includes('create trigger refund_events_immutable before update or delete'))
assert.ok(refunds.includes('create trigger refund_splits_immutable before update or delete'))
assert.ok(refunds.includes('It never mutates labor_earnings.'))
assert.ok(!/update public\.labor_earnings|delete from public\.labor_earnings|insert into public\.labor_earnings/iu.test(refunds))
assert.ok(ledgers.includes('create trigger labor_earnings_immutable before update or delete'))
assert.ok(ledgers.includes('financial ledger rows are immutable; append a reversal instead'))
for (const testId of contract.contracts.stableTestIds) assert.ok(financePages.includes(`data-testid="${testId}"`))
assert.equal(contract.runtimeEvidence, 'pending')
assert.equal(contract.conservationEvidence, 'pending')
assert.equal(contract.permissionEvidence, 'pending')
assert.equal(contract.g5Accepted, false)
for (const table of ['payment_events', 'internal_payment_events', 'profit_ledger_entries', 'labor_earnings']) {
  assert.ok(migration.includes(`create table public.${table} (`))
  assert.ok(migration.includes(`alter table public.${table} enable row level security;`))
}
assert.ok(migration.includes('before update or delete'))
assert.equal((migration.match(/reversal_fk foreign key/gu) ?? []).length, 4)
assert.ok(app.includes('<Route path="/finance"'))
assert.ok(app.includes('<Route path="/earnings"'))
for (const testId of ['finance-page', 'earnings-page', 'earning-row']) assert.ok(pages.includes(`data-testid="${testId}"`))
assert.ok(pages.includes('if (!allowed) return;'))
assert.ok(!/\b(?:fixture|mock|demo)(?:s|data)?\b/iu.test(`${app} ${pages} ${reader}`))

console.log('TEAM_OS_4_G5_CONTRACT_OK checkpoints=65,70 ledgers=4 immutableEvents=6 reversalMutatesOriginal=false laborAutoClawback=false pages=2 runtime=pending conservation=pending permissions=pending gateIntegrated=0')
