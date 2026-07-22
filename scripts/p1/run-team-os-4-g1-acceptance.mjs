import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const roleFor = (key) => key === 'admin_supervisor' ? 'admin' : key
const GREENFIELD_TEST_PROJECT_REF = 'jgcrhoabvaowxnqksvkq'
const ROLE_PAGE = Object.freeze({
  sales: { path: '/leads', surface: 'sales-pipeline-page', error: 'sales-pipeline-error' },
  implementation: { path: '/fulfillment', surface: 'implementation-service-page', error: 'fulfillment-error' },
  operations: { path: '/fulfillment', surface: 'operations-service-page', error: 'fulfillment-error' },
  finance: { path: '/finance', surface: ['finance-page', 'finance-empty'], error: 'finance-error' },
  admin: { path: '/cases', surface: 'cases-page', error: 'cases-error' },
})
const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
const expectDenied = (result, label) => {
  if (!result.error) throw new Error(`${label} unexpectedly succeeded`)
}
const stage = async (label, action) => {
  try {
    return await action()
  } catch {
    throw new Error(`G1_STAGE_FAIL ${label}`)
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

export async function runAcceptance(accounts) {
  if (!Array.isArray(accounts) || accounts.length !== 5) throw new Error('exactly five new role accounts are required')
  const expected = ['sales', 'implementation', 'operations', 'finance', 'admin_supervisor']
  if (JSON.stringify(accounts.map((item) => item.key)) !== JSON.stringify(expected)) throw new Error('acceptance identity order drift')

  const projectRef = required('TEAM_OS_4_TARGET_PROJECT_REF')
  const supabaseUrl = required('TEAM_OS_4_SUPABASE_URL')
  if (projectRef !== GREENFIELD_TEST_PROJECT_REF) throw new Error('runner is restricted to the Team OS 4.0 greenfield test project')
  if (supabaseUrl !== `https://${projectRef}.supabase.co`) throw new Error('runner target ref and URL mismatch')
  const publishableKey = required('TEAM_OS_4_SUPABASE_PUBLISHABLE_KEY')
  const previewUrl = required('TEAM_OS_4_PREVIEW_URL').replace(/\/$/u, '')
  const anon = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const evidence = []
  const steps = new Map(accounts.map((account) => [account.key, {}]))

  await stage('anon-rpc', async () => {
    expectDenied(await anon.rpc('bootstrap_team_os_4_deployment', {}), 'anon public bootstrap')
    expectDenied(await anon.rpc('bootstrap_team_os_4', {}), 'anon private bootstrap')
    evidence.push({ stage: 'anonymous-api-attack', identity: 'anon', denied: 2, pageSession: false })
  })

  const sessions = []
  for (const account of accounts) {
    const client = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
    await stage(`sign-in:${roleFor(account.key)}`, async () => {
      const result = await client.auth.signInWithPassword({ email: account.email, password: account.password })
      if (result.error || !result.data.session) throw new Error('sign-in denied')
      return result
    })
    sessions.push({ account, client })
    steps.get(account.key).signIn = 'passed'
    evidence.push({ stage: 'real-login', role: roleFor(account.key), authenticated: true })
  }

  for (let index = 0; index < sessions.length; index += 1) {
    const { account, client } = sessions[index]
    const other = sessions[(index + 1) % sessions.length].account
    const role = roleFor(account.key)
    await stage(`cross-read:${role}`, async () => {
      const result = await client.from('profiles').select('id').eq('id', other.id)
      const expectedRows = role === 'admin' ? 1 : 0
      if (result.error || (result.data?.length ?? 0) !== expectedRows) throw new Error('cross read policy mismatch')
      evidence.push({ stage: 'cross-profile-read', role, visibleRows: expectedRows, policyMatched: true })
      steps.get(account.key).crossReadPolicy = 'passed'
    })
    await stage(`cross-write:${role}`, async () => {
      const result = await client.from('profiles').update({ display_name: 'forbidden-cross-write' }).eq('id', other.id).select('id')
      if (!result.error && (result.data?.length ?? 0) !== 0) throw new Error('cross write visible')
      evidence.push({ stage: 'cross-profile-write', role, affectedRows: 0, denied: true, denialMode: result.error ? 'policy-error' : 'zero-row' })
      steps.get(account.key).crossWrite = 'denied'
    })
    await stage(`role-rpc:${role}`, async () => {
      expectDenied(await client.rpc('bootstrap_team_os_4_deployment', {}), 'role public bootstrap')
      expectDenied(await client.rpc('bootstrap_team_os_4', {}), 'role private bootstrap')
      evidence.push({ stage: 'sealed-bootstrap-api', role, denied: 2 })
      steps.get(account.key).roleRpc = 'denied'
    })
  }

  const browser = await stage('browser-launch', launchAcceptanceBrowser)
  try {
    for (const account of accounts) {
      const role = roleFor(account.key)
      const context = await browser.newContext()
      const page = await context.newPage()
      await stage(`page-login:${role}`, async () => {
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
      await stage(`auto-route:${role}`, async () => {
        await page.getByTestId(`workspace-${role}`).waitFor()
        if (new URL(page.url()).hash !== `#/workspace/${role}`) throw new Error('role hash mismatch')
        const business = ROLE_PAGE[role]
        await page.goto(`${previewUrl}/#${business.path}`, { waitUntil: 'domcontentloaded' })
        const surfaces = Array.isArray(business.surface) ? business.surface : [business.surface]
        const outcome = await Promise.race([
          ...surfaces.map((testId) => page.getByTestId(testId).waitFor({ state: 'visible' }).then(() => ({ kind: 'surface', testId }))),
          page.getByTestId(business.error).waitFor({ state: 'visible' }).then(() => ({ kind: 'error', testId: business.error })),
        ])
        if (outcome.kind !== 'surface') throw new Error('role business page returned an error state')
        const empty = await page.getByTestId(outcome.testId).locator('.ui-empty').count() > 0 || outcome.testId.endsWith('-empty')
        evidence.push({
          stage: 'workspace-and-business-page',
          role,
          workspace: `/workspace/${role}`,
          businessPage: business.path,
          businessState: empty ? 'explicit-empty' : 'real-data',
        })
        steps.get(account.key).autoRoute = 'passed'
      })
      const wrongRole = role === 'sales' ? 'finance' : 'sales'
      await stage(`cross-url:${role}`, async () => {
        await page.goto(`${previewUrl}/#/workspace/${wrongRole}`, { waitUntil: 'domcontentloaded' })
        await page.getByTestId('access-denied').waitFor()
        evidence.push({ stage: 'wrong-workspace-url', role, requestedRole: wrongRole, denied: true })
        steps.get(account.key).crossUrl = 'denied'
      })
      await context.close()
    }
  } finally {
    await browser.close()
    for (const { client } of sessions) await client.auth.signOut({ scope: 'local' })
  }

  return {
    global: { anonymousBootstrap: 'denied', browserLaunch: 'passed' },
    accounts: accounts.map((account) => ({ identityKey: account.key, steps: steps.get(account.key) })),
    target: 'team-os-4-greenfield-test',
    identities: { anonymousAttackOnly: 1, realRoleLogins: 5 },
    workspacesAccepted: 5,
    businessPagesAccepted: 5,
    crossUrlDenied: 5,
    directApiChecks: 22,
    directApiDenied: 21,
    directApiAllowedByPolicy: 1,
    evidence,
  }
}
