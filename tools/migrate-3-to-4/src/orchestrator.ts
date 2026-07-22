import { createHash } from 'node:crypto'
import { assertMigrationReconciled, type ReconciliationEvidence } from './reconciliation.ts'
import { assertSafeTargetWrite, type TargetTransaction, type TargetWrite, type TargetWriter } from './batch.ts'
import { validateLedgerIdentity, assertCompleteSourceCoverage, type DispositionLedger } from './ledger.ts'
import { validateMigrationManifest, type MigrationPackageManifest } from './manifest.ts'

export const EXECUTION_STATES = [
  'preflight',
  'target_transaction',
  'auth',
  'business',
  'storage',
  'reconciliation',
  'credential_revocation',
  'sealed',
  'failed',
] as const

export type ExecutionState = (typeof EXECUTION_STATES)[number]
export type MigrationStage = 'auth' | 'business' | 'storage'

export interface AuditEvent {
  sequence: number
  at: string
  candidateId: string
  state: ExecutionState
  outcome: 'entered' | 'completed' | 'failed'
  /** Fixed, non-sensitive reason code. Never an exception message or input value. */
  code: string
  /** SHA-256 of fixed failure stage plus error class only; never hashes secrets or input values. */
  errorDigest: string | null
}

export interface CandidateAttemptStore {
  /** Atomically creates the preflight state and rejects every id acquired before, including failed candidates. */
  acquireOnce(candidateId: string): Promise<boolean>
  transition(candidateId: string, from: ExecutionState, to: ExecutionState, transaction?: TargetTransaction): Promise<void>
  appendAudit(event: AuditEvent, transaction?: TargetTransaction): Promise<void>
}

export interface RevocableTargetCredential {
  revoke(): Promise<void>
}

export interface StageExecution {
  writes: readonly TargetWrite[]
  /** Performs non-database work. It must be idempotent within this single invocation. */
  apply?: () => Promise<void>
  /** Reverses apply. Required whenever apply is present. */
  rollback?: () => Promise<void>
}

export interface MigrationExecutionPlan {
  candidateId: string
  executionBatchId: string
  manifest: MigrationPackageManifest
  ledger: DispositionLedger
  sourceRows: readonly { sourceTable: string; sourceId: string }[]
  auth: StageExecution
  business: StageExecution
  storage: StageExecution
}

export interface MigrationExecutionDependencies {
  attempts: CandidateAttemptStore
  target: TargetWriter
  targetCredential: RevocableTargetCredential
  reconcile(transaction: TargetTransaction): Promise<ReconciliationEvidence>
  now?: () => string
}

const SAFE_ID = /^[A-Za-z0-9._-]{1,100}$/

function validatePlan(plan: MigrationExecutionPlan): void {
  if (!SAFE_ID.test(plan.candidateId)) throw new Error('candidate id is invalid')
  if (!SAFE_ID.test(plan.executionBatchId)) throw new Error('execution batch id is invalid')
  const manifestErrors = validateMigrationManifest(plan.manifest)
  if (manifestErrors.length) throw new Error('migration manifest is invalid')
  const ledgerErrors = validateLedgerIdentity(plan.ledger)
  if (ledgerErrors.length) throw new Error('migration ledger is invalid')
  if (plan.ledger.executionBatchId !== plan.executionBatchId) throw new Error('execution batch identity mismatch')
  if (plan.ledger.targetProjectRef !== plan.manifest.targetProjectRef) throw new Error('target project identity mismatch')
  if (plan.ledger.sourceSnapshotSha256 !== plan.manifest.sourceSnapshotSha256) throw new Error('snapshot identity mismatch')
  assertCompleteSourceCoverage([...plan.sourceRows], plan.ledger.rows)

  for (const stage of [plan.auth, plan.business, plan.storage]) {
    if (stage.apply && !stage.rollback) throw new Error('non-database stage requires rollback')
    for (const write of stage.writes) assertSafeTargetWrite(write)
  }
}

