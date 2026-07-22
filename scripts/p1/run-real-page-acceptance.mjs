import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const TEST_REF = 'zdmuaqokndhhbarudhtw'
const PRODUCTION_REF = 'agygfhmkazcbqaqwmljb'
const TEST_ORIGIN = `https://${TEST_REF}.supabase.co`
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const localHost = '127.0.0.1'
const localPort = 4179
const appUrl = `http://${localHost}:${localPort}/canwin-team-os/`
const mobileWidths = [360, 390, 430]
const fixedDesktopLabels = ['我的工作台', '推进中心', '日历', '当前岗位业务']
const fixedMobileLabels = ['工作台', '推进', '日历', '岗位业务', '我的']
const managementLabels = ['组织、岗位与权限', '商品、价格、仓库与服务', '客户、品牌与门店', '财务、成本与结算']

const roleDefinitions = {
  admin: { label: '管理员', additionalFunctions: [], envPrefix: 'P1_REAL_ADMIN' },
  sales: { label: '销售', additionalFunctions: ['supervisor'], envPrefix: 'P1_REAL_SALES' },
  implementation: { label: '实施', additionalFunctions: ['warehouse'], envPrefix: 'P1_REAL_IMPLEMENTATION' },
  operations: { label: '运维', additionalFunctions: [], envPrefix: 'P1_REAL_OPERATIONS' },
  finance: { label: '财务', additionalFunctions: [], envPrefix: 'P1_REAL_FINANCE' },
}
const disabledAccountDefinition = { envPrefix: 'P1_REAL_DISABLED' }

function required(environment, key) {
  const value = environment[key]?.trim()
  if (!value) throw new Error(`CONFIG_MISSING:${key}`)
  return value
}

function assertTestProjectLock(environment) {
  required(environment, 'P1_REAL_SUPABASE_URL')
  required(environment, 'P1_REAL_EXPECTED_PROJECT_REF')
  for (const key of ['P1_REAL_SUPABASE_URL', 'VITE_SUPABASE_URL']) {
    const value = environment[key]?.trim()
    if (!value) continue
    if (value.includes(PRODUCTION_REF)) throw new Error(`PRODUCTION_REF_REJECTED:${key}`)
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      throw new Error(`INVALID_PROJECT_URL:${key}`)
    }
    if (parsed.origin !== TEST_ORIGIN || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error(`TEST_REF_REQUIRED:${key}`)
    }
  }
  for (const key of ['P1_REAL_EXPECTED_PROJECT_REF', 'VITE_EXPECTED_SUPABASE_PROJECT_REF']) {
    const value = environment[key]?.trim()
    if (value && value !== TEST_REF) throw new Error(`TEST_REF_REQUIRED:${key}`)
  }
}

function readConfig(environment) {
  assertTestProjectLock(environment)
  if (required(environment, 'P1_REAL_ALLOW_TEST_WRITES') !== 'SUPERVISOR_TOGGLE_ONLY') {
    throw new Error('TEST_WRITE_SCOPE_REJECTED')
  }

  const accounts = {}
  for (const [role, definition] of Object.entries(roleDefinitions)) {
    const login = required(environment, `${definition.envPrefix}_LOGIN`)
    const password = required(environment, `${definition.envPrefix}_PASSWORD`)
    if (login.toLowerCase() === 'admin') throw new Error('TEST_ADMIN_ALIAS_REJECTED')
    accounts[role] = { login, password }
  }
  accounts.disabled = {
    login: required(environment, `${disabledAccountDefinition.envPrefix}_LOGIN`),
    password: required(environment, `${disabledAccountDefinition.envPrefix}_PASSWORD`),
  }

  const chromeCandidates = [
    environment.P1_REAL_CHROME?.trim(),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean)
  const chromePath = chromeCandidates.find((candidate) => existsSync(candidate))
  if (!chromePath) throw new Error('LOCAL_BROWSER_REQUIRED')

  return {
    accounts,
    anonKey: required(environment, 'P1_REAL_TEST_ANON_KEY'),
    chromePath,
  }
}

