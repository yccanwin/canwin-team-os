export type PrimaryRoleId = 'sales' | 'implementation' | 'operations' | 'finance' | 'admin'

export type AdditionalFunctionId = 'warehouse' | 'supervisor'

export type WorkView = {
  id: PrimaryRoleId
  label: string
}

export type SupervisorScope = {
  regionIds: string[]
  userIds: string[]
  businessScopes: string[]
}

export type AppContext = {
  company: {
    id: string
    name: string
    logoAssetRef: string | null
  }
  user: {
    id: string
    name: string
    status: 'active' | 'disabled'
  }
  primaryRole: PrimaryRoleId
  additionalFunctions: AdditionalFunctionId[]
  skills: string[]
  regionScopeIds: string[]
  warehouseScopeIds: string[]
  supervisorScope: SupervisorScope | null
  supervisorEnabled: boolean
  permissions: string[]
  availableWorkViews: WorkView[]
  currentWorkView: PrimaryRoleId
  navigationRevision: string
}

export type NavigationManifestItem = {
  routeId: string
  label: string
  order: number
  group: 'common' | 'current_role' | 'role_business' | 'warehouse' | 'supervisor' | 'topbar' | 'mobile_only'
  canonicalPath: string
  visible: boolean
  enabled: boolean
  readOnly: boolean
}
