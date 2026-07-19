import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const host = '127.0.0.1'
const port = 4178
const baseUrl = `http://${host}:${port}/canwin-team-os/`
const fakeProjectRef = 'p1pageacceptance0001'
const fakeSupabaseHost = `${fakeProjectRef}.supabase.co`
const chromeCandidates = [
  process.env.P1_PRECHECK_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)
const chromePath = chromeCandidates.find((candidate) => existsSync(candidate))

if (!chromePath) {
  throw new Error('P1_PAGE_PRECHECK_BLOCKED: local Chrome or Edge executable was not found')
}

const roles = {
  sales: { label: '销售', roleTargetLabel: '销售客户', roleTarget: '/sales-v3?tab=leads' },
  implementation: { label: '实施', roleTargetLabel: '实施任务', roleTarget: '/orders-v3?view=implementation' },
  operations: { label: '运维', roleTargetLabel: '运维服务', roleTarget: '/orders-v3?view=operations' },
  finance: { label: '财务', roleTargetLabel: '财务收款', roleTarget: '/finance?view=receipts' },
  admin: { label: '管理员', roleTargetLabel: '管理员审批', roleTarget: '/management-v3?view=approvals' },
}

const fixedDesktopLabels = ['我的工作台', '推进中心', '日历', '当前岗位业务']
const fixedMobileLabels = ['工作台', '推进', '日历', '岗位业务', '我的']
const managementLabels = ['组织、岗位与权限', '商品、价格、仓库与服务', '客户、品牌与门店', '财务、成本与结算']
const viewportWidths = [360, 390, 430]

const counters = {
  assertions: 0,
  desktopRoles: 0,
  mobileRoleWidths: 0,
  overlays: 0,
  legacyRoutes: 0,
  failureModes: 0,
}

function check(condition, message) {
  counters.assertions += 1
  assert.ok(condition, message)
}

function equal(actual, expected, message) {
  counters.assertions += 1
  assert.deepEqual(actual, expected, message)
}

function scenarioFor(role, options = {}) {
  const definition = roles[role]
  const additionalFunctions = options.additionalFunctions ?? []
  const supervisorEnabled = options.supervisorEnabled ?? false
  const userId = `d5000000-0000-4000-8000-00000000000${Object.keys(roles).indexOf(role) + 1}`
  const availableRoles = role === 'admin' ? Object.keys(roles) : [role]
  const context = {
    company: { id: 'P1_TEST', name: 'P1页面预检公司', logoAssetRef: null },
    user: { id: userId, name: `P1 ${definition.label}`, status: 'active' },
    primaryRole: role,
    additionalFunctions,
    skills: [],
    regionScopeIds: [],
    warehouseScopeIds: additionalFunctions.includes('warehouse') ? ['P1_TEST'] : [],
    supervisorScope: additionalFunctions.includes('supervisor')
      ? { regionIds: [], userIds: [], businessScopes: [] }
      : null,
    supervisorEnabled,
    permissions: [],
    availableWorkViews: availableRoles.map((id) => ({ id, label: roles[id].label })),
    currentWorkView: role,
    navigationRevision: 'p1-nav-1:P1_TEST',
  }

  const navigation = [
    navigationItem('messages', '消息', 5, 'topbar', '/notifications-v3'),
    navigationItem('my-workbench', '我的工作台', 10, 'common', '/dashboard'),
    navigationItem('progress', '推进中心', 20, 'common', '/work'),
    navigationItem('calendar', '日历', 30, 'common', '/calendar'),
    navigationItem('role-business', definition.roleTargetLabel, 40, 'current_role', definition.roleTarget),
    navigationItem('mobile-profile', '我的', 50, 'mobile_only', '/profile'),
  ]

  if (role === 'admin') {
    navigation.push(
      navigationItem('admin-people', managementLabels[0], 101, 'role_business', '/settings-v3/access'),
      navigationItem('admin-goods', managementLabels[1], 102, 'role_business', '/asset-center'),
      navigationItem('admin-customers', managementLabels[2], 103, 'role_business', '/sales-v3?tab=customers'),
      navigationItem('admin-finance', managementLabels[3], 104, 'role_business', '/finance'),
    )
  } else {
    navigation.push(navigationItem(`${role}-daily`, `${definition.label}岗位入口`, 101, 'role_business', definition.roleTarget))
  }

  if (additionalFunctions.includes('warehouse')) {
    navigation.push(navigationItem('warehouse-processing', '仓库处理', 200, 'warehouse', '/asset-center?view=inventory'))
  }
  if (additionalFunctions.includes('supervisor') && supervisorEnabled) {
    navigation.push(navigationItem('team-approval', '团队审批', 210, 'supervisor', '/management-v3?view=approvals'))
  }

  return { role, definition, context, navigation }
}

