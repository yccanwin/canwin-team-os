import { mapScheduleEventRow } from '../domain/map-schedule-event-row'
import type { ScheduleEvent, ScheduleEventQuery, ScheduleEventReader } from '../domain/schedule-event'
import { getGreenfieldSupabase } from './supabase'
const COLUMNS = 'id,company_id,owner_id,event_type,title,starts_at,ends_at,location,notes,work_item_id'
export class SupabaseScheduleEventReader implements ScheduleEventReader { async load(query: ScheduleEventQuery): Promise<readonly ScheduleEvent[]> { let request = getGreenfieldSupabase().from('schedule_events').select(COLUMNS).eq('company_id', query.companyId).eq('owner_id', query.ownerId).order('starts_at'); if (query.signal) request = request.abortSignal(query.signal); const result = await request; if (result.error) throw new Error(`SCHEDULE_EVENT_QUERY_FAILED:${result.error.code ?? 'UNKNOWN'}`); if (!Array.isArray(result.data)) throw new Error('SCHEDULE_EVENT_QUERY_INVALID_RESPONSE'); return Object.freeze(result.data.map(mapScheduleEventRow)) } }
