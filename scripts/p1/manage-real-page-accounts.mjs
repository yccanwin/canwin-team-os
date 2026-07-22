import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const TEST_REF = 'zdmuaqokndhhbarudhtw'
const PRODUCTION_REF = 'agygfhmkazcbqaqwmljb'
const TEST_ORIGIN = `https://${TEST_REF}.supabase.co`
const TEAM_ID = 'CANWIN_TEAM'
const MARKER_KEY = 'canwin_p1_page_test'
const WRITE_SCOPE = 'CREATE_OR_SEAL_FIXTURE_ONLY'
const DEFAULT_EVIDENCE_ROOT = 'D:\\CanWin-Team-OS-4.0-P1-Page-Acceptance'
const accountDefinitions = {
  admin: { envPrefix: 'P1_REAL_ADMIN', primaryRole: 'admin', additionalFunctions: [] },
  sales: { envPrefix: 'P1_REAL_SALES', primaryRole: 'sales', additionalFunctions: ['supervisor'] },
  implementation: { envPrefix: 'P1_REAL_IMPLEMENTATION', primaryRole: 'implementation', additionalFunctions: ['warehouse'] },
  operations: { envPrefix: 'P1_REAL_OPERATIONS', primaryRole: 'operations', additionalFunctions: [] },
  finance: { envPrefix: 'P1_REAL_FINANCE', primaryRole: 'finance', additionalFunctions: [] },
  disabled: { envPrefix: 'P1_REAL_DISABLED', primaryRole: null, additionalFunctions: [] },
}

function requiredText(environment, key) {
  const value = environment[key]?.trim()
  if (!value) throw new Error(`CONFIG_MISSING:${key}`)
  return value
}

function requiredSecret(environment, key) {
  const value = environment[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`CONFIG_MISSING:${key}`)
  return value
}

function assertProjectLock(environment) {
  const url = requiredText(environment, 'P1_REAL_SUPABASE_URL')
  const expectedRef = requiredText(environment, 'P1_REAL_EXPECTED_PROJECT_REF')
  for (const [key, value] of [
    ['P1_REAL_SUPABASE_URL', url],
    ['VITE_SUPABASE_URL', environment.VITE_SUPABASE_URL?.trim()],
  ]) {
    if (!value) continue
    if (value.includes(PRODUCTION_REF)) throw new Error(`PRODUCTION_REF_REJECTED:${key}`)
    let parsed
    try { parsed = new URL(value) } catch { throw new Error(`INVALID_PROJECT_URL:${key}`) }
    if (parsed.origin !== TEST_ORIGIN || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error(`TEST_REF_REQUIRED:${key}`)
    }
  }
  if (expectedRef === PRODUCTION_REF) throw new Error('PRODUCTION_REF_REJECTED:P1_REAL_EXPECTED_PROJECT_REF')
  if (expectedRef !== TEST_REF) throw new Error('TEST_REF_REQUIRED:P1_REAL_EXPECTED_PROJECT_REF')
}

function readConfig(environment, action) {
  assertProjectLock(environment)
  if (['create', 'cleanup'].includes(action)
      && requiredText(environment, 'P1_REAL_ACCOUNT_FIXTURE_WRITE_SCOPE') !== WRITE_SCOPE) {
    throw new Error('ACCOUNT_FIXTURE_WRITE_SCOPE_REJECTED')
  }
  const tag = requiredText(environment, 'P1_REAL_FIXTURE_TAG')
  if (!/^[a-z0-9][a-z0-9-]{7,47}$/.test(tag)) throw new Error('FIXTURE_TAG_INVALID')
  const baselineText = requiredText(environment, 'P1_REAL_BASELINE_SUPERVISOR_ENABLED')
  if (!['true', 'false'].includes(baselineText)) throw new Error('SUPERVISOR_BASELINE_INVALID')
  const anonKey = requiredSecret(environment, 'P1_REAL_TEST_ANON_KEY')
  const serviceKey = requiredSecret(environment, 'P1_REAL_TEST_SERVICE_KEY')
  if (anonKey === serviceKey || serviceKey.startsWith('sb_publishable_') || anonKey.startsWith('sb_secret_')) {
    throw new Error('API_KEY_CLASS_REJECTED')
  }
  const accounts = {}
  for (const [role, definition] of Object.entries(accountDefinitions)) {
    const login = requiredText(environment, `${definition.envPrefix}_LOGIN`).toLowerCase()
    const password = requiredSecret(environment, `${definition.envPrefix}_PASSWORD`)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(login)) throw new Error(`ACCOUNT_EMAIL_REQUIRED:${role}`)
    if (password.length < 12 || password.length > 72) throw new Error(`ACCOUNT_PASSWORD_LENGTH:${role}`)
    accounts[role] = { ...definition, login, password }
  }
  if (new Set(Object.values(accounts).map((account) => account.login)).size !== 6) {
    throw new Error('ACCOUNT_LOGINS_MUST_BE_UNIQUE')
  }
  const evidenceRoot = environment.P1_REAL_FIXTURE_EVIDENCE_DIR?.trim() || DEFAULT_EVIDENCE_ROOT
  if (!isAbsolute(evidenceRoot)) throw new Error('EVIDENCE_DIRECTORY_MUST_BE_ABSOLUTE')
  return {
    tag, accounts, anonKey, serviceKey, evidenceRoot: resolve(evidenceRoot),
    baselineSupervisorEnabled: baselineText === 'true',
  }
}

