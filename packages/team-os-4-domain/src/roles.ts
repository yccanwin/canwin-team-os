export const PRIMARY_ROLES = Object.freeze([
  'sales',
  'implementation',
  'operations',
  'finance',
  'admin',
] as const)

export type PrimaryRole = (typeof PRIMARY_ROLES)[number]

export const PRIMARY_ROLE_LABELS = Object.freeze({
  sales: '销售',
  implementation: '实施',
  operations: '运维',
  finance: '财务',
  admin: '管理员',
} as const satisfies Readonly<Record<PrimaryRole, string>>)

export const ADDITIONAL_CAPABILITIES = Object.freeze([
  'warehouse',
  'supervisor',
] as const)

export type AdditionalCapability = (typeof ADDITIONAL_CAPABILITIES)[number]

export const ADDITIONAL_CAPABILITY_LABELS = Object.freeze({
  warehouse: '仓库职能',
  supervisor: '主管职能',
} as const satisfies Readonly<Record<AdditionalCapability, string>>)

export function isPrimaryRole(value: string): value is PrimaryRole {
  return (PRIMARY_ROLES as readonly string[]).includes(value)
}

export function isAdditionalCapability(value: string): value is AdditionalCapability {
  return (ADDITIONAL_CAPABILITIES as readonly string[]).includes(value)
}
