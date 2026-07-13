export type CustomerGrade = 'A' | 'B' | 'C'
export type QuoteStatus = 'draft' | 'pending_approval' | 'approved' | 'frozen'

export interface VersionedCatalogItem {
  id: string
  name: string
  version: number
  kind: 'product' | 'package'
  unitPrice: number
}

export interface QuoteLine {
  itemId: string
  itemNameSnapshot: string
  catalogVersion: number
  quantity: number
  unitPrice: number
  specialContent?: string
}

export interface QuoteSnapshot {
  quoteId: string
  version: number
  lines: QuoteLine[]
  totalAmount: number
  frozenAt: string
}

export interface QuoteChangeOrder {
  id: string
  quoteId: string
  reason: string
  createdAt: string
  status: 'draft'
}

export interface DemoQuote {
  id: string
  customerName: string
  customerGrade: CustomerGrade
  demonstrationCompleted: boolean
  status: QuoteStatus
  version: number
  issuedAt: string
  validUntil: string
  lines: QuoteLine[]
  supervisorApproved: boolean
  frozenSnapshot?: QuoteSnapshot
  changeOrders: QuoteChangeOrder[]
}

export interface QuoteActionResult {
  ok: boolean
  quote: DemoQuote
  message: string
}
