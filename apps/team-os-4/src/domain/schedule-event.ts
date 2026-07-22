export type ScheduleEventKind = 'meeting' | 'visit' | 'break' | 'personal'

export interface ScheduleEvent {
  readonly id: string
  readonly companyId: string
  readonly ownerId: string
  readonly kind: ScheduleEventKind
  readonly title: string
  readonly startsAt: string
  readonly endsAt: string
  readonly location: string | null
  readonly notes: string | null
  readonly workItemId: string | null
}

export interface ScheduleEventQuery {
  readonly companyId: string
  readonly ownerId: string
  readonly signal?: AbortSignal
}

export interface ScheduleEventReader {
  load(query: ScheduleEventQuery): Promise<readonly ScheduleEvent[]>
}
