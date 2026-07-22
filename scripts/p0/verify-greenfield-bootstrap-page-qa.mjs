import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8')
const plan = read('docs/team-os-4.0/p0/11-greenfield-bootstrap-and-page-qa-plan.md')
const app = read('apps/team-os-4/src/App.tsx')
const supabase = read('apps/team-os-4/src/lib/supabase.ts')
const domainRoles = read('packages/team-os-4-domain/src/roles.ts')
const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }
const rolesStart = domainRoles.indexOf('export const PRIMARY_ROLES')
const rolesEnd = domainRoles.indexOf('] as const)', rolesStart)
const rolesBlock = rolesStart >= 0 && rolesEnd > rolesStart
  ? domainRoles.slice(rolesStart, rolesEnd + '] as const)'.length)
  : ''
const primaryRoles = [...rolesBlock.matchAll(/'(sales|implementation|operations|finance|admin)'/gu)]
  .map((match) => match[1])

for (const phrase of [
  '任一步注入失败后相关行数全部保持调用前值',
  '第二次调用必须明确拒绝',
  '`anon`、`authenticated` 均没有执行权',
  '六身份真实页面和直接 API 攻击全部通过',
]) check(plan.includes(phrase), `QA plan acceptance clause missing: ${phrase}`)

check(
  JSON.stringify(primaryRoles) === JSON.stringify(['sales', 'implementation', 'operations', 'finance', 'admin']),
  'five-role domain contract drift',
)
check(
  app.includes('<Navigate to={workspacePath(user.primaryRole)} replace />') &&
    app.includes('<Route path="/workspace/:role" element={<Workspace user={user} />} />'),
  'authenticated workspace route must derive from the authenticated primary role',
)
check(app.includes('<Route path="*"'), 'unknown-route fallback is missing')
check(
  app.includes('data-testid={`workspace-${currentRole}`}'),
  'stable role workspace selector is missing',
)
check(
  app.includes('if (!canOpenWorkspace(user, role))') &&
    app.includes('data-testid="access-denied"'),
  'manual cross-workspace URL denial is missing',
)
check(
  app.includes('data-testid="environment-status"'),
  'stable environment-status selector is missing',
)
check(
  supabase.includes('CANWIN_TEAM_OS_4_SUPABASE_URL') &&
    supabase.includes('CANWIN_TEAM_OS_4_SUPABASE_PUBLISHABLE_KEY'),
  'greenfield-only Supabase environment names are missing',
)

const frontend = `${app}\n${supabase}`
for (const [label, pattern] of [
  ['root src dependency', /(?:\.\.\/){3,}src\//u],
  ['legacy migrations dependency', /(?:\.\.\/)*supabase\/migrations/u],
  ['legacy RPC call', /\.rpc\s*\(/u],
  ['historical company marker', /CANWIN_TEAM(?!_OS_4_)|翻身小队/u],
]) check(!pattern.test(frontend), `frontend contains forbidden ${label}`)

if (failures.length > 0) {
  for (const failure of failures) console.error(`GREENFIELD_BOOTSTRAP_PAGE_QA_FAIL ${failure}`)
  process.exit(1)
}

console.log(
  'GREENFIELD_BOOTSTRAP_PAGE_QA_OK roles=5 stableRoutes=passed legacyDependencies=0 legacyRpcCalls=0 bootstrapRuntimeTests=pending sixIdentityRuntime=pending stableSelectors=present',
)
