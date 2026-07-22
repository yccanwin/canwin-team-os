export const REQUIRED_CONTROL_PLANE_CLOSURES = [
  'disable-login',
  'disable-registration',
  'disable-token-refresh',
  'deny-rest-dml',
  'deny-rpc-dml',
  'deny-storage-write',
  'disable-edge-functions',
  'disable-cron',
  'disable-webhooks',
  'disable-notifications',
  'revoke-ordinary-dml',
  'revoke-write-rpc',
  'remove-online-high-privilege-credentials',
] as const

export const FREEZE_FINGERPRINT_CLASSES = [
  'table-rows',
  'money',
  'inventory',
  'auth',
  'storage',
] as const

export const ATTACKERS = [
  'anonymous',
  'ordinary-user',
  'old-session',
  'direct-api-attacker',
] as const

export const ATTACK_SURFACES = [
  'auth-login',
  'auth-register',
  'auth-refresh',
  'rest-dml',
  'rpc-write',
  'storage-write',
  'function',
  'cron',
  'webhook',
  'notification',
] as const

type ControlPlaneClosure = (typeof REQUIRED_CONTROL_PLANE_CLOSURES)[number]
type FingerprintClass = (typeof FREEZE_FINGERPRINT_CLASSES)[number]
type Attacker = (typeof ATTACKERS)[number]
type AttackSurface = (typeof ATTACK_SURFACES)[number]

export interface SignedFingerprint {
  class: FingerprintClass
  phase: 'before-freeze' | 'after-freeze'
  capturedAt: string
  sha256: string
  signatureAlgorithm: 'ed25519'
  signerKeyId: string
  signatureBase64: string
}

export interface ControlPlaneClosureEvidence {
  item: ControlPlaneClosure
  closed: true
  observedAt: string
  evidenceSha256: string
}

export interface AttackEvidence {
  attacker: Attacker
  surface: AttackSurface
  attemptedAt: string
  result: 'denied'
  evidenceSha256: string
}

export interface SourceFreezeEvidence {
  schemaVersion: 1
  evidenceType: 'team-os-3-permanent-read-only-freeze'
  sourceSystem: 'canwin-team-os-3.0'
  freezeStartedAt: string
  controlPlaneClosedAt: string
  freezeVerifiedAt: string
  controlPlaneClosures: readonly ControlPlaneClosureEvidence[]
  fingerprints: readonly SignedFingerprint[]
  attackMatrix: readonly AttackEvidence[]
  onlineHighPrivilegeCredentials: readonly never[]
  packageSha256: string
  signatureAlgorithm: 'ed25519'
  signerKeyId: string
  signatureBase64: string
}

const SHA256 = /^[a-f0-9]{64}$/
const KEY_ID = /^[A-Za-z0-9._-]{1,80}$/
const ED25519_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/

