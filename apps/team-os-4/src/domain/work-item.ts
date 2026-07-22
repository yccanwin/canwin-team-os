export type {
  RankedWorkItem,
  WorkItem,
  WorkItemCursor,
  WorkItemKind,
  WorkItemPage,
  WorkItemPageRequest,
  WorkItemPriority,
  WorkItemSortBucket,
  WorkItemStableSortKey,
  WorkItemStatus,
} from '../../../../packages/team-os-4-domain/src/index'

export type WorkItemSurface = 'workbench' | 'progress' | 'calendar'

export interface WorkItemSelection {
  readonly surface: WorkItemSurface
  readonly assigneeId: string
  readonly now: string
}
