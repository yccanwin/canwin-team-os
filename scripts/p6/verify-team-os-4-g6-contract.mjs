import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contract = JSON.parse(readFileSync(resolve(repoRoot, 'scripts/p6/team-os-4-g6-acceptance-contract.json'), 'utf8'))
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8')
const migrationDirectory = resolve(repoRoot, 'platform/team-os-4/supabase/migrations')
const g6MigrationNames = readdirSync(migrationDirectory)
  .filter((name) => /_add_g6_.*\.sql$/i.test(name))
  .sort()
const g6Sql = g6MigrationNames.map((name) => read(`platform/team-os-4/supabase/migrations/${name}`)).join('\n')
const appSource = read('apps/team-os-4/src/App.tsx')
const casesPageSource = read('apps/team-os-4/src/CasesPage.tsx')
const caseReaderSource = read('apps/team-os-4/src/lib/supabase-case-reader.ts')

function requirePattern(source, pattern, label) {
  assert.match(source, pattern, label)
}

function lastMatchIndex(source, pattern) {
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  let last = -1
  for (const match of source.matchAll(globalPattern)) last = match.index
  return last
}

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

// Static construction checks only. These checks deliberately do not promote any
// runtime evidence or checkpoint: real accounts, pages, APIs and Storage attacks
// still have to be accepted against the isolated 4.0 project.
assert.ok(g6MigrationNames.length >= 2, 'G6 must be represented by explicit migrations')

// Anonymous traffic must end on a desensitized projection, never the internal
// cases/case_candidates/case_media tables. A later revoke must override any
// earlier foundation grant while the projection remains anonymously readable.
const lastAnonCasesGrant = lastMatchIndex(g6Sql, /grant\s+select\s+on\s+table\s+public\.cases(?:\s*,\s*public\.case_media)?\s+to\s+anon/gi)
const lastAnonCasesRevoke = lastMatchIndex(g6Sql, /revoke\s+(?:all|select)\s+on\s+table\s+public\.cases(?:\s*,\s*public\.case_media)?\s+from\s+anon/gi)
assert.ok(lastAnonCasesRevoke > lastAnonCasesGrant, 'the final G6 boundary must revoke anonymous access to internal cases')
const publicProjectionView = g6Sql.match(/create\s+(?:or\s+replace\s+)?view\s+public\.([_a-z][_a-z0-9]*)[\s\S]*?\bas\s+select\s+([\s\S]*?)\s+from\s+public\.[_a-z][_a-z0-9]*/i)
assert.ok(publicProjectionView, 'a public case projection view is required')
requirePattern(g6Sql, new RegExp(`grant\\s+select\\s+on\\s+table\\s+public\\.${publicProjectionView[1]}\\s+to\\s+(?:anon\\s*,\\s*authenticated|authenticated\\s*,\\s*anon|anon)`, 'i'), 'anonymous users may select the public projection')

const expectedPublicFields = contract.contracts.publicCaseProjectionAllowlist.map((field) => field.replaceAll('-', '_')).sort()
const selectedPublicFields = publicProjectionView[2].split(',').map((selection) => {
  const normalized = selection.trim()
  const alias = normalized.match(/\s+as\s+([_a-z][_a-z0-9]*)$/i)?.[1]
  return alias ?? normalized.split('.').at(-1).trim()
}).sort()
assert.deepEqual(selectedPublicFields, expectedPublicFields, 'public projection fields must exactly match the G6 allowlist')
for (const field of contract.contracts.publicCaseProjectionForbidden) {
  const sqlField = field.replaceAll('-', '_')
  assert.doesNotMatch(publicProjectionView[2], new RegExp(`\\b${sqlField}\\b`, 'i'), `public projection must not expose ${field}`)
}

// Authorization is a durable credential with evidence reference and a validity
// window. Publication must check the current instant, not a cached boolean only.
for (const token of ['authorization_source', 'authorization_scope', 'authorization_valid_from', 'authorization_valid_until']) {
  requirePattern(g6Sql, new RegExp(`\\b${token}\\b`, 'i'), `missing authorization field ${token}`)
}
requirePattern(g6Sql, /(?:external[_ ]evidence|evidence[_ ]reference)/i, 'authorization requires an external evidence reference')
requirePattern(g6Sql, /authorization_valid_until[\s\S]{0,180}(?:now\(\)|pg_catalog\.now\(\))/i, 'publication must enforce authorization expiry')

requirePattern(g6Sql, /\barchive(?:d|_at)?\b/i, 'case lifecycle must support archive')
for (const action of ['publish', 'unpublish']) {
  requirePattern(g6Sql, new RegExp(`function[\\s\\S]{0,100}${action}[_a-z]*case|${action}[_a-z]*case[\\s\\S]{0,160}security definer`, 'i'), `trusted ${action} case API is required`)
}
requirePattern(g6Sql, /security\s+definer/i, 'trusted publication APIs must be server-side security definer functions')
requirePattern(g6Sql, /revoke\s+all\s+on\s+function[\s\S]{0,180}\bfrom\s+public/i, 'trusted case APIs must not be public execute surfaces')

