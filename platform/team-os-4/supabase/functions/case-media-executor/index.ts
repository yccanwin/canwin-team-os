import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

const privateBucket = 'team-os-4-case-media'
const publicBucket = 'team-os-4-public-cases'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const allowedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const allowedActions = new Set(['publish', 'cleanup'])

type JsonObject = Record<string, unknown>

type MediaPlan = {
  media_type: 'logo' | 'display_code'
  source_path: string
  public_path: string
  mime_type: string
  size_bytes: number
}

type CleanupItem = {
  id: number
  case_id: string
  object_path: string
  attempt: number
}

function response(status: number, body: JsonObject) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(body: JsonObject, allowed: string[]) {
  return Object.keys(body).every((key) => allowed.includes(key))
}

function requiredUuid(value: unknown, name: string) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new ClientError(`${name} must be a UUID`)
  return value
}

function optionalInteger(value: unknown, name: string, minimum: number, maximum: number, fallback: number) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ClientError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value as number
}

function optionalUuid(value: unknown, name: string) {
  if (value === undefined || value === null) return null
  return requiredUuid(value, name)
}

class ClientError extends Error {}

function parseMediaPlan(value: unknown): MediaPlan[] {
  if (!Array.isArray(value) || value.length > 2) throw new Error('invalid media copy plan')
  const seen = new Set<string>()
  return value.map((item) => {
    if (!isObject(item)) throw new Error('invalid media copy plan item')
    const mediaType = item.media_type
    const sourcePath = item.source_path
    const publicPath = item.public_path
    const mimeType = item.mime_type
    const sizeBytes = item.size_bytes
    if ((mediaType !== 'logo' && mediaType !== 'display_code') || seen.has(mediaType)) throw new Error('invalid media slot')
    if (typeof sourcePath !== 'string' || sourcePath.length === 0 || typeof publicPath !== 'string' || publicPath.length === 0) {
      throw new Error('invalid media path')
    }
    if (typeof mimeType !== 'string' || !allowedMimeTypes.has(mimeType)) throw new Error('invalid media MIME type')
    const maximum = mediaType === 'logo' ? 204_800 : 307_200
    if (!Number.isInteger(sizeBytes) || (sizeBytes as number) < 1 || (sizeBytes as number) > maximum) {
      throw new Error('invalid media size')
    }
    seen.add(mediaType)
    return {
      media_type: mediaType,
      source_path: sourcePath,
      public_path: publicPath,
      mime_type: mimeType,
      size_bytes: sizeBytes as number,
    }
  })
}

function parseCleanupItems(value: unknown): CleanupItem[] {
  if (!Array.isArray(value)) throw new Error('invalid cleanup claim')
  return value.map((item) => {
    if (!isObject(item) || !Number.isInteger(item.id) || typeof item.case_id !== 'string' ||
      typeof item.object_path !== 'string' || item.object_path.length === 0 || !Number.isInteger(item.attempt)) {
      throw new Error('invalid cleanup item')
    }
    return item as unknown as CleanupItem
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (request.method !== 'POST') return response(405, { error: 'method_not_allowed' })
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return response(415, { error: 'application_json_required' })
  }

  const authorization = request.headers.get('authorization')
  const bearer = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1]
  if (!bearer) return response(401, { error: 'valid_bearer_token_required' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return response(500, { error: 'executor_not_configured' })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return response(400, { error: 'invalid_json' })
  }
  if (!isObject(body) || typeof body.action !== 'string' || !allowedActions.has(body.action)) {
    return response(400, { error: 'invalid_action' })
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser(bearer)
  if (userError || !userData.user) return response(401, { error: 'invalid_or_expired_token' })

  // This privileged client is intentionally limited to Storage byte operations.
  // Every authorization and database state transition uses the caller's JWT client.
  const storageClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  try {
    const companyId = requiredUuid(body.companyId, 'companyId')

    if (body.action === 'publish') {
      if (!exactKeys(body, ['action', 'companyId', 'caseId', 'sortOrder'])) throw new ClientError('unexpected request field')
      const caseId = requiredUuid(body.caseId, 'caseId')
      const sortOrder = optionalInteger(body.sortOrder, 'sortOrder', -1_000_000, 1_000_000, 0)
      const { data: prepared, error: prepareError } = await userClient.rpc('prepare_case_publication_v1', {
        p_company_id: companyId,
        p_case_id: caseId,
      })
      if (prepareError) throw prepareError
      if (!isObject(prepared) || prepared.company_id !== companyId || prepared.case_id !== caseId) {
        throw new Error('invalid publication preparation')
      }

      const media = parseMediaPlan(prepared.media)
      const copiedPaths: string[] = []
      try {
        for (const item of media) {
          const { data: bytes, error: downloadError } = await storageClient.storage.from(privateBucket).download(item.source_path)
          if (downloadError || !bytes) throw downloadError ?? new Error('private media download failed')
          if (bytes.size !== item.size_bytes) throw new Error('private media size changed after preparation')
          const { error: uploadError } = await storageClient.storage.from(publicBucket).upload(item.public_path, bytes, {
            contentType: item.mime_type,
            upsert: false,
          })
          if (uploadError) throw uploadError
          copiedPaths.push(item.public_path)
        }

        const { data: published, error: publishError } = await userClient.rpc('publish_case_v1', {
          p_company_id: companyId,
          p_case_id: caseId,
          p_sort_order: sortOrder,
        })
        if (publishError) throw publishError
        return response(200, { ok: true, action: 'publish', result: published })
      } catch (publishFailure) {
        if (copiedPaths.length > 0) await storageClient.storage.from(publicBucket).remove(copiedPaths)
        throw publishFailure
      }
    }

    if (!exactKeys(body, ['action', 'companyId', 'caseId', 'limit'])) throw new ClientError('unexpected request field')
    const caseId = optionalUuid(body.caseId, 'caseId')
    const limit = optionalInteger(body.limit, 'limit', 1, 50, 20)
    const { data: claim, error: claimError } = await userClient.rpc('claim_case_publication_cleanup_v1', {
      p_company_id: companyId,
      p_case_id: caseId,
      p_limit: limit,
    })
    if (claimError) throw claimError
    if (!isObject(claim) || claim.company_id !== companyId || typeof claim.claim_token !== 'string') {
      throw new Error('invalid cleanup claim')
    }
    const claimToken = requiredUuid(claim.claim_token, 'claimToken')
    const items = parseCleanupItems(claim.items)
    let succeeded = 0
    let failed = 0

    for (const item of items) {
      const { error: removeError } = await storageClient.storage.from(publicBucket).remove([item.object_path])
      const success = !removeError
      const { error: finishError } = await userClient.rpc('finish_case_publication_cleanup_v1', {
        p_company_id: companyId,
        p_cleanup_id: item.id,
        p_claim_token: claimToken,
        p_succeeded: success,
        p_error: success ? null : (removeError?.message ?? 'storage deletion failed'),
      })
      if (finishError) throw finishError
      if (success) succeeded += 1
      else failed += 1
    }

    return response(failed === 0 ? 200 : 502, {
      ok: failed === 0,
      action: 'cleanup',
      claimed: items.length,
      succeeded,
      failed,
    })
  } catch (error) {
    if (error instanceof ClientError) return response(400, { error: 'invalid_request', message: error.message })
    return response(403, { error: 'operation_denied_or_failed' })
  }
})
