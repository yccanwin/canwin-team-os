import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { TimelineEvent } from '@/types'
import {
  resolveMediaUrls,
  resolveStorageAttachments,
  resolveStoredAttachments,
  resolveStoredMediaUrls,
} from '@/services/storage'

type TimelineRow = {
  id: string
  title: string
  event_date: string
  category: TimelineEvent['category'] | null
  description: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

type TimelineMeta = Pick<TimelineEvent, 'description' | 'images' | 'attachments' | 'participants'>

const TIMELINE_SELECT = 'id, title, event_date, category, description, created_by, created_at, updated_at'

function parseMeta(description: string | null): Partial<TimelineMeta> {
  if (!description) return {}
  try {
    const parsed = JSON.parse(description) as Partial<TimelineMeta>
    return parsed && typeof parsed === 'object' ? parsed : { description }
  } catch {
    return { description }
  }
}

function rowToTimelineEvent(row: TimelineRow): TimelineEvent {
  const meta = parseMeta(row.description)
  return {
    id: row.id,
    title: row.title,
    date: row.event_date,
    description: meta.description,
    images: meta.images ?? [],
    attachments: meta.attachments ?? [],
    participants: meta.participants ?? [],
    category: row.category ?? 'other',
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function timelineEventToRow(event: Omit<TimelineEvent, 'id' | 'createdAt'> | Partial<TimelineEvent>) {
  const meta = {
    description: event.description,
    images: event.images ?? [],
    attachments: event.attachments ?? [],
    participants: event.participants ?? [],
  }

  return {
    title: event.title,
    event_date: event.date,
    category: event.category,
    description:
      event.description !== undefined ||
      event.images !== undefined ||
      event.attachments !== undefined ||
      event.participants !== undefined
        ? JSON.stringify(meta)
        : undefined,
  }
}

export async function loadTimelineEvents(): Promise<TimelineEvent[]> {
  const { data, error } = await supabase
    .from('timeline_events')
    .select(TIMELINE_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('event_date', { ascending: false })

  if (error) throw new Error(error.message)
  return Promise.all((data ?? []).map(async (row) => {
    const event = rowToTimelineEvent(row as TimelineRow)
    return {
      ...event,
      images: (await resolveStoredMediaUrls(event.images)) || event.images,
      attachments: (await resolveStoredAttachments(event.attachments)) || event.attachments,
    }
  }))
}

export async function createTimelineEvent(event: Omit<TimelineEvent, 'id' | 'createdAt'>): Promise<TimelineEvent> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)

  const { data, error } = await supabase
    .from('timeline_events')
    .insert({
      ...timelineEventToRow({
        ...event,
        images: (await resolveMediaUrls(event.images, 'timeline')) || event.images,
        attachments:
          (await resolveStorageAttachments(event.attachments, 'timeline/attachments')) ||
          event.attachments,
      }),
      team_id: CANWIN_TEAM_ID,
      created_by: userData.user.id,
    })
    .select(TIMELINE_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToTimelineEvent(data as TimelineRow)
}

export async function updateTimelineEventRecord(
  id: string,
  updates: Partial<TimelineEvent>
): Promise<TimelineEvent> {
  const { data: existing, error: existingError } = await supabase
    .from('timeline_events')
    .select('description')
    .eq('id', id)
    .single()
  if (existingError) throw new Error(existingError.message)

  const previous = parseMeta(existing.description)
  const storedUpdates = {
    ...updates,
    ...(updates.images !== undefined
      ? { images: (await resolveMediaUrls(updates.images, 'timeline')) || updates.images }
      : {}),
    ...(updates.attachments !== undefined
      ? {
          attachments:
            (await resolveStorageAttachments(updates.attachments, 'timeline/attachments')) ||
            updates.attachments,
        }
      : {}),
  }
  const row = timelineEventToRow({ ...previous, ...storedUpdates })
  const { data, error } = await supabase
    .from('timeline_events')
    .update(row)
    .eq('id', id)
    .select(TIMELINE_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToTimelineEvent(data as TimelineRow)
}

export async function deleteTimelineEventRecord(id: string): Promise<void> {
  const { error } = await supabase.from('timeline_events').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
