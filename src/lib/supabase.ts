import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
const expectedSupabaseProjectRef = import.meta.env.VITE_EXPECTED_SUPABASE_PROJECT_REF?.trim()

if (!supabaseUrl || !supabaseAnonKey || !expectedSupabaseProjectRef) {
  throw new Error('Supabase build configuration is missing. Set URL, frontend key, and expected project ref.')
}

const parsedSupabaseUrl = new URL(supabaseUrl)
const projectRefMatch = parsedSupabaseUrl.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)
if (
  parsedSupabaseUrl.protocol !== 'https:' ||
  !projectRefMatch ||
  parsedSupabaseUrl.port ||
  parsedSupabaseUrl.username ||
  parsedSupabaseUrl.password ||
  (parsedSupabaseUrl.pathname !== '' && parsedSupabaseUrl.pathname !== '/') ||
  parsedSupabaseUrl.search ||
  parsedSupabaseUrl.hash
) {
  throw new Error('Supabase URL must use the registered project host over HTTPS.')
}

export const supabaseProjectRef = projectRefMatch[1]
if (supabaseProjectRef !== expectedSupabaseProjectRef) {
  throw new Error('Supabase URL does not match the expected build project ref.')
}
export const supabaseAuthStorageKey = `canwin-${supabaseProjectRef}-auth-session`
export const supabaseLegacyAuthStorageKey = `sb-${supabaseProjectRef}-auth-token`

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: 'public' },
  realtime: { params: { eventsPerSecond: 10 } },
  auth: {
    persistSession: true,
    storage: window.sessionStorage,
    storageKey: supabaseAuthStorageKey,
  },
})

export function isSupabaseConfigured(): boolean {
  return true
}
