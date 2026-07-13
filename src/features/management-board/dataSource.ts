export interface SupervisorExceptionRecord {
  entityId: string
  ownerId: string
  itemType: 'action_exception' | 'closing_opportunity'
  ownerName: string
  entityType: string
  actionType: string
  dueAt: string
  title: string
  urgency: string
}

export interface PerformanceRecord {
  profileId: string; profileName: string; quarterStart: string; pointsTarget: number; estimatedPoints: number; officialPoints: number
  newGmvTarget: number; newGmvActual: number; renewalGmvTarget: number; renewalGmvActual: number
  monthlyObservations: Array<{ monthStart: string; estimatedPoints: number; officialPoints: number; newGmv: number; renewalGmv: number }>; canSetTarget: boolean
}
export interface ReconciliationBatchRecord { batchId: string; quarterStart: string; sourceRef: string; status: string; lineCount: number; createdAt: string; confirmedAt: string | null }
export interface ProfitSummaryRecord { quarterStart: string; forecastProfit: number; actualProfit: number; actualReceipts: number; refundReversals: number; procurementPayments: number; salesExpenses: number; quarterlyRebates: number; companyExpenses: number; canViewDetails: boolean }
export interface SupervisorMarginRecord { orderId: string; orderNumber: string; ownerName: string; salesMargin: number; createdAt: string }

export interface ManagementBoardDataSource {
  listExceptions(): Promise<SupervisorExceptionRecord[]>
  resolveException(input: { itemType: SupervisorExceptionRecord['itemType']; entityId: string; ownerId: string; dueAt: string; note: string; idempotencyKey: string }): Promise<void>
  listPerformance(quarterStart: string): Promise<PerformanceRecord[]>
  setQuarterTarget(input: { profileId: string; quarterStart: string; pointsTarget: number; newGmvTarget: number; renewalGmvTarget: number }): Promise<void>
  saveMonthlyObservation(input: { monthStart: string; estimatedPoints: number; newGmv: number; renewalGmv: number; idempotencyKey: string }): Promise<void>
  listReconciliations(): Promise<ReconciliationBatchRecord[]>
  createReconciliation(input: { quarterStart: string; sourceRef: string; lines: Array<Record<string, unknown>> }): Promise<void>
  confirmReconciliation(batchId: string): Promise<void>
  listProfitSummary(): Promise<ProfitSummaryRecord[]>
  addProfitAdjustment(input: { type: 'quarterly_rebate' | 'expense'; amount: number; effectiveOn: string; reason: string; idempotencyKey: string }): Promise<void>
  listSupervisorMargins(): Promise<SupervisorMarginRecord[]>
}

export class ManagementBoardDataError extends Error {
  constructor(message: string, readonly code?: string) { super(message); this.name = 'ManagementBoardDataError' }
}
