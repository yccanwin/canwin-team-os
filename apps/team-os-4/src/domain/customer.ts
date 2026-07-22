export interface Customer { readonly id: string; readonly companyId: string; readonly name: string; readonly region: string; readonly salesOwnerId: string }
export interface Brand { readonly id: string; readonly companyId: string; readonly customerId: string; readonly name: string }
export interface Store { readonly id: string; readonly companyId: string; readonly brandId: string; readonly name: string; readonly address: string; readonly storeType: 'new' | 'competitor_existing' }
export interface CustomerDirectory { readonly customers: readonly Customer[]; readonly brands: readonly Brand[]; readonly stores: readonly Store[] }
