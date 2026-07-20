import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type MemberPayload = {
  action: 'invite' | 'update' | 'apply-access' | 'replace-supervisor-scope' | 'set-status' | 'reset-password'
  id?: string
  email?: string
  name?: string
  roleCodes?: string[]
  status?: 'active' | 'disabled'
  idempotencyKey?: string
  position?: string
  avatarUrl?: string
  joinDate?: string
  password?: string
  subordinateIds?: string[]
}

type PrimaryAccessRole = 'admin' | 'sales' | 'implementation' | 'operations' | 'finance'
type AdditionalAccessFunction = 'warehouse' | 'supervisor'

const primaryAccessRoles = new Set<PrimaryAccessRole>(['admin', 'sales', 'implementation', 'operations', 'finance'])
const additionalAccessFunctions = new Set<AdditionalAccessFunction>(['warehouse', 'supervisor'])

function splitV1RoleSelection(roleCodes: string[]) {
  const normalized = [...new Set(roleCodes)]
  const invalid = normalized.filter((code) => !primaryAccessRoles.has(code as PrimaryAccessRole) && !additionalAccessFunctions.has(code as AdditionalAccessFunction))
  const primaryRoles = normalized.filter((code): code is PrimaryAccessRole => primaryAccessRoles.has(code as PrimaryAccessRole))
  const additionalFunctions = normalized.filter((code): code is AdditionalAccessFunction => additionalAccessFunctions.has(code as AdditionalAccessFunction))
  if (invalid.length || primaryRoles.length !== 1) throw new Error('INVALID_ROLE_SET')
  const primaryRole = primaryRoles[0]
  if (additionalFunctions.includes('warehouse') && !['admin', 'implementation'].includes(primaryRole)) {
    throw new Error('WAREHOUSE_FUNCTION_NOT_ASSIGNABLE')
  }
  return { primaryRole, additionalFunctions }
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

async function loadMemberAccessState(
  adminClient: ReturnType<typeof createClient>,
  teamId: string,
  profileId: string,
) {
  const [skills, regions, flag] = await Promise.all([
    adminClient.from('user_skills').select('skill_id').eq('team_id', teamId).eq('user_id', profileId),
    adminClient.from('profile_sales_regions').select('region_id').eq('team_id', teamId).eq('profile_id', profileId),
    adminClient.from('feature_flags').select('config').eq('team_id', teamId).eq('key', 'team_os_4_supervisor').single(),
  ])
  const stateError = skills.error || regions.error || flag.error
  if (stateError) throw new Error(`MEMBER_ACCESS_STATE_READ_FAILED:${stateError.message}`)
  const config = flag.data?.config && typeof flag.data.config === 'object' && !Array.isArray(flag.data.config)
    ? flag.data.config as Record<string, unknown>
    : {}
  const warehouseScopes = config.warehouseScopesByProfile && typeof config.warehouseScopesByProfile === 'object' && !Array.isArray(config.warehouseScopesByProfile)
    ? config.warehouseScopesByProfile as Record<string, unknown>
    : {}
  const supervisorScopes = config.supervisorScopesByProfile && typeof config.supervisorScopesByProfile === 'object' && !Array.isArray(config.supervisorScopesByProfile)
    ? config.supervisorScopesByProfile as Record<string, unknown>
    : {}
  const supervisorScope = supervisorScopes[profileId] && typeof supervisorScopes[profileId] === 'object' && !Array.isArray(supervisorScopes[profileId])
    ? supervisorScopes[profileId] as Record<string, unknown>
    : {}
  return {
    skillIds: (skills.data ?? []).map((row) => row.skill_id),
    regionScopeIds: (regions.data ?? []).map((row) => row.region_id),
    warehouseScopeIds: readStringArray(warehouseScopes[profileId]),
    supervisorRegionIds: readStringArray(supervisorScope.regionIds),
    supervisorBusinessScopes: readStringArray(supervisorScope.businessScopes),
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type InvitationFailureCode = 'INVITE_AUTH_FAILED' | 'INVITE_PROFILE_FAILED' | 'INVITE_ROLE_BINDING_FAILED'

async function recordInvitationFailure(
  adminClient: ReturnType<typeof createClient>,
  input: {
    invitationId: string
    teamId: string
    actorId: string
    code: InvitationFailureCode
    message: string
    authUserId?: string
  },
) {
  const failedAt = new Date().toISOString()
  const failure = {
    status: 'failed',
    failure_code: input.code,
    failure_message: input.message.slice(0, 1000),
    failed_at: failedAt,
    auth_user_id: input.authUserId || null,
  }
  const { error: updateError } = await adminClient
    .from('team_invitations')
    .update(failure)
    .eq('id', input.invitationId)
    .eq('team_id', input.teamId)
  const { error: auditError } = await adminClient.from('audit_logs').insert({
    team_id: input.teamId,
    actor_id: input.actorId,
    action: 'invitation.failed',
    target_type: 'team_invitation',
    target_id: input.invitationId,
    after_data: { ...failure, failure_message: input.message.slice(0, 300) },
  })
  return updateError?.message || auditError?.message || ''
}

async function containProvisioningFailure(
  adminClient: ReturnType<typeof createClient>,
  authUserId: string,
  teamId: string,
) {
  const { error: profileError } = await adminClient
    .from('profiles')
    .update({ status: 'disabled' })
    .eq('id', authUserId)
    .eq('team_id', teamId)
  const { error: authError } = await adminClient.auth.admin.updateUserById(authUserId, {
    ban_duration: '876000h',
  })
  return profileError?.message || authError?.message || ''
}

function invitationFailureResponse(code: InvitationFailureCode, detail: string, trackingError = '') {
  const messages: Record<InvitationFailureCode, string> = {
    INVITE_AUTH_FAILED: '管理员邀请发送失败',
    INVITE_PROFILE_FAILED: '邀请已发送，但成员资料初始化失败',
    INVITE_ROLE_BINDING_FAILED: '邀请已发送，但角色绑定失败，账号已暂停',
  }
  return jsonResponse({
    error: `${messages[code]}（${code}）`,
    code,
    detail,
    ...(trackingError ? { trackingError } : {}),
  }, 400)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Edge Function missing Supabase environment variables' }, 500)
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return jsonResponse({ error: 'Unauthorized' }, 401)

  const { data: actorProfile, error: actorError } = await adminClient
    .from('profiles')
    .select('id, team_id, role, status')
    .eq('id', authData.user.id)
    .single()
  if (actorError || !actorProfile || actorProfile.status !== 'active') {
    return jsonResponse({ error: 'Only active access managers can manage members' }, 403)
  }

  const payload = (await req.json()) as MemberPayload
  const teamId = actorProfile.team_id || 'CANWIN_TEAM'
  const { data: canManage, error: permissionError } = await userClient.rpc('has_permission', {
    target_team_id: teamId,
    target_permission_code: 'access.manage',
  })
  if (permissionError || !canManage) return jsonResponse({ error: 'ACCESS_ADMIN_REQUIRED' }, 403)

  if (payload.action === 'invite') {
    if (!payload.email || !payload.name || !payload.roleCodes?.length || !payload.idempotencyKey) {
      return jsonResponse({ error: 'Missing required member fields' }, 400)
    }
    let roleSelection: ReturnType<typeof splitV1RoleSelection>
    try {
      roleSelection = splitV1RoleSelection(payload.roleCodes)
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : 'INVALID_ROLE_SET' }, 400)
    }

    const { data: registry, error: registryError } = await userClient.rpc('admin_create_team_invitation', {
      p_email: payload.email,
      p_display_name: payload.name,
      p_role_codes: payload.roleCodes,
      p_idempotency_key: payload.idempotencyKey,
    })
    if (registryError) return jsonResponse({ error: registryError.message }, 400)
    const invitationId = (registry as { id?: string } | null)?.id
    if (!invitationId) return jsonResponse({ error: 'INVITATION_REGISTRY_INVALID' }, 500)

    const siteUrl = Deno.env.get('SITE_URL')
    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      payload.email.trim().toLowerCase(),
      {
        data: { name: payload.name, team_id: teamId },
        ...(siteUrl ? { redirectTo: siteUrl } : {}),
      },
    )
    if (inviteError || !invited.user) {
      const detail = inviteError?.message || 'Supabase Auth did not return an invited user'
      const trackingError = await recordInvitationFailure(adminClient, {
        invitationId, teamId, actorId: authData.user.id, code: 'INVITE_AUTH_FAILED', message: detail,
      })
      return invitationFailureResponse('INVITE_AUTH_FAILED', detail, trackingError)
    }

    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .upsert({
        id: invited.user.id,
        team_id: teamId,
        name: payload.name,
        position: payload.position || '',
        avatar_url: payload.avatarUrl || null,
        join_date: payload.joinDate || new Date().toISOString().slice(0, 10),
        status: 'active',
      })
      .select('id, team_id, name, role, position, avatar_url, join_date, status, rest_days, mood, taboos')
      .single()
    if (profileError) {
      const containmentError = await containProvisioningFailure(adminClient, invited.user.id, teamId)
      const trackingError = await recordInvitationFailure(adminClient, {
        invitationId, teamId, actorId: authData.user.id, code: 'INVITE_PROFILE_FAILED',
        message: profileError.message, authUserId: invited.user.id,
      })
      return invitationFailureResponse('INVITE_PROFILE_FAILED', profileError.message, containmentError || trackingError)
    }
    const { error: rolesError } = await userClient.rpc('admin_apply_member_access_v1', {
      p_profile_id: invited.user.id,
      p_primary_role: roleSelection.primaryRole,
      p_additional_functions: roleSelection.additionalFunctions,
      p_skill_ids: [],
      p_region_scope_ids: [],
      p_warehouse_scope_ids: roleSelection.additionalFunctions.includes('warehouse') ? [teamId] : [],
      p_idempotency_key: crypto.randomUUID(),
    })
    if (rolesError) {
      const containmentError = await containProvisioningFailure(adminClient, invited.user.id, teamId)
      const trackingError = await recordInvitationFailure(adminClient, {
        invitationId, teamId, actorId: authData.user.id, code: 'INVITE_ROLE_BINDING_FAILED',
        message: rolesError.message, authUserId: invited.user.id,
      })
      return invitationFailureResponse('INVITE_ROLE_BINDING_FAILED', rolesError.message, containmentError || trackingError)
    }
    return jsonResponse({ profile })
  }

  if (payload.action === 'apply-access') {
    if (!payload.id || !payload.roleCodes?.length || !payload.idempotencyKey) {
      return jsonResponse({ error: 'Missing access fields' }, 400)
    }
    try {
      const selection = splitV1RoleSelection(payload.roleCodes)
      const state = await loadMemberAccessState(adminClient, teamId, payload.id)
      const { error } = await userClient.rpc('admin_apply_member_access_v1', {
        p_profile_id: payload.id,
        p_primary_role: selection.primaryRole,
        p_additional_functions: selection.additionalFunctions,
        p_skill_ids: state.skillIds,
        p_region_scope_ids: state.regionScopeIds,
        p_warehouse_scope_ids: selection.additionalFunctions.includes('warehouse')
          ? (state.warehouseScopeIds.length ? state.warehouseScopeIds : [teamId])
          : [],
        p_idempotency_key: payload.idempotencyKey,
      })
      if (error) return jsonResponse({ error: error.message }, 400)
      return jsonResponse({ ok: true })
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : 'INVALID_ROLE_SET' }, 400)
    }
  }

  if (payload.action === 'replace-supervisor-scope') {
    if (!payload.id || !Array.isArray(payload.subordinateIds) || !payload.idempotencyKey) {
      return jsonResponse({ error: 'Missing supervisor scope fields' }, 400)
    }
    try {
      const state = await loadMemberAccessState(adminClient, teamId, payload.id)
      const { error } = await userClient.rpc('admin_replace_supervisor_scope_v1', {
        p_supervisor_id: payload.id,
        p_region_ids: state.supervisorRegionIds,
        p_user_ids: payload.subordinateIds,
        p_business_scopes: state.supervisorBusinessScopes,
        p_idempotency_key: payload.idempotencyKey,
      })
      if (error) return jsonResponse({ error: error.message }, 400)
      return jsonResponse({ ok: true })
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : 'MEMBER_ACCESS_STATE_READ_FAILED' }, 400)
    }
  }

  if (payload.action === 'update') {
    if (!payload.id || !payload.name || !payload.position || !payload.roleCodes?.length) {
      return jsonResponse({ error: 'Missing required member fields' }, 400)
    }
    let roleSelection: ReturnType<typeof splitV1RoleSelection>
    let accessState: Awaited<ReturnType<typeof loadMemberAccessState>>
    try {
      roleSelection = splitV1RoleSelection(payload.roleCodes)
      accessState = await loadMemberAccessState(adminClient, teamId, payload.id)
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : 'INVALID_ROLE_SET' }, 400)
    }
    const { data: profile, error: updateError } = await adminClient
      .from('profiles')
      .update({
        name: payload.name,
        position: payload.position,
        avatar_url: payload.avatarUrl || null,
        join_date: payload.joinDate,
        status: 'active',
      })
      .eq('id', payload.id)
      .eq('team_id', teamId)
      .select('id, team_id, name, role, position, avatar_url, join_date, status, rest_days, mood, taboos')
      .single()
    if (updateError) return jsonResponse({ error: updateError.message }, 400)
    const { error: rolesError } = await userClient.rpc('admin_apply_member_access_v1', {
      p_profile_id: payload.id,
      p_primary_role: roleSelection.primaryRole,
      p_additional_functions: roleSelection.additionalFunctions,
      p_skill_ids: accessState.skillIds,
      p_region_scope_ids: accessState.regionScopeIds,
      p_warehouse_scope_ids: roleSelection.additionalFunctions.includes('warehouse')
        ? (accessState.warehouseScopeIds.length ? accessState.warehouseScopeIds : [teamId])
        : [],
      p_idempotency_key: payload.idempotencyKey || crypto.randomUUID(),
    })
    if (rolesError) return jsonResponse({ error: rolesError.message }, 400)
    const { error: auditError } = await adminClient.from('audit_logs').insert({
      team_id: teamId,
      actor_id: authData.user.id,
      action: 'profile.details_updated',
      target_type: 'profile',
      target_id: payload.id,
      after_data: { name: payload.name, position: payload.position },
    })
    if (auditError) return jsonResponse({ error: auditError.message }, 400)
    return jsonResponse({ profile })
  }

  if (payload.action === 'set-status') {
    if (!payload.id || !payload.status || !payload.idempotencyKey) {
      return jsonResponse({ error: 'Missing status fields' }, 400)
    }
    const { error: statusError } = await userClient.rpc('admin_set_profile_status', {
      p_profile_id: payload.id,
      p_status: payload.status,
      p_idempotency_key: payload.idempotencyKey,
    })
    if (statusError) return jsonResponse({ error: statusError.message }, 400)
    const { error: authStatusError } = await adminClient.auth.admin.updateUserById(payload.id, {
      ban_duration: payload.status === 'disabled' ? '876000h' : 'none',
    })
    if (authStatusError) return jsonResponse({ error: authStatusError.message }, 400)
    return jsonResponse({ ok: true })
  }

  if (payload.action === 'reset-password') {
    if (!payload.id || !payload.password) {
      return jsonResponse({ error: 'Missing password reset fields' }, 400)
    }
    if (payload.password.length < 8 || payload.password.length > 72) {
      return jsonResponse({ error: 'PASSWORD_LENGTH_INVALID' }, 400)
    }

    const { data: targetProfile, error: targetError } = await adminClient
      .from('profiles')
      .select('id, team_id, status')
      .eq('id', payload.id)
      .eq('team_id', teamId)
      .single()
    if (targetError || !targetProfile) {
      return jsonResponse({ error: 'MEMBER_NOT_FOUND' }, 404)
    }

    const { error: passwordError } = await adminClient.auth.admin.updateUserById(payload.id, {
      password: payload.password,
      // An administrator-issued password completes the internal invitation flow.
      // Without this, invited users remain blocked by "Email not confirmed".
      email_confirm: true,
    })
    if (passwordError) return jsonResponse({ error: passwordError.message }, 400)

    const { error: auditError } = await adminClient.from('audit_logs').insert({
      team_id: teamId,
      actor_id: authData.user.id,
      action: 'profile.password_reset',
      target_type: 'profile',
      target_id: payload.id,
      after_data: { reset_at: new Date().toISOString() },
    })
    if (auditError) {
      console.error('[admin-members] Password reset succeeded but audit logging failed.', auditError.message)
    }
    return jsonResponse({ ok: true, ...(auditError ? { auditWarning: true } : {}) })
  }

  return jsonResponse({ error: 'Unsupported action' }, 400)
})
