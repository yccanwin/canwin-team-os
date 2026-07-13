import type { RegionAdminSnapshot, RegionDraft } from './regionTypes'

export interface RegionAdminDataSource {
  loadSnapshot(): Promise<RegionAdminSnapshot>
  saveRegion(draft: RegionDraft): Promise<void>
  saveMemberRegions(profileId: string, regionIds: string[], primaryRegionId: string | null): Promise<void>
}