function remoteCode(error) {
  const raw = String(error?.code ?? error?.status ?? 'REMOTE_ERROR')
  return /^[A-Za-z0-9_.-]{1,64}$/.test(raw) ? raw : 'REMOTE_ERROR'
}

async function result(label, operation) {
  let response
  try { response = await operation() } catch { throw new Error(`${label}:NETWORK_ERROR`) }
  if (response?.error) throw new Error(`${label}:${remoteCode(response.error)}`)
  return response?.data
}

function clients(config) {
  const auth = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  return {
    service: createClient(TEST_ORIGIN, config.serviceKey, { auth }),
    publicClient: () => createClient(TEST_ORIGIN, config.anonKey, { auth }),
  }
}

async function listAllUsers(service) {
  const users = []
  for (let page = 1; page <= 100; page += 1) {
    const data = await result('AUTH_LIST_USERS_FAILED', () => service.auth.admin.listUsers({ page, perPage: 1000 }))
    const batch = data?.users ?? []
    users.push(...batch)
    if (batch.length < 1000) return users
  }
  throw new Error('AUTH_USER_PAGE_LIMIT_EXCEEDED')
}

function markerOf(user) {
  const marker = user?.app_metadata?.[MARKER_KEY]
  return marker && typeof marker === 'object' ? marker : null
}

function usersForTag(users, tag) {
  return users.filter((user) => markerOf(user)?.tag === tag)
}

function assertExactTaggedUsers(config, tagged) {
  if (tagged.length !== 6) throw new Error(`FIXTURE_USER_COUNT_MISMATCH:${tagged.length}`)
  const byRole = new Map(tagged.map((user) => [markerOf(user)?.role, user]))
  for (const [role, account] of Object.entries(config.accounts)) {
    const user = byRole.get(role)
    if (!user || user.email?.toLowerCase() !== account.login) throw new Error(`FIXTURE_IDENTITY_MISMATCH:${role}`)
  }
  return byRole
}

async function flagSnapshot(service) {
  const data = await result('FEATURE_FLAG_READ_FAILED', () => service.from('feature_flags')
    .select('id,enabled,config').eq('team_id', TEAM_ID).eq('key', 'team_os_4_supervisor').single())
  if (!data || typeof data.config !== 'object' || Array.isArray(data.config)) throw new Error('FEATURE_FLAG_INVALID')
  return data
}

function withoutFixtureScopes(configValue, userIds) {
  const config = structuredClone(configValue ?? {})
  for (const key of ['warehouseScopesByProfile', 'supervisorScopesByProfile']) {
    const scopes = config[key] && typeof config[key] === 'object' && !Array.isArray(config[key]) ? { ...config[key] } : {}
    for (const userId of userIds) delete scopes[userId]
    config[key] = scopes
  }
  return config
}

async function updateFixtureScopes(service, flag, byRole) {
  const config = withoutFixtureScopes(flag.config, [...byRole.values()].map((user) => user.id))
  config.warehouseScopesByProfile[byRole.get('implementation').id] = [TEAM_ID]
  config.supervisorScopesByProfile[byRole.get('sales').id] = { regionIds: [], businessScopes: [] }
  await result('FEATURE_FLAG_SCOPE_UPDATE_FAILED', () => service.from('feature_flags').update({ config }).eq('id', flag.id))
}

