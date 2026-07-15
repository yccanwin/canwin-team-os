export interface DealQuoteRecord {
  id: string
  opportunityId: string
  versionNo: number
  status: string
  validUntil: string
  customerTotal: number
  internalTotal: number
  hasSpecialContent: boolean
  specialContent: string | null
  submittedAt: string | null
  frozenAt: string | null
  storeName: string
  brandName?: string
  valueGrade: string
  demoCompleted: boolean
}

export interface DealQuoteApprovalRecord {
  status: 'not_required' | 'pending' | 'approved' | 'rejected'
  note: string | null
  decidedAt: string | null
  canDecide: boolean
}

export interface DealOrderRecord {
  id: string
  orderNumber: string
  quoteId: string
  status: string
  createdAt: string
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
  orderNumber: string
  quoteId: string
  storeName: string
  ownerName: string
  orderStatus: string
  customerTotal: number
  customerPaid: number
  customerRemaining: number
  internalDue: number
  internalPaid: number
  internalRemaining: number
  procurementPaid: number
  estimatedMargin: number | null
  finalMargin: number | null
  marginFinalized: boolean
  fulfillmentUnlocked: boolean
  canManage: boolean
  canViewMargin: boolean
  lockReason: string
}

export interface ReversiblePaymentRecord {
  paymentId: string
  paymentType: string
  originalAmount: number
  reversedAmount: number
  reversibleAmount: number
  confirmedAt: string
  externalRef: string | null
}

export interface QuoteOrderDataSource {
  loadDraftOptions(): Promise<{ opportunities: Array<{ id: string; label: string; valueGrade: string; demoCompleted: boolean }>; packages: Array<{ id: string; name: string }>; items: Array<{ id: string; name: string; itemType: string; listPrice: number }> }>
  completeOpportunityDemo(opportunityId: string): Promise<void>
  createDraft(opportunityId: string): Promise<DealQuoteRecord>
  getDraftLines(quoteId: string): Promise<DealQuoteDraftLineRecord[]>
  replaceDraftLines(quoteId: string, lines: Array<{ kind: 'package' | 'software' | 'hardware' | 'addon'; sourceId: string; quantity: number; customerPrice: number }>): Promise<DealQuoteRecord>
  setSpecialContent(quoteId: string, specialContent: string): Promise<DealQuoteRecord>
  listQuotes(): Promise<DealQuoteRecord[]>
  getQuote(quoteId: string): Promise<DealQuoteRecord>
  submitQuote(quoteId: string): Promise<DealQuoteRecord>
  decideQuote(quoteId: string, approved: boolean, note?: string): Promise<DealQuoteRecord>
  getApproval(quoteId: string): Promise<DealQuoteApprovalRecord>
  confirmDeposit(input: { quoteId: string; amount: number; externalRef: string; recipientType: 'company' | 'sales'; idempotencyKey: string }): Promise<DealOrderRecord>
  listInternalPayments(): Promise<InternalPaymentWorkbenchRecord[]>
  confirmCustomerPayment(input: { orderId: string; amount: number; recipientType: 'company' | 'sales'; externalRef: string; idempotencyKey: string }): Promise<void>
  confirmInternalPayment(input: { orderId: string; amount: number; method: InternalPaymentMethod; externalRef: string; idempotencyKey: string }): Promise<DealOrderRecord>
  recordProcurementPayment(input: { orderId: string; amount: number; externalRef: string; idempotencyKey: string }): Promise<void>
  finalizeSalesMargin(orderId: string): Promise<void>
  listReversiblePayments(orderId: string): Promise<ReversiblePaymentRecord[]>
  reversePayment(input: { paymentId: string; amount: number; reason: string; idempotencyKey: string }): Promise<void>
  recordOrderCancellation(input: { orderId: string; reason: string; idempotencyKey: string }): Promise<void>
}

export class QuoteOrderDataError extends Error {
  constructor(message: string, readonly code?: string) { super(message); this.name = 'QuoteOrderDataError' }
}