async function runSelfTest() {
  const environment = {
    P1_REAL_SUPABASE_URL: `${TEST_ORIGIN}/`,
    P1_REAL_EXPECTED_PROJECT_REF: TEST_REF,
    P1_REAL_ALLOW_TEST_WRITES: 'SUPERVISOR_TOGGLE_ONLY',
    P1_REAL_TEST_ANON_KEY: 'self-test-public-key',
  }
  for (const definition of Object.values(roleDefinitions)) {
    environment[`${definition.envPrefix}_LOGIN`] = `${definition.envPrefix.toLowerCase()}@example.invalid`
    environment[`${definition.envPrefix}_PASSWORD`] = 'not-printed-self-test-password'
  }
  environment[`${disabledAccountDefinition.envPrefix}_LOGIN`] = 'p1-real-disabled@example.invalid'
  environment[`${disabledAccountDefinition.envPrefix}_PASSWORD`] = 'not-printed-self-test-password'

  const parsed = readConfig(environment)
  assert.equal(Object.keys(parsed.accounts).length, 6)
  assert.throws(() => readConfig({ ...environment, P1_REAL_FINANCE_PASSWORD: '' }), /CONFIG_MISSING:P1_REAL_FINANCE_PASSWORD/)
  assert.throws(() => readConfig({ ...environment, P1_REAL_DISABLED_PASSWORD: '' }), /CONFIG_MISSING:P1_REAL_DISABLED_PASSWORD/)
  assert.throws(() => readConfig({ ...environment, P1_REAL_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co/` }), /PRODUCTION_REF_REJECTED/)
  assert.throws(() => readConfig({ ...environment, P1_REAL_SUPABASE_URL: '' }), /CONFIG_MISSING:P1_REAL_SUPABASE_URL/)
  assert.throws(() => readConfig({ ...environment, P1_REAL_EXPECTED_PROJECT_REF: '' }), /CONFIG_MISSING:P1_REAL_EXPECTED_PROJECT_REF/)
  assert.throws(() => readConfig({ ...environment, P1_REAL_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co/' }), /TEST_REF_REQUIRED/)
  assert.throws(() => readConfig({ ...environment, P1_REAL_ALLOW_TEST_WRITES: 'YES' }), /TEST_WRITE_SCOPE_REJECTED/)
  assert.throws(() => readConfig({ ...environment, P1_REAL_ADMIN_LOGIN: 'admin' }), /TEST_ADMIN_ALIAS_REJECTED/)

  const restoreState = { required: false, originalEnabled: false }
  await assert.rejects(
    () => writeSupervisorWithRestoreGuard(restoreState, async () => { throw new Error('AMBIGUOUS_CLIENT_FAILURE') }),
    /AMBIGUOUS_CLIENT_FAILURE/,
  )
  assert.equal(restoreState.required, true, 'ambiguous supervisor write failure must require restoration')
  await restoreSupervisorWithGuard(restoreState, async (enabled) => {
    assert.equal(enabled, false)
  })
  assert.equal(restoreState.required, false, 'only explicit successful restoration may clear the guard')
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const guardedWrite = source.match(/async function writeSupervisorWithRestoreGuard[\s\S]*?\n}/)?.[0] ?? ''
  assert.ok(
    guardedWrite.indexOf('restoreState.required = true') >= 0
      && guardedWrite.indexOf('restoreState.required = true') < guardedWrite.indexOf('await write()'),
    'source guard must be armed before awaiting the supervisor write',
  )
  console.log('[p1:real-page] REAL_ACCEPTANCE_PENDING self-test passed; no network connection was attempted')
}

async function startVite(config) {
  const viteEntry = resolve(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const viteEnvironment = { ...process.env }
  for (const key of Object.keys(viteEnvironment)) {
    if (key.startsWith('P1_REAL_')) delete viteEnvironment[key]
  }
  const child = spawn(process.execPath, [viteEntry, '--host', localHost, '--port', String(localPort), '--strictPort'], {
    cwd: repoRoot,
    env: {
      ...viteEnvironment,
      CANWIN_BUILD_TARGET: 'test-preview',
      VITE_SUPABASE_URL: TEST_ORIGIN,
      VITE_SUPABASE_ANON_KEY: config.anonKey,
      VITE_EXPECTED_SUPABASE_PROJECT_REF: TEST_REF,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })

  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`LOCAL_PREVIEW_EXITED:${output.slice(-500)}`)
    try {
      const response = await fetch(appUrl)
      if (response.ok) return child
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  child.kill()
  throw new Error('LOCAL_PREVIEW_TIMEOUT')
}

function recordSafeNetwork(page, state) {
  page.on('pageerror', (error) => state.errors.push(`PAGE_ERROR:${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') state.errors.push(`CONSOLE_ERROR:${message.text()}`)
  })
  page.on('requestfailed', (request) => state.errors.push(`REQUEST_FAILED:${request.method()}:${new URL(request.url()).hostname}`))
  page.on('response', (response) => {
    const status = response.status()
    if ([401, 403].includes(status) || status >= 500) {
      state.errors.push(`HTTP_${status}:${new URL(response.url()).hostname}${new URL(response.url()).pathname}`)
    }
    if (response.url().includes('/rest/v1/rpc/get_app_context_v1') && response.ok()) {
      const capture = response.json().then((value) => { state.appContexts.push(value) })
        .catch(() => { state.errors.push('APP_CONTEXT_JSON_INVALID') })
      state.pending.push(capture)
    }
    if (response.url().includes('/rest/v1/rpc/get_navigation_manifest_v1') && response.ok()) {
      const capture = response.json().then((value) => { state.navigationManifests.push(value) })
        .catch(() => { state.errors.push('NAVIGATION_JSON_INVALID') })
      state.pending.push(capture)
    }
  })
}

async function lockBrowserTraffic(page, state) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === localHost || url.hostname === `${TEST_REF}.supabase.co`) return route.continue()
    if (url.hostname === 'fonts.googleapis.com') {
      return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' })
    }
    if (url.hostname === `${PRODUCTION_REF}.supabase.co` || url.hostname.endsWith('.supabase.co')) {
      state.errors.push(`SUPABASE_HOST_REJECTED:${url.hostname}`)
    } else {
      state.errors.push(`EXTERNAL_HOST_REJECTED:${url.hostname}`)
    }
    return route.abort('blockedbyclient')
  })
}

