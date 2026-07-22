import type { AdditionalCapability, PrimaryRole } from './roles.js'

export interface TeamOs4UserContext {
  readonly userId: string
  readonly companyId: string
  readonly primaryRole: PrimaryRole
  readonly additionalCapabilities: readonly AdditionalCapability[]
  readonly skillIds: readonly string[]
  readonly regionScopeIds: readonly string[]
  readonly warehouseScopeIds: readonly string[]
  readonly subordinateUserIds: readonly string[]
  readonly supervisorSystemEnabled: boolean
  readonly active: boolean
}

export type UserContextInput = Omit<
  TeamOs4UserContext,
  | 'additionalCapabilities'
  | 'skillIds'
  | 'regionScopeIds'
  | 'warehouseScopeIds'
  | 'subordinateUserIds'
> & {
  readonly additionalCapabilities?: readonly AdditionalCapability[]
  readonly skillIds?: readonly string[]
  readonly regionScopeIds?: readonly string[]
  readonly warehouseScopeIds?: readonly string[]
  readonly subordinateUserIds?: readonly string[]
}

function freezeStrings(values: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...(values ?? [])])
}

export function createUserContext(input: UserContextInput): TeamOs4UserContext {
  return Object.freeze({
    ...input,
    additionalCapabilities: Object.freeze([...(input.additionalCapabilities ?? [])]),
    skillIds: freezeStrings(input.skillIds),
    regionScopeIds: freezeStrings(input.regionScopeIds),
    warehouseScopeIds: freezeStrings(input.warehouseScopeIds),
    subordinateUserIds: freezeStrings(input.subordinateUserIds),
  })
}

export function hasAdditionalCapability(
  context: TeamOs4UserContext,
  capability: AdditionalCapability,
): boolean {
  return context.additionalCapabilities.includes(capability)
}

export function canUseSupervisorFunctions(context: TeamOs4UserContext): boolean {
  return context.supervisorSystemEnabled && hasAdditionalCapability(context, 'supervisor')
}
