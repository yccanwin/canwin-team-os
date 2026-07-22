export interface Product { readonly id: string; readonly companyId: string; readonly name: string; readonly productType: 'software' | 'hardware' | 'service'; readonly isActive: boolean }
export interface Quote { readonly id: string; readonly companyId: string; readonly customerId: string; readonly salesOwnerId: string; readonly status: 'draft' | 'issued' | 'accepted' | 'expired' | 'cancelled' }
export interface Order { readonly id: string; readonly companyId: string; readonly quoteId: string; readonly customerId: string; readonly salesOwnerId: string; readonly status: 'pending_payment' | 'confirmed' | 'fulfilling' | 'completed' | 'cancelled' }
export interface CommerceData { readonly products: readonly Product[]; readonly quotes: readonly Quote[]; readonly orders: readonly Order[] }
