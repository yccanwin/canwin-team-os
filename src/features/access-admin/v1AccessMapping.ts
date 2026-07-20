export const primaryAccessRoleCodes = ['admin', 'sales', 'implementation', 'operations', 'finance'] as const
export const additionalAccessFunctionCodes = ['warehouse', 'supervisor'] as const

export type PrimaryAccessRole = typeof primaryAccessRoleCodes[number]
export type AdditionalAccessFunction = typeof additionalAccessFunctionCodes[number]

const primaryRoleSet = new Set<string>(primaryAccessRoleCodes)
const additionalFunctionSet = new Set<string>(additionalAccessFunctionCodes)

export interface V1RoleSelection {
  primaryRole: PrimaryAccessRole
  additionalFunctions: AdditionalAccessFunction[]
}

export function isPrimaryAccessRole(code: string): code is PrimaryAccessRole {
  return primaryRoleSet.has(code)
}

export function isAdditionalAccessFunction(code: string): code is AdditionalAccessFunction {
  return additionalFunctionSet.has(code)
}

export function isAssignableAccessRoleCode(code: string): boolean {
  return isPrimaryAccessRole(code) || isAdditionalAccessFunction(code)
}

export function normalizeAccessRoleCodes(roleCodes: readonly string[]): string[] {
  return [...new Set(roleCodes.map((code) => code === 'owner' ? 'admin' : code))]
    .filter(isAssignableAccessRoleCode)
}

export function splitV1RoleSelection(roleCodes: readonly string[]): V1RoleSelection {
  const normalized = normalizeAccessRoleCodes(roleCodes)
  const unknown = roleCodes.filter((code) => code !== 'owner' && !isAssignableAccessRoleCode(code))
  const primaryRoles = normalized.filter(isPrimaryAccessRole)
  const additionalFunctions = normalized.filter(isAdditionalAccessFunction)

  if (unknown.length || primaryRoles.length !== 1) throw new Error('INVALID_ROLE_SET')
  const primaryRole = primaryRoles[0]
  if (additionalFunctions.includes('warehouse') && !['admin', 'implementation'].includes(primaryRole)) {
    throw new Error('WAREHOUSE_FUNCTION_NOT_ASSIGNABLE')
  }
  return { primaryRole, additionalFunctions }
}

export function updateV1RoleSelection(current: readonly string[], roleCode: string): string[] {
  const normalized = normalizeAccessRoleCodes(current)
  if (isPrimaryAccessRole(roleCode)) {
    const additional = normalized.filter(isAdditionalAccessFunction)
      .filter((code) => code !== 'warehouse' || ['admin', 'implementation'].includes(roleCode))
    return [roleCode, ...additional]
  }
  if (!isAdditionalAccessFunction(roleCode)) throw new Error('INVALID_ROLE_SET')
  const primaryRole = normalized.find(isPrimaryAccessRole)
  if (roleCode === 'warehouse' && primaryRole && !['admin', 'implementation'].includes(primaryRole)) {
    throw new Error('WAREHOUSE_FUNCTION_NOT_ASSIGNABLE')
  }
  return normalized.includes(roleCode)
    ? normalized.filter((code) => code !== roleCode)
    : [...normalized, roleCode]
}
