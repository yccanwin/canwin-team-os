import type { WorkItemPage, WorkItemPageRequest } from './work-item'

export interface WorkItemQuery extends Omit<WorkItemPageRequest, 'assigneeId'> {
  readonly assigneeId: string
  readonly signal?: AbortSignal
}

/** One read boundary shared by workbench, progress and calendar. */
export interface WorkItemReader {
  load(query: WorkItemQuery): Promise<WorkItemPage>
}
