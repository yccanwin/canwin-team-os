export interface DealQuoteRecord {
  id: string
  opportunityId: string
  versionNo: number
  status: string
  validUntil: string
  customerTotal: number
  internalTotal: number
  hasSpecialContent: boolean
  submittedAt: string | null
  frozenAt: string | null
  storeName: string
  brandName?: string
}

export interface DealOrderRecord {
  id: string
  quoteId: string
  status: string
  customerTotal: number
  internalDue: number
  internalPaid: number
}

export interface DealQuoteDraftLineRecord {
  lineId: string
  kind: 'package' | 'hardware' | 'addon'
  sourceId: string
  itemName: string
  quantity: number
  customerPrice: number
}

export type InternalPaymentMethod = 'cash_remitted' | 'withheld_from_company_receipt'

export interface InternalPaymentWorkbenchRecord {
  orderId: string
  quoteId: string
  storeName: string
  orderStatus: string
  internalDue: number
  internalPaid: number
  internalRemaining: number
  fulfillmentUnlocked: boolean
  canManage: boolean
}

export interface QuoteOrderDataSource {
  loadDraftOptions(): Promise<{ opportunities: Array<{ id: string; label: string; valueGrade: string; demoCompleted: boolean }>; packages: Array<{ id: string; name: string }>; items: Array<{ id: string; name: string; itemType: string; listPrice: number }> }>
  completeOpportunityDemo(opportunityId: string): Promise<void>
  createDraft(opportunityId: string): Promise<DealQuoteRecord>
  getDraftLines(quoteId: string): Promise<DealQuoteDraftLineRecord[]>
  replaceDraftLines(quoteId: string, lines: Array<{ kind: 'package' | 'hardware' | 'addon'; sourceId: string; quantity: number; customerPrice: number }>): Promise<DealQuoteRecord>
  listQuotes(): Promise<DealQuoteRecord[]>
  getQuote(quoteId: string): Promise<DealQuoteRecord>
  submitQuote(quoteId: string): Promise<DealQuoteRecord>
  decideQuote(quoteId: string, approved: boolean, note?: string): Promise<DealQuoteRecord>
  confirmDeposit(input: { quoteId: string; amount: number; externalRef: string; idempotencyKey: string }): Promise<DealOrderRecord>
  listInternalPayments(): Promise<InternalPaymentWorkbenchRecord[]>
  confirmInternalPayment(input: { orderId: string; amount: number; method: InternalPaymentMethod; externalRef: string; idempotencyKey: string }): Promise<DealOrderRecord>
}

export class QuoteOrderDataError extends Error {
  constructor(message: string, readonly code?: string) { super(message); this.name = 'QuoteOrderDataError' }
}
