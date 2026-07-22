import type { WorkItem } from './work-item'

export interface WorkItemQuery {
  readonly companyId: string
  readonly assigneeId: string
  readonly signal?: AbortSignal
}

/** One read boundary shared by workbench, progress and calendar. */
export interface WorkItemReader {
  load(query: WorkItemQuery): Promise<readonly WorkItem[]>
}
