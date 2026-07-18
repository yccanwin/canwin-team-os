export type PerformanceScope = 'personal' | 'team'
export type PerformanceSaleType = 'new' | 'renewal'
export type PerformanceEventStatus = 'counted' | 'reversed' | 'restored'

export interface PerformanceMetric {
  actual: number
  target: number
}

export interface PerformanceSummary {
  quarterStart: string
  points: PerformanceMetric
  newGmv: PerformanceMetric
  renewalGmv: PerformanceMetric
}

export interface PerformanceMember {
  profileId: string
  profileName: string
  points: number
  newGmv: number
  renewalGmv: number
  pointsTarget: number
  newGmvTarget: number
  renewalGmvTarget: number
  canSetTarget: boolean
}

export interface PerformanceViewer {
  profileId: string
  teamId: string
  requestedScope: PerformanceScope
  effectiveScope: PerformanceScope
  selectedProfileId: string | null
  canManageTargets: boolean
}

export interface ProductContribution {
  catalogItemId: string | null
  productName: string
  orderCount: number
  quantity: number
  points: number
  gmv: number
}

export interface ContributionOrder {
  orderId: string
  orderNumber: string
  customerName: string
  salespersonId: string
  salespersonName: string
  saleType: PerformanceSaleType
  points: number
  gmv: number
  countedAt: string
  status: PerformanceEventStatus
}

export interface PerformanceCenterSnapshot {
  viewer: PerformanceViewer
  summary: PerformanceSummary
  members: PerformanceMember[]
  products: ProductContribution[]
  orders: ContributionOrder[]
}