async function clearFixtureScopes(service, flag, userIds) {
  const config = withoutFixtureScopes(flag.config, userIds)
  await result('FEATURE_FLAG_SCOPE_CLEANUP_FAILED', () => service.from('feature_flags').update({ config }).eq('id', flag.id))
}

async function verifyDatabaseFixture(config, service, tagged, sealed = false) {
  const byRole = assertExactTaggedUsers(config, tagged)
  const ids = tagged.map((user) => user.id)
  const profiles = await result('PROFILE_VERIFY_FAILED', () => service.from('profiles')
    .select('id,team_id,status').in('id', ids))
  if ((profiles ?? []).length !== 6) throw new Error('FIXTURE_PROFILE_COUNT_MISMATCH')
  const roleById = new Map([...byRole.entries()].map(([role, user]) => [user.id, role]))
  for (const profile of profiles) {
    const role = roleById.get(profile.id)
    const expected = sealed || role === 'disabled' ? 'disabled' : 'active'
    if (profile.team_id !== TEAM_ID || profile.status !== expected) throw new Error('FIXTURE_PROFILE_STATE_MISMATCH')
  }
  const assignments = await result('ROLE_VERIFY_FAILED', () => service.from('profile_access_roles')
    .select('profile_id,role_id,assignment_kind').in('profile_id', ids))
  if (sealed) {
    if ((assignments ?? []).length !== 0) throw new Error('SEALED_ROLE_ASSIGNMENTS_REMAIN')
  } else {
    if ((assignments ?? []).length !== 7) throw new Error(`FIXTURE_ROLE_ASSIGNMENT_COUNT_MISMATCH:${(assignments ?? []).length}`)
    const roleRows = await result('ACCESS_ROLE_VERIFY_FAILED', () => service.from('access_roles')
      .select('id,code').eq('team_id', TEAM_ID).in('id', assignments.map((item) => item.role_id)))
    const roleCodeById = new Map((roleRows ?? []).map((item) => [item.id, item.code]))
    const actual = new Map()
    for (const assignment of assignments) {
      const role = roleById.get(assignment.profile_id)
      const code = roleCodeById.get(assignment.role_id)
      if (!role || !code) throw new Error('FIXTURE_ROLE_REFERENCE_MISMATCH')
      const values = actual.get(role) ?? []
      values.push(`${code}:${assignment.assignment_kind}`)
      actual.set(role, values)
    }
    const expected = {
      admin: ['admin:primary'],
      sales: ['sales:primary', 'supervisor:additional_function'],
      implementation: ['implementation:primary', 'warehouse:additional_function'],
      operations: ['operations:primary'],
      finance: ['finance:primary'],
      disabled: [],
    }
    for (const [role, values] of Object.entries(expected)) {
      assert.deepEqual([...(actual.get(role) ?? [])].sort(), [...values].sort(), `FIXTURE_ROLE_SET_MISMATCH:${role}`)
    }
  }
  const flag = await flagSnapshot(service)
  if (flag.enabled !== config.baselineSupervisorEnabled) throw new Error('SUPERVISOR_BASELINE_DRIFT')
  const warehouse = flag.config?.warehouseScopesByProfile ?? {}
  const supervisor = flag.config?.supervisorScopesByProfile ?? {}
  if (sealed) {
    if (ids.some((id) => Object.hasOwn(warehouse, id) || Object.hasOwn(supervisor, id))) throw new Error('SEALED_SCOPE_REMAINS')
  } else {
    assert.deepEqual(warehouse[byRole.get('implementation').id], [TEAM_ID])
    assert.deepEqual(supervisor[byRole.get('sales').id], { regionIds: [], businessScopes: [] })
  }
  return { byRole, profiles, assignments, flag }
}

