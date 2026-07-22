import type { WorkItemCommandBody, WorkItemCommandTransport } from '../domain/work-item-command'
import { getGreenfieldSupabase } from './supabase'

/** Browser calls only the trusted JWT-aware service boundary; privileged RPCs stay server-only. */
export class SupabaseWorkItemCommandTransport implements WorkItemCommandTransport {
  async invoke(body: WorkItemCommandBody): Promise<unknown> {
    const result = await getGreenfieldSupabase().functions.invoke('work-item-command', { body })
    if (result.error) throw new Error(`WORK_ITEM_COMMAND_FAILED:${result.error.name ?? 'UNKNOWN'}`)
    return result.data
  }
}
