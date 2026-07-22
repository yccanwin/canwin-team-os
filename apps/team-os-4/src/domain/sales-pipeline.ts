export type LeadPoolStatus = 'public_pool' | 'claimed' | 'converted' | 'discarded'
export type OpportunityStage = 'discovery' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost'
export interface Lead { readonly id: string; readonly companyId: string; readonly ownerId: string | null; readonly name: string; readonly region: string; readonly poolStatus: LeadPoolStatus; readonly cleanupDueAt: string | null; readonly createdAt: string }
export interface Opportunity { readonly id: string; readonly companyId: string; readonly ownerId: string; readonly customerId: string; readonly storeId: string; readonly name: string; readonly stage: OpportunityStage }
export interface SalesPipeline { readonly leads: readonly Lead[]; readonly opportunities: readonly Opportunity[] }