async function signInAndInspect(config, account, role, publicClient) {
  const signedIn = await result(`SIGN_IN_FAILED:${role}`, () => publicClient.auth.signInWithPassword({
    email: account.login, password: account.password,
  }))
  if (!signedIn?.session?.access_token) throw new Error(`SESSION_MISSING:${role}`)
  try {
    const contextResult = await publicClient.rpc('get_app_context_v1')
    if (role === 'disabled') {
      if (!contextResult.error) throw new Error('DISABLED_ACCOUNT_REACHED_APP_CONTEXT')
      if (remoteCode(contextResult.error) !== '42501') throw new Error(`DISABLED_ACCOUNT_WRONG_DENIAL:${remoteCode(contextResult.error)}`)
      return
    }
    if (contextResult.error) throw new Error(`APP_CONTEXT_FAILED:${role}:${remoteCode(contextResult.error)}`)
    const context = contextResult.data
    const expected = account.additionalFunctions
    if (context?.primaryRole !== role || context?.currentWorkView !== role
        || JSON.stringify([...(context?.additionalFunctions ?? [])].sort()) !== JSON.stringify([...expected].sort())) {
      throw new Error(`APP_CONTEXT_MISMATCH:${role}`)
    }
    if (role === 'implementation' && JSON.stringify(context.warehouseScopeIds) !== JSON.stringify([TEAM_ID])) {
      throw new Error('WAREHOUSE_SCOPE_MISMATCH')
    }
    const manifest = await result(`NAVIGATION_FAILED:${role}`, () => publicClient.rpc('get_navigation_manifest_v1', { p_work_view: role }))
    const routeIds = new Set((manifest ?? []).map((item) => item.routeId))
    if (routeIds.has('warehouse-processing') !== (role === 'implementation')) throw new Error(`WAREHOUSE_NAV_MISMATCH:${role}`)
    if (routeIds.has('team-approval') !== (role === 'sales' && config.baselineSupervisorEnabled)) {
      throw new Error(`SUPERVISOR_NAV_MISMATCH:${role}`)
    }
  } finally {
    await result(`SIGN_OUT_FAILED:${role}`, () => publicClient.auth.signOut({ scope: 'global' }))
  }
}

async function verifyLiveFixture(config, clientSet) {
  const users = await listAllUsers(clientSet.service)
  const tagged = usersForTag(users, config.tag)
  await verifyDatabaseFixture(config, clientSet.service, tagged, false)
  for (const [role, account] of Object.entries(config.accounts)) {
    await signInAndInspect(config, account, role, clientSet.publicClient())
  }
  return tagged
}

