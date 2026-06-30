import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type MemberPayload = {
  action: 'create' | 'update' | 'disable'
  id?: string
  email?: string
  password?: string
  name?: string
  role?: 'admin' | 'captain' | 'finance' | 'warehouse' | 'member'
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
  if (actorError || actorProfile?.role !== 'admin' || actorProfile.status !== 'active') {
    return jsonResponse({ error: 'Only active admin can manage members' }, 403)
  }

  const payload = (await req.json()) as MemberPayload
  const teamId = actorProfile.team_id || 'CANWIN_TEAM'

  if (payload.action === 'create') {
    if (!payload.email || !payload.password || !payload.name || !payload.role || !payload.position) {
      return jsonResponse({ error: 'Missing required member fields' }, 400)
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: { name: payload.name },
    })
    if (createError || !created.user) {
      return jsonResponse({ error: createError?.message || 'Failed to create auth user' }, 400)
    }

    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .upsert({
        id: created.user.id,
        team_id: teamId,
        name: payload.name,
        role: payload.role,
        position: payload.position,
        avatar_url: payload.avatarUrl || null,
        join_date: payload.joinDate || new Date().toISOString().slice(0, 10),
        status: 'active',
      })
      .select('id, team_id, name, role, position, avatar_url, join_date, status, rest_days, mood, taboos')
      .single()
    if (profileError) return jsonResponse({ error: profileError.message }, 400)
    return jsonResponse({ profile })
  }

  if (payload.action === 'update') {
    if (!payload.id || !payload.name || !payload.role || !payload.position) {
      return jsonResponse({ error: 'Missing required member fields' }, 400)
    }
    if (payload.password) {
      const { error: passwordError } = await adminClient.auth.admin.updateUserById(payload.id, {
        password: payload.password,
      })
      if (passwordError) return jsonResponse({ error: passwordError.message }, 400)
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
    return jsonResponse({ profile })
  }

  if (payload.action === 'disable') {
    if (!payload.id) return jsonResponse({ error: 'Missing member id' }, 400)
    if (payload.id === authData.user.id) return jsonResponse({ error: 'Admin cannot disable self' }, 400)

    const { error: disableError } = await adminClient
      .from('profiles')
      .update({ status: 'disabled' })
      .eq('id', payload.id)
      .eq('team_id', teamId)
    if (disableError) return jsonResponse({ error: disableError.message }, 400)
    return jsonResponse({ ok: true })
  }

  return jsonResponse({ error: 'Unsupported action' }, 400)
})
