import { validateMigrationManifest, type MigrationPackageManifest } from './manifest.ts'

const valid: MigrationPackageManifest = {
  schemaVersion: 1,
  mode: 'offline-signed-snapshot',
  candidateAttempt: '1/1',
  sourceSystem: 'canwin-team-os-3.0',
  sourceSnapshotSha256: 'a'.repeat(64),
  snapshotManifestSha256: 'd'.repeat(64),
  signatureAlgorithm: 'ed25519',
  signerKeyId: 'offline-freeze-key-1',
  sourceFreezeVerifiedAt: '2026-07-22T00:00:00.000Z',
  migrationCodeCommit: 'b'.repeat(40),
  targetProjectRef: 'c'.repeat(20),
  targetIsBlank: true,
  migrationModeEnabled: true,
  sourceNetworkCredentialsIncluded: false,
  dispositions: { import: 0, merge: 0, archive: 0, discard: 0, reject: 0 },
}

if (validateMigrationManifest(valid).length !== 0) throw new Error('valid manifest rejected')

const unsafe = { ...valid, sourceEndpoint: 'postgresql://legacy.example' }
if (!validateMigrationManifest(unsafe).includes('manifest contains a forbidden online credential or endpoint marker')) {
  throw new Error('online source endpoint was not rejected')
}

console.log('TEAM_OS_4_MIGRATION_MANIFEST_SELFTEST_OK positive=1 negative=1 sourceNetwork=0')
