import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type MemberPayload = {
  action: 'invite' | 'update' | 'set-status'
  id?: string
  email?: string
  name?: string
  role?: 'admin' | 'captain' | 'finance' | 'warehouse' | 'member'
  roleCodes?: string[]
  status?: 'active' | 'disabled'
  idempotencyKey?: string
  position?: string
  avatarUrl?: string
  joinDate?: string
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

    const legacyRole = payload.roleCodes.includes('admin')
      ? 'admin'
      : payload.roleCodes.includes('supervisor')
        ? 'captain'
        : payload.roleCodes.includes('finance')
          ? 'finance'
          : payload.roleCodes.includes('warehouse')
            ? 'warehouse'
            : 'member'
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .upsert({
        id: invited.user.id,
        team_id: teamId,
        name: payload.name,
        role: legacyRole,
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
    const { error: rolesError } = await userClient.rpc('admin_replace_profile_roles', {
      p_profile_id: invited.user.id,
      p_role_codes: payload.roleCodes,
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

  if (payload.action === 'update') {
    if (!payload.id || !payload.name || !payload.role || !payload.position || !payload.roleCodes?.length) {
      return jsonResponse({ error: 'Missing required member fields' }, 400)
    }
    const { data: profile, error: updateError } = await adminClient
      .from('profiles')
      .update({
        name: payload.name,
        role: payload.role,
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
    const { error: rolesError } = await userClient.rpc('admin_replace_profile_roles', {
      p_profile_id: payload.id,
      p_role_codes: payload.roleCodes,
      p_idempotency_key: payload.idempotencyKey || crypto.randomUUID(),
    })
    if (rolesError) return jsonResponse({ error: rolesError.message }, 400)
    const { error: auditError } = await adminClient.from('audit_logs').insert({
      team_id: teamId,
      actor_id: authData.user.id,
      action: 'profile.details_updated',
      target_type: 'profile',
      target_id: payload.id,
      after_data: { name: payload.name, position: payload.position, role: payload.role },
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

  return jsonResponse({ error: 'Unsupported action' }, 400)
})
