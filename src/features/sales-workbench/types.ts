export type WorkbenchTab = 'today' | 'leads' | 'customers' | 'orders' | 'profile'

export type LeadStage = 'new' | 'contacted' | 'qualified' | 'opportunity'

export interface SalesLead {
  opportunityId?: string
  id: string
  storeName: string
  contactName: string
  phone: string
  address?: string
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
  recycleRisk?: 'none' | 'uncontacted_24h' | 'uncontacted_48h' | 'inactive_15d'
  recycleDueAt?: string
  recyclePaused?: boolean
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

export interface PersonalSalesTarget {
  id: string
  pointTarget: number
  estimatedPoints: number
  officialPoints: number
  newGmvTarget: number
  newGmvActual: number
  renewalGmvTarget: number
  renewalGmvActual: number
  updatedAt: string
}

export interface PersonalSalesMonthlyObservation {
  monthStart: string
  monthLabel: string
  newGmv: number
  renewalGmv: number
  officialPoints: number
}

export interface PersonalSalesWorkspace {
  profileId: string
  displayName: string
  quarterStart: string
  quarterEnd: string
  quarterLabel: string
  target?: PersonalSalesTarget
  monthlyObservations: PersonalSalesMonthlyObservation[]
}

export interface OrderActionSignal {
  kind: 'delivery_exception' | 'renewal'
  count: number
}
