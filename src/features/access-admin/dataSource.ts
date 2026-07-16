import type { AccessAdminSnapshot } from './types'

export interface AccessAdminDataSource {
  loadSnapshot(): Promise<AccessAdminSnapshot>
  replaceRoles(profileId: string, roleCodes: string[]): Promise<void>
  createInvitation(email: string, displayName: string, roleCodes: string[]): Promise<void>
  setProfileStatus(profileId: string, status: 'active' | 'disabled'): Promise<void>
  resetPassword(profileId: string, password: string): Promise<void>
  createDelegation(input: { delegatorId: string; delegateId: string; startsAt: string; endsAt: string; reason: string }): Promise<void>
  replaceSupervisorSubordinates(supervisorId: string, subordinateIds: string[]): Promise<void>
  reassignOwnership(fromProfileId: string, toProfileId: string, reason: string): Promise<void>
}
