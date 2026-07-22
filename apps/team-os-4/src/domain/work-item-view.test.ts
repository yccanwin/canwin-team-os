import { strict as assert } from 'node:assert'
import type { RankedWorkItem, WorkItemPage } from './work-item.ts'
import {
  appendServerOrderedWorkItems,
  normalizeWorkItemFilters,
  parseSavedWorkItemViews,
  serializeSavedWorkItemViews,
  workItemFilterKey,
  type SavedWorkItemView,
} from './work-item-view.ts'

const item = (id: string, rank: RankedWorkItem['sortKey']['sortRank']): RankedWorkItem => ({
  id,
  companyId: 'company',
  sourceBusiness: 'reminder',
  sourceRecordId: `source-${id}`,
  role: 'sales',
  assigneeId: 'user',
  kind: 'reminder',
  title: `Task ${id}`,
  priority: 'normal',
  status: 'pending',
  plannedAt: null,
  dueAt: '2026-07-22T10:00:00.000Z',
  nextStep: `Next ${id}`,
  blockedReason: null,
  generationRule: 'test',
  completedAt: null,
  sortBucket: rank === 1 ? 'overdue_blocking' : 'due_today',
  sortKey: { sortRank: rank, waitingRank: 1, sortAt: '2026-07-22T10:00:00.000Z', priorityRank: 3, id },
})
const page = (items: readonly RankedWorkItem[]): WorkItemPage => ({ ordering: 'server-authoritative', items, nextCursor: null })

const normalized = normalizeWorkItemFilters({
  search: '  客户 A  ',
  statuses: ['completed', 'pending', 'completed'],
  roleTypes: ['admin', 'sales', 'admin'],
})
assert.deepEqual(normalized, { search: '客户 A', statuses: ['pending', 'completed'], roleTypes: ['sales', 'admin'] })
assert.equal(workItemFilterKey(normalized), workItemFilterKey({ ...normalized, statuses: ['completed', 'pending'] }))

const merged = appendServerOrderedWorkItems([item('a', 1)], page([item('b', 1), item('c', 2)]))
assert.deepEqual(merged.map(({ id }) => id), ['a', 'b', 'c'], 'pagination must append without client sorting')
assert.throws(() => appendServerOrderedWorkItems(merged, page([item('b', 2)])), /DUPLICATE_ID/)
assert.throws(() => appendServerOrderedWorkItems([item('z', 2)], page([item('a', 1)])), /ORDER_INVALID/)

const saved: readonly SavedWorkItemView[] = [{ id: 'view-1', name: '待处理', filters: normalized }]
assert.deepEqual(parseSavedWorkItemViews(serializeSavedWorkItemViews(saved)), saved)
assert.deepEqual(parseSavedWorkItemViews('{bad json'), [])

console.log('TEAM_OS_4_WORK_ITEM_VIEW_OK filters=combined savedViews=validated pagination=server-order-preserved')
