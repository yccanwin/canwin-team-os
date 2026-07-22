import { createHash } from 'node:crypto'

export const ENABLED_ACCOUNT_ROLES = Object.freeze([
  'sales',
  'implementation',
  'operations',
  'finance',
  'admin',
])

export const ENABLED_ACCOUNT_POSITIVE_STAGES = Object.freeze([
  'auth-real-password-login',
  'app-context-exact-primary-role-and-capabilities',
  'navigation-manifest-exact-role-boundary',
  'workspace-auto-route-and-visible-content',
  'role-business-page-real-remote-request',
  'own-scope-direct-api-read',
  'role-business-direct-api-read',
])

export const ENABLED_ACCOUNT_BOUNDARY_STAGES = Object.freeze([
  'manual-cross-role-url-denied',
  'cross-identity-read-matches-role-policy',
  'cross-identity-write-denied',
  'management-page-matches-role-policy',
  'management-api-matches-role-policy',
  'role-business-api-matches-role-policy',
  'bootstrap-public-entry-denied',
  'bootstrap-private-entry-denied',
])

export const ANONYMOUS_NEGATIVE_STAGES = Object.freeze([
  'bootstrap-public-entry-denied',
  'bootstrap-private-entry-denied',
  'internal-table-read-denied',
  'rest-dml-denied',
  'write-rpc-denied',
  'private-storage-read-denied',
  'storage-write-denied',
])

export const REQUIRED_EVIDENCE_FIELDS = Object.freeze([
  'run_id',
  'target_project_ref',
  'application_commit',
  'account_role',
  'identity_kind',
  'stage',
  'started_at',
  'finished_at',
  'page_url_or_api_surface',
  'http_status_or_postgres_code',
  'row_count_or_result_digest',
  'page_test_id_or_trace_digest',
  'outcome',
  'evidence_sha256',
])

const SHA256 = /^[a-f0-9]{64}$/u
const PROJECT_REF = /^[a-z0-9]{20}$/u
const COMMIT = /^[a-f0-9]{40}$/u
const RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/u
const SAFE_TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:/#-]{0,511}$/u
const POSTGRES_CODE = /^[0-9A-Z_-]{3,32}$/u
const SENSITIVE_VALUE = /(?:bearer\s+[a-zA-Z0-9._-]+|eyJ[a-zA-Z0-9_-]{8,}|sb_(?:secret|publishable)_[a-zA-Z0-9_-]+|(?:password|passwd|authorization|access[_-]?token|refresh[_-]?token|service[_-]?role|api[_-]?key|secret|session[_-]?token)\s*[:=]\s*[^,}\s]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/iu

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex')

const assertSafeText = (name, value, pattern = SAFE_TOKEN) => {
  if (typeof value !== 'string' || !pattern.test(value) || SENSITIVE_VALUE.test(value)) {
    throw new Error(`acceptance evidence ${name} is unsafe or invalid`)
  }
}

const assertIsoTimestamp = (name, value) => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`acceptance evidence ${name} must be a canonical ISO timestamp`)
  }
}

const expectedCategory = (identityKind, stage) => {
  if (identityKind === 'anonymous-attack') {
    return ANONYMOUS_NEGATIVE_STAGES.includes(stage) ? 'anonymous-negative' : null
  }
  if (ENABLED_ACCOUNT_POSITIVE_STAGES.includes(stage)) return 'enabled-account-positive'
  if (ENABLED_ACCOUNT_BOUNDARY_STAGES.includes(stage)) return 'enabled-account-boundary'
  return null
}

const canonicalCore = (record) => ({
  run_id: record.run_id,
  target_project_ref: record.target_project_ref,
  application_commit: record.application_commit,
  account_role: record.account_role,
  identity_kind: record.identity_kind,
  stage: record.stage,
  started_at: record.started_at,
  finished_at: record.finished_at,
  page_url_or_api_surface: record.page_url_or_api_surface,
  http_status_or_postgres_code: record.http_status_or_postgres_code,
  row_count_or_result_digest: record.row_count_or_result_digest,
  page_test_id_or_trace_digest: record.page_test_id_or_trace_digest,
  outcome: record.outcome,
})

export const acceptanceEvidenceSha256 = (record) => sha256(JSON.stringify(canonicalCore(record)))