async function waitForCapture(state, key) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    await Promise.allSettled(state.pending)
    if (state[key].length > 0) return state[key].at(-1)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw new Error(`${key.toUpperCase()}_NOT_CAPTURED`)
}

async function loginAndVerify(browser, account, role, supervisorExpected) {
  const definition = roleDefinitions[role]
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const state = { errors: [], pending: [], appContexts: [], navigationManifests: [] }
  recordSafeNetwork(page, state)
  await lockBrowserTraffic(page, state)

  try {
    await page.goto(`${appUrl}#/`, { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Account').waitFor({ state: 'visible' })
    await page.getByLabel('Account').fill(account.login)
    await page.getByLabel('Password').fill(account.password)
    await page.locator('button[type="submit"]').click()
    await page.locator('main.app-main h1').waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForFunction(() => window.location.hash.startsWith('#/dashboard'))

    const appContext = await waitForCapture(state, 'appContexts')
    const manifest = await waitForCapture(state, 'navigationManifests')
    assert.equal(appContext.primaryRole, role, `${role} AppContext primary role mismatch`)
    assert.deepEqual([...appContext.additionalFunctions].sort(), [...definition.additionalFunctions].sort(), `${role} additional functions mismatch`)
    assert.equal(appContext.currentWorkView, role, `${role} default work view mismatch`)
    assert.ok(appContext.navigationRevision === `p1-nav-1:${appContext.company.id}`, `${role} navigation revision mismatch`)
    assert.ok(Array.isArray(manifest), `${role} navigation manifest is not an array`)

    const routeIds = new Set(manifest.map((item) => item.routeId))
    for (const routeId of ['my-workbench', 'progress', 'calendar', 'role-business', 'messages', 'mobile-profile']) {
      assert.ok(routeIds.has(routeId), `${role} missing navigation ${routeId}`)
    }
    assert.equal(routeIds.has('warehouse-processing'), role === 'implementation', `${role} warehouse navigation mismatch`)
    assert.equal(routeIds.has('team-approval'), role === 'sales' && supervisorExpected, `${role} supervisor navigation mismatch`)

    const sidebar = page.locator('aside').first()
    for (const label of fixedDesktopLabels) {
      assert.equal(await sidebar.getByText(label, { exact: true }).count(), 1, `${role} missing desktop label ${label}`)
    }
    assert.equal(await page.getByText(`${definition.label}工作视图`, { exact: true }).count(), 1, `${role} dashboard role label mismatch`)
    const mainText = await page.locator('main.app-main').innerText()
    assert.ok(mainText.trim().length > 80, `${role} rendered silent empty content`)

    const businessToggle = sidebar.getByRole('button', { name: '业务入口' })
    await businessToggle.click()
    for (const label of managementLabels) {
      const count = await sidebar.getByText(label, { exact: true }).count()
      assert.equal(count, role === 'admin' ? 1 : 0, `${role} management visibility mismatch for ${label}`)
    }

    for (const width of mobileWidths) {
      await page.setViewportSize({ width, height: 844 })
      const mobileNav = page.getByRole('navigation', { name: '移动端岗位导航' })
      await mobileNav.waitFor({ state: 'visible' })
      const links = mobileNav.locator('a')
      assert.equal(await links.count(), 5, `${role} ${width}px mobile item count mismatch`)
      assert.deepEqual((await links.allInnerTexts()).map((text) => text.trim()), fixedMobileLabels, `${role} ${width}px mobile order mismatch`)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      assert.ok(overflow <= 1, `${role} ${width}px horizontal overflow=${overflow}`)
    }

    await Promise.allSettled(state.pending)
    assert.deepEqual(state.errors, [], `${role} emitted browser/network errors: ${state.errors.join('|')}`)

    const accessToken = await page.evaluate(() => {
      const key = Object.keys(sessionStorage).find((candidate) => candidate.startsWith('canwin-') && candidate.endsWith('-auth-session'))
      if (!key) return null
      try {
        return JSON.parse(sessionStorage.getItem(key) ?? 'null')?.access_token ?? null
      } catch {
        return null
      }
    })
    return { appContext, accessToken }
  } finally {
    await context.close()
  }
}

async function verifyDisabledAccount(browser, account) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const state = { errors: [], pending: [], appContexts: [], navigationManifests: [] }
  recordSafeNetwork(page, state)
  await lockBrowserTraffic(page, state)

  try {
    await page.goto(`${appUrl}#/`, { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Account').waitFor({ state: 'visible' })
    await page.getByLabel('Account').fill(account.login)
    await page.getByLabel('Password').fill(account.password)
    await page.locator('button[type="submit"]').click()
    const disabledMessage = page.getByRole('alert').getByText('当前账号已停用，请联系管理员。', { exact: true })
    await disabledMessage.waitFor({ state: 'visible', timeout: 20_000 })

    assert.ok(await page.locator('.fanshon-login-shell').isVisible(), 'disabled account left the login shell')
    assert.equal(await page.locator('main.app-main').count(), 0, 'disabled account mounted the workbench')
    assert.equal(await page.getByRole('navigation', { name: '4.0岗位导航' }).count(), 0, 'disabled account mounted navigation')
    await Promise.allSettled(state.pending)
    assert.equal(state.appContexts.length, 0, 'disabled account reached AppContext')
    assert.equal(state.navigationManifests.length, 0, 'disabled account reached navigation manifest')
    assert.deepEqual(state.errors, [], `disabled account emitted browser/network errors: ${state.errors.join('|')}`)
  } finally {
    await context.close()
  }
}

async function writeSupervisorWithRestoreGuard(restoreState, write) {
  restoreState.required = true
  await write()
}

async function restoreSupervisorWithGuard(restoreState, write) {
  restoreState.required = true
  await write(restoreState.originalEnabled)
  restoreState.required = false
}

async function setSupervisorEnabled(config, adminAccessToken, enabled) {
  if (!adminAccessToken) throw new Error('ADMIN_ACCESS_TOKEN_MISSING')
  const response = await fetch(`${TEST_ORIGIN}/rest/v1/rpc/admin_set_supervisor_system_v1`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      authorization: `Bearer ${adminAccessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_enabled: enabled, p_idempotency_key: randomUUID() }),
  })
  if (!response.ok) throw new Error(`SUPERVISOR_TOGGLE_HTTP_${response.status}`)
}

async function executeRealAcceptance(config) {
  let vite
  let browser
  let adminAccessToken
  const restoreState = { required: false, originalEnabled: null }
  try {
    vite = await startVite(config)
    browser = await chromium.launch({ headless: true, executablePath: config.chromePath })

    await verifyDisabledAccount(browser, config.accounts.disabled)
    const admin = await loginAndVerify(browser, config.accounts.admin, 'admin', false)
    adminAccessToken = admin.accessToken
    restoreState.originalEnabled = admin.appContext.supervisorEnabled

    await writeSupervisorWithRestoreGuard(
      restoreState,
      () => setSupervisorEnabled(config, adminAccessToken, false),
    )
    await loginAndVerify(browser, config.accounts.sales, 'sales', false)
    await loginAndVerify(browser, config.accounts.implementation, 'implementation', false)
    await loginAndVerify(browser, config.accounts.operations, 'operations', false)
    await loginAndVerify(browser, config.accounts.finance, 'finance', false)

    await writeSupervisorWithRestoreGuard(
      restoreState,
      () => setSupervisorEnabled(config, adminAccessToken, true),
    )
    await loginAndVerify(browser, config.accounts.sales, 'sales', true)

    await restoreSupervisorWithGuard(
      restoreState,
      (enabled) => setSupervisorEnabled(config, adminAccessToken, enabled),
    )
    console.log('[p1:real-page] REAL_ACCEPTANCE_COMPLETE roles=5 disabled=passed mobileWidths=360,390,430 supervisorOff=passed supervisorOn=passed')
  } finally {
    if (restoreState.required && adminAccessToken && typeof restoreState.originalEnabled === 'boolean') {
      try {
        await restoreSupervisorWithGuard(
          restoreState,
          (enabled) => setSupervisorEnabled(config, adminAccessToken, enabled),
        )
      } catch {
        console.error('[p1:real-page] REAL_ACCEPTANCE_PENDING supervisor switch restoration requires manual verification')
      }
    }
    if (browser) await browser.close()
    if (vite && vite.exitCode === null) vite.kill()
  }
}

const selfTest = process.argv.includes('--self-test')
const execute = process.argv.includes('--execute')

try {
  if (selfTest) {
    await runSelfTest()
  } else if (!execute) {
    console.log('[p1:real-page] REAL_ACCEPTANCE_PENDING runner is offline; use --self-test or provide the isolated test credentials and --execute')
    process.exitCode = 2
  } else {
    const config = readConfig(process.env)
    await executeRealAcceptance(config)
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : 'UNKNOWN_FAILURE'
  console.error(`[p1:real-page] REAL_ACCEPTANCE_PENDING ${reason}`)
  process.exitCode = 1
}
