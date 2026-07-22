export const BACKUP_DOMAINS = ['database', 'auth', 'storage'] as const
export type BackupDomain = (typeof BACKUP_DOMAINS)[number]

export interface BackupArtifact {
  domain: BackupDomain
  /** Relative path inside the sealed backup package. */
  path: string
  sizeBytes: number
  sha256: string
  createdAt: string
}

export interface BackupCatalog {
  schemaVersion: 1
  backupId: string
  sourceCutoffAt: string
  completedAt: string
  packageRoot: string
  artifacts: readonly BackupArtifact[]
}

export interface RestoredDomainEvidence {
  domain: BackupDomain
  artifactSha256: string
  restoreStartedAt: string
  restoreCompletedAt: string
  verifiedAt: string
  expectedItems: number
  restoredItems: number
  verification: 'passed' | 'failed'
}

export interface RecoveryDrillEvidence {
  schemaVersion: 1
  drillId: string
  backupId: string
  isolatedTargetProjectRef: string
  isolatedTargetConfirmed: true
  startedAt: string
  acceptedAt: string
  targetDisposition: 'destroyed' | 'sealed-for-evidence'
  domains: readonly RestoredDomainEvidence[]
  rpoObjectiveSeconds: number
  rtoObjectiveSeconds: number
}

export interface RecoveryObjectivesEvidence {
  rpoActualSeconds: number
  rpoObjectiveSeconds: number
  rpoMet: boolean
  rtoActualSeconds: number
  rtoObjectiveSeconds: number
  rtoMet: boolean
}

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ID = /^[A-Za-z0-9._-]{1,100}$/
const PROJECT_REF = /^[a-z0-9]{20}$/
const SAFE_RELATIVE_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[A-Za-z0-9._/-]+$/
const FORBIDDEN_SECRET = /(?:service[_-]?role|secret|password|passwd|private[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer|postgres(?:ql)?:\/\/|eyJ[a-zA-Z0-9_-]{10,})/i

function secondsBetween(from: string, to: string): number {
  const start = Date.parse(from)
  const end = Date.parse(to)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return Number.NaN
  return (end - start) / 1000
}

function containsForbiddenSecret(value: unknown): boolean {
  return FORBIDDEN_SECRET.test(JSON.stringify(value))
}

export function validateBackupCatalog(catalog: BackupCatalog): string[] {
  const errors: string[] = []
  if (catalog.schemaVersion !== 1) errors.push('backup catalog schemaVersion must be 1')
  if (!SAFE_ID.test(catalog.backupId)) errors.push('backup id is invalid')
  if (!SAFE_RELATIVE_PATH.test(catalog.packageRoot)) errors.push('backup package root must be a safe relative path')
  if (!Number.isFinite(secondsBetween(catalog.sourceCutoffAt, catalog.completedAt))) errors.push('backup time window is invalid')
  if (!Array.isArray(catalog.artifacts) || catalog.artifacts.length === 0) errors.push('backup artifacts must not be empty')

  const paths = new Set<string>()
  const domains = new Set<BackupDomain>()
  const cutoffAt = Date.parse(catalog.sourceCutoffAt)
  const completedAt = Date.parse(catalog.completedAt)
  for (const [index, artifact] of (catalog.artifacts ?? []).entries()) {
    const at = `artifacts[${index}]`
    if (!BACKUP_DOMAINS.includes(artifact.domain)) errors.push(`${at}: backup domain is invalid`)
    domains.add(artifact.domain)
    if (!SAFE_RELATIVE_PATH.test(artifact.path)) errors.push(`${at}: artifact path is invalid`)
    if (paths.has(artifact.path)) errors.push(`${at}: artifact path is duplicated`)
    paths.add(artifact.path)
    if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) errors.push(`${at}: artifact size must be a positive safe integer`)
    if (!SHA256.test(artifact.sha256)) errors.push(`${at}: artifact SHA-256 is invalid`)
    const createdAt = Date.parse(artifact.createdAt)
    if (!Number.isFinite(createdAt)) errors.push(`${at}: creation time is invalid`)
    if (Number.isFinite(createdAt) && (createdAt < cutoffAt || createdAt > completedAt)) errors.push(`${at}: creation time is outside the backup window`)
    if (artifact.path.toLowerCase().includes(artifact.domain) === false) errors.push(`${at}: domain must be visible in artifact path`)
  }
  for (const domain of BACKUP_DOMAINS) if (!domains.has(domain)) errors.push(`${domain} backup is missing`)
  if (containsForbiddenSecret(catalog)) errors.push('backup catalog contains a forbidden credential marker')
  return errors
}

