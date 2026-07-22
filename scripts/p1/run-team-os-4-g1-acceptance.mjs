import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { isAbsolute, join, resolve } from 'node:path'
import { createAcceptanceEvidenceRecord } from '../../platform/team-os-4/tools/acceptance-accounts/src/evidence.mjs'

const roleFor = (key) => key === 'admin_supervisor' ? 'admin' : key
const GREENFIELD_TEST_PROJECT_REF = 'jgcrhoabvaowxnqksvkq'
const ROLE_CAPABILITIES = Object.freeze({
  sales: [], implementation: ['warehouse'], operations: [], finance: [], admin: ['supervisor'],
})
const ROLE_NAVIGATION_PATHS = Object.freeze({
  sales: ['/leads', '/customers', '/orders', '/catalog', '/earnings'],
  implementation: ['/fulfillment', '/warehouse', '/earnings'],
  operations: ['/fulfillment', '/cases', '/earnings'],
  finance: ['/finance', '/earnings'],
  admin: ['/leads', '/customers', '/catalog', '/orders', '/warehouse', '/finance', '/cases'],
})
const ROLE_PAGE = Object.freeze({
  sales: {
    path: '/leads', surface: 'sales-pipeline-page', error: 'sales-pipeline-error',
    realDataTestId: 'opportunity-row', expectedRestSurfaces: ['leads', 'opportunities'],
  },
  implementation: {
    path: '/fulfillment', surface: 'implementation-service-page', error: 'fulfillment-error',
    realDataTestId: 'service-assignment-installation',
    expectedRestSurfaces: ['fulfillment_units', 'service_assignments', 'stock_items'],
  },
  operations: {
    path: '/fulfillment', surface: 'operations-service-page', error: 'fulfillment-error',
    realDataTestId: 'service-assignment-operations_handoff',
    expectedRestSurfaces: ['fulfillment_units', 'service_assignments', 'stock_items'],
  },
  finance: {
    path: '/finance', surface: ['finance-page', 'finance-empty'], error: 'finance-error',
    realDataTestId: 'finance-payment-count',
    expectedRestSurfaces: ['internal_payment_events', 'payment_events', 'profit_ledger_entries', 'refund_events'],
  },
  admin: {
    path: '/cases', surface: 'cases-page', error: 'cases-error',
    realDataTestId: 'case-admin-row',
    expectedRestSurfaces: ['case_candidates', 'case_media', 'cases', 'published_cases_public'],
  },
})
const MANAGEMENT_PAGE = Object.freeze({
  sales: { path: '/warehouse', surface: 'warehouse-denied', boundary: 'denied' },
  implementation: { path: '/finance', surface: 'finance-denied', boundary: 'denied' },
  operations: { path: '/finance', surface: 'finance-denied', boundary: 'denied' },
  finance: { path: '/warehouse', surface: 'warehouse-denied', boundary: 'denied' },
  admin: {
    path: '/warehouse', surface: 'warehouse-page', boundary: 'authorized',
    realDataTestId: 'warehouse-row',
  },
})
const ROLE_BUSINESS_READ = Object.freeze({
  sales: { table: 'opportunities', ownerColumn: 'owner_id' },
  implementation: { table: 'fulfillment_units', ownerColumn: 'assigned_to' },
  operations: { table: 'service_assignments', ownerColumn: 'assignee_id' },
  finance: { table: 'payment_events' },
  admin: { table: 'case_candidates' },
})
const ROLE_BUSINESS_BOUNDARY = Object.freeze({
  sales: { table: 'payment_events', boundary: 'denied' },
  implementation: { table: 'opportunities', boundary: 'denied' },
  operations: { table: 'payment_events', boundary: 'denied' },
  finance: { table: 'opportunities', boundary: 'denied' },
  admin: { table: 'case_candidates', boundary: 'authorized' },
})
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
const expectDenied = (result, label, { privateSchemaBoundary = false } = {}) => {
  if (!result.error) throw new Error(`${label} unexpectedly succeeded`)
  const status = Number(result.status ?? result.error.statusCode ?? result.error.status)
  const code = String(result.error.code ?? '')
  const authorizationDenied = status === 401 || status === 403 || code === '42501'
  const privateSchemaDenied = privateSchemaBoundary && code === 'PGRST106'
  if (!authorizationDenied && !privateSchemaDenied) {
    throw new Error(`${label} did not return an authorization boundary`)
  }
}
const digest = (value) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right))
const pageSurface = (path) => `page:#${path}`
const restSurface = (tables) => `rest:${sorted(tables).join('/')}`
const traceDigest = (value) => `trace:${digest(value)}`
const visibleState = async (page, rootTestId, realDataTestId) => {
  const root = page.getByTestId(rootTestId)
  await root.waitFor({ state: 'visible' })
  if (realDataTestId) {
    const realData = page.getByTestId(realDataTestId)
    if (await realData.count() > 0) {
      const count = await realData.first().getAttribute('data-count')
      if (count === null || Number(count) >= 1) return 'real-data'
    }
  }
  return (await root.locator('.ui-empty').count()) > 0 || rootTestId.endsWith('-empty')
    ? 'explicit-empty'
    : 'visible-without-required-data'
}
const workspaceState = async (page) => {
  const result = await Promise.race([
    page.getByTestId('work-items-workbench-list').waitFor({ state: 'visible' }).then(() => 'real-data'),
    page.getByTestId('work-items-workbench-empty').waitFor({ state: 'visible' }).then(() => 'explicit-empty'),
    page.getByTestId('work-items-workbench-error').waitFor({ state: 'visible' }).then(() => 'error'),
  ])
  if (result === 'error') throw new Error('workspace returned an error state')
  return result
}
const sidebarPaths = async (page) => page.locator('aside nav.desktop-nav a').evaluateAll((links) => links.map((link) => {
  const hash = new URL(link.href).hash
  return hash.startsWith('#') ? hash.slice(1) : hash
}))
const captureRemoteRest = (page, supabaseUrl) => {
  const calls = []
  const startedRequests = new WeakSet()
  const origin = new URL(supabaseUrl).origin
  const requestListener = (request) => {
    const url = new URL(request.url())
    if (url.origin === origin && url.pathname.startsWith('/rest/v1/')) startedRequests.add(request)
  }
  const listener = (response) => {
    if (!startedRequests.has(response.request())) return
    const url = new URL(response.url())
    if (url.origin !== origin || !url.pathname.startsWith('/rest/v1/')) return
    calls.push({ surface: url.pathname.slice('/rest/v1/'.length), status: response.status() })
  }
  page.on('request', requestListener)
  page.on('response', listener)
  return {
    finish() {
      page.off('request', requestListener)
      page.off('response', listener)
      const unique = [...new Map(calls.map((call) => [`${call.surface}:${call.status}`, call])).values()]
      if (!unique.length || unique.some((call) => call.status < 200 || call.status >= 300)) {
        throw new Error('business page remote REST evidence is incomplete')
      }
      return sorted(unique.map((call) => `${call.surface}:${call.status}`))
    },
  }
}
const WINDOWS_BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]
const launchAcceptanceBrowser = () => {
  const bundled = chromium.executablePath()
  if (bundled && existsSync(bundled)) return chromium.launch({ headless: true })
  const systemBrowser = WINDOWS_BROWSER_PATHS.find((path) => existsSync(path))
  if (!systemBrowser) throw new Error('no supported browser executable found')
  return chromium.launch({ headless: true, executablePath: systemBrowser })
}

