import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { validateAndSealAcceptanceEvidence } from './evidence.mjs'

export const ACCEPTANCE_IDENTITIES = Object.freeze([
  { key: 'sales', primaryRole: 'sales', capability: null },
  { key: 'implementation', primaryRole: 'implementation', capability: 'warehouse' },
  { key: 'operations', primaryRole: 'operations', capability: null },
  { key: 'finance', primaryRole: 'finance', capability: null },
  { key: 'admin_supervisor', primaryRole: 'admin', capability: 'supervisor' },
])

const makePassword = () => randomBytes(32).toString('base64url') + 'Aa1!'
const SAFE_STAGE = /^G1_STAGE_FAIL (?:anon-bootstrap-public|anon-bootstrap-private|anon-internal-read|anon-rest-dml|anon-write-rpc|anon-storage-read|anon-storage-write|browser-launch|(?:sign-in|profile-context|own-scope-read|role-business-read|cross-read|cross-write|management-api|role-business-boundary|bootstrap-public|bootstrap-private|page-login|auto-route|cross-url|management-page):(?:sales|implementation|operations|finance|admin))$/u
const PROJECT_REF = /^[a-z0-9]{20}$/u
const CODE_COMMIT = /^[a-f0-9]{40}$/u
const GREENFIELD_TEST_PROJECT_REF = 'jgcrhoabvaowxnqksvkq'
const STEP_EXPECTATIONS = Object.freeze({
  signIn: 'passed',
  profileContext: 'passed',
  ownScopeApi: 'passed',
  roleBusinessRead: 'passed',
  crossReadPolicy: 'passed',
  crossWrite: 'denied',
  managementApi: 'passed',
  roleBusinessBoundary: 'passed',
  publicBootstrap: 'denied',
  privateBootstrap: 'denied',
  pageLogin: 'passed',
  autoRoute: 'passed',
  crossUrl: 'denied',
  managementPage: 'passed',
})

const userIdHash = (id) => createHash('sha256').update(id, 'utf8').digest('hex')

const validateAcceptanceResult = (result, context) => {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('acceptance runner result is invalid')
  if (result.runId !== context.runId || result.applicationCommit !== context.applicationCommit) {
    throw new Error('acceptance runner identity fields mismatch')
  }
  if (result.global?.anonymousBootstrap !== 'denied' || result.global?.browserLaunch !== 'passed') {
    throw new Error('acceptance runner global steps are incomplete')
  }
  if (!Array.isArray(result.accounts) || result.accounts.length !== ACCEPTANCE_IDENTITIES.length) {
    throw new Error('acceptance runner account steps are incomplete')
  }
  const byKey = new Map(result.accounts.map((item) => [item?.identityKey, item]))
  if (byKey.size !== ACCEPTANCE_IDENTITIES.length) throw new Error('acceptance runner identity steps are duplicated')
  for (const identity of ACCEPTANCE_IDENTITIES) {
    const actual = byKey.get(identity.key)
    if (!actual || !actual.steps || Object.keys(actual).some((key) => !['identityKey', 'steps'].includes(key))) {
      throw new Error('acceptance runner identity step shape is invalid')
    }
    if (JSON.stringify(actual.steps) !== JSON.stringify(STEP_EXPECTATIONS)) {
      throw new Error('acceptance runner identity steps did not pass')
    }
  }
  return result
}

export class AcceptanceProvisioningError extends Error {
  constructor(evidence, cause) {
    super('acceptance account provisioning failed; batch cleanup was attempted', { cause })
    this.name = 'AcceptanceProvisioningError'
    this.evidence = Object.freeze(evidence)
  }
}

