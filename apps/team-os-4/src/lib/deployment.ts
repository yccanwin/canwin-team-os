export const TEAM_OS_4_PRODUCT_VERSION = '4.0'

const LEGACY_PRODUCTION_PROJECT_REF = 'agygfhmkazcbqaqwmljb'
const PROJECT_REF_PATTERN = /^[a-z]{20}$/
const RELEASE_VERSION_PATTERN = /^4\.0\.\d+(?:-[0-9A-Za-z.-]+)?$/
const LEGACY_ADDRESS_MARKERS = ['canwinos3', 'team-os-3', '/sales-v3', '/management-v3']

export interface TeamOs4Deployment {
  readonly productVersion: typeof TEAM_OS_4_PRODUCT_VERSION
  readonly releaseVersion: string
  readonly stage: 'greenfield-test'
  readonly publicAppUrl: string
  readonly supabaseUrl: string
  readonly supabaseProjectRef: string
  readonly supabasePublishableKey: string
}

let deployment: TeamOs4Deployment | undefined

function required(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name]?.trim()
  if (!value) throw new Error(`TEAM_OS_4_DEPLOYMENT_CONFIG_MISSING:${name}`)
  return value
}

function assertNewFourAddress(url: URL, name: string): void {
  const address = url.href.toLowerCase()
  if (LEGACY_ADDRESS_MARKERS.some((marker) => address.includes(marker))) {
    throw new Error(`TEAM_OS_4_LEGACY_ADDRESS_FORBIDDEN:${name}`)
  }
}

function assertRuntimeAddress(publicAppUrl: URL): void {
  if (typeof window === 'undefined') return
  if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') return

  const configuredPath = publicAppUrl.pathname.replace(/\/+$/, '')
  const runtimePath = window.location.pathname.replace(/\/+$/, '')
  if (window.location.origin !== publicAppUrl.origin || runtimePath !== configuredPath) {
    throw new Error('TEAM_OS_4_PUBLIC_APP_URL_MISMATCH')
  }
}

export function getTeamOs4Deployment(): TeamOs4Deployment {
  if (deployment) return deployment

  const stage = required('CANWIN_TEAM_OS_4_DEPLOYMENT_STAGE')
  const projectRef = required('CANWIN_TEAM_OS_4_SUPABASE_PROJECT_REF')
  const releaseVersion = required('CANWIN_TEAM_OS_4_RELEASE_VERSION')
  const supabaseUrl = new URL(required('CANWIN_TEAM_OS_4_SUPABASE_URL'))
  const publicAppUrl = new URL(required('CANWIN_TEAM_OS_4_PUBLIC_APP_URL'))

  if (stage !== 'greenfield-test') throw new Error('TEAM_OS_4_PRODUCTION_CONNECTION_FORBIDDEN')
  if (!PROJECT_REF_PATTERN.test(projectRef)) throw new Error('TEAM_OS_4_PROJECT_REF_INVALID')
  if (projectRef === LEGACY_PRODUCTION_PROJECT_REF) throw new Error('TEAM_OS_4_LEGACY_PROJECT_FORBIDDEN')
  if (supabaseUrl.protocol !== 'https:' || supabaseUrl.hostname !== `${projectRef}.supabase.co`) {
    throw new Error('TEAM_OS_4_SUPABASE_PROJECT_REF_MISMATCH')
  }
  if (publicAppUrl.protocol !== 'https:') throw new Error('TEAM_OS_4_PUBLIC_APP_URL_MUST_USE_HTTPS')
  if (!RELEASE_VERSION_PATTERN.test(releaseVersion)) throw new Error('TEAM_OS_4_RELEASE_VERSION_INVALID')

  assertNewFourAddress(supabaseUrl, 'SUPABASE_URL')
  assertNewFourAddress(publicAppUrl, 'PUBLIC_APP_URL')
  assertRuntimeAddress(publicAppUrl)

  deployment = Object.freeze({
    productVersion: TEAM_OS_4_PRODUCT_VERSION,
    releaseVersion,
    stage,
    publicAppUrl: publicAppUrl.href,
    supabaseUrl: supabaseUrl.href.replace(/\/$/, ''),
    supabaseProjectRef: projectRef,
    supabasePublishableKey: required('CANWIN_TEAM_OS_4_SUPABASE_PUBLISHABLE_KEY'),
  })
  return deployment
}

export function hasTeamOs4DeploymentEnvironment(): boolean {
  return Boolean(
    import.meta.env.CANWIN_TEAM_OS_4_SUPABASE_URL &&
      import.meta.env.CANWIN_TEAM_OS_4_SUPABASE_PUBLISHABLE_KEY &&
      import.meta.env.CANWIN_TEAM_OS_4_SUPABASE_PROJECT_REF &&
      import.meta.env.CANWIN_TEAM_OS_4_DEPLOYMENT_STAGE &&
      import.meta.env.CANWIN_TEAM_OS_4_PUBLIC_APP_URL &&
      import.meta.env.CANWIN_TEAM_OS_4_RELEASE_VERSION,
  )
}
