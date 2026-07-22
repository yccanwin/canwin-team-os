import type { PrimaryRole } from './roles.js'

export const WORK_ITEM_KINDS = Object.freeze(['reminder', 'business_action'] as const)
export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number]

export const WORK_ITEM_PRIORITIES = Object.freeze(['urgent', 'high', 'normal', 'low'] as const)
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number]

export const WORK_ITEM_STATUSES = Object.freeze([
  'pending',
  'in_progress',
  'waiting',
  'completed',
  'cancelled',
] as const)
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number]

export const WORK_ITEM_STATE_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['in_progress', 'completed', 'cancelled'] as const),
  in_progress: Object.freeze(['waiting', 'completed', 'cancelled'] as const),
  waiting: Object.freeze(['in_progress', 'completed', 'cancelled'] as const),
  completed: Object.freeze([] as const),
  cancelled: Object.freeze([] as const),
} satisfies Readonly<Record<WorkItemStatus, readonly WorkItemStatus[]>>)

export function canTransitionWorkItemStatus(from: WorkItemStatus, to: WorkItemStatus): boolean {
  return (WORK_ITEM_STATE_TRANSITIONS[from] as readonly WorkItemStatus[]).includes(to)
}

/** Business actions close only inside their owning server transaction. */
export function canUseGenericWorkItemCompletion(kind: WorkItemKind): boolean {
  return kind === 'reminder'
}

export const WORK_ITEM_SORT_BUCKETS = Object.freeze([
  'overdue_blocking',
  'due_today',
  'upcoming_business_date',
  'first_contact',
  'reclaim_soon',
  'renewal',
  'normal',
] as const)
export type WorkItemSortBucket = (typeof WORK_ITEM_SORT_BUCKETS)[number]

export const WORK_ITEM_SORT_BUCKET_RANK = Object.freeze({
  overdue_blocking: 1,
  due_today: 2,
  upcoming_business_date: 3,
  first_contact: 4,
  reclaim_soon: 5,
  renewal: 6,
  normal: 7,
} as const satisfies Readonly<Record<WorkItemSortBucket, 1 | 2 | 3 | 4 | 5 | 6 | 7>>)

export const WORK_ITEM_PRIORITY_RANK = Object.freeze({
  urgent: 1,
  high: 2,
  normal: 3,
  low: 4,
} as const satisfies Readonly<Record<WorkItemPriority, 1 | 2 | 3 | 4>>)

export interface WorkItem {
  readonly id: string
  readonly companyId: string
  readonly sourceBusiness: string
  readonly sourceRecordId: string
  readonly role: PrimaryRole
  readonly assigneeId: string
  readonly kind: WorkItemKind
  readonly title: string
  readonly priority: WorkItemPriority
  readonly status: WorkItemStatus
  readonly plannedAt: string | null
  readonly dueAt: string | null
  readonly nextStep: string
  readonly blockedReason: string | null
  readonly generationRule: string
  readonly completedAt: string | null
}

/** Exact tuple owned by the server for stable keyset ordering. */
export interface WorkItemStableSortKey {
  readonly sortRank: 1 | 2 | 3 | 4 | 5 | 6 | 7
  /** Waiting items sort first inside the same business bucket. */
  readonly waitingRank: 0 | 1
  readonly sortAt: string
  readonly priorityRank: 1 | 2 | 3 | 4
  readonly id: string
}

export interface RankedWorkItem extends WorkItem {
  readonly sortBucket: WorkItemSortBucket
  readonly sortKey: WorkItemStableSortKey
}

export interface WorkItemCursor {
  readonly sortRank: WorkItemStableSortKey['sortRank']
  readonly waitingRank: WorkItemStableSortKey['waitingRank']
  readonly sortAt: string
  readonly priorityRank: WorkItemStableSortKey['priorityRank']
  readonly id: string
  /** Pins every page in one traversal to the same Asia/Shanghai business date. */
  readonly businessDate: string
}

export const WORK_ITEM_PAGE_DEFAULT_LIMIT = 50
export const WORK_ITEM_PAGE_MAX_LIMIT = 100

export interface WorkItemPageRequest {
  readonly companyId: string
  readonly assigneeId: string | null
  readonly statuses?: readonly WorkItemStatus[]
  readonly roleTypes?: readonly PrimaryRole[]
  readonly search?: string | null
  readonly limit?: number
  readonly cursor?: WorkItemCursor | null
  /** Asia/Shanghai business date, formatted as YYYY-MM-DD. */
  readonly businessDate?: string | null
}

/** A page is already ordered by the server; clients must not re-sort it. */
export interface WorkItemPage {
  readonly ordering: 'server-authoritative'
  readonly items: readonly RankedWorkItem[]
  readonly nextCursor: WorkItemCursor | null
}

export function compareWorkItemStableSortKeys(
  left: WorkItemStableSortKey,
  right: WorkItemStableSortKey,
): number {
  return left.sortRank - right.sortRank ||
    left.waitingRank - right.waitingRank ||
    Date.parse(left.sortAt) - Date.parse(right.sortAt) ||
    left.priorityRank - right.priorityRank ||
    left.id.localeCompare(right.id)
}

export function isServerOrderedWorkItemPage(page: WorkItemPage): boolean {
  return page.items.every((item, index) => {
    const previous = page.items[index - 1]
    return previous === undefined || compareWorkItemStableSortKeys(previous.sortKey, item.sortKey) <= 0
  })
}
