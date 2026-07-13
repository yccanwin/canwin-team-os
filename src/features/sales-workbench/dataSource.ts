import type { CustomerBrandSummary, FollowUpDraft, SalesAssessmentSummary, SalesLead } from './types'

export type LeadReadScope = 'mine' | 'region'

export interface SalesWorkbenchDataSource {
  listLeads(scope: LeadReadScope): Promise<SalesLead[]>
  claimLead(leadId: string): Promise<SalesLead>
  createFollowUp(leadId: string, followUp: FollowUpDraft): Promise<SalesLead>
  recordContactAttempt(leadId: string, result: ContactAttemptResult, note?: string): Promise<void>
  getLeadFollowupContext(leadId: string): Promise<LeadFollowupContext>
  listCustomers(): Promise<CustomerBrandSummary[]>
  listMyAssessments(): Promise<SalesAssessmentSummary[]>
  qualifyLead(leadId: string): Promise<string>
  recordStoreQualificationFacts(input: { storeId: string; areaSqm?: number; privateRoomCount?: number; isLandmark: boolean; isTakeawayOnly: boolean }): Promise<string>
  recordQualificationEvidence(input: { leadId: string; evidenceType: 'annual_fee_viable'|'key_person_contacted'|'key_person_meeting_scheduled'; detail: string; contactId?: string; meetingAt?: string }): Promise<string>
  loadCrmEditorOptions(): Promise<CrmEditorOptions>
  upsertBrand(input: BrandMutation): Promise<string>
  upsertStore(input: StoreMutation): Promise<string>
  upsertContact(input: ContactMutation): Promise<string>
  upsertLead(input: LeadMutation): Promise<string>
  loadQuickLeadContext(): Promise<QuickLeadContext>
  createQuickLead(input: QuickLeadMutation): Promise<string>
}

export interface BrandMutation { id?: string; name: string; businessMode: string }
export interface StoreMutation { id?: string; brandId: string; regionId: string; name: string; businessType: string; address: string }
export interface ContactMutation { id?: string; brandId?: string; storeId?: string; name: string; title: string; isKeyPerson: boolean }
export interface LeadMutation { id?: string; regionId: string; brandId?: string; storeId?: string; title: string; source: string }
export interface QuickLeadMutation { title: string; phone: string; source: string; regionId?: string }
export interface QuickLeadContext {
  regions: Array<{ id: string; name: string }>
  defaultRegionId?: string
  requiresRegionSelection: boolean
}
export type ContactAttemptResult = 'reached' | 'no_answer' | 'unreachable'
export interface LeadActivity {
  id: string
  activityType: 'attempt' | 'effective_followup'
  occurredAt: string
  outcome: string
  businessFact?: string
  customerCommitment?: string
  nextActionAt?: string
}
export interface LeadFollowupContext {
  leadStatus: string
  nurtureUntil?: string
  unreachableDays: number
  activities: LeadActivity[]
}
export interface CrmEditorOptions {
  brands: Array<{ id: string; name: string; businessMode: string }>
  regions: Array<{ id: string; name: string }>
  stores: Array<{ id: string; brandId?: string; regionId: string; name: string; businessType: string; address: string }>
  contacts: Array<{ id: string; brandId?: string; storeId?: string; name: string; title: string; isKeyPerson: boolean }>
  leads: Array<{ id: string; regionId: string; brandId?: string; storeId?: string; title: string; source: string }>
}

export class SalesWorkbenchDataError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'SalesWorkbenchDataError'
  }
}