export async function provisionAcceptanceAccounts({ adapter, emailFor, runAcceptance, projectRef, codeCommit }) {
  if (!PROJECT_REF.test(projectRef)) throw new Error('acceptance project ref is invalid')
  if (projectRef !== GREENFIELD_TEST_PROJECT_REF) throw new Error('acceptance provisioning is restricted to the Team OS 4.0 greenfield test project')
  if (!CODE_COMMIT.test(codeCommit)) throw new Error('acceptance code commit is invalid')
  const created = []
  const runId = randomUUID()
  let completedEvidenceRecords = []
  let acceptanceStarted = false
  let fixturePreparationState = 'not-started'
  let fixtureSummarySha256 = null
  let fixtureSummary = null
  let sealedPassedRuntimeEvidence = null
  try {
    await adapter.preflightAcceptance({ projectRef })
    for (const identity of ACCEPTANCE_IDENTITIES) {
      const password = makePassword()
      const email = emailFor(identity.key)
      const user = await adapter.createAuthUser({
        email, password, runId, identityKey: identity.key,
      })
      created.push({ ...identity, id: user.id, email, password, profileCreated: false })
      const profile = await adapter.createProfile({
        userId: user.id,
        primaryRole: identity.primaryRole,
        capability: identity.capability,
      })
      created.at(-1).profileCreated = true
      if (profile?.status !== 'active') throw new Error('created profile is not active')
      created.at(-1).profileStatus = profile.status
    }

    fixturePreparationState = 'indeterminate'
    fixtureSummary = await adapter.createRunFixtures({
      runId,
      projectRef,
      accounts: created.map((item) => ({ key: item.key, id: item.id })),
    })
    fixturePreparationState = 'confirmed-prepared'
    fixtureSummarySha256 = createHash('sha256').update(JSON.stringify({
      runId,
      projectRef,
      codeCommit,
      fixtureSummary,
    }), 'utf8').digest('hex')

    acceptanceStarted = true
    const rawResult = await runAcceptance(created.map((item) => ({
      key: item.key,
      id: item.id,
      email: item.email,
      password: item.password,
    })), { runId, targetProjectRef: projectRef, applicationCommit: codeCommit })
    completedEvidenceRecords = Array.isArray(rawResult?.evidenceRecords) ? rawResult.evidenceRecords : []
    const result = validateAcceptanceResult(rawResult, { runId, applicationCommit: codeCommit })
    sealedPassedRuntimeEvidence = validateAndSealAcceptanceEvidence({
      records: completedEvidenceRecords,
      runId,
      targetProjectRef: projectRef,
      applicationCommit: codeCommit,
      status: 'passed',
    })
    await adapter.retainRun({
      runId,
      projectRef,
      codeCommit,
      runtimeEvidence: sealedPassedRuntimeEvidence,
      accounts: created.map((item) => ({ key: item.key, id: item.id })),
    })
    fixturePreparationState = 'confirmed-retained'
    return {
      schemaVersion: 1,
      status: 'sealed-not-deleted',
      evidenceSealed: true,
      projectRef,
      codeCommit,
      runId,
      global: result.global,
      provisioningEvidence: {
        status: 'retained',
        fixturesCountAsRuntimeEvidence: false,
        fixturePreparationState,
        summarySha256: fixtureSummarySha256,
        baselineVersion: fixtureSummary.baseline_version,
        enabledAccounts: fixtureSummary.enabled_accounts,
        runWorkItems: fixtureSummary.run_work_items,
        runBusinessRows: fixtureSummary.run_business_rows,
        persistentBaselineReady: fixtureSummary.persistent_baseline_ready,
      },
      runtimeEvidence: sealedPassedRuntimeEvidence,
      accounts: created.map((item) => ({
        projectRef,
        codeCommit,
        identityKey: item.key,
        userIdSha256: userIdHash(item.id),
        profileStatus: item.profileStatus,
        steps: result.accounts.find((account) => account.identityKey === item.key).steps,
      })),
    }
  } catch (error) {
    if (Array.isArray(error?.evidenceRecords)) completedEvidenceRecords = error.evidenceRecords
    let runtimeEvidence = null
    let runtimeEvidenceStatus = 'not-started'
    let evidenceSealed = false
    let evidenceRecordsRejected = false
    let rejectedEvidenceCount = 0
    let rejectedEvidenceSha256 = null
    if (sealedPassedRuntimeEvidence) {
      runtimeEvidence = sealedPassedRuntimeEvidence
      runtimeEvidenceStatus = 'sealed-passed-retention-indeterminate'
      evidenceSealed = true
    } else if (acceptanceStarted) {
      try {
        if (completedEvidenceRecords.length === 0) {
          throw new Error('started acceptance runner returned no terminal evidence')
        }
        runtimeEvidence = validateAndSealAcceptanceEvidence({
          records: completedEvidenceRecords,
          runId,
          targetProjectRef: projectRef,
          applicationCommit: codeCommit,
          status: 'failed-stopped',
        })
        runtimeEvidenceStatus = 'sealed-failed-stopped'
        evidenceSealed = true
      } catch {
        evidenceRecordsRejected = true
        rejectedEvidenceCount = completedEvidenceRecords.length
        rejectedEvidenceSha256 = createHash('sha256')
          .update(JSON.stringify(completedEvidenceRecords), 'utf8').digest('hex')
        runtimeEvidenceStatus = 'rejected'
      }
    }

    let databaseCleanupStatus = fixturePreparationState === 'not-started'
      ? 'not-required'
      : 'indeterminate'
    let businessFixturesSafeToDetach = fixturePreparationState === 'not-started'
    if (created.length > 0 && fixturePreparationState !== 'not-started') {
      try {
        const databaseCleanup = await adapter.cleanupRunDatabase({ runId })
        if (databaseCleanup.status === 'confirmed-cleaned') {
          databaseCleanupStatus = 'confirmed-cleaned'
          businessFixturesSafeToDetach = true
        } else if (databaseCleanup.status === 'not-found' && fixturePreparationState === 'indeterminate') {
          databaseCleanupStatus = 'confirmed-not-prepared'
          businessFixturesSafeToDetach = true
        }
      } catch {
        databaseCleanupStatus = 'indeterminate'
      }
    }

    const profileAccessDeniedIds = new Set()
    let profileCleanupStatus = created.length === 0 ? 'not-required' : 'not-started'
    if (businessFixturesSafeToDetach) {
      for (const item of [...created].reverse()) {
        try {
          await adapter.deleteAcceptanceProfile({
            id: item.id, runId, identityKey: item.key,
          })
          profileAccessDeniedIds.add(item.id)
        } catch {
          // One profile cleanup attempt per account; remaining accounts are quarantined below.
        }
      }
      profileCleanupStatus = profileAccessDeniedIds.size === created.length
        ? 'confirmed-cleaned'
        : 'incomplete'
    }

    const authDeletedIds = new Set()
    if (businessFixturesSafeToDetach) {
      for (const item of [...created].reverse()) {
        if (!profileAccessDeniedIds.has(item.id)) continue
        try {
          await adapter.deleteAuthUser(item.id)
          authDeletedIds.add(item.id)
        } catch {
          // One hard-delete attempt; a remaining identity is quarantined once below.
        }
      }
    }

    const remainingAccounts = created
      .filter((item) => !authDeletedIds.has(item.id))
      .map((item) => ({ key: item.key, id: item.id }))
    const authBannedIds = new Set()
    if (remainingAccounts.length > 0) {
      try {
        const quarantine = await adapter.quarantineAccounts({ runId, accounts: remainingAccounts })
        for (const id of quarantine.profileDisabledIds) profileAccessDeniedIds.add(id)
        for (const id of quarantine.authBannedIds) authBannedIds.add(id)
      } catch {
        // The single quarantine attempt is reflected as incomplete evidence below.
      }
    }
    if (profileCleanupStatus !== 'confirmed-cleaned') {
      profileCleanupStatus = profileAccessDeniedIds.size === created.length
        ? 'confirmed-disabled'
        : (profileAccessDeniedIds.size > 0 ? 'incomplete' : profileCleanupStatus)
    }

    const applicationAccessDenied = created.every((item) =>
      authDeletedIds.has(item.id) || profileAccessDeniedIds.has(item.id))
    const remainingAuthIsolated = remainingAccounts.every((item) => authBannedIds.has(item.id))
    const cleanupComplete = authDeletedIds.size === created.length
    const quarantineComplete = !cleanupComplete && applicationAccessDenied && remainingAuthIsolated
    const safeStage = error instanceof Error && SAFE_STAGE.test(error.message) ? error.message : null
    throw new AcceptanceProvisioningError({
      schemaVersion: 1,
      status: created.length === 0 && fixturePreparationState === 'not-started'
        ? 'failed-before-provisioning'
        : cleanupComplete
          ? 'failed-cleaned'
        : (quarantineComplete ? 'failed-quarantined' : 'failed-cleanup-incomplete'),
      evidenceSealed,
      runtimeEvidenceStatus,
      projectRef,
      codeCommit,
      runId,
      safeStage: safeStage ?? 'G1_STAGE_FAIL concealed',
      createdAccounts: created.length,
      cleanedAccounts: authDeletedIds.size,
      authBannedAccounts: authBannedIds.size,
      remainingUserIdHashes: remainingAccounts.map((item) => userIdHash(item.id)),
      applicationAccessDeniedByProfileRemovalOrDisable: applicationAccessDenied,
      profileCleanupStatus,
      databaseCleanupStatus,
      fixturePreparationState,
      fixtureSummarySha256,
      credentialsExposed: false,
      evidenceRecordsRejected,
      rejectedEvidenceCount,
      rejectedEvidenceSha256,
      runtimeEvidence,
    }, error)
  } finally {
    for (const item of created) item.password = undefined
  }
}
