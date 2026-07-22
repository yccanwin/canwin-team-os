export const CUTOVER_STATES = [
  'precutover',
  'frozen',
  'migrating',
  'reconciling',
  'accepted',
  'cutover',
  'observing',
  'closed',
  'failed',
] as const

export type CutoverState = (typeof CUTOVER_STATES)[number]

export interface FullReconciliationGate {
  status: 'passed'
  differences: 0
  requiredSections: readonly ['entities', 'criticalAmounts', 'inventory', 'auth', 'storage']
  verifiedAt: string
}

export type AcceptanceRole = 'sales' | 'implementation' | 'operations' | 'finance' | 'admin-supervisor' | 'disabled-user'

export interface AccountAcceptance {
  role: AcceptanceRole
  authentication: 'passed' | 'denied-as-required'
  page: 'passed' | 'denied-as-required'
  directApi: 'passed' | 'denied-as-required'
  verifiedAt: string
}

export interface SixAccountGate {
  status: 'passed'
  accounts: readonly AccountAcceptance[]
}

export interface BackupRecoveryGate {
  status: 'passed'
  databaseRestore: 'passed'
  authRestore: 'passed'
  storageRestore: 'passed'
  rpoMet: true
  rtoMet: true
  verifiedAt: string
}

export interface CutoverAcceptanceEvidence {
  reconciliation: FullReconciliationGate
  sixAccounts: SixAccountGate
  backupRecovery: BackupRecoveryGate
}

export interface CutoverCandidate {
  candidateId: string
  state: CutoverState
  sourceAccess: 'offline-snapshot-only'
  sealed: boolean
}

export interface CutoverStateStore {
  /** Compare-and-set; implementation must reject stale or previously sealed candidates. */
  transition(candidateId: string, from: CutoverState, to: CutoverState): Promise<void>
  sealFailedCandidate(candidateId: string): Promise<void>
}

export interface CutoverCredential {
  revoke(): Promise<void>
}

export interface ReadOnlySourceGuard {
  /** Must verify 3.0 is frozen/read-only without returning a source write handle. */
  assertReadOnly(): Promise<true>
}

export interface CutoverDependencies {
  store: CutoverStateStore
  credential: CutoverCredential
  source: ReadOnlySourceGuard
  perform?: Partial<Record<Exclude<CutoverState, 'precutover' | 'failed'>, () => Promise<void>>>
}

const ALLOWED_TRANSITIONS: Readonly<Record<Exclude<CutoverState, 'failed' | 'closed'>, CutoverState>> = {
  precutover: 'frozen',
  frozen: 'migrating',
  migrating: 'reconciling',
  reconciling: 'accepted',
  accepted: 'cutover',
  cutover: 'observing',
  observing: 'closed',
}
const REQUIRED_ROLES: readonly AcceptanceRole[] = ['sales', 'implementation', 'operations', 'finance', 'admin-supervisor', 'disabled-user']
const SAFE_ID = /^[A-Za-z0-9._-]{1,100}$/

