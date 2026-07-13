import type { AccessAdminSnapshot } from './types'

export interface AccessAdminDataSource {
  loadSnapshot(): Promise<AccessAdminSnapshot>
  manageProfileAccess(profileId: string, roleCodes: string[], regionIds: string[]): Promise<void>
}
