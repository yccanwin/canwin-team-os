import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | undefined

export function hasGreenfieldEnvironment(): boolean {
  return Boolean(
    import.meta.env.CANWIN_TEAM_OS_4_SUPABASE_URL &&
      import.meta.env.CANWIN_TEAM_OS_4_SUPABASE_PUBLISHABLE_KEY,
  )
}

export function getGreenfieldSupabase(): SupabaseClient {
  if (client) return client

  const url = import.meta.env.CANWIN_TEAM_OS_4_SUPABASE_URL
  const publishableKey = import.meta.env.CANWIN_TEAM_OS_4_SUPABASE_PUBLISHABLE_KEY

  if (!url || !publishableKey) {
    throw new Error('全新 4.0 Supabase 环境尚未配置')
  }

  client = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })

  return client
}
