/**
 * Offline Auth migration contract.
 *
 * This module deliberately contains no Supabase client and no logger. It only
 * validates an already frozen snapshot and builds target writes for a trusted
 * executor. Password hashes may exist in memory long enough to become a bound
 * SQL parameter; they must never enter returned audit records or error text.
 */

export const AUTH_SOURCE_TABLES = ['auth.users', 'auth.identities'] as const
export const FORBIDDEN_AUTH_TABLES = [
  'auth.sessions',
  'auth.refresh_tokens',
  'auth.mfa_challenges',
  'auth.mfa_amr_claims',
  'auth.one_time_tokens',
] as const

export interface FrozenAuthUser {
  id: string
  email: string | null
  phone: string | null
  encryptedPassword: string | null
  emailConfirmedAt: string | null
  phoneConfirmedAt: string | null
  bannedUntil: string | null
  createdAt: string
  updatedAt: string
  appMetadata: Record<string, unknown>
  userMetadata: Record<string, unknown>
}

export interface FrozenAuthIdentity {
  id: string
  userId: string
  provider: string
  providerIdentityId: string
  createdAt: string
  updatedAt: string
}

export interface AuthUidMapping {
  sourceUid: string
  targetUid: string
  strategy: 'preserved' | 'explicit-remap'
  reason: string
}

export interface AuthMigrationAudit {
  sourceUid: string
  targetUid: string
  uidStrategy: AuthUidMapping['strategy']
  identityCount: number
  migratedAuditFields: readonly string[]
  authorizationSource: 'app_metadata-and-team-os-4-permissions-only'
  passwordHashLogged: false
  forceReauthentication: true
}

export interface AuthTargetWrite {
  statement: string
  parameters: readonly unknown[]
}

export interface AuthMigrationPlan {
  writes: AuthTargetWrite[]
  audit: AuthMigrationAudit[]
  invalidateAllLegacySessions: true
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_PROVIDER = /^[a-z0-9_-]{1,64}$/i
const ISO_FIELDS = ['emailConfirmedAt', 'phoneConfirmedAt', 'bannedUntil', 'createdAt', 'updatedAt'] as const
const AUTHORIZATION_KEYS = /^(role|roles|permission|permissions|is_admin|admin)$/i
const FORBIDDEN_SECRET_KEYS = /(refresh.?token|access.?token|session|otp|verification.?code|jwt.?secret)/i

function isIsoOrNull(value: string | null): boolean {
  return value === null || (!Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value)
}

function findForbiddenKey(value: unknown, path = '$'): string | null {
  if (!value || typeof value !== 'object') return null
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`
    if (FORBIDDEN_SECRET_KEYS.test(key)) return childPath
    const nested = findForbiddenKey(child, childPath)
    if (nested) return nested
  }
  return null
}

function findAuthorizationKey(value: unknown, path = '$'): string | null {
  if (!value || typeof value !== 'object') return null
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`
    if (AUTHORIZATION_KEYS.test(key)) return childPath
    const nested = findAuthorizationKey(child, childPath)
    if (nested) return nested
  }
  return null
}

