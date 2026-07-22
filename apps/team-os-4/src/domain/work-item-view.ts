import { PRIMARY_ROLES, type PrimaryRole } from '../../../../packages/team-os-4-domain/src/roles.ts'
import {
  WORK_ITEM_STATUSES,
  compareWorkItemStableSortKeys,
  type RankedWorkItem,
  type WorkItemPage,
  type WorkItemStatus,
} from '../../../../packages/team-os-4-domain/src/work-item.ts'

export interface WorkItemFilterState {
  readonly search: string
  readonly statuses: readonly WorkItemStatus[]
  readonly roleTypes: readonly PrimaryRole[]
}

export interface SavedWorkItemView {
  readonly id: string
  readonly name: string
  readonly filters: WorkItemFilterState
}

export const EMPTY_WORK_ITEM_FILTERS: WorkItemFilterState = Object.freeze({
  search: '',
  statuses: Object.freeze([]),
  roleTypes: Object.freeze([]),
})

function uniqueInContractOrder<T extends string>(values: readonly T[], contract: readonly T[]): readonly T[] {
  const selected = new Set(values)
  return Object.freeze(contract.filter((value) => selected.has(value)))
}

export function normalizeWorkItemFilters(filters: WorkItemFilterState): WorkItemFilterState {
  return Object.freeze({
    search: filters.search.trim().slice(0, 120),
    statuses: uniqueInContractOrder(filters.statuses, WORK_ITEM_STATUSES),
    roleTypes: uniqueInContractOrder(filters.roleTypes, PRIMARY_ROLES),
  })
}

export function workItemFilterKey(filters: WorkItemFilterState): string {
  const normalized = normalizeWorkItemFilters(filters)
  return JSON.stringify([normalized.search, normalized.statuses, normalized.roleTypes])
}

export function appendServerOrderedWorkItems(
  existing: readonly RankedWorkItem[],
  incomingPage: WorkItemPage,
): readonly RankedWorkItem[] {
  const existingIds = new Set(existing.map(({ id }) => id))
  if (incomingPage.items.some(({ id }) => existingIds.has(id))) {
    throw new Error('WORK_ITEM_PAGE_DUPLICATE_ID')
  }
  const previousTail = existing[existing.length - 1]
  const incomingHead = incomingPage.items[0]
  if (previousTail && incomingHead && compareWorkItemStableSortKeys(previousTail.sortKey, incomingHead.sortKey) > 0) {
    throw new Error('WORK_ITEM_PAGE_ORDER_INVALID')
  }
  return Object.freeze([...existing, ...incomingPage.items])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

export function parseSavedWorkItemViews(serialized: string | null): readonly SavedWorkItemView[] {
  if (!serialized) return Object.freeze([])
  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!Array.isArray(parsed)) return Object.freeze([])
    const views = parsed.flatMap((entry): SavedWorkItemView[] => {
      if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string' || !isRecord(entry.filters)) return []
      if (typeof entry.filters.search !== 'string' || !isStringArray(entry.filters.statuses) || !isStringArray(entry.filters.roleTypes)) return []
      const statuses = entry.filters.statuses.filter((status): status is WorkItemStatus => (WORK_ITEM_STATUSES as readonly string[]).includes(status))
      const roleTypes = entry.filters.roleTypes.filter((role): role is PrimaryRole => (PRIMARY_ROLES as readonly string[]).includes(role))
      const name = entry.name.trim().slice(0, 40)
      if (!entry.id.trim() || !name) return []
      return [{ id: entry.id, name, filters: normalizeWorkItemFilters({ search: entry.filters.search, statuses, roleTypes }) }]
    })
    return Object.freeze(views.slice(0, 20))
  } catch {
    return Object.freeze([])
  }
}

export function serializeSavedWorkItemViews(views: readonly SavedWorkItemView[]): string {
  return JSON.stringify(views.slice(0, 20).map((view) => ({
    id: view.id,
    name: view.name,
    filters: normalizeWorkItemFilters(view.filters),
  })))
}