export function createAcceptanceEvidenceRecord({
  runId,
  targetProjectRef,
  applicationCommit,
  accountRole,
  identityKind,
  stage,
  startedAt,
  finishedAt,
  pageUrlOrApiSurface,
  httpStatusOrPostgresCode,
  rowCountOrResultDigest,
  pageTestIdOrTraceDigest,
  outcome,
}) {
  const core = canonicalCore({
    run_id: runId,
    target_project_ref: targetProjectRef,
    application_commit: applicationCommit,
    account_role: accountRole,
    identity_kind: identityKind,
    stage,
    started_at: startedAt,
    finished_at: finishedAt,
    page_url_or_api_surface: pageUrlOrApiSurface,
    http_status_or_postgres_code: httpStatusOrPostgresCode,
    row_count_or_result_digest: rowCountOrResultDigest,
    page_test_id_or_trace_digest: pageTestIdOrTraceDigest,
    outcome,
  })
  return Object.freeze({ ...core, evidence_sha256: acceptanceEvidenceSha256(core) })
}

const validateEvidenceRecord = (record, context) => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('acceptance evidence record is invalid')
  if (JSON.stringify(Object.keys(record)) !== JSON.stringify(REQUIRED_EVIDENCE_FIELDS)) {
    throw new Error('acceptance evidence record fields or ordering drifted')
  }
  if (record.run_id !== context.runId || !RUN_ID.test(record.run_id)) throw new Error('acceptance evidence run id mismatch')
  if (record.target_project_ref !== context.targetProjectRef || !PROJECT_REF.test(record.target_project_ref)) {
    throw new Error('acceptance evidence target project ref mismatch')
  }
  if (record.application_commit !== context.applicationCommit || !COMMIT.test(record.application_commit)) {
    throw new Error('acceptance evidence application commit mismatch')
  }
  if (record.identity_kind === 'enabled-account') {
    if (!ENABLED_ACCOUNT_ROLES.includes(record.account_role)) throw new Error('acceptance evidence enabled account role is invalid')
  } else if (record.identity_kind === 'anonymous-attack') {
    if (record.account_role !== 'anon') throw new Error('acceptance evidence anonymous role is invalid')
  } else {
    throw new Error('acceptance evidence identity kind is invalid')
  }
  assertSafeText('stage', record.stage)
  assertIsoTimestamp('started_at', record.started_at)
  assertIsoTimestamp('finished_at', record.finished_at)
  if (Date.parse(record.finished_at) < Date.parse(record.started_at)) throw new Error('acceptance evidence timestamps are reversed')
  assertSafeText('page_url_or_api_surface', record.page_url_or_api_surface)
  if (typeof record.http_status_or_postgres_code === 'number') {
    if (!Number.isInteger(record.http_status_or_postgres_code) || record.http_status_or_postgres_code < 100 || record.http_status_or_postgres_code > 599) {
      throw new Error('acceptance evidence HTTP status is invalid')
    }
  } else {
    assertSafeText('http_status_or_postgres_code', record.http_status_or_postgres_code, POSTGRES_CODE)
  }
  if (typeof record.row_count_or_result_digest === 'number') {
    if (!Number.isSafeInteger(record.row_count_or_result_digest) || record.row_count_or_result_digest < 0) {
      throw new Error('acceptance evidence row count is invalid')
    }
  } else if (typeof record.row_count_or_result_digest !== 'string' || !SHA256.test(record.row_count_or_result_digest)) {
    throw new Error('acceptance evidence result digest is invalid')
  }
  assertSafeText('page_test_id_or_trace_digest', record.page_test_id_or_trace_digest)
  if (!['passed', 'denied', 'failed'].includes(record.outcome)) throw new Error('acceptance evidence outcome is invalid')
  if (!SHA256.test(record.evidence_sha256) || record.evidence_sha256 !== acceptanceEvidenceSha256(record)) {
    throw new Error('acceptance evidence SHA-256 mismatch')
  }
  if (SENSITIVE_VALUE.test(JSON.stringify(record))) throw new Error('acceptance evidence contains credential material')
  return Object.freeze({ ...record })
}

const evidenceKey = (record) => `${record.identity_kind}:${record.account_role}:${record.stage}`

const expectedKeys = Object.freeze(new Set([
  ...ENABLED_ACCOUNT_ROLES.flatMap((role) => [
    ...ENABLED_ACCOUNT_POSITIVE_STAGES.map((stage) => `enabled-account:${role}:${stage}`),
    ...ENABLED_ACCOUNT_BOUNDARY_STAGES.map((stage) => `enabled-account:${role}:${stage}`),
  ]),
  ...ANONYMOUS_NEGATIVE_STAGES.map((stage) => `anonymous-attack:anon:${stage}`),
]))

