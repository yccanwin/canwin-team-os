const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const idempotencyPattern = /^[A-Za-z0-9._:-]{1,128}$/
const transitionStatuses = new Set(['in_progress', 'waiting', 'cancelled'])

export class RequestContractError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value, allowed) {
  const allowedSet = new Set(allowed)
  return Object.keys(value).every((key) => allowedSet.has(key))
}

function requiredUuid(value, field) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new RequestContractError('invalid_uuid', `${field} must be a UUID`)
  }
  return value.toLowerCase()
}

function requiredIdempotencyKey(value) {
  if (typeof value !== 'string' || !idempotencyPattern.test(value)) {
    throw new RequestContractError(
      'invalid_idempotency_key',
      'idempotencyKey must contain 1-128 letters, digits, dot, underscore, colon, or hyphen',
    )
  }
  return value
}

function optionalNotePayload(value) {
  if (value === undefined) return {}
  if (!isObject(value) || !exactKeys(value, ['note'])) {
    throw new RequestContractError('invalid_payload', 'complete payload only accepts note')
  }
  if (value.note === undefined) return {}
  if (typeof value.note !== 'string' || value.note.trim().length < 1 || value.note.trim().length > 1000) {
    throw new RequestContractError('invalid_payload', 'payload.note must contain 1-1000 characters')
  }
  return { note: value.note.trim() }
}

function transitionPayload(status, value) {
  if (value === undefined) value = {}
  if (!isObject(value)) throw new RequestContractError('invalid_payload', 'payload must be an object')
  if (status === 'waiting') {
    if (!exactKeys(value, ['blocked_reason'])) {
      throw new RequestContractError('invalid_payload', 'waiting payload only accepts blocked_reason')
    }
    const reason = value.blocked_reason
    if (typeof reason !== 'string' || reason.trim().length < 1 || reason.trim().length > 1000) {
      throw new RequestContractError(
        'invalid_payload',
        'payload.blocked_reason must contain 1-1000 characters',
      )
    }
    return { blocked_reason: reason.trim() }
  }
  if (!exactKeys(value, [])) {
    throw new RequestContractError('invalid_payload', 'non-waiting transitions require an empty payload')
  }
  return {}
}

export function parseBearer(value) {
  const match = typeof value === 'string' ? value.match(/^Bearer\s+([^\s]+)$/i) : null
  if (!match || match[1].length > 8192) {
    throw new RequestContractError('invalid_bearer', 'a valid Bearer token is required')
  }
  return match[1]
}

export function parseCommand(value) {
  if (!isObject(value) || (value.action !== 'transition' && value.action !== 'complete')) {
    throw new RequestContractError('invalid_action', 'action must be transition or complete')
  }

  const common = {
    action: value.action,
    companyId: requiredUuid(value.companyId, 'companyId'),
    workItemId: requiredUuid(value.workItemId, 'workItemId'),
    idempotencyKey: requiredIdempotencyKey(value.idempotencyKey),
  }

  if (value.action === 'complete') {
    if (!exactKeys(value, ['action', 'companyId', 'workItemId', 'idempotencyKey', 'payload'])) {
      throw new RequestContractError('unexpected_field', 'complete contains an unexpected field')
    }
    return { ...common, payload: optionalNotePayload(value.payload) }
  }

  if (!exactKeys(value, ['action', 'companyId', 'workItemId', 'targetStatus', 'idempotencyKey', 'payload'])) {
    throw new RequestContractError('unexpected_field', 'transition contains an unexpected field')
  }
  if (typeof value.targetStatus !== 'string' || !transitionStatuses.has(value.targetStatus)) {
    throw new RequestContractError(
      'invalid_target_status',
      'targetStatus must be in_progress, waiting, or cancelled',
    )
  }
  return {
    ...common,
    targetStatus: value.targetStatus,
    payload: transitionPayload(value.targetStatus, value.payload),
  }
}

export function allowedCorsOrigin(requestOrigin, configuredOrigins) {
  if (requestOrigin === null || requestOrigin === '') return null
  const allowed = configuredOrigins
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return allowed.includes(requestOrigin) ? requestOrigin : undefined
}

export function authorizeCommand({ command, userId, profile, role, workItem }) {
  if (!profile || profile.id !== userId || profile.company_id !== command.companyId || profile.is_active !== true) {
    return { allowed: false, status: 403, code: 'inactive_or_wrong_company_profile' }
  }
  if (!role || role.company_id !== command.companyId || role.is_active !== true) {
    return { allowed: false, status: 403, code: 'inactive_primary_role' }
  }
  if (!workItem || workItem.company_id !== command.companyId || workItem.id !== command.workItemId) {
    return { allowed: false, status: 404, code: 'work_item_not_found' }
  }
  if (workItem.assignee_id !== userId && role.role_key !== 'admin') {
    return { allowed: false, status: 403, code: 'work_item_not_assigned' }
  }
  if (command.action === 'complete' && workItem.kind === 'business_action') {
    return { allowed: false, status: 409, code: 'business_action_requires_owning_transaction' }
  }
  if (command.action === 'complete' && workItem.kind !== 'reminder') {
    return { allowed: false, status: 409, code: 'unsupported_work_item_kind' }
  }
  return { allowed: true }
}
