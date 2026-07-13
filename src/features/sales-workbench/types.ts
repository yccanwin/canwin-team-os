export type WorkbenchTab = 'today' | 'leads' | 'customers' | 'orders' | 'profile'

export type LeadStage = 'new' | 'contacted' | 'qualified' | 'opportunity'

export interface SalesLead {
  opportunityId?: string
  id: string
  storeName: string
  contactName: string
  phone: string
  district: string
  businessType: string
  source: string
  createdAt: string
  nextActionAt?: string
  stage: LeadStage
  facts: string[]
  leadStatus?: string
  ownerDisplayName?: string
  claimable?: boolean
}

export interface FollowUpDraft {
  fact: string
  commitment: string
  nextActionAt: string
}

export type BusinessGrade = 'A' | 'B' | 'C' | 'D' | ''

export interface OpportunityQualification {
  isRealStore: boolean
  grade: BusinessGrade
  fitsAnnualProduct: boolean
  keyPersonReached: boolean
}

export interface WorkbenchSummary {
  appointments: number
  overdue: number
  newLeads: number
  recycleRisks: number
}

export interface CustomerContactSummary {
  id: string
  name: string
  role: string
}

export interface CustomerStoreSummary {
  id: string
  name: string
  district: string
  businessType: string
  contacts: CustomerContactSummary[]
}

export interface CustomerBrandSummary {
  id: string
  name: string
  stores: CustomerStoreSummary[]
}

export type SalesActionPriority = 'overdue_appointment' | 'upcoming_appointment' | 'today_followup' | 'new_lead' | 'recycle_risk'

export interface SalesAssessmentSummary {
  id: string
  periodQuarter: string
  pointTarget: number
  newGmvTarget: number
  newGmvActual: number
  renewalGmvTarget: number
  renewalGmvActual: number
}

export interface OrderActionSignal {
  kind: 'delivery_exception' | 'renewal'
  count: number
}
