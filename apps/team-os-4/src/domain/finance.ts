export interface PaymentEvent { readonly id: string; readonly companyId: string; readonly orderId: string; readonly eventType: 'confirmed' | 'reversed'; readonly amount: number }
export interface InternalPaymentEvent { readonly id: string; readonly companyId: string; readonly orderId: string; readonly eventType: 'confirmed' | 'reversed'; readonly amount: number }
export interface ProfitEntry { readonly id: string; readonly companyId: string; readonly orderId: string; readonly beneficiaryUserId: string | null; readonly entryType: 'recognized' | 'reversed'; readonly amount: number }
export interface LaborEarning { readonly id: string; readonly companyId: string; readonly orderId: string; readonly beneficiaryUserId: string; readonly entryType: 'recognized' | 'reversed'; readonly amount: number }
export interface FinanceData { readonly payments: readonly PaymentEvent[]; readonly internalPayments: readonly InternalPaymentEvent[]; readonly profits: readonly ProfitEntry[] }
