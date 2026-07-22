import type { WorkItem, WorkItemSelection } from './work-item'

const OPEN_STATUSES = new Set<WorkItem['status']>(['pending', 'in_progress', 'waiting'])

/** Derives every G2 surface from one caller-owned work-item collection. */
export function selectWorkItems(
  items: readonly WorkItem[],
  selection: WorkItemSelection,
): readonly WorkItem[] {
  const now = Date.parse(selection.now)
  return [...items
    .filter((item) => item.assigneeId === selection.assigneeId)
    .filter((item) => {
      if (selection.surface === 'progress') return true
      if (selection.surface === 'calendar') return item.plannedAt !== null || item.dueAt !== null
      if (!OPEN_STATUSES.has(item.status)) return false
      const planned = item.plannedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(item.plannedAt)
      const due = item.dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(item.dueAt)
      return planned <= now || due <= now
    })]
    .sort((left, right) => {
      const leftTime = Date.parse(left.dueAt ?? left.plannedAt ?? '9999-12-31T23:59:59.999Z')
      const rightTime = Date.parse(right.dueAt ?? right.plannedAt ?? '9999-12-31T23:59:59.999Z')
      return leftTime - rightTime || left.id.localeCompare(right.id)
    })
}
