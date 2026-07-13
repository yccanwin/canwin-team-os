export interface AccessMemberView {
  id: string
  name: string
  status: string
  legacyRole: string
  roles: Array<{ id: string; code: string; name: string }>
  regions: Array<{ id: string; code: string; name: string; primary: boolean }>
}

export interface FeatureFlagView { id: string; key: string; description: string; enabled: boolean }
export interface AccessRoleOption { id: string; code: string; name: string }
export interface AccessRegionOption { id: string; code: string; name: string }
export interface AccessAdminSnapshot { members: AccessMemberView[]; featureFlags: FeatureFlagView[]; roles: AccessRoleOption[]; regions: AccessRegionOption[]; currentUserIsAdmin: boolean }
