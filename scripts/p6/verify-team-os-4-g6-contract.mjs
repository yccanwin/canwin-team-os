import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p6/team-os-4-g6-acceptance-contract.json'), 'utf8'))

assert.equal(contract.schemaVersion, 1)
assert.equal(contract.phase, 'G6')
assert.equal(contract.acceptedProgressBefore, 70)
assert.deepEqual(contract.checkpoints.map(({ progress, status }) => [progress, status]), [[75, 'pending'], [80, 'pending']])
assert.deepEqual(contract.checkpoints[0].required, [
  'sales-core-day', 'implementation-core-day', 'operations-core-day', 'finance-core-day', 'admin-core-day',
  'ordinary-user-management-pages-denied',
])
assert.deepEqual(contract.checkpoints[1].required, [
  'mobile-core-actions',
  'case-customer-display-authorization',
  'case-admin-review',
  'authorization-revocation-unpublishes-case',
  'case-public-projection-isolation',
  'case-image-slot-policy',
  'case-storage-policy',
])
assert.deepEqual(contract.contracts.coreDayRoles, ['sales', 'implementation', 'operations', 'finance', 'admin'])
assert.deepEqual(Object.keys(contract.contracts.coreDayByRole), contract.contracts.coreDayRoles)
for (const role of contract.contracts.coreDayRoles) {
  assert.ok(contract.contracts.coreDayByRole[role].includes('today-work'))
  assert.ok(contract.contracts.coreDayByRole[role].length >= 7)
}
assert.deepEqual(contract.contracts.ordinaryUserForbiddenManagementAreas, [
  'organization-role-and-permission',
  'catalog-price-warehouse-and-service-management',
  'global-customer-brand-and-store-management',
  'global-finance-cost-and-settlement',
  'case-publication-management',
  'system-settings',
])
assert.deepEqual(contract.contracts.mobileActions, ['today-work', 'progress', 'calendar', 'role-business', 'profile'])
assert.deepEqual(contract.contracts.mobileFixedOrder, contract.contracts.mobileActions)
assert.deepEqual(contract.contracts.mobileRoleBusinessByRole, {
  sales: 'sales-customers',
  implementation: 'implementation-tasks',
  operations: 'operations-services',
  finance: 'finance-receipts',
  admin: 'admin-approvals',
})
assert.deepEqual(contract.contracts.mobileTopbar, ['messages'])
assert.deepEqual(contract.contracts.mobileHighFrequencyActions, [
  'view-today-work', 'record-follow-up', 'contact-customer',
  'process-implementation-or-operations-step', 'view-order-status', 'complete-personal-task',
])
assert.deepEqual(contract.contracts.desktopOnlyCompleteAreas, [
  'catalog-maintenance', 'general-ledger', 'permission-configuration', 'bulk-import', 'complex-reporting',
])
assert.deepEqual(contract.contracts.casePublicationRequires, ['customer-display-authorization', 'admin-review'])
assert.equal(contract.contracts.caseCandidateSource, 'one-candidate-per-completed-store-fulfillment')
assert.equal(contract.contracts.caseCandidateAutoPublic, false)
assert.deepEqual(contract.contracts.caseTextContributors, [
  'participating-sales', 'participating-implementation', 'participating-operations', 'admin',
])
assert.deepEqual(contract.contracts.authorizationRecords, [
  'status', 'source', 'external_evidence_reference', 'scope', 'valid_from', 'valid_until',
  'revoked_at', 'revoked_by', 'reason',
])
assert.equal(contract.contracts.authorizationEvidenceUploadAllowed, false)
assert.equal(contract.contracts.authorizationMustBeValidAtPublication, true)
assert.deepEqual(contract.contracts.caseLifecycleAdminActions, ['edit', 'publish', 'unpublish', 'archive'])
assert.equal(contract.contracts.authorizationRevocation, 'immediate-unpublish-and-public-projection-removal')
assert.equal(contract.contracts.authorizationRevocationRetains, 'private-internal-candidate')
assert.deepEqual(contract.contracts.authorizationRevocationDeletes, ['public-logo-copy', 'public-display-code-copy'])
assert.equal(contract.contracts.publicWebsiteSource, 'desensitized-published-case-projection-only')
assert.equal(contract.contracts.anonymousInternalCaseTableAccessAllowed, false)
assert.deepEqual(contract.contracts.publicCaseProjectionForbidden, [
  'contact', 'phone', 'detailed-address', 'quote', 'internal-price', 'sales-profit', 'company-profit',
  'internal-operation-record',
])
assert.equal(contract.contracts.publicCaseProjectionAllowlist.length, 13)
assert.deepEqual(contract.contracts.allowedImageSlots, ['logo', 'display_code'])
assert.equal(contract.contracts.maxImagesPerCase, 2)
assert.equal(contract.contracts.thirdImageRejected, true)
assert.deepEqual(contract.contracts.imageMimeAllowlist, ['image/png', 'image/jpeg', 'image/webp'])
assert.deepEqual(contract.contracts.maxImageBytesBySlot, { logo: 204800, display_code: 307200 })
assert.deepEqual(contract.contracts.imageExtensionAllowlist, ['png', 'jpg', 'jpeg', 'webp'])
assert.deepEqual(contract.contracts.imageFormatsRejected, ['svg', 'gif'])
assert.deepEqual(contract.contracts.imageEnforcementLayers, ['frontend', 'storage-path-policy', 'database-api'])
assert.deepEqual(contract.contracts.caseImageUploaders, ['admin'])
assert.deepEqual(contract.contracts.caseImageUploadDeniedRoles, ['sales', 'implementation', 'operations', 'finance', 'anon'])
assert.equal(contract.contracts.draftImageLocation, 'private-case-bucket')
assert.equal(contract.contracts.publishedImageLocation, 'separate-public-case-directory')
assert.equal(contract.contracts.publicImageCopyCondition, 'authorized-and-admin-reviewed-case-publication')
assert.equal(contract.contracts.publicImageWriteAuthority, 'trusted-server-only')
assert.equal(contract.contracts.browserServiceRoleAllowed, false)
assert.deepEqual(contract.contracts.storageReplacementRequires, ['insert', 'select', 'update'])
assert.deepEqual(contract.contracts.storageObjectPathMustBind, ['company_id', 'case_id', 'slot'])
assert.equal(contract.contracts.allowedImagesRequireIndependentFileBackup, true)
assert.equal(contract.contracts.allOtherUploadsAllowed, false)
assert.deepEqual(contract.contracts.removedUploadSurfaces, [
  'team-album', 'photo-upload', 'achievement-image', 'avatar', 'receipt', 'delivery-photo', 'ordinary-attachment',
])
assert.equal(contract.contracts.rlsAndStoragePoliciesRequired, true)
assert.deepEqual(contract.contracts.storagePolicyRequiredChecks, [
  'explicit-grant', 'rls-enabled', 'company-admin-write-authorization', 'private-draft-read-isolation',
  'anonymous-public-read-only', 'slot-path-validation', 'mime-validation', 'size-validation',
  'third-image-rejection', 'revocation-public-copy-deletion',
])
assert.equal(contract.contracts.fixturesMocksOrDemoDataAllowed, false)
assert.deepEqual(contract.requiredRuntimeEvidence.roleAccounts, [
  'sales', 'implementation', 'operations', 'finance', 'admin', 'unauthorized-attacker',
])
assert.equal(contract.requiredRuntimeEvidence.roleDay, 'real-account-real-page-real-api')
assert.deepEqual(contract.requiredRuntimeEvidence.mobileWidths, [360, 390, 430])
assert.equal(contract.requiredRuntimeEvidence.mobile, 'five-fixed-entries-and-role-specific-fourth-entry')
assert.equal(contract.requiredRuntimeEvidence.caseAuthorization, 'publish-denied-without-valid-authorization-or-admin-review-and-revocation-removes-public-projection')
assert.equal(contract.requiredRuntimeEvidence.storage, 'allowed-two-slots-pass-and-all-role-path-mime-size-count-attacks-denied')
for (const field of ['runtimeEvidence', 'mobileEvidence', 'caseAuthorizationEvidence', 'storageEvidence']) assert.equal(contract[field], 'pending')
assert.equal(contract.g6Accepted, false)

console.log('TEAM_OS_4_G6_CONTRACT_OK checkpoints=75,80 roles=5 imageSlots=2 thirdImage=denied authorizationRevocation=unpublish runtime=pending mobile=pending case=pending storage=pending gateIntegrated=0')