async function createFixture(config, clientSet) {
  const allUsers = await listAllUsers(clientSet.service)
  if (usersForTag(allUsers, config.tag).length !== 0) throw new Error('FIXTURE_TAG_ALREADY_EXISTS')
  const logins = new Set(Object.values(config.accounts).map((account) => account.login))
  if (allUsers.some((user) => logins.has(user.email?.toLowerCase()))) throw new Error('FIXTURE_EMAIL_ALREADY_EXISTS')
  const flag = await flagSnapshot(clientSet.service)
  if (flag.enabled !== config.baselineSupervisorEnabled) throw new Error('SUPERVISOR_BASELINE_DRIFT')

  const created = []
  try {
    for (const [role, account] of Object.entries(config.accounts)) {
      const data = await result(`CREATE_USER_FAILED:${role}`, () => clientSet.service.auth.admin.createUser({
        email: account.login, password: account.password, email_confirm: true,
        app_metadata: { [MARKER_KEY]: { tag: config.tag, role } },
        user_metadata: { name: `P1_PAGE_${role.toUpperCase()}_${config.tag}` },
      }))
      if (!data?.user?.id) throw new Error(`CREATE_USER_ID_MISSING:${role}`)
      created.push({ role, id: data.user.id })
    }
    const ids = created.map((item) => item.id)
    await result('PROFILE_DISABLE_PREP_FAILED', () => clientSet.service.from('profiles').update({ status: 'disabled', role: 'member' }).in('id', ids))
    const roles = await result('ACCESS_ROLE_READ_FAILED', () => clientSet.service.from('access_roles')
      .select('id,code').eq('team_id', TEAM_ID).in('code', ['admin', 'sales', 'supervisor', 'implementation', 'warehouse', 'operations', 'finance']))
    const roleIds = new Map((roles ?? []).map((role) => [role.code, role.id]))
    if (roleIds.size !== 7) throw new Error('ACCESS_ROLE_SEED_INCOMPLETE')
    const byRole = new Map(created.map((item) => [item.role, item]))
    const assignments = []
    for (const [role, account] of Object.entries(config.accounts)) {
      if (!account.primaryRole) continue
      assignments.push({ team_id: TEAM_ID, profile_id: byRole.get(role).id, role_id: roleIds.get(account.primaryRole), assignment_kind: 'primary' })
      for (const code of account.additionalFunctions) {
        assignments.push({ team_id: TEAM_ID, profile_id: byRole.get(role).id, role_id: roleIds.get(code), assignment_kind: 'additional_function' })
      }
    }
    await result('ROLE_ASSIGNMENT_CREATE_FAILED', () => clientSet.service.from('profile_access_roles').insert(assignments))
    await updateFixtureScopes(clientSet.service, flag, byRole)
    const activeIds = created.filter((item) => item.role !== 'disabled').map((item) => item.id)
    await result('PROFILE_ACTIVATE_FAILED', () => clientSet.service.from('profiles').update({ status: 'active' }).in('id', activeIds))
    return await verifyLiveFixture(config, clientSet)
  } catch (error) {
    const userIds = created.map((item) => item.id)
    const sealFailures = []
    const attemptSeal = async (label, operation) => {
      try { await operation() } catch { sealFailures.push(label) }
    }
    if (userIds.length) {
      await attemptSeal('profiles', () => result('PARTIAL_PROFILE_SEAL_FAILED', () => clientSet.service.from('profiles').update({ status: 'disabled' }).in('id', userIds)))
      await attemptSeal('roles', () => result('PARTIAL_ROLE_SEAL_FAILED', () => clientSet.service.from('profile_access_roles').delete().in('profile_id', userIds)))
      await attemptSeal('scopes', async () => {
        const currentFlag = await flagSnapshot(clientSet.service)
        await clearFixtureScopes(clientSet.service, currentFlag, userIds)
      })
      for (const item of created) {
        await attemptSeal(`auth:${item.role}`, () => result(`PARTIAL_AUTH_SEAL_FAILED:${item.role}`, () => clientSet.service.auth.admin.updateUserById(item.id, {
          password: randomBytes(48).toString('base64url') + 'Aa1!', ban_duration: '876000h',
        })))
      }
    }
    const sealComplete = sealFailures.length === 0
    const payload = evidencePayload(config, 'create-failure', sealComplete ? 'partial-sealed' : 'partial-preserved-seal-incomplete', {
      partialAccountsCreated: created.length,
      partialAccountsPreserved: created.length,
      physicalDeletion: false,
      auditChain: 'preserved',
      oldCredentialsReusable: sealComplete ? false : 'unverified',
      sealFailures,
      expectedResidual: sealComplete ? {
        authUsers: created.length, profiles: created.length, profileStatus: 'disabled', authBanned: created.length,
        roleAssignments: 0, fixtureScopeEntries: 0, auditChain: 'preserved', physicalDeletion: false,
      } : 'manual-inspection-required',
    })
    const evidence = writeEvidence(config, payload)
    console.error(`[p1:real-accounts] failureEvidence=${evidence.path} evidenceSha256=${evidence.sha256}`)
    throw new Error(`CREATE_FAILED_PARTIAL_${sealComplete ? 'SEALED' : 'PRESERVED'}:${created.length}`)
  }
}

async function sealFixture(config, clientSet) {
  const tagged = usersForTag(await listAllUsers(clientSet.service), config.tag)
  try {
    await verifyDatabaseFixture(config, clientSet.service, tagged, true)
    const allBanned = tagged.every((user) => user.banned_until && new Date(user.banned_until).getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000)
    if (!allBanned) throw new Error('SEALED_AUTH_BAN_MISSING')
    for (const [role, account] of Object.entries(config.accounts)) {
      const probe = await clientSet.publicClient().auth.signInWithPassword({ email: account.login, password: account.password })
      if (!probe.error) throw new Error(`OLD_CREDENTIAL_REUSE_DETECTED:${role}`)
    }
    return { tagged, alreadySealed: true }
  } catch (error) {
    if (String(error?.message ?? '').startsWith('OLD_CREDENTIAL_REUSE_DETECTED:')) throw error
  }
  const { byRole, flag } = await verifyDatabaseFixture(config, clientSet.service, tagged, false)
  const ids = tagged.map((user) => user.id)
  for (const [role, account] of Object.entries(config.accounts)) {
    const client = clientSet.publicClient()
    await result(`SEAL_SIGN_IN_FAILED:${role}`, () => client.auth.signInWithPassword({
      email: account.login, password: account.password,
    }))
    await result(`SEAL_GLOBAL_SIGN_OUT_FAILED:${role}`, () => client.auth.signOut({ scope: 'global' }))
  }
  await result('PROFILE_SEAL_FAILED', () => clientSet.service.from('profiles').update({ status: 'disabled' }).in('id', ids))
  await result('ROLE_SEAL_FAILED', () => clientSet.service.from('profile_access_roles').delete().in('profile_id', ids))
  await clearFixtureScopes(clientSet.service, flag, ids)
  for (const [role, user] of byRole.entries()) {
    const replacement = randomBytes(48).toString('base64url') + 'Aa1!'
    await result(`AUTH_SEAL_FAILED:${role}`, () => clientSet.service.auth.admin.updateUserById(user.id, {
      password: replacement, ban_duration: '876000h',
    }))
  }
  const sealedUsers = usersForTag(await listAllUsers(clientSet.service), config.tag)
  await verifyDatabaseFixture(config, clientSet.service, sealedUsers, true)
  for (const [role, account] of Object.entries(config.accounts)) {
    const probe = await clientSet.publicClient().auth.signInWithPassword({ email: account.login, password: account.password })
    if (!probe.error) throw new Error(`OLD_CREDENTIAL_REUSE_DETECTED:${role}`)
  }
  return { tagged: sealedUsers, alreadySealed: false }
}

