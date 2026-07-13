import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase build configuration is missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: 'public' },
  realtime: { params: { eventsPerSecond: 10 } },
  auth: {
    persistSession: true,
    storage: window.sessionStorage,
    storageKey: 'canwin-auth-session',
  },
})

export function isSupabaseConfigured(): boolean {
  return true
}
