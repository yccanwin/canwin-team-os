export type RegionLevel = 'province' | 'city' | 'district' | 'custom'

export interface RegionAdminRegion {
  id: string
  code: string
  name: string
  regionLevel: RegionLevel
  parentId: string | null
  isActive: boolean
  assignedCount: number
}

export interface RegionAssignment {
  regionId: string
  isPrimary: boolean
}

export interface RegionAdminMember {
  id: string
  name: string
  status: string
  regions: RegionAssignment[]
}

export interface RegionAdminSnapshot {
  regions: RegionAdminRegion[]
  members: RegionAdminMember[]
}

export interface RegionDraft {
  id?: string
  code: string
  name: string
  regionLevel: RegionLevel
  parentId: string | null
  isActive: boolean
}
