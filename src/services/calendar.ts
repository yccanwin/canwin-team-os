import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { CalendarEvent } from '@/types/calendar'

type CalendarRow = {
  id: string
  title: string
  event_type: CalendarEvent['type']
  start_at: string
  end_at: string | null
  all_day: boolean
  user_id: string | null
  related_type: string | null
  created_at: string
  profiles?: { name: string } | { name: string }[] | null
}

const CALENDAR_SELECT =
  'id, title, event_type, start_at, end_at, all_day, user_id, related_type, created_at, profiles(name)'

type CalendarMeta = Pick<CalendarEvent, 'description' | 'color'>

function parseMeta(relatedType: string | null): Partial<CalendarMeta> {
  if (!relatedType?.startsWith('canwin:')) return {}
  try {
    const parsed = JSON.parse(relatedType.slice('canwin:'.length)) as Partial<CalendarMeta>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function splitDateTime(value: string | null, allDay: boolean) {
  if (!value) return { date: undefined, time: undefined }
  const date = value.slice(0, 10)
  if (allDay) return { date, time: undefined }
  return { date, time: value.slice(11, 16) }
}

function combineDateTime(date: string, time?: string) {
  return time ? `${date}T${time}:00` : `${date}T00:00:00`
}

function profileName(row: CalendarRow) {
  if (Array.isArray(row.profiles)) return row.profiles[0]?.name || ''
  return row.profiles?.name || ''
}

function rowToCalendarEvent(row: CalendarRow): CalendarEvent {
  const start = splitDateTime(row.start_at, row.all_day)
  const end = splitDateTime(row.end_at, row.all_day)
  const meta = parseMeta(row.related_type)

  return {
    id: row.id,
    title: row.title,
    description: meta.description,
    startDate: start.date || row.start_at.slice(0, 10),
    endDate: end.date,
    startTime: start.time,
    endTime: end.time,
    creatorId: row.user_id || '',
    creatorName: profileName(row),
    color: meta.color,
    createdAt: row.created_at,
    type: row.event_type,
  }
}

function calendarEventToRow(
  event: Omit<CalendarEvent, 'id' | 'createdAt'> | Partial<CalendarEvent>,
  relatedType?: string | null
) {
  const startDate = event.startDate || new Date().toISOString().slice(0, 10)
  const allDay = !event.startTime && !event.endTime
  const hasMetaUpdate = event.description !== undefined || event.color !== undefined
  const nextMeta = hasMetaUpdate
    ? {
        ...parseMeta(relatedType ?? null),
        ...(event.description !== undefined ? { description: event.description } : {}),
        ...(event.color !== undefined ? { color: event.color } : {}),
      }
    : undefined

  return {
    title: event.title,
    event_type: event.type,
    start_at: event.startDate ? combineDateTime(startDate, event.startTime) : undefined,
    end_at: event.endDate ? combineDateTime(event.endDate, event.endTime) : undefined,
    all_day: allDay,
    user_id: event.creatorId,
    related_type: nextMeta ? `canwin:${JSON.stringify(nextMeta)}` : undefined,
  }
}

export async function loadCalendarEvents(): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from('calendar_events')
    .select(CALENDAR_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('start_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => rowToCalendarEvent(row as CalendarRow))
}

export async function createCalendarEvent(event: Omit<CalendarEvent, 'id' | 'createdAt'>): Promise<CalendarEvent> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)

  const { data, error } = await supabase
    .from('calendar_events')
    .insert({
      ...calendarEventToRow(event, null),
      team_id: CANWIN_TEAM_ID,
      created_by: userData.user.id,
    })
    .select(CALENDAR_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToCalendarEvent(data as CalendarRow)
}

export async function updateCalendarEventRecord(
  id: string,
  updates: Partial<CalendarEvent>
): Promise<CalendarEvent> {
  let relatedType: string | null = null
  if (updates.description !== undefined || updates.color !== undefined) {
    const { data, error } = await supabase
      .from('calendar_events')
      .select('related_type')
      .eq('id', id)
      .single()
    if (error) throw new Error(error.message)
    relatedType = data.related_type
  }

  const { data, error } = await supabase
    .from('calendar_events')
    .update(calendarEventToRow(updates, relatedType))
    .eq('id', id)
    .select(CALENDAR_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToCalendarEvent(data as CalendarRow)
}

export async function deleteCalendarEventRecord(id: string): Promise<void> {
  const { error } = await supabase.from('calendar_events').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