export function validateRecoveryDrill(catalog: BackupCatalog, drill: RecoveryDrillEvidence): string[] {
  const errors = validateBackupCatalog(catalog)
  if (drill.schemaVersion !== 1) errors.push('recovery drill schemaVersion must be 1')
  if (!SAFE_ID.test(drill.drillId)) errors.push('recovery drill id is invalid')
  if (drill.backupId !== catalog.backupId) errors.push('recovery drill backup id mismatch')
  if (!PROJECT_REF.test(drill.isolatedTargetProjectRef)) errors.push('isolated target project ref is invalid')
  if (drill.isolatedTargetConfirmed !== true) errors.push('recovery target isolation is not confirmed')
  if (!Number.isFinite(secondsBetween(drill.startedAt, drill.acceptedAt))) errors.push('recovery drill time window is invalid')
  if (!Number.isFinite(secondsBetween(catalog.completedAt, drill.startedAt))) errors.push('recovery drill must start after backup completion')
  if (!Number.isSafeInteger(drill.rpoObjectiveSeconds) || drill.rpoObjectiveSeconds < 0) errors.push('RPO objective is invalid')
  if (!Number.isSafeInteger(drill.rtoObjectiveSeconds) || drill.rtoObjectiveSeconds <= 0) errors.push('RTO objective is invalid')

  const domains = new Set<BackupDomain>()
  for (const [index, restored] of (drill.domains ?? []).entries()) {
    const at = `domains[${index}]`
    if (!BACKUP_DOMAINS.includes(restored.domain)) errors.push(`${at}: restore domain is invalid`)
    if (domains.has(restored.domain)) errors.push(`${at}: restore domain is duplicated`)
    domains.add(restored.domain)
    if (!SHA256.test(restored.artifactSha256)) errors.push(`${at}: restored artifact SHA-256 is invalid`)
    if (!catalog.artifacts.some((artifact) => artifact.domain === restored.domain && artifact.sha256 === restored.artifactSha256)) {
      errors.push(`${at}: restored artifact is absent from backup catalog`)
    }
    if (!Number.isFinite(secondsBetween(restored.restoreStartedAt, restored.restoreCompletedAt))) errors.push(`${at}: restore time window is invalid`)
    if (!Number.isFinite(secondsBetween(restored.restoreCompletedAt, restored.verifiedAt))) errors.push(`${at}: verification time window is invalid`)
    if (!Number.isSafeInteger(restored.expectedItems) || restored.expectedItems < 0) errors.push(`${at}: expected item count is invalid`)
    if (!Number.isSafeInteger(restored.restoredItems) || restored.restoredItems < 0) errors.push(`${at}: restored item count is invalid`)
    if (restored.expectedItems !== restored.restoredItems) errors.push(`${at}: restored item count mismatch`)
    if (restored.verification !== 'passed') errors.push(`${at}: restore verification did not pass`)
  }
  for (const domain of BACKUP_DOMAINS) if (!domains.has(domain)) errors.push(`${domain} recovery evidence is missing`)
  if (containsForbiddenSecret(drill)) errors.push('recovery evidence contains a forbidden credential marker')
  return errors
}

export function calculateRecoveryObjectives(catalog: BackupCatalog, drill: RecoveryDrillEvidence): RecoveryObjectivesEvidence {
  const errors = validateRecoveryDrill(catalog, drill)
  if (errors.length) throw new Error(`backup recovery evidence is invalid: ${errors.join('; ')}`)
  // The source cutoff is the latest recoverable point; drill start represents
  // the simulated incident. Their gap is the demonstrated data-loss window.
  const rpoActualSeconds = secondsBetween(catalog.sourceCutoffAt, drill.startedAt)
  const rtoActualSeconds = secondsBetween(drill.startedAt, drill.acceptedAt)
  return {
    rpoActualSeconds,
    rpoObjectiveSeconds: drill.rpoObjectiveSeconds,
    rpoMet: rpoActualSeconds <= drill.rpoObjectiveSeconds,
    rtoActualSeconds,
    rtoObjectiveSeconds: drill.rtoObjectiveSeconds,
    rtoMet: rtoActualSeconds <= drill.rtoObjectiveSeconds,
  }
}

export function assertRecoveryAccepted(catalog: BackupCatalog, drill: RecoveryDrillEvidence): RecoveryObjectivesEvidence {
  const objectives = calculateRecoveryObjectives(catalog, drill)
  if (!objectives.rpoMet || !objectives.rtoMet) throw new Error('recovery drill did not meet RPO/RTO objectives')
  return objectives
}
