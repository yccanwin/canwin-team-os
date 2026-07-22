import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p8/team-os-4-clean-delivery-contract.json'), 'utf8'))

assert.equal(contract.schemaVersion, 1)
assert.equal(contract.phase, 'P8')
assert.equal(contract.artifactKind, 'team-os-4-clean-installation-package')
assert.equal(contract.status, 'pending')
assert.deepEqual(contract.deliveryRoots, [
  'apps/team-os-4',
  'packages/team-os-4-domain',
  'platform/team-os-4',
])
assert.deepEqual(contract.requiredTopLevelInventory, ['VERSION', 'LICENSE', 'NOTICE', 'DELIVERY.json', 'MANIFEST.sha256'])
assert.deepEqual(contract.requiredDeliveryMetadataFields, [
  'product', 'artifactKind', 'version', 'code_commit', 'built_at', 'license_file', 'notice_file',
  'source_roots', 'contains_exported_business_data', 'contains_credentials',
])
assert.deepEqual(contract.forbiddenBusinessData, [
  'employee-records', 'customer-records', 'orders', 'financial-records',
  'business-logs', 'cases', 'images', 'auth-users',
])
assert.deepEqual(contract.forbiddenSecretKinds, [
  'service-role-key', 'anon-or-publishable-key', 'jwt-secret', 'database-password',
  'access-token', 'refresh-token', 'private-key', 'webhook-secret',
])
assert.deepEqual(contract.forbiddenFilePatterns, [
  '.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx', '*.dump', '*.backup',
  '*.sql.gz', '*.log', '*.png', '*.jpg', '*.jpeg', '*.webp', '*.gif', '*.svg',
])
assert.deepEqual(contract.forbiddenDirectories, [
  'node_modules', 'dist', '.vite', '.temp', 'exports',
  'snapshots', 'fixtures', 'evidence', 'cache',
])
assert.equal(contract.allowedNonSecretEnvironmentTemplate, 'apps/team-os-4/.env.example')
assert.equal(contract.businessSeedDataAllowed, false)
assert.equal(contract.fixturesMocksDemoDataAllowed, false)
assert.equal(contract.authUserExportAllowed, false)
assert.equal(contract.storageObjectExportAllowed, false)
assert.equal(contract.source3MigrationsAllowed, false)
assert.equal(contract.source3MigrationPath, 'supabase/migrations')
assert.equal(contract.target4MigrationPath, 'platform/team-os-4/supabase/migrations')
assert.deepEqual(contract.migrationTool, {
  path: 'tools/migrate-3-to-4',
  includedInCleanInstallationPackage: false,
  artifactKind: 'separate-offline-one-shot-migration-tool',
  mayContainExportedBusinessData: false,
  mayContainCredentials: false,
})
assert.equal(contract.packageAssemblyRule, 'explicit-allowlist-only')
assert.equal(contract.packageVerificationRule, 'unpack-and-scan-every-file-before-signing')
assert.equal(contract.runtimeEvidence, 'pending')
assert.equal(contract.p8Accepted, false)

// This verifier freezes package policy only. A real unpacked artifact must later
// be scanned byte-for-byte before runtime evidence or P8 acceptance can change.
console.log('Team OS 4.0 P8 clean-delivery contract is structurally valid; artifact evidence remains pending.')
