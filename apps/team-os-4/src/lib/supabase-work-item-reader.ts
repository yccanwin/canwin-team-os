import {
  WORK_ITEM_PAGE_DEFAULT_LIMIT,
  isServerOrderedWorkItemPage,
} from '../../../../packages/team-os-4-domain/src/index'
import { mapWorkItemPage } from '../domain/map-work-item-row'
import type { WorkItemQuery, WorkItemReader } from '../domain/work-item-query'
import { getGreenfieldSupabase } from './supabase'

const BUSINESS_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export class SupabaseWorkItemReader implements WorkItemReader {
  async load(query: WorkItemQuery) {
    const cursor = query.cursor ?? null
    let request = getGreenfieldSupabase()
      .rpc('list_work_items_v1', {
        p_company_id: query.companyId,
        p_assignee_id: query.assigneeId,
        p_statuses: query.statuses ? [...query.statuses] : null,
        p_role_types: query.roleTypes ? [...query.roleTypes] : null,
        p_search: query.search?.trim() || null,
        p_limit: query.limit ?? WORK_ITEM_PAGE_DEFAULT_LIMIT,
        p_cursor_rank: cursor?.sortRank ?? null,
        p_cursor_waiting_rank: cursor?.waitingRank ?? null,
        p_cursor_sort_at: cursor?.sortAt ?? null,
        p_cursor_priority_rank: cursor?.priorityRank ?? null,
        p_cursor_id: cursor?.id ?? null,
        p_business_date: query.businessDate ?? BUSINESS_DATE.format(new Date()),
      })

    if (query.signal) request = request.abortSignal(query.signal)
    const result = await request
    if (result.error) throw new Error(`WORK_ITEM_QUERY_FAILED:${result.error.code ?? 'UNKNOWN'}`)
    const page = mapWorkItemPage(result.data)
    if (!isServerOrderedWorkItemPage(page)) throw new Error('WORK_ITEM_QUERY_INVALID_SERVER_ORDER')
    return page
  }
}