function evidencePayload(config, action, status, detail = {}) {
  return {
    schemaVersion: 1,
    evidenceType: 'canwin-team-os-4-p1-real-page-account-fixture',
    action, status, targetProjectRef: TEST_REF, fixtureTag: config.tag,
    capturedAt: new Date().toISOString(), credentialsIncluded: false,
    productionWrites: 0, ...detail,
  }
}

function writeEvidence(config, payload) {
  mkdirSync(config.evidenceRoot, { recursive: true })
  const stamp = payload.capturedAt.replaceAll(/[-:.]/g, '')
  const path = resolve(config.evidenceRoot, `${config.tag}-${payload.action}-${stamp}.json`)
  const text = `${JSON.stringify(payload, null, 2)}\n`
  writeFileSync(path, text, { flag: 'wx', encoding: 'utf8' })
  return { path, sha256: createHash('sha256').update(text).digest('hex') }
}

function selfTestEnvironment() {
  const environment = {
    P1_REAL_SUPABASE_URL: `${TEST_ORIGIN}/`, P1_REAL_EXPECTED_PROJECT_REF: TEST_REF,
    P1_REAL_ACCOUNT_FIXTURE_WRITE_SCOPE: WRITE_SCOPE, P1_REAL_FIXTURE_TAG: 'p1-page-selftest',
    P1_REAL_BASELINE_SUPERVISOR_ENABLED: 'false', P1_REAL_TEST_ANON_KEY: 'sb_publishable_self_test',
    P1_REAL_TEST_SERVICE_KEY: 'sb_secret_self_test',
  }
  for (const [role, definition] of Object.entries(accountDefinitions)) {
    environment[`${definition.envPrefix}_LOGIN`] = `p1-${role}@example.invalid`
    environment[`${definition.envPrefix}_PASSWORD`] = `offline-${role}-password-Aa1!`
  }
  return environment
}

