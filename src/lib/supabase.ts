import { createClient } from '@supabase/supabase-js'

// Supabase 项目配置
const supabaseUrl = 'https://agygfhmkazcbqaqwmljb.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFneWdmaG1rYXpjYnFhcXdtbGpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MzcyNzAsImV4cCI6MjA5ODExMzI3MH0.d1KrSXS57kvWzn1J8v0kBmuCAcNWI6g08bFcbmaSPs0'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: 'public' },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})

export function isSupabaseConfigured(): boolean {
  return !supabaseUrl.startsWith('__')
}