// Draft objects remain private and public copies live in a separate directory;
// browsers have read-only access to the latter and no write policy.
requirePattern(g6Sql, /'team-os-4-case-media'[\s\S]{0,160}\bfalse\b/i, 'private draft case bucket is required')
requirePattern(g6Sql, /'team-os-4-public-cases'[\s\S]{0,160}\bfalse\b/i, 'separate public case directory is required')
requirePattern(g6Sql, /bucket_id\s*=\s*'team-os-4-public-cases'[\s\S]{0,500}\bto\s+anon\b|for\s+select\s+to\s+anon[\s\S]{0,500}bucket_id\s*=\s*'team-os-4-public-cases'/i, 'anonymous public case media access must be read-only')
assert.doesNotMatch(g6Sql, /create\s+policy[\s\S]{0,180}on\s+storage\.objects[\s\S]{0,100}for\s+(?:insert|update|delete)[\s\S]{0,100}\bto\s+(?:anon|authenticated)\b/i, 'browser roles must not receive case Storage write policies')

// App.tsx is the authoritative mobile shell: exactly five fixed entries remain,
// the fourth is role-specific, and CasesPage has no anonymous/public bypass.
const mobileNav = appSource.match(/function\s+MobileBottomNav[\s\S]*?\n}\n\nfunction\s+AuthenticatedApp/)?.[0]
assert.ok(mobileNav, 'MobileBottomNav must exist in App.tsx')
assert.equal((mobileNav.match(/<NavLink\b/g) ?? []).length, 5, 'mobile navigation must contain exactly five entries')
for (const route of ['workspacePath(user.primaryRole)', '"/progress"', '"/calendar"', 'roleBusinessPath(user.primaryRole)', '"/profile"']) {
  assert.ok(mobileNav.includes(route), `mobile navigation is missing ${route}`)
}
assert.ok(appSource.includes("if (role === 'sales') return '/customers'"))
assert.ok(appSource.includes("if (role === 'finance') return '/finance'"))
assert.ok(appSource.includes("if (role === 'admin') return '/cases'"))
assert.ok(appSource.includes("return '/fulfillment'"))
assert.ok(appSource.includes('<Route path="/cases" element={<CasesPage user={user} />} />'))
assert.doesNotMatch(casesPageSource, /anon(?:ymous)?|public[_-]?token|service[_-]?role/i, 'CasesPage must not create an anonymous or privileged bypass')
assert.match(casesPageSource, /data\.publicCases/, 'CasesPage must render the redacted public projection')
const publicCasesComponent = casesPageSource.match(/function\s+PublicCases[\s\S]*?\n}\n\nfunction\s+authorizationState/)?.[0]
assert.ok(publicCasesComponent, 'CasesPage must isolate its public projection renderer')
for (const field of ['brandDisplayName', 'storeDisplayName', 'industry', 'region', 'storeKind', 'productsAndServices', 'originalProblem', 'solution', 'launchResult', 'serviceTeamDisplay']) {
  assert.ok(publicCasesComponent.includes(field), `public case renderer is missing ${field}`)
}
assert.doesNotMatch(publicCasesComponent, /authorization|candidate|companyId|objectPath|phone|address|price|profit/i, 'public case renderer must not expose internal fields')

const publicReaderSelect = caseReaderSource.match(/from\(['"]published_cases_public['"]\)\.select\(['"]([^'"]+)['"]\)/)?.[1]
assert.ok(publicReaderSelect, 'case reader must query the redacted public projection')
assert.deepEqual(publicReaderSelect.split(',').map((field) => field.trim()).sort(), expectedPublicFields, 'browser public query must request exactly the allowlisted fields')
for (const internalQuery of ['casesQuery', 'mediaQuery', 'candidatesQuery']) {
  requirePattern(caseReaderSource, new RegExp(`isAdmin\\s*\\?\\s*${internalQuery}\\s*:\\s*(?:noRows|Promise\\.resolve)`, 'i'), `${internalQuery} must execute only for administrators`)
}

for (const field of ['runtimeEvidence', 'mobileEvidence', 'caseAuthorizationEvidence', 'storageEvidence']) assert.equal(contract[field], 'pending')
assert.equal(contract.g6Accepted, false)

console.log(`TEAM_OS_4_G6_CONTRACT_OK migrations=${g6MigrationNames.length} checkpoints=75,80 roles=5 mobileEntries=5 publicProjection=allowlist-only trustedPublish=required trustedUnpublish=required archive=required storage=isolated runtime=pending mobile=pending case=pending storage=pending gateIntegrated=0`)
