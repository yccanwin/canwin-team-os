import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createSupabasePerformanceCenterDataSource,
  mapPerformanceCenterSnapshot,
  PerformanceCenterDataError,
} from '../src/features/performance-center/supabaseDataSource.ts'

const raw = {
  viewer: { profileId: 'viewer-1', teamId: 'team-1', requestedScope: 'team', effectiveScope: 'team', selectedProfileId: null, canManageTargets: true },
  summary: {
    quarterStart: '2026-07-01',
    points: { target: '3600', actual: '120.5' },
    newGmv: { target: 300000, actual: '8800' },
    renewalGmv: { target: 120000, actual: 2200 },
  },
  members: [{ profileId: 'sales-1', profileName: '销售一', points: '120.5', newGmv: '8800', renewalGmv: 2200, pointsTarget: 1000, newGmvTarget: 50000, renewalGmvTarget: 20000, canSetTarget: true }],
  products: [{ catalogItemId: null, productName: '门店年费', orderCount: '2', quantity: 2, points: '120.5', gmv: '11000' }],
  orders: [
    { orderId: 'order-1', orderNumber: 'SO-001', customerName: '一号门店', salespersonId: 'sales-1', salespersonName: '销售一', saleType: 'new', points: '100', gmv: '8800', countedAt: '2026-07-18T08:00:00Z', status: 'counted' },
    { orderId: 'order-2', orderNumber: 'SO-002', customerName: '二号门店', salespersonId: 'sales-1', salespersonName: '销售一', saleType: 'renewal', points: 0, gmv: 0, countedAt: '2026-07-18T09:00:00Z', status: 'reversed' },
    { orderId: 'order-3', orderNumber: 'SO-003', customerName: '三号门店', salespersonId: 'sales-1', salespersonName: '销售一', saleType: 'renewal', points: '20.5', gmv: '2200', countedAt: '2026-07-18T10:00:00Z', status: 'restored' },
  ],
}

const snapshot = mapPerformanceCenterSnapshot(raw)
assert.equal(snapshot.viewer.selectedProfileId, null)
assert.deepEqual(snapshot.summary.points, { target: 3600, actual: 120.5 })
assert.equal(snapshot.members[0]?.newGmv, 8800)
assert.equal(snapshot.members[0]?.pointsTarget, 1000)
assert.equal(snapshot.products[0]?.catalogItemId, null)
assert.deepEqual(snapshot.orders.map((order) => order.status), ['counted', 'reversed', 'restored'])
assert.deepEqual(snapshot.orders.map((order) => order.saleType), ['new', 'renewal', 'renewal'])
assert.deepEqual(snapshot.orders.map((order) => order.salespersonId), ['sales-1', 'sales-1', 'sales-1'])

const personalRaw = {
  ...raw,
  viewer: { ...raw.viewer, requestedScope: 'personal', effectiveScope: 'personal', selectedProfileId: 'sales-1' },
}
const personal = mapPerformanceCenterSnapshot(personalRaw)
assert.equal(personal.viewer.selectedProfileId, 'sales-1')

const managerFallback = mapPerformanceCenterSnapshot({
  ...raw,
  viewer: { ...raw.viewer, requestedScope: 'personal', effectiveScope: 'team', selectedProfileId: null },
})
assert.equal(managerFallback.viewer.requestedScope, 'personal')
assert.equal(managerFallback.viewer.effectiveScope, 'team')
assert.equal(managerFallback.viewer.selectedProfileId, null)
assert.equal(managerFallback.members[0]?.profileId, 'sales-1')

assert.throws(
  () => mapPerformanceCenterSnapshot({ ...raw, orders: [{ ...raw.orders[0], status: 'qualified' }] }),
  (error: unknown) => error instanceof PerformanceCenterDataError && error.message.includes('orders[0].status'),
)

assert.throws(
  () => mapPerformanceCenterSnapshot({ ...raw, viewer: { ...raw.viewer, requestedScope: 'personal', effectiveScope: 'personal' } }),
  (error: unknown) => error instanceof PerformanceCenterDataError && error.message.includes('selectedProfileId'),
)

const calls: Array<{ name: string; args: Record<string, unknown> }> = []
const successfulClient = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args })
    return { data: args.p_scope === 'personal' ? personalRaw : raw, error: null }
  },
} as unknown as SupabaseClient
const source = createSupabasePerformanceCenterDataSource(successfulClient)
await source.loadSnapshot({ quarterStart: '2026-07-01', scope: 'personal', profileId: 'sales-1' })
await source.loadSnapshot({ quarterStart: '2026-07-01', scope: 'team' })
assert.deepEqual(calls, [
  {
    name: 'get_performance_center_snapshot',
    args: { p_quarter_start: '2026-07-01', p_scope: 'personal', p_profile_id: 'sales-1' },
  },
  {
    name: 'get_performance_center_snapshot',
    args: { p_quarter_start: '2026-07-01', p_scope: 'team', p_profile_id: null },
  },
])

const rpcErrorSource = createSupabasePerformanceCenterDataSource({
  rpc: async () => ({ data: null, error: { message: 'PERFORMANCE_FORBIDDEN', code: '42501' } }),
} as unknown as SupabaseClient)
await assert.rejects(
  () => rpcErrorSource.loadSnapshot({ quarterStart: '2026-07-01', scope: 'personal' }),
  (error: unknown) => error instanceof PerformanceCenterDataError
    && error.code === '42501'
    && error.message.includes('PERFORMANCE_FORBIDDEN'),
)

const malformedSource = createSupabasePerformanceCenterDataSource({
  rpc: async () => ({ data: { ...raw, members: null }, error: null }),
} as unknown as SupabaseClient)
await assert.rejects(
  () => malformedSource.loadSnapshot({ quarterStart: '2026-07-01', scope: 'team' }),
  (error: unknown) => error instanceof PerformanceCenterDataError
    && error.code === 'INVALID_SNAPSHOT'
    && error.message.includes('members'),
)

console.log('performance-center mapping: OK')
