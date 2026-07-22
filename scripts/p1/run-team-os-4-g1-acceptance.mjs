import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

const roleFor = (key) => key === 'admin_supervisor' ? 'admin' : key
const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
const expectDenied = (result, label) => {
  if (!result.error) throw new Error(`${label} unexpectedly succeeded`)
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

  expectDenied(await anon.rpc('bootstrap_team_os_4_deployment', {}), 'anon public bootstrap')
  expectDenied(await anon.rpc('bootstrap_team_os_4', {}), 'anon private bootstrap')

  const sessions = []
  for (const account of accounts) {
    const client = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const signedIn = await client.auth.signInWithPassword({ email: account.email, password: account.password })
    if (signedIn.error || !signedIn.data.session) throw new Error(`real sign-in failed for ${account.key}`)
    sessions.push({ account, client })
  }

  for (let index = 0; index < sessions.length; index += 1) {
    const { account, client } = sessions[index]
    const other = sessions[(index + 1) % sessions.length].account
    const crossRead = await client.from('profiles').select('id').eq('id', other.id)
    if (crossRead.error || (crossRead.data?.length ?? 0) !== 0) throw new Error(`cross-identity REST read was not denied for ${account.key}`)
    const crossWrite = await client.from('profiles').update({ display_name: 'forbidden-cross-write' }).eq('id', other.id).select('id')
    if (crossWrite.error || (crossWrite.data?.length ?? 0) !== 0) throw new Error(`cross-identity REST write was not denied for ${account.key}`)
    expectDenied(await client.rpc('bootstrap_team_os_4_deployment', {}), `${account.key} public bootstrap`)
    expectDenied(await client.rpc('bootstrap_team_os_4', {}), `${account.key} private bootstrap`)
  }

  const browser = await chromium.launch({ headless: true })
  try {
    for (const account of accounts) {
      const role = roleFor(account.key)
      const context = await browser.newContext()
      const page = await context.newPage()
      await page.goto(`${previewUrl}/#/`, { waitUntil: 'domcontentloaded' })
      await page.getByTestId('login-email').fill(account.email)
      await page.getByTestId('login-password').fill(account.password)
      await page.getByTestId('login-submit').click()
      await page.waitForURL(new RegExp(`#/workspace/${role}$`))
      await page.getByTestId(`workspace-${role}`).waitFor()
      const wrongRole = role === 'sales' ? 'finance' : 'sales'
      await page.goto(`${previewUrl}/#/workspace/${wrongRole}`, { waitUntil: 'domcontentloaded' })
      await page.getByTestId('access-denied').waitFor()
      await context.close()
    }
  } finally {
    await browser.close()
    for (const { client } of sessions) await client.auth.signOut({ scope: 'local' })
  }

  return { identities: 6, realLogins: 5, pageRoutes: 5, crossUrlDenied: 5, directApiDenied: 22 }
}