const summarize = (records) => {
  let enabledAccountPositive = 0
  let enabledAccountBoundary = 0
  let anonymousNegative = 0
  let failed = 0
  let supplemental = 0
  for (const record of records) {
    if (record.outcome === 'failed') {
      failed += 1
      continue
    }
    const category = expectedCategory(record.identity_kind, record.stage)
    if (category === null) supplemental += 1
    else if (record.outcome !== 'passed') throw new Error(`acceptance evidence check did not pass for ${record.stage}`)
    else if (category === 'anonymous-negative') anonymousNegative += 1
    else if (category === 'enabled-account-positive') enabledAccountPositive += 1
    else enabledAccountBoundary += 1
  }
  return Object.freeze({
    enabled_account_positive: enabledAccountPositive,
    enabled_account_boundary: enabledAccountBoundary,
    anonymous_negative: anonymousNegative,
    supplemental,
    failed,
    total: records.length,
  })
}

const validateRecordSet = ({ records, runId, targetProjectRef, applicationCommit, status }) => {
  if (!Array.isArray(records)) throw new Error('acceptance evidence records are missing')
  const safeRecords = records.map((record) => validateEvidenceRecord(record, { runId, targetProjectRef, applicationCommit }))
  const seen = new Set()
  let failureSeen = false
  for (const record of safeRecords) {
    const key = evidenceKey(record)
    if (seen.has(key)) throw new Error(`acceptance evidence duplicate check ${key}`)
    seen.add(key)
    if (failureSeen) throw new Error('acceptance evidence exists after the first failed step')
    if (record.outcome === 'failed') failureSeen = true
  }
  const summary = summarize(safeRecords)
  if (status === 'passed') {
    if (summary.failed !== 0) throw new Error('passed acceptance evidence contains a failed step')
    for (const key of expectedKeys) if (!seen.has(key)) throw new Error(`acceptance evidence required check missing ${key}`)
    if (summary.enabled_account_positive !== 35 || summary.enabled_account_boundary !== 40 ||
        summary.anonymous_negative !== 7 || summary.supplemental !== 0 || summary.total !== 82) {
      throw new Error('acceptance evidence current-run totals are incomplete')
    }
  } else if (status === 'failed-stopped') {
    if (summary.failed > 1 || (summary.total > 0 && summary.failed !== 1)) {
      throw new Error('acceptance evidence must preserve exactly one terminal failed step')
    }
  } else {
    throw new Error('acceptance evidence seal status is invalid')
  }
  return { safeRecords, summary }
}

const bundleSha256 = (bundle) => sha256(JSON.stringify({
  schema_version: bundle.schema_version,
  status: bundle.status,
  run_id: bundle.run_id,
  target_project_ref: bundle.target_project_ref,
  application_commit: bundle.application_commit,
  totals_source: bundle.totals_source,
  credentials_exposed: bundle.credentials_exposed,
  first_failure_stopped: bundle.first_failure_stopped,
  current_run_counts: bundle.current_run_counts,
  records: bundle.records,
}))

export function validateAndSealAcceptanceEvidence({ records, runId, targetProjectRef, applicationCommit, status = 'passed' }) {
  const { safeRecords, summary } = validateRecordSet({ records, runId, targetProjectRef, applicationCommit, status })
  const bundle = {
    schema_version: 1,
    status,
    run_id: runId,
    target_project_ref: targetProjectRef,
    application_commit: applicationCommit,
    totals_source: 'current-run-records-only',
    credentials_exposed: false,
    first_failure_stopped: status === 'failed-stopped',
    current_run_counts: summary,
    records: Object.freeze([...safeRecords]),
  }
  return Object.freeze({ ...bundle, evidence_sha256: bundleSha256(bundle) })
}

export function createAcceptanceEvidenceCollector({ runId, targetProjectRef, applicationCommit }) {
  const records = []
  let stopped = false
  return Object.freeze({
    append(record) {
      if (stopped) throw new Error('acceptance evidence collector stopped at the first failure')
      const safeRecord = validateEvidenceRecord(record, { runId, targetProjectRef, applicationCommit })
      if (records.some((existing) => evidenceKey(existing) === evidenceKey(safeRecord))) {
        throw new Error(`acceptance evidence duplicate check ${evidenceKey(safeRecord)}`)
      }
      records.push(safeRecord)
      if (safeRecord.outcome === 'failed') stopped = true
      return safeRecord
    },
    snapshot() {
      return Object.freeze([...records])
    },
    sealPassed() {
      if (stopped) throw new Error('failed acceptance evidence cannot be sealed as passed')
      return validateAndSealAcceptanceEvidence({ records, runId, targetProjectRef, applicationCommit, status: 'passed' })
    },
    sealFailed() {
      stopped = true
      return validateAndSealAcceptanceEvidence({ records, runId, targetProjectRef, applicationCommit, status: 'failed-stopped' })
    },
  })
}
