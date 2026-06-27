import { createClient } from '@supabase/supabase-js'

// TODO: 替换为你的 Supabase 项目信息
// 在 https://app.supabase.com → Project Settings → API 中获取
const supabaseUrl = '__SUPABASE_URL__'
const supabaseAnonKey = '__SUPABASE_ANON_KEY__'

if (supabaseUrl.startsWith('__')) {
  console.warn('[Supabase] 未配置 URL 和 Key，数据仅保存在本地 localStorage')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: 'public' },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})

export function isSupabaseConfigured(): boolean {
  return !supabaseUrl.startsWith('__')
}