const PREVIEW_COMMIT = /^[a-f0-9]{40}$/u
const PREVIEW_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const normalizePagesUrl = (value) => {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('TEAM_OS_4_PREVIEW_URL must be a credential-free HTTPS Pages URL')
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/`
  return url.href
}
const git = (repositoryPath, args) => {
  const result = spawnSync('git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
  })
  if (result.error || result.status !== 0) throw new Error('preview repository git verification failed')
  return result.stdout.trim()
}
const repositoryFromOrigin = (origin) => {
  const https = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/iu.exec(origin)
  const ssh = /^(?:ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/iu.exec(origin)
  const repository = (https?.[1] ?? ssh?.[1] ?? '').replace(/\.git$/iu, '')
  if (!PREVIEW_REPOSITORY.test(repository)) throw new Error('preview origin is not a GitHub repository')
  return repository
}
const githubPagesJson = async (repository, endpoint) => {
  const [owner, name] = repository.split('/')
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    'User-Agent': 'canwin-team-os-4-acceptance-preflight',
  }
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${endpoint}`, { headers })
  if (!response.ok) throw new Error(`GitHub Pages metadata request failed with status ${response.status}`)
  return response.json()
}

export async function runPreflightOnly() {
  const previewUrl = normalizePagesUrl(required('TEAM_OS_4_PREVIEW_URL'))
  const previewCommit = required('TEAM_OS_4_PREVIEW_COMMIT')
  const previewRepository = required('TEAM_OS_4_PREVIEW_REPOSITORY')
  const rawRepositoryPath = required('TEAM_OS_4_PREVIEW_REPOSITORY_PATH')
  const rawScreenshotDirectory = required('TEAM_OS_4_PREFLIGHT_SCREENSHOT_DIR')
  if (!PREVIEW_COMMIT.test(previewCommit)) throw new Error('TEAM_OS_4_PREVIEW_COMMIT must be a full lowercase 40-character SHA')
  if (!PREVIEW_REPOSITORY.test(previewRepository)) throw new Error('TEAM_OS_4_PREVIEW_REPOSITORY must be owner/repository')
  if (!isAbsolute(rawRepositoryPath) || !isAbsolute(rawScreenshotDirectory)) {
    throw new Error('preview repository and screenshot paths must be explicit absolute paths')
  }
  const repositoryPath = resolve(rawRepositoryPath)
  const screenshotDirectory = resolve(rawScreenshotDirectory)
  if (!existsSync(repositoryPath)) throw new Error('preview repository path does not exist')

  const verifiedCommit = git(repositoryPath, ['rev-parse', '--verify', `${previewCommit}^{commit}`])
  if (verifiedCommit !== previewCommit) throw new Error('preview commit is not the verified repository commit')
  const originRepository = repositoryFromOrigin(git(repositoryPath, ['remote', 'get-url', 'origin']))
  if (originRepository.toLowerCase() !== previewRepository.toLowerCase()) {
    throw new Error('preview repository does not match the local origin repository')
  }

  const [pages, latestBuild] = await Promise.all([
    githubPagesJson(previewRepository, 'pages'),
    githubPagesJson(previewRepository, 'pages/builds/latest'),
  ])
  const pagesUrl = normalizePagesUrl(pages.html_url)
  if (pagesUrl !== previewUrl) throw new Error('GitHub Pages URL does not match TEAM_OS_4_PREVIEW_URL')
  if (latestBuild.commit !== previewCommit || latestBuild.status !== 'built') {
    throw new Error('latest GitHub Pages build is not the requested preview commit')
  }
  if (!pages.source?.branch || !['/', '/docs'].includes(pages.source?.path)) {
    throw new Error('GitHub Pages source is missing or unsupported')
  }
  // GitHub's documented latest-build payload omits source. When an API variant includes
  // it, require an exact match; otherwise the repository-scoped latest build is bound to
  // the source returned by the Pages site endpoint.
  const latestBuildSource = latestBuild.source ?? pages.source
  if (latestBuildSource.branch !== pages.source.branch || latestBuildSource.path !== pages.source.path) {
    throw new Error('latest GitHub Pages build source does not match the configured Pages source')
  }

  mkdirSync(screenshotDirectory, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(/[-:.]/gu, '')
  const screenshotPath = join(screenshotDirectory, `team-os-4-login-${previewCommit}-${stamp}.png`)
  let browser
  try {
    browser = await launchAcceptanceBrowser()
    const context = await browser.newContext()
    const page = await context.newPage()
    const response = await page.goto(`${previewUrl}#/`, { waitUntil: 'domcontentloaded' })
    if (!response || !response.ok()) throw new Error('preview login page did not return a successful response')
    await page.getByTestId('login-gate').waitFor({ state: 'visible' })
    await page.getByText('Team OS 4.0', { exact: true }).waitFor({ state: 'visible' })
    if (await page.title() !== 'CanWin Team OS 4.0') throw new Error('preview page title is not Team OS 4.0')
    if (await page.getByTestId('login-error').count()) throw new Error('preview login page rendered a configuration error')
    if (await page.getByTestId('login-email').inputValue() || await page.getByTestId('login-password').inputValue()) {
      throw new Error('preview login page contains credential material')
    }
    await page.screenshot({ path: screenshotPath, fullPage: true })
    await context.close()
  } finally {
    await Promise.resolve().then(() => browser?.close()).catch(() => undefined)
  }
  const screenshot = readFileSync(screenshotPath)
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (screenshot.length <= pngSignature.length || !screenshot.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error('preview login screenshot is empty or not a PNG')
  }
  const screenshotSha256 = createHash('sha256').update(screenshot).digest('hex')
  return Object.freeze({ previewRepository, previewCommit, pagesUrl, screenshotPath, screenshotSha256 })
}

export async function runAcceptance(accounts, context) {
  if (!Array.isArray(accounts) || accounts.length !== 5) throw new Error('exactly five new role accounts are required')
  const expected = ['sales', 'implementation', 'operations', 'finance', 'admin_supervisor']
  if (JSON.stringify(accounts.map((item) => item.key)) !== JSON.stringify(expected)) throw new Error('acceptance identity order drift')

  const projectRef = required('TEAM_OS_4_TARGET_PROJECT_REF')
  const supabaseUrl = required('TEAM_OS_4_SUPABASE_URL')
  if (projectRef !== GREENFIELD_TEST_PROJECT_REF) throw new Error('runner is restricted to the Team OS 4.0 greenfield test project')
  if (supabaseUrl !== `https://${projectRef}.supabase.co`) throw new Error('runner target ref and URL mismatch')
  const publishableKey = required('TEAM_OS_4_SUPABASE_PUBLISHABLE_KEY')
  const previewUrl = required('TEAM_OS_4_PREVIEW_URL').replace(/\/$/u, '')
  if (!context || context.targetProjectRef !== projectRef) throw new Error('acceptance context target mismatch')
  const applicationCommit = context.applicationCommit
  const runId = context.runId
  if (!/^[a-f0-9]{40}$/u.test(applicationCommit ?? '')) throw new Error('acceptance context commit is invalid')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/u.test(runId ?? '')) throw new Error('acceptance context run id is invalid')
  const anon = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const evidenceRecords = []
  const steps = new Map(accounts.map((account) => [account.key, {}]))
  const appendEvidenceRecord = ({
    role,
    identityKind,
    evidenceStage,
    startedAt,
    surface,
    status,
    result,
    rowCount,
    trace,
    outcome = 'passed',
  }) => {
    evidenceRecords.push(createAcceptanceEvidenceRecord({
      runId,
      targetProjectRef: projectRef,
      applicationCommit,
      accountRole: role,
      identityKind,
      stage: evidenceStage,
      startedAt,
      finishedAt: new Date().toISOString(),
      pageUrlOrApiSurface: surface,
      httpStatusOrPostgresCode: status,
      rowCountOrResultDigest: Number.isSafeInteger(rowCount) ? rowCount : digest(result),
      pageTestIdOrTraceDigest: trace ?? traceDigest({ role, evidenceStage, result }),
      outcome,
    }))
  }
  const runStage = async (label, action) => {
    try {
      return await action()
    } catch {
      const roleStageMatch = /^(sign-in|profile-context|own-scope-read|role-business-read|cross-read|cross-write|management-api|role-business-boundary|bootstrap-public|bootstrap-private|page-login|auto-route|cross-url|management-page):(sales|implementation|operations|finance|admin)$/u.exec(label)
      if ((roleStageMatch || label === 'browser-launch') && evidenceRecords.at(-1)?.outcome !== 'failed') {
        const stagePrefix = roleStageMatch?.[1] ?? 'browser-launch'
        appendEvidenceRecord({
          role: roleStageMatch?.[2] ?? 'anon',
          identityKind: roleStageMatch ? 'enabled-account' : 'anonymous-attack',
          evidenceStage: `${stagePrefix}-terminal-failure`,
          startedAt: new Date().toISOString(),
          surface: `runner-check:${stagePrefix}`,
          status: 'CHECK_FAILED',
          result: { failed: true },
          trace: traceDigest({ role: roleStageMatch?.[2] ?? 'anon', stage: stagePrefix, failed: true }),
          outcome: 'failed',
        })
      }
      const failure = new Error(`G1_STAGE_FAIL ${label}`)
      Object.defineProperties(failure, {
        evidenceRecords: { value: Object.freeze([...evidenceRecords]) },
        runId: { value: runId },
        applicationCommit: { value: applicationCommit },
      })
      throw failure
    }
  }
  const runEvidenceCheck = async (descriptor, action) => {
    const startedAt = new Date().toISOString()
    try {
      const observation = await action()
      appendEvidenceRecord({ ...descriptor, startedAt, ...observation, outcome: 'passed' })
      return observation
    } catch (error) {
      appendEvidenceRecord({
        ...descriptor,
        startedAt,
        status: 'CHECK_FAILED',
        result: { stage: descriptor.evidenceStage, failed: true },
        trace: traceDigest({ stage: descriptor.evidenceStage, failed: true }),
        outcome: 'failed',
      })
      throw error
    }
  }
  const deniedObservation = (result, detail) => ({
    status: Number.isInteger(result?.status) ? result.status : 'POLICY_DENIED',
    result: {
      denied: true,
      boundary: detail,
      code: /^[0-9A-Z_-]{3,32}$/u.test(result?.error?.code ?? '') ? result.error.code : 'POLICY_DENIED',
    },
  })
  const appendPageEvidence = ({ role, stage: evidenceStage, startedAt, surface, status = 'UI_VISIBLE', result, testId }) => {
    appendEvidenceRecord({
      role, identityKind: 'enabled-account', evidenceStage, startedAt, surface,
      status, result, trace: testId,
    })
  }
  const bootstrapArguments = {
    p_company_name: 'G1 authorization probe',
    p_company_stable_key: 'g1_authorization_probe',
    p_admin_user_id: ZERO_UUID,
    p_admin_email: 'g1-authorization-probe@example.invalid',
    p_admin_display_name: 'G1 Authorization Probe',
    p_target_project_ref: projectRef,
    p_access_url: `https://${projectRef}.supabase.co`,
    p_actor_label: 'g1-authorization-probe',
    p_bootstrap_version: 'g1-authorization-probe',
  }

  await runStage('anon-bootstrap-public', () => runEvidenceCheck({
    role: 'anon', identityKind: 'anonymous-attack', evidenceStage: 'bootstrap-public-entry-denied',
    surface: 'rpc:public.bootstrap_team_os_4_deployment',
  }, async () => {
    const result = await anon.rpc('bootstrap_team_os_4_deployment', bootstrapArguments)
    expectDenied(result, 'anon public bootstrap')
    return deniedObservation(result, 'public-bootstrap')
  }))
  await runStage('anon-bootstrap-private', () => runEvidenceCheck({
    role: 'anon', identityKind: 'anonymous-attack', evidenceStage: 'bootstrap-private-entry-denied',
    surface: 'rpc:private.bootstrap_team_os_4',
  }, async () => {
    const result = await anon.schema('private').rpc('bootstrap_team_os_4', bootstrapArguments)
    expectDenied(result, 'anon private bootstrap', { privateSchemaBoundary: true })
    return deniedObservation(result, 'private-bootstrap')
  }))
  await runStage('anon-internal-read', () => runEvidenceCheck({
    role: 'anon', identityKind: 'anonymous-attack', evidenceStage: 'internal-table-read-denied',
    surface: restSurface(['profiles']),
  }, async () => {
    const result = await anon.from('profiles').select('id', { count: 'exact', head: true })
    expectDenied(result, 'anon internal table read')
    return deniedObservation(result, 'internal-table-read')
  }))
  await runStage('anon-rest-dml', () => runEvidenceCheck({
    role: 'anon', identityKind: 'anonymous-attack', evidenceStage: 'rest-dml-denied',
    surface: restSurface(['profiles']),
  }, async () => {
    const result = await anon.from('profiles')
      .update({ display_name: 'anonymous-write-must-not-land' })
      .eq('id', ZERO_UUID)
      .select('id')
    expectDenied(result, 'anon REST DML')
    return deniedObservation(result, 'zero-target-update')
  }))
  await runStage('anon-write-rpc', () => runEvidenceCheck({
    role: 'anon', identityKind: 'anonymous-attack', evidenceStage: 'write-rpc-denied',
    surface: 'rpc:public.complete_work_item_v1',
  }, async () => {
    const result = await anon.rpc('complete_work_item_v1', {
      p_company_id: ZERO_UUID,
      p_work_item_id: ZERO_UUID,
      p_idempotency_key: 'g1-anon-denied',
      p_actor_user_id: ZERO_UUID,
      p_payload: {},
    })
    expectDenied(result, 'anon write RPC')
    return deniedObservation(result, 'zero-target-write-rpc')
  }))
  await runStage('anon-storage-read', () => runEvidenceCheck({
    role: 'anon', identityKind: 'anonymous-attack', evidenceStage: 'private-storage-read-denied',
    surface: 'storage:team-os-4-case-media/list',
  }, async () => {
    const result = await anon.storage.from('team-os-4-case-media').list('', { limit: 1 })
    if (result.error || (result.data?.length ?? 0) !== 0) throw new Error('anon private storage read visible')
    return { status: 'RLS_EMPTY', rowCount: 0, result: { boundary: 'empty-by-policy' } }
  }))
  await runStage('anon-storage-write', () => runEvidenceCheck({
    role: 'anon', identityKind: 'anonymous-attack', evidenceStage: 'storage-write-denied',
    surface: 'storage:team-os-4-case-media/signed-upload',
  }, async () => {
    const result = await anon.storage.from('team-os-4-case-media')
      .createSignedUploadUrl(`${ZERO_UUID}/${ZERO_UUID}/logo.png`)
    expectDenied(result, 'anon storage write')
    return deniedObservation(result, 'private-bucket-signed-upload')
  }))
  const sessions = []
  let browser
  try {
  for (const account of accounts) {
    const client = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const role = roleFor(account.key)
    sessions.push({ account, client })
    await runStage(`sign-in:${role}`, () => runEvidenceCheck({
      role, identityKind: 'enabled-account', evidenceStage: 'auth-real-password-login',
      surface: 'auth:password-login',
    }, async () => {
      const result = await client.auth.signInWithPassword({ email: account.email, password: account.password })
      if (result.error || !result.data.session || result.data.user?.id !== account.id) throw new Error('sign-in denied')
      return { status: 'AUTH_OK', result: { authenticated: true, identity: digest(account.id) } }
    }))
    steps.get(account.key).signIn = 'passed'
  }

  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index]
    const { account, client } = session
    const other = sessions[(index + 1) % sessions.length].account
    const role = roleFor(account.key)
    await runStage(`profile-context:${role}`, async () => {
      const startedAt = new Date().toISOString()
      const profileResult = await client.from('profiles')
        .select('id,company_id,primary_role_id,is_active')
        .eq('id', account.id)
        .single()
      if (profileResult.error || !profileResult.data?.is_active || profileResult.data.id !== account.id) {
        throw new Error('current profile mismatch')
      }
      const roleResult = await client.from('primary_roles')
        .select('id,company_id,role_key,is_active')
        .eq('id', profileResult.data.primary_role_id)
        .single()
      if (roleResult.error || !roleResult.data?.is_active || roleResult.data.role_key !== role || roleResult.data.company_id !== profileResult.data.company_id) {
        throw new Error('primary role mismatch')
      }
      const linkResult = await client.from('profile_capabilities')
        .select('capability_id,company_id,revoked_at')
        .eq('profile_id', account.id)
      if (linkResult.error) throw new Error('capability links unavailable')
      const activeLinks = (linkResult.data ?? []).filter((item) => item.revoked_at === null)
      if (activeLinks.some((item) => item.company_id !== profileResult.data.company_id)) throw new Error('capability company mismatch')
      const capabilityIds = activeLinks.map((item) => item.capability_id)
      let capabilities = []
      if (capabilityIds.length) {
        const capabilityResult = await client.from('capabilities')
          .select('id,company_id,capability_key,is_active')
          .in('id', capabilityIds)
        if (capabilityResult.error) throw new Error('capabilities unavailable')
        if ((capabilityResult.data ?? []).some((item) => !item.is_active || item.company_id !== profileResult.data.company_id)) {
          throw new Error('inactive or foreign capability')
        }
        capabilities = sorted((capabilityResult.data ?? []).map((item) => item.capability_key))
      }
      if (JSON.stringify(capabilities) !== JSON.stringify(ROLE_CAPABILITIES[role])) throw new Error('additional capability mismatch')
      session.companyId = profileResult.data.company_id
      appendPageEvidence({
        role,
        stage: 'app-context-exact-primary-role-and-capabilities',
        startedAt,
        surface: restSurface(['profiles', 'primary_roles', 'profile_capabilities', 'capabilities']),
        status: 200,
        result: { active: true, primaryRole: role, additionalCapabilities: capabilities },
        testId: `trace:${digest({ role, capabilities })}`,
      })
      steps.get(account.key).profileContext = 'passed'
    })

    await runStage(`own-scope-read:${role}`, () => runEvidenceCheck({
      role, identityKind: 'enabled-account', evidenceStage: 'own-scope-direct-api-read',
      surface: restSurface(['work_items']),
    }, async () => {
      const result = await client.from('work_items')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', session.companyId)
        .eq('assignee_id', account.id)
      if (result.error || !Number.isSafeInteger(result.count) || result.count < 1) throw new Error('own scope direct API read did not prove a visible fixture')
      return { status: result.status, rowCount: result.count, result: { scope: 'self', table: 'work_items' } }
    }))
    steps.get(account.key).ownScopeApi = 'passed'

    await runStage(`role-business-read:${role}`, () => runEvidenceCheck({
      role, identityKind: 'enabled-account', evidenceStage: 'role-business-direct-api-read',
      surface: restSurface([ROLE_BUSINESS_READ[role].table]),
    }, async () => {
      const rule = ROLE_BUSINESS_READ[role]
      let query = client.from(rule.table)
        .select('id', { count: 'exact', head: true })
        .eq('company_id', session.companyId)
      if (rule.ownerColumn) query = query.eq(rule.ownerColumn, account.id)
      const result = await query
      if (result.error || !Number.isSafeInteger(result.count) || result.count < 1) throw new Error('role business direct API read did not prove a visible fixture')
      return { status: result.status, rowCount: result.count, result: { table: rule.table, scope: rule.ownerColumn ? 'self' : 'role' } }
    }))
    steps.get(account.key).roleBusinessRead = 'passed'

    await runStage(`cross-read:${role}`, () => runEvidenceCheck({
      role, identityKind: 'enabled-account', evidenceStage: 'cross-identity-read-matches-role-policy',
      surface: restSurface(['profiles']),
    }, async () => {
      const result = await client.from('profiles').select('id').eq('id', other.id)
      const expectedRows = role === 'admin' ? 1 : 0
      if (result.error || (result.data?.length ?? 0) !== expectedRows) throw new Error('cross read policy mismatch')
      return { status: result.status, rowCount: expectedRows, result: { boundary: role === 'admin' ? 'authorized' : 'denied' } }
    }))
    steps.get(account.key).crossReadPolicy = 'passed'

    await runStage(`cross-write:${role}`, () => runEvidenceCheck({
      role, identityKind: 'enabled-account', evidenceStage: 'cross-identity-write-denied',
      surface: restSurface(['profiles']),
    }, async () => {
      const result = await client.from('profiles').update({ display_name: `G1 ACCEPTANCE ${roleFor(other.key)}` })
        .eq('id', other.id).select('id')
      if (!result.error && (result.data?.length ?? 0) !== 0) throw new Error('cross write visible')
      if (result.error) expectDenied(result, 'cross identity write')
      return {
        status: Number.isInteger(result.status) ? result.status : 'POLICY_DENIED',
        rowCount: 0,
        result: { denied: true, denialMode: result.error ? 'policy-error' : 'zero-row' },
      }
    }))
    steps.get(account.key).crossWrite = 'denied'

    await runStage(`management-api:${role}`, () => runEvidenceCheck({
      role, identityKind: 'enabled-account', evidenceStage: 'management-api-matches-role-policy',
      surface: restSurface(['warehouses']),
    }, async () => {
      const result = await client.from('warehouses')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', session.companyId)
      const expectedBoundary = role === 'admin' || role === 'implementation' ? 'authorized' : 'denied'
      if (result.error || !Number.isSafeInteger(result.count) ||
          (expectedBoundary === 'denied' && result.count !== 0) ||
          (expectedBoundary === 'authorized' && result.count < 1)) {
        throw new Error('management API policy mismatch')
      }
      return { status: result.status, rowCount: result.count, result: { boundary: expectedBoundary, table: 'warehouses' } }
    }))
    steps.get(account.key).managementApi = 'passed'

    await runStage(`role-business-boundary:${role}`, () => runEvidenceCheck({
      role, identityKind: 'enabled-account', evidenceStage: 'role-business-api-matches-role-policy',
      surface: restSurface([ROLE_BUSINESS_BOUNDARY[role].table]),
    }, async () => {
      const rule = ROLE_BUSINESS_BOUNDARY[role]
      const result = await client.from(rule.table)
        .select('id', { count: 'exact', head: true })
        .eq('company_id', session.companyId)
      if (result.error || !Number.isSafeInteger(result.count) ||
          (rule.boundary === 'denied' && result.count !== 0) ||
          (rule.boundary === 'authorized' && result.count < 1)) {
        throw new Error('role business API policy mismatch')
      }
      return { status: result.status, rowCount: result.count, result: { boundary: rule.boundary, table: rule.table } }
    }))
    steps.get(account.key).roleBusinessBoundary = 'passed'

    await runStage(`bootstrap-public:${role}`, () => runEvidenceCheck({
      role, identityKind: 'enabled-account', evidenceStage: 'bootstrap-public-entry-denied',
      surface: 'rpc:public.bootstrap_team_os_4_deployment',
    }, async () => {
      const result = await client.rpc('bootstrap_team_os_4_deployment', bootstrapArguments)
      expectDenied(result, 'role public bootstrap')
      return deniedObservation(result, 'public-bootstrap')
    }))
    steps.get(account.key).publicBootstrap = 'denied'

    await runStage(`bootstrap-private:${role}`, () => runEvidenceCheck({
      role, identityKind: 'enabled-account', evidenceStage: 'bootstrap-private-entry-denied',
      surface: 'rpc:private.bootstrap_team_os_4',
    }, async () => {
      const result = await client.schema('private').rpc('bootstrap_team_os_4', bootstrapArguments)
      expectDenied(result, 'role private bootstrap', { privateSchemaBoundary: true })
      return deniedObservation(result, 'private-bootstrap')
    }))
    steps.get(account.key).privateBootstrap = 'denied'
  }

  browser = await runStage('browser-launch', launchAcceptanceBrowser)
    for (const account of accounts) {
      const role = roleFor(account.key)
      let pageContext
      let page
      await runStage(`page-login:${role}`, async () => {
        pageContext = await browser.newContext()
        page = await pageContext.newPage()
        await page.goto(`${previewUrl}/#/`, { waitUntil: 'domcontentloaded' })
        await page.getByTestId('login-gate').waitFor({ state: 'visible' })
        await page.getByTestId('login-email').fill(account.email)
        await page.getByTestId('login-password').fill(account.password)
        await page.getByTestId('login-submit').click()
        const outcome = await Promise.race([
          page.getByTestId('authenticated-app').waitFor({ state: 'visible' }).then(() => 'authenticated'),
          page.getByTestId('login-error').waitFor({ state: 'visible' }).then(() => 'login-error'),
        ])
        if (outcome !== 'authenticated') throw new Error('login rejected')
        steps.get(account.key).pageLogin = 'passed'
      })
      await runStage(`auto-route:${role}`, async () => {
        const startedAt = new Date().toISOString()
        await page.getByTestId(`workspace-${role}`).waitFor()
        if (new URL(page.url()).hash !== `#/workspace/${role}`) throw new Error('role hash mismatch')
        const state = await workspaceState(page)
        await page.getByTestId(`role-business-${role}`).waitFor({ state: 'visible' })
        appendPageEvidence({
          role,
          stage: 'workspace-auto-route-and-visible-content',
          startedAt,
          surface: pageSurface(`/workspace/${role}`),
          result: { path: `/workspace/${role}`, state },
          testId: state === 'explicit-empty' ? 'work-items-workbench-empty' : 'work-items-workbench-list',
        })
        const navigationStartedAt = new Date().toISOString()
        const actualPaths = await sidebarPaths(page)
        const expectedPaths = [`/workspace/${role}`, '/progress', '/calendar', ...ROLE_NAVIGATION_PATHS[role]]
        if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) throw new Error('sidebar role boundary mismatch')
        appendPageEvidence({
          role,
          stage: 'navigation-manifest-exact-role-boundary',
          startedAt: navigationStartedAt,
          surface: pageSurface(`/workspace/${role}`),
          result: { paths: actualPaths },
          testId: 'desktop-nav',
        })
        const business = ROLE_PAGE[role]
        const businessStartedAt = new Date().toISOString()
        const remote = captureRemoteRest(page, supabaseUrl)
        await page.goto(`${previewUrl}/#${business.path}`, { waitUntil: 'domcontentloaded' })
        const surfaces = Array.isArray(business.surface) ? business.surface : [business.surface]
        const outcome = await Promise.race([
          ...surfaces.map((testId) => page.getByTestId(testId).waitFor({ state: 'visible' }).then(() => ({ kind: 'surface', testId }))),
          page.getByTestId(business.error).waitFor({ state: 'visible' }).then(() => ({ kind: 'error', testId: business.error })),
        ])
        if (outcome.kind !== 'surface') throw new Error('role business page returned an error state')
        const businessState = await visibleState(page, outcome.testId, business.realDataTestId)
        if (businessState !== 'real-data') throw new Error('role business page did not render its required real fixture')
        const remoteCalls = remote.finish()
        const actualRestSurfaces = sorted(remoteCalls.map((call) => call.split(':').at(0)))
        if (JSON.stringify(actualRestSurfaces) !== JSON.stringify(sorted(business.expectedRestSurfaces))) {
          throw new Error('role business page remote REST surface set drifted')
        }
        appendPageEvidence({
          role,
          stage: 'role-business-page-real-remote-request',
          startedAt: businessStartedAt,
          surface: pageSurface(business.path),
          status: Number(remoteCalls.at(0).split(':').at(-1)),
          result: { state: businessState, remoteCalls },
          testId: outcome.testId,
        })
        steps.get(account.key).autoRoute = 'passed'
      })
      const wrongRole = role === 'sales' ? 'finance' : 'sales'
      await runStage(`cross-url:${role}`, async () => {
        const startedAt = new Date().toISOString()
        await page.goto(`${previewUrl}/#/workspace/${wrongRole}`, { waitUntil: 'domcontentloaded' })
        await page.getByTestId('access-denied').waitFor()
        appendPageEvidence({
          role,
          stage: 'manual-cross-role-url-denied',
          startedAt,
          surface: pageSurface(`/workspace/${wrongRole}`),
          status: 'RLS_UI_DENIED',
          result: { requestedRole: wrongRole, boundary: 'denied' },
          testId: 'access-denied',
        })
        steps.get(account.key).crossUrl = 'denied'
      })
      await runStage(`management-page:${role}`, async () => {
        const startedAt = new Date().toISOString()
        const management = MANAGEMENT_PAGE[role]
        await page.goto(`${previewUrl}/#${management.path}`, { waitUntil: 'domcontentloaded' })
        await page.getByTestId(management.surface).waitFor({ state: 'visible' })
        const state = management.boundary === 'denied'
          ? 'access-denied'
          : await visibleState(page, management.surface, management.realDataTestId)
        if (management.boundary === 'authorized' && state !== 'real-data') {
          throw new Error('authorized management page did not render its required real fixture')
        }
        appendPageEvidence({
          role,
          stage: 'management-page-matches-role-policy',
          startedAt,
          surface: pageSurface(management.path),
          status: management.boundary === 'denied' ? 'RLS_UI_DENIED' : 'UI_VISIBLE',
          result: { boundary: management.boundary, state },
          testId: management.surface,
        })
        steps.get(account.key).managementPage = 'passed'
      })
      await Promise.resolve().then(() => pageContext?.close()).catch(() => undefined)
    }
  } finally {
    await Promise.allSettled([
      Promise.resolve().then(() => browser?.close()),
      ...sessions.map(({ client }) => Promise.resolve().then(() => client.auth.signOut({ scope: 'local' }))),
    ])
  }

  return {
    global: { anonymousBootstrap: 'denied', browserLaunch: 'passed' },
    accounts: accounts.map((account) => ({ identityKey: account.key, steps: steps.get(account.key) })),
    evidenceRecords,
    runId,
    applicationCommit,
  }
}