function time(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function uniqueExactCoverage<T extends string>(
  actual: readonly T[],
  required: readonly T[],
  label: string,
  errors: string[],
): void {
  const seen = new Set(actual)
  if (seen.size !== actual.length) errors.push(`${label} contains duplicates`)
  for (const item of required) if (!seen.has(item)) errors.push(`${label} missing ${item}`)
  for (const item of seen) if (!required.includes(item)) errors.push(`${label} contains unknown ${item}`)
}

function validateSignatureFields(value: Pick<SignedFingerprint, 'signatureAlgorithm' | 'signerKeyId' | 'signatureBase64'>, label: string, errors: string[]): void {
  if (value.signatureAlgorithm !== 'ed25519') errors.push(`${label} must use ed25519`)
  if (!KEY_ID.test(value.signerKeyId ?? '')) errors.push(`${label} signer key id is invalid`)
  if (!ED25519_SIGNATURE.test(value.signatureBase64 ?? '')) errors.push(`${label} signature must be a 64-byte base64 Ed25519 signature`)
}

export function validateSourceFreezeEvidence(value: unknown): string[] {
  const errors: string[] = []
  if (!value || typeof value !== 'object') return ['freeze evidence must be an object']
  const evidence = value as Partial<SourceFreezeEvidence>

  if (evidence.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  if (evidence.evidenceType !== 'team-os-3-permanent-read-only-freeze') errors.push('evidence type mismatch')
  if (evidence.sourceSystem !== 'canwin-team-os-3.0') errors.push('source system mismatch')

  const started = time(evidence.freezeStartedAt)
  const closed = time(evidence.controlPlaneClosedAt)
  const verified = time(evidence.freezeVerifiedAt)
  if (started === null || closed === null || verified === null) errors.push('freeze chronology contains an invalid timestamp')
  else if (!(started <= closed && closed <= verified)) errors.push('freeze chronology must be started <= control-plane-closed <= verified')

  const closures = Array.isArray(evidence.controlPlaneClosures) ? evidence.controlPlaneClosures : []
  uniqueExactCoverage(closures.map((entry) => entry.item), REQUIRED_CONTROL_PLANE_CLOSURES, 'control-plane closure coverage', errors)
  for (const entry of closures) {
    if (entry.closed !== true) errors.push(`control-plane item ${entry.item} is not closed`)
    const observed = time(entry.observedAt)
    if (observed === null || started === null || closed === null || observed < started || observed > closed) errors.push(`control-plane item ${entry.item} has invalid chronology`)
    if (!SHA256.test(entry.evidenceSha256 ?? '')) errors.push(`control-plane item ${entry.item} has invalid SHA-256`)
  }

  const fingerprints = Array.isArray(evidence.fingerprints) ? evidence.fingerprints : []
  const fingerprintKeys = fingerprints.map((entry) => `${entry.phase}:${entry.class}`)
  const requiredFingerprintKeys = (['before-freeze', 'after-freeze'] as const)
    .flatMap((phase) => FREEZE_FINGERPRINT_CLASSES.map((item) => `${phase}:${item}`))
  uniqueExactCoverage(fingerprintKeys, requiredFingerprintKeys, 'fingerprint coverage', errors)
  for (const entry of fingerprints) {
    const captured = time(entry.capturedAt)
    if (captured === null) errors.push(`fingerprint ${entry.phase}:${entry.class} has invalid timestamp`)
    else if (entry.phase === 'before-freeze' && started !== null && captured > started) errors.push(`fingerprint before-freeze:${entry.class} was captured too late`)
    else if (entry.phase === 'after-freeze' && closed !== null && verified !== null && (captured < closed || captured > verified)) errors.push(`fingerprint after-freeze:${entry.class} has invalid chronology`)
    if (!SHA256.test(entry.sha256 ?? '')) errors.push(`fingerprint ${entry.phase}:${entry.class} has invalid SHA-256`)
    validateSignatureFields(entry, `fingerprint ${entry.phase}:${entry.class}`, errors)
  }

  const attacks = Array.isArray(evidence.attackMatrix) ? evidence.attackMatrix : []
  const attackKeys = attacks.map((entry) => `${entry.attacker}:${entry.surface}`)
  const requiredAttackKeys = ATTACKERS.flatMap((attacker) => ATTACK_SURFACES.map((surface) => `${attacker}:${surface}`))
  uniqueExactCoverage(attackKeys, requiredAttackKeys, 'attack matrix coverage', errors)
  for (const entry of attacks) {
    if (entry.result !== 'denied') errors.push(`attack ${entry.attacker}:${entry.surface} was not denied`)
    const attempted = time(entry.attemptedAt)
    if (attempted === null || closed === null || verified === null || attempted < closed || attempted > verified) errors.push(`attack ${entry.attacker}:${entry.surface} has invalid chronology`)
    if (!SHA256.test(entry.evidenceSha256 ?? '')) errors.push(`attack ${entry.attacker}:${entry.surface} has invalid SHA-256`)
  }

  if (!Array.isArray(evidence.onlineHighPrivilegeCredentials) || evidence.onlineHighPrivilegeCredentials.length !== 0) {
    errors.push('online high-privilege credential inventory must be present and empty')
  }
  if (!SHA256.test(evidence.packageSha256 ?? '')) errors.push('package SHA-256 is invalid')
  validateSignatureFields(evidence as SourceFreezeEvidence, 'freeze evidence package', errors)
  return errors
}

export function assertSourceFrozen(value: unknown): asserts value is SourceFreezeEvidence {
  const errors = validateSourceFreezeEvidence(value)
  if (errors.length) throw new Error(`source freeze evidence rejected: ${JSON.stringify(errors)}`)
}

// This module validates an already collected, offline evidence package. It does
// not contain source endpoints, credentials or commands capable of changing 3.0.