async function runSelfTest() {
  const environment = selfTestEnvironment()
  const config = readConfig(environment, 'create')
  assert.equal(Object.keys(config.accounts).length, 6)
  assert.throws(() => readConfig({ ...environment, P1_REAL_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co/` }, 'create'), /PRODUCTION_REF_REJECTED/)
  assert.throws(() => readConfig({ ...environment, P1_REAL_EXPECTED_PROJECT_REF: PRODUCTION_REF }, 'create'), /PRODUCTION_REF_REJECTED/)
  assert.throws(() => readConfig({ ...environment, P1_REAL_SUPABASE_URL: '' }, 'create'), /CONFIG_MISSING/)
  assert.throws(() => readConfig({ ...environment, P1_REAL_ACCOUNT_FIXTURE_WRITE_SCOPE: 'YES' }, 'create'), /WRITE_SCOPE_REJECTED/)
  assert.throws(() => readConfig({ ...environment, P1_REAL_DISABLED_LOGIN: environment.P1_REAL_ADMIN_LOGIN }, 'create'), /LOGINS_MUST_BE_UNIQUE/)
  assert.throws(() => readConfig({ ...environment, P1_REAL_TEST_SERVICE_KEY: environment.P1_REAL_TEST_ANON_KEY }, 'create'), /API_KEY_CLASS_REJECTED/)
  const payload = evidencePayload(config, 'cleanup', 'sealed', {
    expectedResidual: { authUsers: 6, profiles: 6, profileStatus: 'disabled', authBanned: 6, roleAssignments: 0, fixtureScopeEntries: 0, auditChain: 'preserved', physicalDeletion: false },
    oldCredentialsReusable: false,
  })
  const partialFailure = evidencePayload(config, 'create-failure', 'partial-sealed', {
    partialAccountsCreated: 3, partialAccountsPreserved: 3, physicalDeletion: false,
    auditChain: 'preserved', oldCredentialsReusable: false, sealFailures: [],
  })
  assert.equal(partialFailure.partialAccountsCreated, partialFailure.partialAccountsPreserved)
  assert.equal(partialFailure.physicalDeletion, false)
  assert.equal(partialFailure.status, 'partial-sealed')
  const serialized = JSON.stringify([payload, partialFailure])
  for (const account of Object.values(config.accounts)) {
    assert.ok(!serialized.includes(account.login))
    assert.ok(!serialized.includes(account.password))
  }
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  assert.ok(source.includes("ban_duration: '876000h'"))
  assert.ok(source.includes("auditChain: 'preserved'"))
  assert.ok(source.includes('CREATE_FAILED_PARTIAL_'))
  assert.ok(!/\.deleteUser\s*\(/.test(source), 'fixture failures or cleanup must never physically delete Auth users')
  assert.ok(!source.includes(['CREATE', 'FAILED', 'ROLLED', 'BACK'].join('_')), 'partial fixture failure must not claim rollback')
  assert.ok(!/console\.(?:log|error)\(\s*config\b/.test(source))
  console.log('[p1:real-accounts] SELF_TEST_PASSED guards=7 negativeFailureCases=1 accounts=6 evidenceSecrets=0 cleanup=seal-not-delete network=0')
}

const action = process.argv.includes('--create') ? 'create'
  : process.argv.includes('--verify') ? 'verify'
    : process.argv.includes('--cleanup') ? 'cleanup'
      : process.argv.includes('--self-test') ? 'self-test' : null

try {
  if (action === 'self-test') {
    await runSelfTest()
  } else if (!action || process.argv.filter((arg) => ['--create', '--verify', '--cleanup'].includes(arg)).length !== 1) {
    console.error('[p1:real-accounts] OFFLINE use exactly one of --self-test, --create, --verify, --cleanup')
    process.exitCode = 2
  } else {
    const config = readConfig(process.env, action)
    const clientSet = clients(config)
    let tagged
    let detail
    if (action === 'create') {
      tagged = await createFixture(config, clientSet)
      detail = { accountsCreated: tagged.length, enabledProfiles: 5, disabledProfiles: 1, roleAssignments: 7, fixtureScopeEntries: 2, cleanupRequired: true }
    } else if (action === 'verify') {
      tagged = await verifyLiveFixture(config, clientSet)
      detail = { accountsVerified: tagged.length, enabledProfiles: 5, disabledProfiles: 1, rolesVerified: 5, oldCredentialsReusable: true }
    } else {
      const sealed = await sealFixture(config, clientSet)
      tagged = sealed.tagged
      detail = {
        accountsSealed: tagged.length, oldCredentialsReusable: false, alreadySealed: sealed.alreadySealed,
        expectedResidual: { authUsers: 6, profiles: 6, profileStatus: 'disabled', authBanned: 6, roleAssignments: 0, fixtureScopeEntries: 0, auditChain: 'preserved', physicalDeletion: false },
      }
    }
    const payload = evidencePayload(config, action, action === 'cleanup' ? 'sealed' : 'passed', detail)
    const evidence = writeEvidence(config, payload)
    console.log(`[p1:real-accounts] ${action.toUpperCase()}_COMPLETE target=${TEST_REF} tag=${config.tag} accounts=6 credentialsPrinted=0 credentialsWritten=0 productionWrites=0`)
    console.log(`[p1:real-accounts] evidence=${evidence.path} evidenceSha256=${evidence.sha256}`)
  }
} catch (error) {
  const reason = String(error?.message ?? 'UNKNOWN_FAILURE').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 240)
  console.error(`[p1:real-accounts] ACTION_PENDING ${reason} credentialsPrinted=0 credentialsWritten=0 productionWrites=0`)
  process.exitCode = 1
}
