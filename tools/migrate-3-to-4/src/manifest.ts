export const DISPOSITIONS = ['import', 'merge', 'archive', 'discard', 'reject'] as const

export type Disposition = (typeof DISPOSITIONS)[number]

export interface MigrationPackageManifest {
  schemaVersion: 1
  mode: 'offline-signed-snapshot'
  candidateAttempt: '1/1'
  sourceSystem: 'canwin-team-os-3.0'
  sourceSnapshotSha256: string
  snapshotManifestSha256: string
  signatureAlgorithm: 'ed25519'
  signerKeyId: string
  sourceFreezeVerifiedAt: string
  migrationCodeCommit: string
  targetProjectRef: string
  targetIsBlank: true
  migrationModeEnabled: true
  sourceNetworkCredentialsIncluded: false
  dispositions: Record<Disposition, number>
}

const SHA256 = /^[a-f0-9]{64}$/
const PROJECT_REF = /^[a-z0-9]{20}$/
const GIT_COMMIT = /^[a-f0-9]{40}$/

export function validateMigrationManifest(value: unknown): string[] {
  const errors: string[] = []
  if (!value || typeof value !== 'object') return ['manifest must be an object']

  const manifest = value as Partial<MigrationPackageManifest>
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  if (manifest.mode !== 'offline-signed-snapshot') errors.push('only offline signed snapshots are allowed')
  if (manifest.candidateAttempt !== '1/1') errors.push('each target project allows one formal attempt')
  if (manifest.sourceSystem !== 'canwin-team-os-3.0') errors.push('source system mismatch')
  if (!SHA256.test(manifest.sourceSnapshotSha256 ?? '')) errors.push('source snapshot SHA-256 is invalid')
  if (!SHA256.test(manifest.snapshotManifestSha256 ?? '')) errors.push('snapshot manifest SHA-256 is invalid')
  if (manifest.signatureAlgorithm !== 'ed25519') errors.push('only ed25519 signatures are allowed')
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(manifest.signerKeyId ?? '')) errors.push('signer key id is invalid')
  if (Number.isNaN(Date.parse(manifest.sourceFreezeVerifiedAt ?? ''))) errors.push('source freeze time is invalid')
  if (!GIT_COMMIT.test(manifest.migrationCodeCommit ?? '')) errors.push('migration commit must be a full SHA')
  if (!PROJECT_REF.test(manifest.targetProjectRef ?? '')) errors.push('target project ref is invalid')
  if (manifest.targetIsBlank !== true) errors.push('target must be blank')
  if (manifest.migrationModeEnabled !== true) errors.push('migration mode must be enabled')
  if (manifest.sourceNetworkCredentialsIncluded !== false) errors.push('source network credentials are forbidden')

  const dispositions = manifest.dispositions
  for (const disposition of DISPOSITIONS) {
    const count = dispositions?.[disposition]
    if (!Number.isInteger(count) || (count ?? -1) < 0) errors.push(`${disposition} count must be a non-negative integer`)
  }

  const serialized = JSON.stringify(value)
  if (/service[_-]?role|postgres(?:ql)?:\/\/|supabase\.co|refresh[_-]?token|access[_-]?token/i.test(serialized)) {
    errors.push('manifest contains a forbidden online credential or endpoint marker')
  }

  return errors
}
