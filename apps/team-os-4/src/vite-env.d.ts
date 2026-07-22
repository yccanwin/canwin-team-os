/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly CANWIN_TEAM_OS_4_SUPABASE_URL?: string
  readonly CANWIN_TEAM_OS_4_SUPABASE_PUBLISHABLE_KEY?: string
  readonly CANWIN_TEAM_OS_4_SUPABASE_PROJECT_REF?: string
  readonly CANWIN_TEAM_OS_4_DEPLOYMENT_STAGE?: string
  readonly CANWIN_TEAM_OS_4_PUBLIC_APP_URL?: string
  readonly CANWIN_TEAM_OS_4_RELEASE_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
