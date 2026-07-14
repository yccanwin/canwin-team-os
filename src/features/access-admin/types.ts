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
  currentUserId: string
}

const systemRoleLabels: Record<string, { name: string; description: string }> = {
  owner: { name: '老板（Owner）', description: '拥有团队全部管理权限' },
  admin: { name: '管理员（Administrator）', description: '管理人员、权限和系统配置' },
  supervisor: { name: '销售主管（Sales Supervisor）', description: '管理销售团队、下属与销售过程' },
  sales: { name: '销售（Sales）', description: '负责线索、客户、商机和成交推进' },
  finance: { name: '财务（Finance）', description: '负责收付款确认、冲销和经营数据' },
  warehouse: { name: '仓库（Warehouse）', description: '负责库存和硬件履约' },
  implementation: { name: '实施（Implementation）', description: '负责安装、培训和实施交付' },
  operations: { name: '运维（Operations）', description: '负责售后承接和持续运营' },
}

export function localizeAccessRole(role: AccessRoleOption): AccessRoleOption {
  const localized = systemRoleLabels[role.code]
  return localized ? { ...role, ...localized } : role
}

export function accessRoleName(code: string): string {
  return systemRoleLabels[code]?.name ?? code
}
