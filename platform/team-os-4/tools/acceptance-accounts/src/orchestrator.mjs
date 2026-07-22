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
  if (!CODE_COMMIT.test(codeCommit)) throw new Error('acceptance code commit is invalid')
  const created = []
  const runId = randomUUID()
  let completedEvidenceRecords = []
  let acceptanceStarted = false
  try {
    for (const identity of ACCEPTANCE_IDENTITIES) {
      const password = makePassword()
      const email = emailFor(identity.key)
      const user = await adapter.createAuthUser({ email, password })
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

    acceptanceStarted = true
    const rawResult = await runAcceptance(created.map((item) => ({
      key: item.key,
      id: item.id,
      email: item.email,
      password: item.password,
    })), { runId, targetProjectRef: projectRef, applicationCommit: codeCommit })
    completedEvidenceRecords = Array.isArray(rawResult?.evidenceRecords) ? rawResult.evidenceRecords : []
    const result = validateAcceptanceResult(rawResult, { runId, applicationCommit: codeCommit })
    const runtimeEvidence = validateAndSealAcceptanceEvidence({
      records: completedEvidenceRecords,
      runId,
      targetProjectRef: projectRef,
      applicationCommit: codeCommit,
      status: 'passed',
    })
    return {
      schemaVersion: 1,
      status: 'sealed-not-deleted',
      evidenceSealed: true,
      projectRef,
      codeCommit,
      runId,
      global: result.global,
      runtimeEvidence,
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
    let runtimeEvidence
    let evidenceRecordsRejected = false
    let rejectedEvidenceCount = 0
    let rejectedEvidenceSha256 = null
    try {
      if (acceptanceStarted && completedEvidenceRecords.length === 0) {
        throw new Error('started acceptance runner returned no terminal evidence')
      }
      runtimeEvidence = validateAndSealAcceptanceEvidence({
        records: completedEvidenceRecords,
        runId,
        targetProjectRef: projectRef,
        applicationCommit: codeCommit,
        status: 'failed-stopped',
      })
    } catch {
      evidenceRecordsRejected = acceptanceStarted || completedEvidenceRecords.length > 0
      rejectedEvidenceCount = completedEvidenceRecords.length
      rejectedEvidenceSha256 = evidenceRecordsRejected
        ? createHash('sha256').update(JSON.stringify(completedEvidenceRecords), 'utf8').digest('hex')
        : null
      runtimeEvidence = evidenceRecordsRejected
        ? null
        : validateAndSealAcceptanceEvidence({
            records: [],
            runId,
            targetProjectRef: projectRef,
            applicationCommit: codeCommit,
            status: 'failed-stopped',
          })
    }
    let cleanedAccounts = 0
    let cleanupComplete = true
    for (const item of [...created].reverse()) {
      try {
        if (item.profileCreated) await adapter.deleteProfile(item.id)
        await adapter.deleteAuthUser(item.id)
        cleanedAccounts += 1
      } catch {
        cleanupComplete = false
      }
    }
    const safeStage = error instanceof Error && SAFE_STAGE.test(error.message) ? error.message : null
    throw new AcceptanceProvisioningError({
      schemaVersion: 1,
      status: cleanupComplete && cleanedAccounts === created.length ? 'failed-cleaned' : 'failed-cleanup-incomplete',
      evidenceSealed: !evidenceRecordsRejected,
      projectRef,
      codeCommit,
      runId,
      safeStage: safeStage ?? 'G1_STAGE_FAIL concealed',
      createdAccounts: created.length,
      cleanedAccounts,
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