function navigationItem(routeId, label, order, group, canonicalPath) {
  return { routeId, label, order, group, canonicalPath, visible: true, enabled: true, readOnly: false }
}

function persistedUser(scenario) {
  return {
    id: scenario.context.user.id,
    name: scenario.context.user.name,
    role: scenario.role,
    position: '',
    joinDate: '2026-07-19T00:00:00.000Z',
    badges: [],
  }
}

async function startVite() {
  const viteEntry = resolve(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [viteEntry, '--host', host, '--port', String(port), '--strictPort'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CANWIN_BUILD_TARGET: 'test-preview',
      VITE_SUPABASE_URL: `https://${fakeSupabaseHost}`,
      VITE_SUPABASE_ANON_KEY: 'p1-page-precheck-public-placeholder',
      VITE_EXPECTED_SUPABASE_PROJECT_REF: fakeProjectRef,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })

  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`P1_PAGE_PRECHECK_SERVER_EXITED\n${output}`)
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return child
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  child.kill()
  throw new Error(`P1_PAGE_PRECHECK_SERVER_TIMEOUT\n${output}`)
}

async function createPage(browser, scenario, viewport, failureMode = 'none') {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
  await context.addInitScript(({ user }) => {
    sessionStorage.setItem('canwin-users', JSON.stringify({
      state: { users: [], currentUser: user },
      version: 3,
    }))
  }, { user: persistedUser(scenario) })

  const page = await context.newPage()
  const unexpected = []
  page.on('pageerror', (error) => unexpected.push(`pageerror:${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') unexpected.push(`console:${message.text()}`)
  })
  page.on('requestfailed', (request) => {
    if (failureMode !== 'navigation-network' || !request.url().includes('get_navigation_manifest_v1')) {
      unexpected.push(`requestfailed:${request.method()} ${request.url()}`)
    }
  })
  page.on('response', (response) => {
    if ([401, 403].includes(response.status()) || response.status() >= 500) {
      const expectedAppContextFailure = failureMode === 'app-context-500'
        && response.url().includes('get_app_context_v1')
      if (!expectedAppContextFailure) unexpected.push(`response:${response.status()} ${response.url()}`)
    }
  })

  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url())
    if (requestUrl.hostname === host) return route.continue()
    if (requestUrl.hostname === 'fonts.googleapis.com') {
      return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' })
    }
    if (requestUrl.hostname !== fakeSupabaseHost) return route.abort('blockedbyclient')

    if (requestUrl.pathname.endsWith('/rpc/get_app_context_v1')) {
      if (failureMode === 'app-context-500') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'PRECHECK injected AppContext failure' }) })
      }
      return fulfillJson(route, scenario.context)
    }
    if (requestUrl.pathname.endsWith('/rpc/get_navigation_manifest_v1')) {
      if (failureMode === 'navigation-network') return route.abort('connectionfailed')
      return fulfillJson(route, scenario.navigation)
    }
    if (requestUrl.pathname.endsWith('/rpc/is_feature_enabled')) return fulfillJson(route, false)
    if (requestUrl.pathname.startsWith('/rest/v1/')) return fulfillJson(route, [])
    if (requestUrl.pathname.startsWith('/auth/v1/')) return fulfillJson(route, {})
    return route.abort('blockedbyclient')
  })

  return { context, page, unexpected }
}

function fulfillJson(route, value) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    headers: { 'content-range': '0-0/0' },
    body: JSON.stringify(value),
  })
}

async function openDashboard(page) {
  await page.goto(`${baseUrl}#/`, { waitUntil: 'domcontentloaded' })
  await page.locator('main.app-main h1').waitFor({ state: 'visible' })
  await page.waitForFunction(() => window.location.hash.startsWith('#/dashboard'))
  const mainText = await page.locator('main.app-main').innerText()
  check(mainText.trim().length > 80, 'dashboard rendered a silent or empty main region')
  equal(new URL(page.url()).hash, '#/dashboard', 'default route did not resolve to the shared workbench')
}

async function assertNoUnexpected(unexpected, label) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  equal(unexpected, [], `${label} emitted browser or network errors`)
}

async function verifyDesktopRole(browser, role) {
  const scenario = scenarioFor(role)
  const { context, page, unexpected } = await createPage(browser, scenario, { width: 1280, height: 900 })
  try {
    await openDashboard(page)
    const sidebar = page.locator('aside').first()
    for (const label of fixedDesktopLabels) {
      equal(await sidebar.getByText(label, { exact: true }).count(), 1, `${role} desktop navigation missing ${label}`)
    }
    equal(await page.getByText(`${scenario.definition.label}工作视图`, { exact: true }).count(), 1, `${role} default work view is wrong`)
    equal(await sidebar.getByText('仓库处理', { exact: true }).count(), 0, `${role} unexpectedly sees warehouse without overlay`)
    equal(await sidebar.getByText('团队审批', { exact: true }).count(), 0, `${role} unexpectedly sees supervisor without overlay`)

    const businessToggle = sidebar.getByRole('button', { name: '业务入口' })
    await businessToggle.click()
    if (role === 'admin') {
      for (const label of managementLabels) {
        equal(await sidebar.getByText(label, { exact: true }).count(), 1, `admin management entry missing ${label}`)
      }
    } else {
      for (const label of managementLabels) {
        equal(await sidebar.getByText(label, { exact: true }).count(), 0, `${role} sees management entry ${label}`)
      }
    }
    await assertNoUnexpected(unexpected, `desktop:${role}`)
    counters.desktopRoles += 1
  } finally {
    await context.close()
  }
}

async function verifyMobileRole(browser, role, width) {
  const scenario = scenarioFor(role)
  const { context, page, unexpected } = await createPage(browser, scenario, { width, height: 844 })
  try {
    await openDashboard(page)
    const mobileNav = page.getByRole('navigation', { name: '移动端岗位导航' })
    await mobileNav.waitFor({ state: 'visible' })
    const links = mobileNav.locator('a')
    equal(await links.count(), 5, `${role} ${width}px mobile navigation does not contain exactly five items`)
    equal((await links.allInnerTexts()).map((label) => label.trim()), fixedMobileLabels, `${role} ${width}px mobile labels/order drifted`)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(overflow <= 1, `${role} ${width}px has ${overflow}px horizontal overflow`)
    await assertNoUnexpected(unexpected, `mobile:${role}:${width}`)
    counters.mobileRoleWidths += 1
  } finally {
    await context.close()
  }
}

async function verifyOverlays(browser) {
  const cases = [
    {
      label: 'warehouse-on',
      scenario: scenarioFor('implementation', { additionalFunctions: ['warehouse'] }),
      visible: ['仓库处理'],
      hidden: ['团队审批'],
    },
    {
      label: 'supervisor-off',
      scenario: scenarioFor('sales', { additionalFunctions: ['supervisor'], supervisorEnabled: false }),
      visible: ['主管体系未开启，责任回到管理员'],
      hidden: ['团队审批', '仓库处理'],
    },
    {
      label: 'supervisor-on',
      scenario: scenarioFor('sales', { additionalFunctions: ['supervisor'], supervisorEnabled: true }),
      visible: ['团队审批'],
      hidden: ['仓库处理'],
    },
  ]

  for (const testCase of cases) {
    const { context, page, unexpected } = await createPage(browser, testCase.scenario, { width: 1280, height: 900 })
    try {
      await openDashboard(page)
      for (const label of testCase.visible) {
        check(await page.getByText(label, { exact: true }).first().isVisible(), `${testCase.label} missing ${label}`)
      }
      for (const label of testCase.hidden) {
        equal(await page.getByText(label, { exact: true }).count(), 0, `${testCase.label} unexpectedly shows ${label}`)
      }
      await assertNoUnexpected(unexpected, `overlay:${testCase.label}`)
      counters.overlays += 1
    } finally {
      await context.close()
    }
  }
}

async function verifyLegacyRoutes(browser) {
  const scenario = scenarioFor('sales')
  const { context, page, unexpected } = await createPage(browser, scenario, { width: 1280, height: 900 })
  const closed = ['/votes', '/votes/example', '/timeline', '/photos', '/toolbox', '/warroom', '/culture-center']
  const redirects = [
    ['/tasks', '#/work'],
    ['/goals', '#/profile?view=goals'],
    ['/inventory', '#/asset-center?view=inventory'],
    ['/sales', '#/profile?view=earnings'],
    ['/achievements', '#/management-v3?view=case-candidates'],
    ['/assets', '#/asset-center?view=assets'],
    ['/skills', '#/settings-v3/access?view=skills'],
    ['/members', '#/settings-v3/access?view=members'],
    ['/settings', '#/settings-v3'],
    ['/access-v3', '#/settings-v3/access'],
  ]
  try {
    for (const path of closed) {
      await page.goto(`${baseUrl}#${path}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('heading', { name: '这个3.0入口已暂停' }).waitFor({ state: 'visible' })
      check((await page.locator('main.app-main').innerText()).includes('原有数据和附件仍完整保留'), `${path} does not state data preservation`)
      counters.legacyRoutes += 1
    }
    for (const [path, expectedHash] of redirects) {
      await page.goto(`${baseUrl}#${path}`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction((hash) => window.location.hash === hash, expectedHash)
      equal(new URL(page.url()).hash, expectedHash, `${path} redirect target drifted`)
      counters.legacyRoutes += 1
    }
    await assertNoUnexpected(unexpected, 'legacy-routes')
  } finally {
    await context.close()
  }
}

async function verifyFailureModes(browser) {
  const scenario = scenarioFor('sales')
  for (const failureMode of ['app-context-500', 'navigation-network']) {
    const { context, page } = await createPage(browser, scenario, { width: 1280, height: 900 }, failureMode)
    try {
      await page.goto(`${baseUrl}#/dashboard`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('heading', { name: '4.0 工作台已安全停止' }).waitFor({ state: 'visible' })
      equal(await page.locator('main.app-main').count(), 0, `${failureMode} left business content mounted`)
      equal(await page.getByRole('navigation', { name: '4.0岗位导航' }).count(), 0, `${failureMode} left desktop navigation mounted`)
      check((await page.locator('body').innerText()).trim().length > 20, `${failureMode} failed silently with an empty page`)
      counters.failureModes += 1
    } finally {
      await context.close()
    }
  }
}

let vite
let browser
try {
  console.log('[p1:page-precheck] PRECHECK_ONLY starting with local mocked RPC responses; no external project will be contacted')
  vite = await startVite()
  browser = await chromium.launch({ headless: true, executablePath: chromePath })

  for (const role of Object.keys(roles)) await verifyDesktopRole(browser, role)
  for (const role of Object.keys(roles)) {
    for (const width of viewportWidths) await verifyMobileRole(browser, role, width)
  }
  await verifyOverlays(browser)
  await verifyLegacyRoutes(browser)
  await verifyFailureModes(browser)

  console.log(`[p1:page-precheck] PRECHECK_ONLY summary assertions=${counters.assertions} desktopRoles=${counters.desktopRoles}/5 mobileRoleWidths=${counters.mobileRoleWidths}/15 overlays=${counters.overlays}/3 legacyRoutes=${counters.legacyRoutes}/17 failureModes=${counters.failureModes}/2`)
  console.log('[p1:page-precheck] PRECHECK_ONLY passed; this is not remote runtime or phase acceptance evidence')
} finally {
  if (browser) await browser.close()
  if (vite && vite.exitCode === null) vite.kill()
}
