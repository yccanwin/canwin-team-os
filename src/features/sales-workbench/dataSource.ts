import type { CustomerBrandSummary, FollowUpDraft, PersonalSalesWorkspace, SalesLead } from './types'

export type LeadReadScope = 'mine' | 'region'

export interface SalesWorkbenchDataSource {
  listLeads(scope: LeadReadScope): Promise<SalesLead[]>
  listTodayActions(): Promise<SalesTodayAction[]>
  claimLead(leadId: string): Promise<SalesLead>
  createFollowUp(leadId: string, followUp: FollowUpDraft): Promise<SalesLead>
  recordContactAttempt(leadId: string, result: ContactAttemptResult, note?: string): Promise<void>
  getLeadFollowupContext(leadId: string): Promise<LeadFollowupContext>
  listCustomers(): Promise<CustomerBrandSummary[]>
  getMySalesWorkspace(): Promise<PersonalSalesWorkspace>
  qualifyLead(leadId: string): Promise<string>
  getQualificationStatus(leadId: string): Promise<QualificationStatus>
  recordStoreQualificationFacts(input: { storeId: string; areaSqm?: number; privateRoomCount?: number; isLandmark: boolean; isTakeawayOnly: boolean }): Promise<string>
  recordQualificationEvidence(input: { leadId: string; evidenceType: 'annual_fee_viable'|'key_person_contacted'|'key_person_meeting_scheduled'; detail: string; contactId?: string; meetingAt?: string }): Promise<string>
  loadCrmEditorOptions(): Promise<CrmEditorOptions>
  upsertBrand(input: BrandMutation): Promise<string>
  upsertStore(input: StoreMutation): Promise<string>
  upsertContact(input: ContactMutation): Promise<string>
  loadQuickLeadContext(): Promise<QuickLeadContext>
  createQuickLead(input: QuickLeadMutation): Promise<string>
  submitFieldLead(input: FieldLeadMutation): Promise<string>
  precheckLeadConversion(input: { leadId: string; brandName: string; storeName: string }): Promise<LeadConversionPrecheck>
  convertLeadToCustomer(input: LeadConversionMutation): Promise<{ brandId: string; storeId: string; contactId: string; idempotent: boolean }>
}

export interface BrandMutation { id?: string; name: string; businessMode: string }
export interface StoreMutation { id?: string; brandId: string; regionId: string; name: string; businessType: string; address: string }
export interface ContactMutation { id?: string; brandId?: string; storeId?: string; name: string; title: string; isKeyPerson: boolean }
export interface QuickLeadMutation { title: string; phone: string; source: string; regionId?: string }
export type FieldLeadSource = 'field_visit' | 'site_hoarding'
export interface FieldLeadMutation { title: string; contactName?: string; phone?: string; source: FieldLeadSource; regionText?: string; address?: string }
export interface QuickLeadContext {
  regions: Array<{ id: string; name: string }>
  defaultRegionId?: string
  requiresRegionSelection: boolean
}

export interface SalesTodayAction {
  id: string
  entityId: string
  entityType: 'lead'|'renewal'|'delivery_exception'
  actionType: string
  priority: number
  priorityTone: 'critical'|'high'|'medium'|'normal'
  label: string
  title: string
  reason: string
  dueAt?: string
  route: string
  supervisorException: boolean
}

export interface QualificationStatus {
  leadId: string
  storeId?: string
  storeName?: string
  businessType?: string
  businessTypeLabel?: string
  areaSqm?: number
  privateRoomCount?: number
  isLandmark: boolean
  isTakeawayOnly: boolean
  isRealStore: boolean
  calculatedGrade?: 'A'|'B'|'C'|'D'
  gradeReason: string
  annualFeeViable: boolean
  keyPersonReady: boolean
  eligible: boolean
  missingEvidence: string[]
  nextAction: string
  opportunityId?: string
  demoRequiredBeforeDeposit: boolean
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
export interface LeadConversionMatch { id: string; name: string; brandId?: string; storeId?: string; businessMode?: string }
export interface LeadConversionPrecheck { brands: LeadConversionMatch[]; stores: LeadConversionMatch[]; contacts: LeadConversionMatch[] }
export interface LeadConversionMutation {
  leadId: string; brandId?: string; brandName: string; businessMode: string; storeId?: string; storeName: string
  businessType: string; address: string; contactId?: string; contactName: string; contactTitle: string; isKeyPerson: boolean
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
