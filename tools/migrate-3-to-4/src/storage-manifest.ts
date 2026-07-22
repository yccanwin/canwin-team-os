import { createHash } from 'node:crypto'

export const STORAGE_DISPOSITIONS = ['case_logo', 'case_display_code', 'archive'] as const
export type StorageDisposition = (typeof STORAGE_DISPOSITIONS)[number]

export interface StorageManifestEntry {
  sourceBucket: string
  sourcePath: string
  sizeBytes: number
  mimeType: string
  sha256: string
  ownerId: string | null
  sourceRecordType: string
  sourceRecordId: string
  disposition: StorageDisposition
  targetBucket: string | null
  targetPath: string | null
  archivePackagePath: string | null
}

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[^\\\u0000-\u001f]+$/
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function validateStorageManifest(entries: readonly StorageManifestEntry[]): string[] {
  const errors: string[] = []
  const sources = new Set<string>()
  const targets = new Set<string>()

  if (entries.length === 0) errors.push('storage manifest must not be empty')
  entries.forEach((entry, index) => {
    const at = `storage[${index}]`
    const sourceKey = `${entry.sourceBucket}/${entry.sourcePath}`
    if (!entry.sourceBucket.trim()) errors.push(`${at}: source bucket is required`)
    if (!SAFE_PATH.test(entry.sourcePath)) errors.push(`${at}: source path is invalid`)
    if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0) errors.push(`${at}: size must be a non-negative safe integer`)
    if (!SHA256.test(entry.sha256)) errors.push(`${at}: SHA-256 is invalid`)
    if (!entry.mimeType.trim()) errors.push(`${at}: MIME type is required`)
    if (!entry.sourceRecordType.trim() || !entry.sourceRecordId.trim()) errors.push(`${at}: source record identity is required`)
    if (sources.has(sourceKey)) errors.push(`${at}: duplicate source object ${sourceKey}`)
    sources.add(sourceKey)

    if (entry.disposition === 'archive') {
      if (entry.targetBucket !== null || entry.targetPath !== null) errors.push(`${at}: archived objects must not have a 4.0 target location`)
      if (!entry.archivePackagePath || !SAFE_PATH.test(entry.archivePackagePath)) errors.push(`${at}: archived object requires a safe encrypted archive package path`)
      return
    }

    if (!ALLOWED_IMAGE_MIME.has(entry.mimeType)) errors.push(`${at}: only PNG, JPEG or WebP case images may enter 4.0`)
    const limit = entry.disposition === 'case_logo' ? 204_800 : 307_200
    if (entry.sizeBytes > limit) errors.push(`${at}: object exceeds ${entry.disposition} byte limit`)
    if (entry.archivePackagePath !== null) errors.push(`${at}: imported case image must not have an archive package path`)
    if (!entry.targetBucket?.trim()) errors.push(`${at}: imported case image requires a target bucket`)
    if (!entry.targetPath || !SAFE_PATH.test(entry.targetPath)) errors.push(`${at}: imported case image requires a safe target path`)
    if (entry.targetBucket && entry.targetPath) {
      const targetKey = `${entry.targetBucket}/${entry.targetPath}`
      if (targets.has(targetKey)) errors.push(`${at}: duplicate target object ${targetKey}`)
      targets.add(targetKey)
    }
  })
  return errors
}

export interface StorageObjectEvidence {
  bucket: string
  path: string
  sizeBytes: number
  mimeType: string
  sha256: string
  bytes: Uint8Array
}

export function reconcileStorageObject(expected: StorageManifestEntry, actual: StorageObjectEvidence): string[] {
  const errors: string[] = []
  const actualHash = createHash('sha256').update(actual.bytes).digest('hex')
  if (expected.targetBucket === null || expected.targetPath === null) return ['archived object must not exist in 4.0 storage']
  if (actual.bucket !== expected.targetBucket) errors.push('target bucket mismatch')
  if (actual.path !== expected.targetPath) errors.push('target path mismatch')
  if (actual.sizeBytes !== expected.sizeBytes) errors.push('metadata size mismatch')
  if (actual.mimeType !== expected.mimeType) errors.push('metadata MIME mismatch')
  if (actual.sha256 !== expected.sha256) errors.push('metadata SHA-256 mismatch')
  if (actual.bytes.byteLength !== expected.sizeBytes) errors.push('object byte length mismatch')
  if (actualHash !== expected.sha256) errors.push('object bytes SHA-256 mismatch')
  return errors
}

export function reconcileArchivedObject(expected: StorageManifestEntry, archivePath: string, bytes: Uint8Array): string[] {
  if (expected.disposition !== 'archive' || expected.archivePackagePath === null) return ['object is not assigned to the encrypted archive']
  const errors: string[] = []
  if (archivePath !== expected.archivePackagePath) errors.push('archive package path mismatch')
  if (bytes.byteLength !== expected.sizeBytes) errors.push('archived object byte length mismatch')
  if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256) errors.push('archived object SHA-256 mismatch')
  return errors
}

export function buildInsertOnlyStoragePlan(entries: readonly StorageManifestEntry[], occupiedTargetObjects: ReadonlySet<string>): StorageManifestEntry[] {
  const errors = validateStorageManifest(entries)
  if (errors.length) throw new Error(`invalid storage manifest: ${errors.join('; ')}`)
  const plan = entries.filter((entry) => entry.disposition !== 'archive')
  for (const entry of plan) {
    const targetKey = `${entry.targetBucket}/${entry.targetPath}`
    if (occupiedTargetObjects.has(targetKey)) throw new Error(`target object already exists; overwrite forbidden: ${targetKey}`)
  }
  return plan
}
