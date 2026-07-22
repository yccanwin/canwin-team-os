import {
  WORK_ITEM_PRIORITY_RANK,
  WORK_ITEM_SORT_BUCKET_RANK,
  WORK_ITEM_SORT_BUCKETS,
} from '../../../../packages/team-os-4-domain/src/work-item.ts'
import { isPrimaryRole } from '../../../../packages/team-os-4-domain/src/roles.ts'
import type {
  RankedWorkItem,
  WorkItem,
  WorkItemCursor,
  WorkItemKind,
  WorkItemPage,
  WorkItemPriority,
  WorkItemSortBucket,
  WorkItemStatus,
} from './work-item'

const KINDS = new Set<WorkItemKind>(['reminder', 'business_action'])
const PRIORITIES = new Set<WorkItemPriority>(['urgent', 'high', 'normal', 'low'])
const STATUSES = new Set<WorkItemStatus>(['pending', 'in_progress', 'waiting', 'completed', 'cancelled'])

function rowObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('WORK_ITEM_ROW_INVALID')
  return value as Record<string, unknown>
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`WORK_ITEM_FIELD_INVALID:${key}`)
  return value
}

function nullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  if (value === null) return null
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`WORK_ITEM_FIELD_INVALID:${key}`)
  return value
}

function nullableTimestamp(row: Record<string, unknown>, key: string): string | null {
  const value = nullableString(row, key)
  if (value !== null && !Number.isFinite(Date.parse(value))) throw new Error(`WORK_ITEM_FIELD_INVALID:${key}`)
  return value
}

function requiredInteger(row: Record<string, unknown>, key: string, minimum: number, maximum: number): number {
  const value = row[key]
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`WORK_ITEM_FIELD_INVALID:${key}`)
  }
  return value as number
}

function requiredTimestamp(row: Record<string, unknown>, key: string): string {
  const value = requiredString(row, key)
  if (!Number.isFinite(Date.parse(value))) throw new Error(`WORK_ITEM_FIELD_INVALID:${key}`)
  return value
}

export function mapWorkItemRow(value: unknown): WorkItem {
  const row = rowObject(value)
  const role = requiredString(row, 'role_type')
  const kind = requiredString(row, 'kind')
  const priority = requiredString(row, 'priority')
  const status = requiredString(row, 'status')
  if (!isPrimaryRole(role)) throw new Error('WORK_ITEM_FIELD_INVALID:role_type')
  if (!KINDS.has(kind as WorkItemKind)) throw new Error('WORK_ITEM_FIELD_INVALID:kind')
  if (!PRIORITIES.has(priority as WorkItemPriority)) throw new Error('WORK_ITEM_FIELD_INVALID:priority')
  if (!STATUSES.has(status as WorkItemStatus)) throw new Error('WORK_ITEM_FIELD_INVALID:status')

  return Object.freeze({
    id: requiredString(row, 'id'),
    companyId: requiredString(row, 'company_id'),
    sourceBusiness: requiredString(row, 'source_business'),
    sourceRecordId: requiredString(row, 'source_id'),
    role,
    assigneeId: requiredString(row, 'assignee_id'),
    kind: kind as WorkItemKind,
    title: requiredString(row, 'title'),
    priority: priority as WorkItemPriority,
    status: status as WorkItemStatus,
    plannedAt: nullableTimestamp(row, 'planned_at'),
    dueAt: nullableTimestamp(row, 'due_at'),
    nextStep: requiredString(row, 'next_step'),
    blockedReason: nullableString(row, 'blocked_reason'),
    generationRule: requiredString(row, 'generation_rule'),
    completedAt: nullableTimestamp(row, 'completed_at'),
  })
}

export function mapRankedWorkItemRow(value: unknown): RankedWorkItem {
  const row = rowObject(value)
  const item = mapWorkItemRow(row)
  const sortBucket = requiredString(row, 'sort_bucket')
  if (!(WORK_ITEM_SORT_BUCKETS as readonly string[]).includes(sortBucket)) {
    throw new Error('WORK_ITEM_FIELD_INVALID:sort_bucket')
  }
  const sortRank = requiredInteger(row, 'sort_rank', 1, 7) as RankedWorkItem['sortKey']['sortRank']
  const waitingRank = requiredInteger(row, 'waiting_rank', 0, 1) as RankedWorkItem['sortKey']['waitingRank']
  const priorityRank = requiredInteger(row, 'priority_rank', 1, 4) as RankedWorkItem['sortKey']['priorityRank']
  if (WORK_ITEM_SORT_BUCKET_RANK[sortBucket as WorkItemSortBucket] !== sortRank ||
      (item.status === 'waiting' ? waitingRank !== 0 : waitingRank !== 1) ||
      WORK_ITEM_PRIORITY_RANK[item.priority] !== priorityRank) {
    throw new Error('WORK_ITEM_FIELD_INVALID:server_sort_contract')
  }
  return Object.freeze({
    ...item,
    sortBucket: sortBucket as WorkItemSortBucket,
    sortKey: Object.freeze({
      sortRank,
      waitingRank,
      sortAt: requiredTimestamp(row, 'sort_at'),
      priorityRank,
      id: item.id,
    }),
  })
}

function mapWorkItemCursor(value: unknown): WorkItemCursor | null {
  if (value === null) return null
  const row = rowObject(value)
  return Object.freeze({
    sortRank: requiredInteger(row, 'sort_rank', 1, 7) as WorkItemCursor['sortRank'],
    waitingRank: requiredInteger(row, 'waiting_rank', 0, 1) as WorkItemCursor['waitingRank'],
    sortAt: requiredTimestamp(row, 'sort_at'),
    priorityRank: requiredInteger(row, 'priority_rank', 1, 4) as WorkItemCursor['priorityRank'],
    id: requiredString(row, 'id'),
  })
}

export function mapWorkItemPage(value: unknown): WorkItemPage {
  const row = rowObject(value)
  if (!Array.isArray(row.items)) throw new Error('WORK_ITEM_PAGE_INVALID:items')
  return Object.freeze({
    ordering: 'server-authoritative',
    items: Object.freeze(row.items.map(mapRankedWorkItemRow)),
    nextCursor: mapWorkItemCursor(row.next_cursor),
  })
}
