export interface AccessRoleOption { id: string; code: string; name: string; description: string }
export interface AccessRegionOption { id: string; code: string; name: string; primary: boolean }
export interface AccessMemberView {
  id: string
  name: string
  position: string
  status: 'active' | 'disabled'
  roles: AccessRoleOption[]
  regions: AccessRegionOption[]
}
export interface InvitationView { id: string; email: string; displayName: string; roleCodes: string[]; status: string; invitedAt: string }
export interface DelegationView { id: string; delegatorId: string; delegateId: string; startsAt: string; endsAt: string; reason: string; status: string }
export interface SupervisorAssignmentView { id: string; supervisorId: string; subordinateId: string; startsOn: string; endsOn: string | null }
export interface SensitiveRuleView { key: string; label: string; rule: string }
export interface FeatureFlagView { id: string; key: string; description: string; enabled: boolean }
export interface AccessAdminSnapshot {
  members: AccessMemberView[]
  roles: AccessRoleOption[]
  invitations: InvitationView[]
  delegations: DelegationView[]
  supervisorAssignments: SupervisorAssignmentView[]
  sensitiveRules: SensitiveRuleView[]
  featureFlags: FeatureFlagView[]
  currentUserIsAdmin: boolean
}
