/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly CANWIN_TEAM_OS_4_SUPABASE_URL?: string
  readonly CANWIN_TEAM_OS_4_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
