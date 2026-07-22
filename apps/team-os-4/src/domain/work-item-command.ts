import {
  canTransitionWorkItemStatus,
  canUseGenericWorkItemCompletion,
  type WorkItem,
  type WorkItemStatus,
} from '../../../../packages/team-os-4-domain/src/work-item.ts'

export type WorkItemTransitionTarget = Extract<WorkItemStatus, 'in_progress' | 'waiting' | 'cancelled'>

export interface WorkItemCommandBody {
  readonly action: 'transition' | 'complete'
  readonly companyId: string
  readonly workItemId: string
  readonly idempotencyKey: string
  readonly targetStatus?: WorkItemTransitionTarget
  readonly blockedReason?: string
}

export interface WorkItemCommandTransport {
  invoke(body: WorkItemCommandBody): Promise<unknown>
}

export class WorkItemCommandGateway {
  private readonly transport: WorkItemCommandTransport
  private readonly createIdempotencyKey: () => string

  constructor(
    transport: WorkItemCommandTransport,
    createIdempotencyKey: () => string,
  ) {
    this.transport = transport
    this.createIdempotencyKey = createIdempotencyKey
  }

  async transition(item: WorkItem, targetStatus: WorkItemTransitionTarget, blockedReason?: string): Promise<void> {
    if (!canTransitionWorkItemStatus(item.status, targetStatus)) throw new Error('WORK_ITEM_TRANSITION_NOT_ALLOWED')
    const reason = blockedReason?.trim()
    if (targetStatus === 'waiting' && !reason) throw new Error('WORK_ITEM_WAITING_REASON_REQUIRED')
    await this.transport.invoke({
      action: 'transition',
      companyId: item.companyId,
      workItemId: item.id,
      idempotencyKey: this.createIdempotencyKey(),
      targetStatus,
      ...(targetStatus === 'waiting' ? { blockedReason: reason } : {}),
    })
  }

  async completeReminder(item: WorkItem): Promise<void> {
    if (!canUseGenericWorkItemCompletion(item.kind)) throw new Error('WORK_ITEM_BUSINESS_ACTION_REQUIRES_OWNING_TRANSACTION')
    if (!canTransitionWorkItemStatus(item.status, 'completed')) throw new Error('WORK_ITEM_COMPLETION_NOT_ALLOWED')
    await this.transport.invoke({
      action: 'complete',
      companyId: item.companyId,
      workItemId: item.id,
      idempotencyKey: this.createIdempotencyKey(),
    })
  }
}

export function businessActionRoute(sourceBusiness: string): string {
  const source = sourceBusiness.toLowerCase()
  if (source.includes('lead') || source.includes('opportunity')) return '/leads'
  if (source.includes('customer') || source.includes('store')) return '/customers'
  if (source.includes('catalog') || source.includes('product')) return '/catalog'
  if (source.includes('order') || source.includes('quote')) return '/orders'
  if (source.includes('payment') || source.includes('finance')) return '/finance'
  if (source.includes('warehouse') || source.includes('stock')) return '/warehouse'
  if (source.includes('fulfillment') || source.includes('delivery')) return '/fulfillment'
  if (source.includes('case')) return '/cases'
  return '/progress'
}
