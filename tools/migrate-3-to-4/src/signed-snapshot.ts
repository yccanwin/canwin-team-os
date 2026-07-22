import { createHash, verify } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { validateMigrationManifest, type MigrationPackageManifest } from './manifest.ts'

export interface SnapshotFile { path: string; size: number; sha256: string }
export interface SnapshotInventory { schemaVersion: 1; files: SnapshotFile[] }
export interface SignedSnapshotEnvelope {
  manifest: MigrationPackageManifest
  inventory: SnapshotInventory
  signatureBase64: string
}

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function validateSnapshotEnvelope(envelope: SignedSnapshotEnvelope, trustedPublicKeyPem: string): string[] {
  const errors = validateMigrationManifest(envelope.manifest)
  if (envelope.inventory.schemaVersion !== 1) errors.push('snapshot inventory schemaVersion must be 1')
  if (!Array.isArray(envelope.inventory.files) || envelope.inventory.files.length === 0) errors.push('snapshot inventory must not be empty')
  const paths = new Set<string>()
  for (const file of envelope.inventory.files ?? []) {
    if (!SAFE_PATH.test(file.path) || file.path.includes('\\')) errors.push(`unsafe snapshot path: ${file.path}`)
    if (paths.has(file.path)) errors.push(`duplicate snapshot path: ${file.path}`)
    paths.add(file.path)
    if (!Number.isSafeInteger(file.size) || file.size < 0) errors.push(`invalid snapshot size: ${file.path}`)
    if (!SHA256.test(file.sha256)) errors.push(`invalid snapshot digest: ${file.path}`)
  }
  if (sha256(canonical(envelope.inventory)) !== envelope.manifest.snapshotManifestSha256) {
    errors.push('snapshot inventory digest does not match signed manifest')
  }
  const payload = canonical({ manifest: envelope.manifest, inventory: envelope.inventory })
  if (!/^[A-Za-z0-9+/]{86}==$/.test(envelope.signatureBase64)) errors.push('snapshot signature is not canonical base64')
  const signature = Buffer.from(envelope.signatureBase64, 'base64')
  try {
    if (signature.length !== 64 || !verify(null, Buffer.from(payload), trustedPublicKeyPem, signature)) {
      errors.push('snapshot signature verification failed')
    }
  } catch {
    errors.push('snapshot signature verification failed')
  }
  return errors
}

export async function verifySnapshotFiles(root: string, inventory: SnapshotInventory): Promise<string[]> {
  const errors: string[] = []
  const absoluteRoot = resolve(root)
  for (const expected of inventory.files) {
    const absoluteFile = resolve(absoluteRoot, expected.path)
    if (absoluteFile !== absoluteRoot && !absoluteFile.startsWith(`${absoluteRoot}${sep}`)) {
      errors.push(`snapshot file escapes package root: ${expected.path}`)
      continue
    }
    try {
      const bytes = await readFile(absoluteFile)
      if (bytes.byteLength !== expected.size) errors.push(`snapshot file size mismatch: ${expected.path}`)
      if (sha256(bytes) !== expected.sha256) errors.push(`snapshot file digest mismatch: ${expected.path}`)
    } catch {
      errors.push(`snapshot file missing or unreadable: ${expected.path}`)
    }
  }
  return errors
}

export function canonicalSnapshotInventory(inventory: SnapshotInventory): string { return canonical(inventory) }
