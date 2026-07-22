import { isPrimaryRole } from '../../../../packages/team-os-4-domain/src/index'
import type { WorkItem, WorkItemKind, WorkItemPriority, WorkItemStatus } from './work-item'

const KINDS = new Set<WorkItemKind>(['reminder', 'business_action'])
const PRIORITIES = new Set<WorkItemPriority>(['urgent', 'high', 'normal', 'low'])
const STATUSES = new Set<WorkItemStatus>(['pending', 'in_progress', 'waiting', 'completed', 'cancelled'])

function rowObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('WORK_ITEM_ROW_INVALID')
  return value as Record<string, unknown>
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`WORK_ITEM_FIELD_INVALID:${key}`)
  return value
}

function nullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  if (value === null) return null
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`WORK_ITEM_FIELD_INVALID:${key}`)
  return value
}

function nullableTimestamp(row: Record<string, unknown>, key: string): string | null {
  const value = nullableString(row, key)
  if (value !== null && !Number.isFinite(Date.parse(value))) throw new Error(`WORK_ITEM_FIELD_INVALID:${key}`)
  return value
}

export function mapWorkItemRow(value: unknown): WorkItem {
  const row = rowObject(value)
  const role = requiredString(row, 'role_type')
  const kind = requiredString(row, 'kind')
  const priority = requiredString(row, 'priority')
  const status = requiredString(row, 'status')
  if (!isPrimaryRole(role)) throw new Error('WORK_ITEM_FIELD_INVALID:role_type')
  if (!KINDS.has(kind as WorkItemKind)) throw new Error('WORK_ITEM_FIELD_INVALID:kind')
  if (!PRIORITIES.has(priority as WorkItemPriority)) throw new Error('WORK_ITEM_FIELD_INVALID:priority')
  if (!STATUSES.has(status as WorkItemStatus)) throw new Error('WORK_ITEM_FIELD_INVALID:status')

  return Object.freeze({
    id: requiredString(row, 'id'),
    companyId: requiredString(row, 'company_id'),
    sourceBusiness: requiredString(row, 'source_business'),
    sourceRecordId: requiredString(row, 'source_id'),
    role,
    assigneeId: requiredString(row, 'assignee_id'),
    kind: kind as WorkItemKind,
    priority: priority as WorkItemPriority,
    status: status as WorkItemStatus,
    plannedAt: nullableTimestamp(row, 'planned_at'),
    dueAt: nullableTimestamp(row, 'due_at'),
    nextStep: requiredString(row, 'next_step'),
    blockedReason: nullableString(row, 'blocked_reason'),
    generationRule: requiredString(row, 'generation_rule'),
    completedAt: nullableTimestamp(row, 'completed_at'),
  })
}
