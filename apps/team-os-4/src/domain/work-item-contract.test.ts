import { strict as assert } from 'node:assert'
import {
  WORK_ITEM_SORT_BUCKETS,
  WORK_ITEM_SORT_BUCKET_RANK,
  canTransitionWorkItemStatus,
  canUseGenericWorkItemCompletion,
  compareWorkItemStableSortKeys,
  isServerOrderedWorkItemPage,
  type RankedWorkItem,
  type WorkItemStableSortKey,
} from '../../../../packages/team-os-4-domain/src/work-item.ts'
import { mapWorkItemPage } from './map-work-item-row.ts'
import { selectWorkItems } from './select-work-items.ts'

assert.deepEqual(WORK_ITEM_SORT_BUCKETS, [
  'overdue_blocking',
  'due_today',
  'upcoming_business_date',
  'first_contact',
  'reclaim_soon',
  'renewal',
  'normal',
])
assert.deepEqual(Object.values(WORK_ITEM_SORT_BUCKET_RANK), [1, 2, 3, 4, 5, 6, 7])
assert.equal(canTransitionWorkItemStatus('pending', 'in_progress'), true)
assert.equal(canTransitionWorkItemStatus('waiting', 'in_progress'), true)
assert.equal(canTransitionWorkItemStatus('completed', 'in_progress'), false)
assert.equal(canUseGenericWorkItemCompletion('reminder'), true)
assert.equal(canUseGenericWorkItemCompletion('business_action'), false)

const key = (sortRank: WorkItemStableSortKey['sortRank'], id: string): WorkItemStableSortKey => ({
  sortRank,
  waitingRank: 1,
  sortAt: '2026-07-22T10:00:00.000Z',
  priorityRank: 1,
  id,
})
assert.ok(compareWorkItemStableSortKeys(key(1, 'a'), key(2, 'a')) < 0)
assert.ok(compareWorkItemStableSortKeys(key(1, 'a'), key(1, 'b')) < 0)
assert.ok(compareWorkItemStableSortKeys(
  { ...key(1, 'a'), waitingRank: 0 },
  { ...key(1, 'a'), waitingRank: 1 },
) < 0)

const item = (id: string, sortRank: WorkItemStableSortKey['sortRank'], status: RankedWorkItem['status']): RankedWorkItem => ({
  id,
  companyId: 'company',
  sourceBusiness: 'ordinary',
  sourceRecordId: `source-${id}`,
  role: 'sales',
  assigneeId: 'user',
  kind: 'reminder',
  title: `Task ${id}`,
  priority: 'urgent',
  status,
  plannedAt: '2026-07-22T09:00:00.000Z',
  dueAt: '2026-07-22T10:00:00.000Z',
  nextStep: 'Continue',
  blockedReason: null,
  generationRule: 'test',
  completedAt: status === 'completed' ? '2026-07-22T10:00:00.000Z' : null,
  sortBucket: WORK_ITEM_SORT_BUCKETS[sortRank - 1],
  sortKey: key(sortRank, id),
})

const serverPage = {
  ordering: 'server-authoritative' as const,
  items: [item('b', 1, 'pending'), item('a', 2, 'completed')],
  nextCursor: null,
}
assert.equal(isServerOrderedWorkItemPage(serverPage), true)
assert.deepEqual(
  selectWorkItems(serverPage.items, { surface: 'progress', assigneeId: 'user', now: '2026-07-22T12:00:00.000Z' }).map(({ id }) => id),
  ['b', 'a'],
  'client selection must preserve server authority order',
)
assert.equal(isServerOrderedWorkItemPage({ ...serverPage, items: [...serverPage.items].reverse() }), false)

const mappedPage = mapWorkItemPage({
  items: serverPage.items.map((entry) => ({
    id: entry.id,
    company_id: entry.companyId,
    source_business: entry.sourceBusiness,
    source_id: entry.sourceRecordId,
    role_type: entry.role,
    assignee_id: entry.assigneeId,
    kind: entry.kind,
    title: entry.title,
    priority: entry.priority,
    status: entry.status,
    planned_at: entry.plannedAt,
    due_at: entry.dueAt,
    next_step: entry.nextStep,
    blocked_reason: entry.blockedReason,
    generation_rule: entry.generationRule,
    completed_at: entry.completedAt,
    sort_bucket: entry.sortBucket,
    sort_rank: entry.sortKey.sortRank,
    waiting_rank: entry.sortKey.waitingRank,
    sort_at: entry.sortKey.sortAt,
    priority_rank: entry.sortKey.priorityRank,
  })),
  next_cursor: { sort_rank: 2, waiting_rank: 1, sort_at: '2026-07-22T10:00:00.000Z', priority_rank: 1, id: 'a' },
})
assert.equal(mappedPage.ordering, 'server-authoritative')
assert.deepEqual(mappedPage.items.map(({ id }) => id), ['b', 'a'])
assert.deepEqual(mappedPage.nextCursor, { sortRank: 2, waitingRank: 1, sortAt: '2026-07-22T10:00:00.000Z', priorityRank: 1, id: 'a' })

console.log('TEAM_OS_4_WORK_ITEM_CONTRACT_OK buckets=7 stateMachine=passed genericBusinessCompletion=denied serverOrder=preserved')
