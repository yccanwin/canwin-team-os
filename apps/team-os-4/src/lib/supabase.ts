import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getTeamOs4Deployment, hasTeamOs4DeploymentEnvironment } from './deployment'

let client: SupabaseClient | undefined

export function hasGreenfieldEnvironment(): boolean {
  return hasTeamOs4DeploymentEnvironment()
}

export function getGreenfieldSupabase(): SupabaseClient {
  if (client) return client

  const config = getTeamOs4Deployment()

  client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })

  return client
}
