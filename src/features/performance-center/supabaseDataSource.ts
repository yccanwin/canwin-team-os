import type { SupabaseClient } from '@supabase/supabase-js'
import type { PerformanceCenterDataSource } from './dataSource'
import type {
  ContributionOrder,
  PerformanceCenterSnapshot,
  PerformanceEventStatus,
  PerformanceMember,
  PerformanceMetric,
  PerformanceSaleType,
  PerformanceScope,
  PerformanceViewer,
  ProductContribution,
} from './types'

type JsonRecord = Record<string, unknown>

export class PerformanceCenterDataError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'PerformanceCenterDataError'
    this.code = code
  }
}

function record(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PerformanceCenterDataError(`${path} 格式无效`)
  return value as JsonRecord
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new PerformanceCenterDataError(`${path} 必须是数组`)
  return value
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new PerformanceCenterDataError(`${path} 缺失`)
  return value
}

function nullableText(value: unknown, path: string): string | null {
  if (value === null) return null
  return text(value, path)
}

function numeric(value: unknown, path: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) throw new PerformanceCenterDataError(`${path} 不是有效数字`)
  return parsed
}

function metric(value: unknown, path: string): PerformanceMetric {
  const item = record(value, path)
  return { target: numeric(item.target, `${path}.target`), actual: numeric(item.actual, `${path}.actual`) }
}

function scope(value: unknown, path: string): PerformanceScope {
  if (value === 'personal' || value === 'team') return value
  throw new PerformanceCenterDataError(`${path} 必须是 personal 或 team`)
}

function viewer(value: unknown): PerformanceViewer {
  const item = record(value, 'viewer')
  if (typeof item.canManageTargets !== 'boolean') throw new PerformanceCenterDataError('viewer.canManageTargets 必须是布尔值')
  const requestedScope = scope(item.requestedScope, 'viewer.requestedScope')
  const effectiveScope = scope(item.effectiveScope, 'viewer.effectiveScope')
  const selectedProfileId = nullableText(item.selectedProfileId, 'viewer.selectedProfileId')
  if (effectiveScope === 'personal' && selectedProfileId === null) {
    throw new PerformanceCenterDataError('viewer.selectedProfileId 在个人范围内不能为空')
  }
  if (effectiveScope === 'team' && selectedProfileId !== null) {
    throw new PerformanceCenterDataError('viewer.selectedProfileId 在团队范围内必须为空')
  }
  return {
    profileId: text(item.profileId, 'viewer.profileId'),
    teamId: text(item.teamId, 'viewer.teamId'),
    requestedScope,
    effectiveScope,
    selectedProfileId,
    canManageTargets: item.canManageTargets,
  }
}

function member(value: unknown, index: number): PerformanceMember {
  const path = `members[${index}]`
  const item = record(value, path)
  if (typeof item.canSetTarget !== 'boolean') throw new PerformanceCenterDataError(`${path}.canSetTarget 必须是布尔值`)
  return {
    profileId: text(item.profileId, `${path}.profileId`),
    profileName: text(item.profileName, `${path}.profileName`),
    points: numeric(item.points, `${path}.points`),
    newGmv: numeric(item.newGmv, `${path}.newGmv`),
    renewalGmv: numeric(item.renewalGmv, `${path}.renewalGmv`),
    pointsTarget: numeric(item.pointsTarget, `${path}.pointsTarget`),
    newGmvTarget: numeric(item.newGmvTarget, `${path}.newGmvTarget`),
    renewalGmvTarget: numeric(item.renewalGmvTarget, `${path}.renewalGmvTarget`),
    canSetTarget: item.canSetTarget,
  }
}

function product(value: unknown, index: number): ProductContribution {
  const path = `products[${index}]`
  const item = record(value, path)
  return {
    catalogItemId: nullableText(item.catalogItemId, `${path}.catalogItemId`),
    productName: text(item.productName, `${path}.productName`),
    orderCount: numeric(item.orderCount, `${path}.orderCount`),
    quantity: numeric(item.quantity, `${path}.quantity`),
    points: numeric(item.points, `${path}.points`),
    gmv: numeric(item.gmv, `${path}.gmv`),
  }
}

function saleType(value: unknown, path: string): PerformanceSaleType {
  if (value === 'new' || value === 'renewal') return value
  throw new PerformanceCenterDataError(`${path} 必须是 new 或 renewal`)
}

function eventStatus(value: unknown, path: string): PerformanceEventStatus {
  if (value === 'counted' || value === 'reversed' || value === 'restored') return value
  throw new PerformanceCenterDataError(`${path} 必须是 counted、reversed 或 restored`)
}

function contributionOrder(value: unknown, index: number): ContributionOrder {
  const path = `orders[${index}]`
  const item = record(value, path)
  return {
    orderId: text(item.orderId, `${path}.orderId`),
    orderNumber: text(item.orderNumber, `${path}.orderNumber`),
    customerName: text(item.customerName, `${path}.customerName`),
    salespersonId: text(item.salespersonId, `${path}.salespersonId`),
    salespersonName: text(item.salespersonName, `${path}.salespersonName`),
    saleType: saleType(item.saleType, `${path}.saleType`),
    points: numeric(item.points, `${path}.points`),
    gmv: numeric(item.gmv, `${path}.gmv`),
    countedAt: text(item.countedAt, `${path}.countedAt`),
    status: eventStatus(item.status, `${path}.status`),
  }
}

export function mapPerformanceCenterSnapshot(value: unknown): PerformanceCenterSnapshot {
  const root = record(value, 'snapshot')
  const summary = record(root.summary, 'summary')
  return {
    viewer: viewer(root.viewer),
    summary: {
      quarterStart: text(summary.quarterStart, 'summary.quarterStart'),
      points: metric(summary.points, 'summary.points'),
      newGmv: metric(summary.newGmv, 'summary.newGmv'),
      renewalGmv: metric(summary.renewalGmv, 'summary.renewalGmv'),
    },
    members: array(root.members, 'members').map(member),
    products: array(root.products, 'products').map(product),
    orders: array(root.orders, 'orders').map(contributionOrder),
  }
}

export function createSupabasePerformanceCenterDataSource(client: SupabaseClient): PerformanceCenterDataSource {
  return {
    async loadSnapshot(query) {
      const { data, error } = await client.rpc('get_performance_center_snapshot', {
        p_quarter_start: query.quarterStart,
        p_scope: query.scope,
        p_profile_id: query.scope === 'personal' ? query.profileId ?? null : null,
      })
      if (error) throw new PerformanceCenterDataError(`读取业绩与积分失败：${error.message}`, error.code)
      if (data === null || data === undefined) throw new PerformanceCenterDataError('读取业绩与积分失败：服务器未返回快照')
      try {
        return mapPerformanceCenterSnapshot(data)
      } catch (caught) {
        if (caught instanceof PerformanceCenterDataError) {
          throw new PerformanceCenterDataError(`读取业绩与积分失败：服务器快照格式异常（${caught.message}）`, 'INVALID_SNAPSHOT')
        }
        throw caught
      }
    },
  }
}
