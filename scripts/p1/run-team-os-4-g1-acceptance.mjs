import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const roleFor = (key) => key === 'admin_supervisor' ? 'admin' : key
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
  if (supabaseUrl !== `https://${projectRef}.supabase.co`) throw new Error('runner target ref and URL mismatch')
  const publishableKey = required('TEAM_OS_4_SUPABASE_PUBLISHABLE_KEY')
  const previewUrl = required('TEAM_OS_4_PREVIEW_URL').replace(/\/$/u, '')
  const anon = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })

  await stage('anon-rpc', async () => {
    expectDenied(await anon.rpc('bootstrap_team_os_4_deployment', {}), 'anon public bootstrap')
    expectDenied(await anon.rpc('bootstrap_team_os_4', {}), 'anon private bootstrap')
  })

  const sessions = []
  for (const account of accounts) {
    const client = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const signedIn = await stage(`sign-in:${roleFor(account.key)}`, async () => {
      const result = await client.auth.signInWithPassword({ email: account.email, password: account.password })
      if (result.error || !result.data.session) throw new Error('sign-in denied')
      return result
    })
    sessions.push({ account, client })
  }

  for (let index = 0; index < sessions.length; index += 1) {
    const { account, client } = sessions[index]
    const other = sessions[(index + 1) % sessions.length].account
    const role = roleFor(account.key)
    await stage(`cross-read:${role}`, async () => {
      const result = await client.from('profiles').select('id').eq('id', other.id)
      const expectedRows = role === 'admin' ? 1 : 0
      if (result.error || (result.data?.length ?? 0) !== expectedRows) throw new Error('cross read policy mismatch')
    })
    await stage(`cross-write:${role}`, async () => {
      const result = await client.from('profiles').update({ display_name: 'forbidden-cross-write' }).eq('id', other.id).select('id')
      if (result.error || (result.data?.length ?? 0) !== 0) throw new Error('cross write visible')
    })
    await stage(`role-rpc:${role}`, async () => {
      expectDenied(await client.rpc('bootstrap_team_os_4_deployment', {}), 'role public bootstrap')
      expectDenied(await client.rpc('bootstrap_team_os_4', {}), 'role private bootstrap')
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
        await page.getByTestId('login-email').fill(account.email)
        await page.getByTestId('login-password').fill(account.password)
        await page.getByTestId('login-submit').click()
      })
      await stage(`auto-route:${role}`, async () => {
        await page.waitForURL((url) => url.hash === `#/workspace/${role}`)
        await page.getByTestId(`workspace-${role}`).waitFor()
      })
      const wrongRole = role === 'sales' ? 'finance' : 'sales'
      await stage(`cross-url:${role}`, async () => {
        await page.goto(`${previewUrl}/#/workspace/${wrongRole}`, { waitUntil: 'domcontentloaded' })
        await page.getByTestId('access-denied').waitFor()
      })
      await context.close()
    }
  } finally {
    await browser.close()
    for (const { client } of sessions) await client.auth.signOut({ scope: 'local' })
  }

  return { identities: 6, realLogins: 5, pageRoutes: 5, crossUrlDenied: 5, directApiDenied: 22 }
}
