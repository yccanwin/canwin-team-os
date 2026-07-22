import { createHash, sign, verify, type KeyLike } from 'node:crypto'
import type { ExecutionState } from './orchestrator.ts'
import { reconcileMigration, type ReconciliationDifference, type ReconciliationEvidence } from './reconciliation.ts'

const SAFE_ID = /^[A-Za-z0-9._-]{1,100}$/
const PROJECT_REF = /^[a-z]{20}$/
const SHA256 = /^[a-f0-9]{64}$/
const GIT_COMMIT = /^[a-f0-9]{40}$/
const FAILURE_STAGES: readonly ExecutionState[] = [
  'preflight', 'target_transaction', 'auth', 'business', 'storage', 'reconciliation', 'credential_revocation',
]

export interface FailedCandidateForensicInput {
  runId: string
  candidateId: string
  sourceSnapshotSha256: string
  targetProjectRef: string
  codeCommit: string
  startedAt: string
  failedAt: string
  failureStage: Exclude<ExecutionState, 'sealed' | 'failed'>
  /** Digest of a fixed failure code and error class. Raw errors and secrets are forbidden. */
  errorDigest: string
  reconciliation: ReconciliationEvidence
  reconciliationDifferences: readonly ReconciliationDifference[]
  targetForensicOnly: true
  targetCredentialRevoked: true
  candidateOutcome: 'failed'
}

export interface FailedCandidateForensicRecord extends FailedCandidateForensicInput {
  sequence: number
  previousRecordDigest: string | null
  recordedAt: string
  recordDigest: string
  signatureAlgorithm: 'ed25519'
  signatureBase64: string
}

export interface ForensicEvidenceStore {
  readTail(): Promise<Pick<FailedCandidateForensicRecord, 'sequence' | 'recordDigest'> | null>
  /** Atomically burns the target ref and appends only when the chain tail matches. */
  reserveTargetAndAppend(record: FailedCandidateForensicRecord, expectedPreviousDigest: string | null): Promise<boolean>
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`
}

function assertIsoTimestamp(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be a UTC ISO-8601 timestamp`)
  }
}

export function validateFailedCandidateForensicInput(input: FailedCandidateForensicInput): string[] {
  const errors: string[] = []
  if (!SAFE_ID.test(input.runId)) errors.push('run id is invalid')
  if (!SAFE_ID.test(input.candidateId)) errors.push('candidate id is invalid')
  if (!SHA256.test(input.sourceSnapshotSha256)) errors.push('source snapshot digest is invalid')
  if (!PROJECT_REF.test(input.targetProjectRef)) errors.push('target project ref is invalid')
  if (!GIT_COMMIT.test(input.codeCommit)) errors.push('code commit is invalid')
  try { assertIsoTimestamp(input.startedAt, 'startedAt') } catch (error) { errors.push((error as Error).message) }
  try { assertIsoTimestamp(input.failedAt, 'failedAt') } catch (error) { errors.push((error as Error).message) }
  if (!Number.isNaN(Date.parse(input.startedAt)) && !Number.isNaN(Date.parse(input.failedAt)) && Date.parse(input.failedAt) < Date.parse(input.startedAt)) {
    errors.push('failedAt cannot precede startedAt')
  }
  if (!FAILURE_STAGES.includes(input.failureStage)) errors.push('failure stage is invalid')
  if (!SHA256.test(input.errorDigest)) errors.push('error digest is invalid')
  if (!input.reconciliation
    || !Array.isArray(input.reconciliation.entities)
    || !Array.isArray(input.reconciliation.criticalAmounts)
    || !Array.isArray(input.reconciliation.inventory)
    || !Array.isArray(input.reconciliation.auth)
    || !Array.isArray(input.reconciliation.storage)
    || !Array.isArray(input.reconciliationDifferences)) errors.push('complete reconciliation evidence is required')
  else if (canonicalize(input.reconciliationDifferences) !== canonicalize(reconcileMigration(input.reconciliation))) {
    errors.push('reconciliation differences do not match the supplied evidence')
  }
  if (input.targetForensicOnly !== true) errors.push('failed target must be forensic-only')
  if (input.targetCredentialRevoked !== true) errors.push('target credential revocation is required')
  if (input.candidateOutcome !== 'failed') errors.push('only failed candidates may create a forensic pack')
  return errors
}

function unsignedRecord(record: Omit<FailedCandidateForensicRecord, 'recordDigest' | 'signatureAlgorithm' | 'signatureBase64'>): string {
  return canonicalize(record)
}

export async function sealFailedCandidateForensicEvidence(
  input: FailedCandidateForensicInput,
  store: ForensicEvidenceStore,
  signingKey: KeyLike,
  now: () => string = () => new Date().toISOString(),
): Promise<FailedCandidateForensicRecord> {
  const errors = validateFailedCandidateForensicInput(input)
  if (errors.length) throw new Error(`failed candidate forensic evidence is invalid: ${errors.join('; ')}`)
  const tail = await store.readTail()
  const base = {
    ...input,
    sequence: (tail?.sequence ?? 0) + 1,
    previousRecordDigest: tail?.recordDigest ?? null,
    recordedAt: now(),
  }
  assertIsoTimestamp(base.recordedAt, 'recordedAt')
  const payload = unsignedRecord(base)
  const recordDigest = createHash('sha256').update(payload).digest('hex')
  const signatureBase64 = sign(null, Buffer.from(recordDigest, 'hex'), signingKey).toString('base64')
  const record: FailedCandidateForensicRecord = {
    ...base,
    recordDigest,
    signatureAlgorithm: 'ed25519',
    signatureBase64,
  }
  if (!await store.reserveTargetAndAppend(record, base.previousRecordDigest)) {
    throw new Error('failed target is already reserved or the forensic evidence chain changed')
  }
  return record
}

export function verifyFailedCandidateForensicRecord(record: FailedCandidateForensicRecord, publicKey: KeyLike): string[] {
  const errors = validateFailedCandidateForensicInput(record)
  if (!Number.isSafeInteger(record.sequence) || record.sequence < 1) errors.push('sequence is invalid')
  if (record.previousRecordDigest !== null && !SHA256.test(record.previousRecordDigest)) errors.push('previous record digest is invalid')
  try { assertIsoTimestamp(record.recordedAt, 'recordedAt') } catch (error) { errors.push((error as Error).message) }
  const { recordDigest, signatureAlgorithm, signatureBase64, ...base } = record
  const expectedDigest = createHash('sha256').update(unsignedRecord(base)).digest('hex')
  if (recordDigest !== expectedDigest) errors.push('record digest does not match evidence')
  if (signatureAlgorithm !== 'ed25519') errors.push('signature algorithm is invalid')
  try {
    if (!verify(null, Buffer.from(recordDigest, 'hex'), publicKey, Buffer.from(signatureBase64, 'base64'))) errors.push('record signature verification failed')
  } catch {
    errors.push('record signature verification failed')
  }
  return errors
}
