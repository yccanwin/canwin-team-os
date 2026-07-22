import type { ScheduleEvent, ScheduleEventKind } from './schedule-event'

const KINDS = new Set<ScheduleEventKind>(['meeting', 'visit', 'break', 'personal'])
const objectRow = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('SCHEDULE_EVENT_ROW_INVALID')
  return value as Record<string, unknown>
}
const text = (row: Record<string, unknown>, key: string): string => {
  const value = row[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`SCHEDULE_EVENT_FIELD_INVALID:${key}`)
  return value
}
const optionalText = (row: Record<string, unknown>, key: string): string | null => row[key] === null ? null : text(row, key)
const timestamp = (row: Record<string, unknown>, key: string): string => {
  const value = text(row, key)
  if (!Number.isFinite(Date.parse(value))) throw new Error(`SCHEDULE_EVENT_FIELD_INVALID:${key}`)
  return value
}

export function mapScheduleEventRow(value: unknown): ScheduleEvent {
  const row = objectRow(value)
  const kind = text(row, 'event_type')
  if (!KINDS.has(kind as ScheduleEventKind)) throw new Error('SCHEDULE_EVENT_FIELD_INVALID:event_type')
  const startsAt = timestamp(row, 'starts_at')
  const endsAt = timestamp(row, 'ends_at')
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('SCHEDULE_EVENT_FIELD_INVALID:ends_at')
  return Object.freeze({
    id: text(row, 'id'), companyId: text(row, 'company_id'), ownerId: text(row, 'owner_id'),
    kind: kind as ScheduleEventKind, title: text(row, 'title'), startsAt, endsAt,
    location: optionalText(row, 'location'), notes: optionalText(row, 'notes'),
    workItemId: optionalText(row, 'work_item_id'),
  })
}