function validTime(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

export function validateCutoverAcceptance(evidence: CutoverAcceptanceEvidence): string[] {
  const errors: string[] = []
  const reconciliation = evidence?.reconciliation
  if (reconciliation?.status !== 'passed' || reconciliation.differences !== 0) errors.push('full reconciliation did not pass')
  if (JSON.stringify(reconciliation?.requiredSections) !== JSON.stringify(['entities', 'criticalAmounts', 'inventory', 'auth', 'storage'])) {
    errors.push('full reconciliation section coverage is incomplete')
  }
  if (!validTime(reconciliation?.verifiedAt ?? '')) errors.push('full reconciliation verification time is invalid')

  const accounts = evidence?.sixAccounts?.accounts ?? []
  if (evidence?.sixAccounts?.status !== 'passed' || accounts.length !== REQUIRED_ROLES.length) errors.push('six-account acceptance is incomplete')
  const roles = new Set<AcceptanceRole>()
  for (const account of accounts) {
    if (!REQUIRED_ROLES.includes(account.role) || roles.has(account.role)) errors.push('six-account role coverage is invalid')
    roles.add(account.role)
    const expectedOutcome = account.role === 'disabled-user' ? 'denied-as-required' : 'passed'
    if (account.authentication !== expectedOutcome || account.page !== expectedOutcome || account.directApi !== expectedOutcome) {
      errors.push(`account acceptance did not fully pass: ${account.role}`)
    }
    if (!validTime(account.verifiedAt)) errors.push(`account acceptance time is invalid: ${account.role}`)
  }
  for (const role of REQUIRED_ROLES) if (!roles.has(role)) errors.push(`account acceptance is missing: ${role}`)

  const recovery = evidence?.backupRecovery
  if (recovery?.status !== 'passed' || recovery.databaseRestore !== 'passed' || recovery.authRestore !== 'passed' ||
      recovery.storageRestore !== 'passed' || recovery.rpoMet !== true || recovery.rtoMet !== true) {
    errors.push('backup recovery acceptance did not fully pass')
  }
  if (!validTime(recovery?.verifiedAt ?? '')) errors.push('backup recovery verification time is invalid')
  return errors
}

export function assertCutoverAcceptance(evidence: CutoverAcceptanceEvidence | undefined): void {
  if (!evidence) throw new Error('cutover acceptance evidence is required')
  const errors = validateCutoverAcceptance(evidence)
  if (errors.length) throw new Error(`cutover acceptance rejected: ${errors.join('; ')}`)
}

async function failAndSeal(
  candidate: CutoverCandidate,
  dependencies: CutoverDependencies,
  cause: unknown,
): Promise<never> {
  const cleanupErrors: unknown[] = []
  try { await dependencies.credential.revoke() } catch (error) { cleanupErrors.push(error) }
  if (candidate.state !== 'failed' && candidate.state !== 'closed') {
    try { await dependencies.store.transition(candidate.candidateId, candidate.state, 'failed') } catch (error) { cleanupErrors.push(error) }
  }
  try { await dependencies.store.sealFailedCandidate(candidate.candidateId) } catch (error) { cleanupErrors.push(error) }
  if (cleanupErrors.length) throw new AggregateError([cause, ...cleanupErrors], 'cutover failed and candidate cleanup was incomplete')
  throw cause
}

/**
 * Advances one and only one state. There is deliberately no 3.0 writer in the
 * dependency surface: every advance re-proves that 3.0 remains read-only.
 */
export async function advanceCutover(
  candidate: CutoverCandidate,
  dependencies: CutoverDependencies,
  acceptance?: CutoverAcceptanceEvidence,
): Promise<CutoverCandidate> {
  if (!SAFE_ID.test(candidate.candidateId)) throw new Error('cutover candidate id is invalid')
  if (candidate.sourceAccess !== 'offline-snapshot-only') throw new Error('3.0 online access is forbidden')
  if (candidate.sealed || candidate.state === 'failed') throw new Error('failed or sealed cutover candidate cannot be resumed')
  if (candidate.state === 'closed') throw new Error('closed cutover candidate cannot advance')
  const next = ALLOWED_TRANSITIONS[candidate.state]

  try {
    if (await dependencies.source.assertReadOnly() !== true) throw new Error('3.0 read-only guard did not pass')
    if (next === 'accepted' || next === 'cutover') assertCutoverAcceptance(acceptance)
    await dependencies.perform?.[next]?.()
    // Re-check immediately before the durable transition so a stage cannot
    // silently make 3.0 writable while it runs.
    if (await dependencies.source.assertReadOnly() !== true) throw new Error('3.0 read-only guard was lost')
    if (next === 'closed') await dependencies.credential.revoke()
    await dependencies.store.transition(candidate.candidateId, candidate.state, next)
    return { ...candidate, state: next, sealed: next === 'closed' }
  } catch (error) {
    return failAndSeal(candidate, dependencies, error)
  }
}
