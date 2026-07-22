import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  RequestContractError,
  allowedCorsOrigin,
  authorizeCommand,
  parseBearer,
  parseCommand,
} from './contract.mjs'

type JsonObject = Record<string, unknown>

function configuredSecretKey() {
  const named = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (named) {
    try {
      const parsed = JSON.parse(named) as Record<string, unknown>
      const candidate = parsed.default ?? Object.values(parsed)[0]
      if (typeof candidate === 'string' && candidate.length > 0) return candidate
    } catch {
      return null
    }
  }
  return Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? null
}

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
  }
  if (origin) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function response(status: number, body: JsonObject, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) })
}

function databaseFailureStatus(code: string | undefined) {
  if (code === '22023') return 400
  if (code === '42501') return 403
  if (code === 'P0002') return 404
  if (code === '23505' || code === '23514' || code === '55000') return 409
  return 502
}

Deno.serve(async (request) => {
  const requestOrigin = request.headers.get('origin')
  const origin = allowedCorsOrigin(
    requestOrigin,
    Deno.env.get('TEAM_OS_4_ALLOWED_ORIGINS') ?? '',
  )
  if (origin === undefined) return response(403, { error: 'origin_not_allowed' }, null)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (request.method !== 'POST') return response(405, { error: 'method_not_allowed' }, origin)
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return response(415, { error: 'application_json_required' }, origin)
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > 16_384) {
    return response(413, { error: 'request_too_large' }, origin)
  }

  let bearer: string
  try {
    bearer = parseBearer(request.headers.get('authorization'))
  } catch {
    return response(401, { error: 'valid_bearer_token_required' }, origin)
  }

  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return response(400, { error: 'invalid_request_body' }, origin)
  }
  if (new TextEncoder().encode(rawBody).byteLength > 16_384) {
    return response(413, { error: 'request_too_large' }, origin)
  }

  let command: ReturnType<typeof parseCommand>
  try {
    command = parseCommand(JSON.parse(rawBody))
  } catch (error) {
    if (error instanceof RequestContractError) {
      return response(400, { error: 'invalid_request', code: error.code }, origin)
    }
    return response(400, { error: 'invalid_json' }, origin)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const secretKey = configuredSecretKey()
  if (!supabaseUrl || !secretKey) return response(500, { error: 'command_service_not_configured' }, origin)

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data: userData, error: userError } = await admin.auth.getUser(bearer)
  if (userError || !userData.user) return response(401, { error: 'invalid_or_expired_token' }, origin)

  const [{ data: profile, error: profileError }, { data: workItem, error: workItemError }] = await Promise.all([
    admin.from('profiles')
      .select('id,company_id,primary_role_id,is_active')
      .eq('id', userData.user.id)
      .eq('company_id', command.companyId)
      .maybeSingle(),
    admin.from('work_items')
      .select('id,company_id,assignee_id,kind,status')
      .eq('id', command.workItemId)
      .eq('company_id', command.companyId)
      .maybeSingle(),
  ])
  if (profileError || workItemError) return response(502, { error: 'authorization_lookup_failed' }, origin)

  let role: { company_id: string; role_key: string; is_active: boolean } | null = null
  if (profile?.primary_role_id) {
    const { data, error } = await admin.from('primary_roles')
      .select('company_id,role_key,is_active')
      .eq('id', profile.primary_role_id)
      .eq('company_id', command.companyId)
      .maybeSingle()
    if (error) return response(502, { error: 'authorization_lookup_failed' }, origin)
    role = data
  }

  const authorization = authorizeCommand({
    command,
    userId: userData.user.id,
    profile,
    role,
    workItem,
  })
  if (!authorization.allowed) {
    return response(authorization.status, { error: authorization.code }, origin)
  }

  const rpc = command.action === 'complete'
    ? admin.rpc('complete_work_item_v1', {
      p_company_id: command.companyId,
      p_work_item_id: command.workItemId,
      p_idempotency_key: command.idempotencyKey,
      p_actor_user_id: userData.user.id,
      p_payload: command.payload,
    })
    : admin.rpc('transition_work_item_v1', {
      p_company_id: command.companyId,
      p_work_item_id: command.workItemId,
      p_target_status: command.targetStatus,
      p_idempotency_key: command.idempotencyKey,
      p_actor_user_id: userData.user.id,
      p_payload: command.payload,
    })

  const { data: result, error: rpcError } = await rpc
  if (rpcError) {
    return response(databaseFailureStatus(rpcError.code), {
      error: 'command_rejected',
      code: rpcError.code ?? 'database_error',
    }, origin)
  }
  return response(200, { ok: true, action: command.action, result }, origin)
})
