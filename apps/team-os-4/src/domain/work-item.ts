import type { PrimaryRole } from '../../../../packages/team-os-4-domain/src/index'

export type WorkItemKind = 'reminder' | 'business_action'
export type WorkItemPriority = 'urgent' | 'high' | 'normal' | 'low'
export type WorkItemStatus = 'pending' | 'in_progress' | 'waiting' | 'completed' | 'cancelled'

export interface WorkItem {
  readonly id: string
  readonly companyId: string
  readonly sourceBusiness: string
  readonly sourceRecordId: string
  readonly role: PrimaryRole
  readonly assigneeId: string
  readonly kind: WorkItemKind
  readonly priority: WorkItemPriority
  readonly status: WorkItemStatus
  readonly plannedAt: string | null
  readonly dueAt: string | null
  readonly nextStep: string
  readonly blockedReason: string | null
  readonly generationRule: string
  readonly completedAt: string | null
}

export type WorkItemSurface = 'workbench' | 'progress' | 'calendar'

export interface WorkItemSelection {
  readonly surface: WorkItemSurface
  readonly assigneeId: string
  readonly now: string
}
