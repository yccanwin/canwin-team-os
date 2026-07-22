import { mapWorkItemRow } from '../domain/map-work-item-row'
import type { WorkItem } from '../domain/work-item'
import type { WorkItemQuery, WorkItemReader } from '../domain/work-item-query'
import { getGreenfieldSupabase } from './supabase'

const WORK_ITEM_COLUMNS = [
  'id', 'company_id', 'source_business', 'source_id', 'role_type', 'assignee_id',
  'kind', 'priority', 'status', 'planned_at', 'due_at', 'next_step', 'blocked_reason',
  'generation_rule', 'completed_at',
].join(',')

export class SupabaseWorkItemReader implements WorkItemReader {
  async load(query: WorkItemQuery): Promise<readonly WorkItem[]> {
    let request = getGreenfieldSupabase()
      .from('work_items')
      .select(WORK_ITEM_COLUMNS)
      .eq('company_id', query.companyId)
      .eq('assignee_id', query.assigneeId)

    if (query.signal) request = request.abortSignal(query.signal)
    const result = await request
    if (result.error) throw new Error(`WORK_ITEM_QUERY_FAILED:${result.error.code ?? 'UNKNOWN'}`)
    if (!Array.isArray(result.data)) throw new Error('WORK_ITEM_QUERY_INVALID_RESPONSE')
    return Object.freeze(result.data.map(mapWorkItemRow))
  }
}