export function validateFrozenAuthSnapshot(
  users: readonly FrozenAuthUser[],
  identities: readonly FrozenAuthIdentity[],
  uidMappings: readonly AuthUidMapping[],
): string[] {
  const errors: string[] = []
  const userIds = new Set<string>()
  const targetIds = new Set<string>()
  const mappingBySource = new Map<string, AuthUidMapping>()

  for (const mapping of uidMappings) {
    if (!UUID.test(mapping.sourceUid) || !UUID.test(mapping.targetUid)) errors.push('UID mapping contains an invalid UUID')
    if (mappingBySource.has(mapping.sourceUid)) errors.push(`duplicate UID mapping for ${mapping.sourceUid}`)
    if (targetIds.has(mapping.targetUid)) errors.push(`duplicate target UID ${mapping.targetUid}`)
    if (mapping.strategy === 'preserved' && mapping.sourceUid !== mapping.targetUid) errors.push(`preserved UID changed for ${mapping.sourceUid}`)
    if (mapping.strategy === 'explicit-remap' && mapping.sourceUid === mapping.targetUid) errors.push(`explicit UID remap did not change ${mapping.sourceUid}`)
    if (!mapping.reason.trim()) errors.push(`UID mapping reason is missing for ${mapping.sourceUid}`)
    mappingBySource.set(mapping.sourceUid, mapping)
    targetIds.add(mapping.targetUid)
  }

  for (const user of users) {
    if (!UUID.test(user.id)) errors.push('auth.users contains an invalid UID')
    if (userIds.has(user.id)) errors.push(`duplicate auth.users UID ${user.id}`)
    userIds.add(user.id)
    if (!mappingBySource.has(user.id)) errors.push(`auth.users UID has no preserve/remap decision: ${user.id}`)
    for (const field of ISO_FIELDS) if (!isIsoOrNull(user[field])) errors.push(`invalid ${field} for auth.users/${user.id}`)
    const forbiddenAppKey = findForbiddenKey(user.appMetadata)
    if (forbiddenAppKey) errors.push(`forbidden credential marker in app_metadata at ${forbiddenAppKey}`)
    const forbiddenUserKey = findForbiddenKey(user.userMetadata)
    if (forbiddenUserKey) errors.push(`forbidden credential marker in user_metadata at ${forbiddenUserKey}`)
    const metadataAuthorization = findAuthorizationKey(user.userMetadata)
    if (metadataAuthorization) errors.push(`user_metadata authorization is forbidden for auth.users/${user.id} at ${metadataAuthorization}`)
  }

  const identityKeys = new Set<string>()
  for (const identity of identities) {
    if (!UUID.test(identity.id) || !UUID.test(identity.userId)) errors.push('auth.identities contains an invalid UUID')
    if (!userIds.has(identity.userId)) errors.push(`orphan auth identity ${identity.id}`)
    if (!SAFE_PROVIDER.test(identity.provider) || !identity.providerIdentityId) errors.push(`invalid auth identity provider data for ${identity.id}`)
    if (!isIsoOrNull(identity.createdAt) || !isIsoOrNull(identity.updatedAt)) errors.push(`invalid audit timestamp for auth.identities/${identity.id}`)
    const key = `${identity.provider}\u0000${identity.providerIdentityId}`
    if (identityKeys.has(key)) errors.push(`duplicate provider identity ${identity.provider}/${identity.providerIdentityId}`)
    identityKeys.add(key)
  }

  for (const sourceUid of mappingBySource.keys()) if (!userIds.has(sourceUid)) errors.push(`UID mapping has no source auth.users row: ${sourceUid}`)
  return errors
}

/** Build parameterized writes. Never serialize or log the returned parameters. */
export function buildAuthMigrationPlan(
  users: readonly FrozenAuthUser[],
  identities: readonly FrozenAuthIdentity[],
  uidMappings: readonly AuthUidMapping[],
): AuthMigrationPlan {
  const errors = validateFrozenAuthSnapshot(users, identities, uidMappings)
  if (errors.length) throw new Error(errors.join('; '))
  const mappingBySource = new Map(uidMappings.map((mapping) => [mapping.sourceUid, mapping]))
  const identitiesByUser = new Map<string, FrozenAuthIdentity[]>()
  for (const identity of identities) identitiesByUser.set(identity.userId, [...(identitiesByUser.get(identity.userId) ?? []), identity])

  const writes: AuthTargetWrite[] = []
  const audit: AuthMigrationAudit[] = []
  for (const user of users) {
    const mapping = mappingBySource.get(user.id)!
    // Roles/permissions are accepted only from app_metadata; the trusted target
    // executor must additionally materialize them in the 4.0 permission tables.
    writes.push({
      statement: 'select team_os_4_migration.import_auth_user($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      parameters: [mapping.targetUid, user.email, user.phone, user.encryptedPassword, user.emailConfirmedAt, user.phoneConfirmedAt, user.bannedUntil, user.createdAt, user.updatedAt, user.appMetadata, user.userMetadata],
    })
    for (const identity of identitiesByUser.get(user.id) ?? []) writes.push({
      statement: 'select team_os_4_migration.import_auth_identity($1,$2,$3,$4,$5,$6)',
      parameters: [identity.id, mapping.targetUid, identity.provider, identity.providerIdentityId, identity.createdAt, identity.updatedAt],
    })
    audit.push({
      sourceUid: user.id,
      targetUid: mapping.targetUid,
      uidStrategy: mapping.strategy,
      identityCount: identitiesByUser.get(user.id)?.length ?? 0,
      migratedAuditFields: ['created_at', 'updated_at', 'email_confirmed_at', 'phone_confirmed_at', 'banned_until'],
      authorizationSource: 'app_metadata-and-team-os-4-permissions-only',
      passwordHashLogged: false,
      forceReauthentication: true,
    })
  }
  return { writes, audit, invalidateAllLegacySessions: true }
}