function safeFailureCode(state: ExecutionState): string {
  return `migration_${state}_failed`
}

/**
 * Executes exactly one offline candidate. The attempt is burned before any
 * target connection is opened. No 3.0 endpoint or credential is accepted by
 * this API. Database writes remain uncommitted until every stage and the full
 * reconciliation succeeds. Auth and Storage side effects are compensated in
 * reverse order on failure. The short-lived target credential is revoked on
 * both success and failure.
 */
export async function executeMigrationOnce(
  plan: MigrationExecutionPlan,
  dependencies: MigrationExecutionDependencies,
): Promise<readonly AuditEvent[]> {
  const now = dependencies.now ?? (() => new Date().toISOString())
  const audit: AuditEvent[] = []
  let state: ExecutionState = 'preflight'
  let previous: ExecutionState = 'preflight'
  let transaction: TargetTransaction | null = null
  const compensations: Array<() => Promise<void>> = []
  let sequence = 0

  const record = async (outcome: AuditEvent['outcome'], code: string, auditTransaction?: TargetTransaction, errorDigest: string | null = null): Promise<void> => {
    const event: AuditEvent = { sequence: ++sequence, at: now(), candidateId: plan.candidateId, state, outcome, code, errorDigest }
    audit.push(event)
    await dependencies.attempts.appendAudit(event, auditTransaction)
  }
  const enter = async (next: ExecutionState, stateTransaction: TargetTransaction): Promise<void> => {
    previous = state
    state = next
    await dependencies.attempts.transition(plan.candidateId, previous, state, stateTransaction)
    await record('entered', `migration_${state}_entered`, stateTransaction)
  }

  const acquired = await dependencies.attempts.acquireOnce(plan.candidateId)
  if (!acquired) throw new Error('migration candidate has already been attempted')

  try {
    await record('entered', 'migration_preflight_entered')
    validatePlan(plan)
    await record('completed', 'migration_preflight_completed')

    transaction = await dependencies.target.begin()
    await enter('target_transaction', transaction)
    await record('completed', 'migration_target_transaction_opened', transaction)

    for (const [stageName, stage] of [
      ['auth', plan.auth],
      ['business', plan.business],
      ['storage', plan.storage],
    ] as const) {
      await enter(stageName, transaction)
      if (stage.writes.length === 0 && !stage.apply) throw new Error('empty migration stage is forbidden')
      for (const write of stage.writes) await transaction.execute(write.statement, write.parameters)
      if (stage.apply) {
        compensations.push(stage.rollback!)
        await stage.apply()
      }
      await record('completed', `migration_${stageName}_completed`, transaction)
    }

    await enter('reconciliation', transaction)
    assertMigrationReconciled(await dependencies.reconcile(transaction))
    await record('completed', 'migration_reconciliation_completed', transaction)

    await enter('credential_revocation', transaction)
    await dependencies.targetCredential.revoke()
    await record('completed', 'migration_target_credential_revoked', transaction)

    await enter('sealed', transaction)
    await record('completed', 'migration_sealed', transaction)
    await transaction.commit()
    transaction = null
    return audit
  } catch (error) {
    const failedAt = state
    const rollbackErrors: unknown[] = []
    if (transaction) {
      try { await transaction.rollback() } catch (rollbackError) { rollbackErrors.push(rollbackError) }
      transaction = null
    }
    for (const compensate of compensations.reverse()) {
      try { await compensate() } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    try { await dependencies.targetCredential.revoke() } catch (revokeError) { rollbackErrors.push(revokeError) }

    previous = 'preflight'
    state = 'failed'
    await dependencies.attempts.transition(plan.candidateId, previous, state)
    const failureCode = safeFailureCode(failedAt)
    const errorClass = error instanceof Error ? error.name : 'UnknownError'
    const errorDigest = createHash('sha256').update(`${failureCode}:${errorClass}`).digest('hex')
    await record('failed', failureCode, undefined, errorDigest)
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'migration failed and cleanup was incomplete')
    throw error
  }
}
