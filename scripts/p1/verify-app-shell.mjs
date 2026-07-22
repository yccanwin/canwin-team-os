import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFileSync(resolve(repoRoot, path), 'utf8').replace(/\r\n/g, '\n')
const issues = []
let assertions = 0
const check = (condition, message) => {
  assertions += 1
  if (!condition) issues.push(message)
}

const types = read('src/features/app-shell/types.ts')
const dataSource = read('src/features/app-shell/supabaseDataSource.ts')
const store = read('src/features/app-shell/useAppContextStore.ts')
const navigation = read('src/components/Layout/navigation.ts')
const layout = read('src/components/Layout/index.tsx')
const dashboard = read('src/pages/Dashboard/index.tsx')
const profile = read('src/services/profile.ts')
const app = read('src/App.tsx')
const salesWorkbench = read('src/features/sales-workbench/SalesWorkbench.tsx')
const accessAdminDataSource = read('src/features/access-admin/supabaseDataSource.ts')
const accessAdminEditor = read('src/features/access-admin/AccessAdminEditor.tsx')
const accessV1Mapping = read('src/features/access-admin/v1AccessMapping.ts')
const adminMembersFunction = read('supabase/functions/admin-members/index.ts')
const migration = read('supabase/migrations/20260719130910_team_os_4_p1_access_shell.sql')
const sqlTest = read('supabase/tests/team_os_4_p1_access_shell.sql')

const appContextFields = [
  'company', 'user', 'primaryRole', 'additionalFunctions', 'skills', 'regionScopeIds',
  'warehouseScopeIds', 'supervisorScope', 'supervisorEnabled', 'permissions',
  'availableWorkViews', 'currentWorkView', 'navigationRevision',
]
for (const field of appContextFields) {
  check(new RegExp(`\\b${field}\\b`).test(types), `AppContext type missing ${field}`)
}

check(dataSource.includes("supabase.rpc('get_app_context_v1')"), 'AppContext is not loaded from the frozen RPC')
check(dataSource.includes("supabase.rpc('get_navigation_manifest_v1'"), 'navigation is not loaded from the frozen RPC')
check(dataSource.includes('hasExactKeys'), 'runtime field whitelist is not fail-closed')
check(dataSource.includes("value.navigationRevision !== `p1-nav-1:${value.company.id}`"), 'navigation revision is not fail-closed')
check(dataSource.includes('validateNavigationManifest(items, workView, context)'), 'navigation semantics are not checked before rendering')
check(dataSource.includes("routeId: 'my-workbench', order: 10"), 'desktop fixed navigation order is not enforced')
check(dataSource.includes("routeId: 'mobile-profile', order: 50"), 'mobile profile contract is not enforced')
check(dataSource.includes("expected: context.additionalFunctions.includes('warehouse')"), 'warehouse navigation is not matched to AppContext')
check(dataSource.includes("context.additionalFunctions.includes('supervisor') && context.supervisorEnabled"), 'supervisor navigation is not matched to AppContext and switch')
check(store.includes('availableWorkViews.some'), 'work-view switch does not verify the server whitelist')
check(store.includes('navigation: []'), 'navigation does not fail closed during loading/error')

check(navigation.includes("['my-workbench', 'progress', 'calendar', 'role-business', 'mobile-profile']"), 'mobile navigation does not use the frozen five-item order')
check(navigation.includes("'role-business': '岗位业务'"), 'mobile navigation does not use the frozen 岗位业务 label')
check(navigation.includes("item.routeId === 'role-business' ? '当前岗位业务'"), 'desktop navigation does not use the frozen 当前岗位业务 label')
check(navigation.includes("item.group === 'warehouse'"), 'warehouse conditional group missing')
check(navigation.includes("item.group === 'supervisor'"), 'supervisor conditional group missing')
check(!navigation.includes('NAVIGATION_GROUPS'), 'legacy global static navigation remains authoritative')

check(layout.includes('buildNavigationGroups(navigation)'), 'Layout does not consume the server navigation manifest')
check(layout.includes('context.availableWorkViews.map'), 'account menu work-view switch missing')
check(layout.includes('v4.0 岗位壳层'), '4.0 shell version marker missing')
check(!layout.includes('usesSalesMobileNavigation'), 'sales page still bypasses the unified mobile navigation')

for (const forbiddenStore of ['useFinanceStore', 'useInventoryStore', 'usePhotoStore', 'useWarRoomStore', 'useTimelineStore']) {
  check(!dashboard.includes(forbiddenStore), `role workbench reads broad legacy store ${forbiddenStore}`)
}
check(dashboard.includes('context.currentWorkView'), 'role-generated workbench does not use server currentWorkView')
check(dashboard.includes("item.group === 'role_business'"), 'workbench business links do not come from the server manifest')

check(!profile.includes('CANWIN_TEAM_ID'), 'current profile resolution still hard-codes the old company id')
check(profile.includes('loadAppContext()'), 'profile service does not resolve company and primary role from AppContext')
check(profile.includes("context?.additionalFunctions.includes('warehouse')"), 'legacy warehouse UI helpers do not read the AppContext overlay')
check(app.includes("appContext?.additionalFunctions.includes('warehouse')"), 'bootstrap warehouse loading is not controlled by AppContext')
check(!app.includes('isWarehouseRole(currentUser.role)'), 'bootstrap still infers warehouse access from the primary role')
check(!salesWorkbench.includes('<aside className="sw-desktop-nav"'), 'sales workbench retains a second desktop navigation')
check(!salesWorkbench.includes('<nav className="sw-bottom-nav"'), 'sales workbench retains a second mobile navigation')

check(app.includes('<Route path="/members" element={<Navigate to="/settings-v3/access?view=members" replace />} />'), 'legacy /members route does not redirect to the 4.0 access page')
check(app.includes('<Route path="/settings" element={<Navigate to="/settings-v3" replace />} />'), 'legacy /settings route does not redirect to the 4.0 settings page')
check(app.includes('<Route path="/settings-v3/access"'), '4.0 access navigation route is not mounted')
check(accessAdminDataSource.includes("action: 'apply-access'"), '4.0 access page does not use the preserving Edge member writer')
check(accessAdminDataSource.includes("action: 'replace-supervisor-scope'"), '4.0 access page does not use the preserving Edge supervisor writer')
check(!accessAdminDataSource.includes("rpc('admin_replace_profile_roles'"), '4.0 access page still calls the retired role writer')
check(!accessAdminDataSource.includes("rpc('admin_replace_supervisor_subordinates'"), '4.0 access page still calls the retired supervisor writer')
check(adminMembersFunction.includes("rpc('admin_apply_member_access_v1'"), 'admin-members does not call the frozen v1 member writer')
check(adminMembersFunction.includes("rpc('admin_replace_supervisor_scope_v1'"), 'admin-members does not call the frozen v1 supervisor writer')
check(!adminMembersFunction.includes("rpc('admin_replace_profile_roles'"), 'admin-members still calls the retired role writer')
check(!adminMembersFunction.includes("rpc('admin_replace_supervisor_subordinates'"), 'admin-members still calls the retired supervisor writer')
for (const preservedSource of ['user_skills', 'profile_sales_regions', 'feature_flags']) {
  check(adminMembersFunction.includes(preservedSource), `admin-members does not preserve ${preservedSource}`)
}
for (const v1Field of [
  'p_primary_role', 'p_additional_functions', 'p_skill_ids', 'p_region_scope_ids',
  'p_warehouse_scope_ids', 'p_region_ids', 'p_user_ids', 'p_business_scopes',
]) {
  check(adminMembersFunction.includes(v1Field), `admin-members v1 write payload missing ${v1Field}`)
}
check(accessV1Mapping.includes("['admin', 'sales', 'implementation', 'operations', 'finance']"), '4.0 primary role allow-list drift')
check(accessV1Mapping.includes("['warehouse', 'supervisor']"), '4.0 additional-function allow-list drift')
check(accessV1Mapping.includes("!['admin', 'implementation'].includes(primaryRole)"), 'warehouse overlay is not limited to admin/implementation')
check(accessV1Mapping.includes("code === 'owner' ? 'admin' : code"), 'owner read-compatibility is not normalized to admin in the UI')
check(!adminMembersFunction.includes("code === 'owner' ? 'admin'"), 'Edge writer accepts owner as a new 4.0 role')
check(accessAdminEditor.includes("type={isPrimaryAccessRole(role.code) ? 'radio' : 'checkbox'}"), 'access editor does not enforce one primary role in the UI')

const requiredRouteFragments = [
  '<Route path="/" element={<Navigate to="/dashboard" replace />} />',
  '<Route path="/tasks" element={<Navigate to="/work" replace />} />',
  '<Route path="/goals" element={<Navigate to="/profile?view=goals" replace />} />',
  '<Route path="/votes" element={<ClosedLegacyRoute />} />',
  '<Route path="/timeline" element={<ClosedLegacyRoute />} />',
  '<Route path="/photos" element={<ClosedLegacyRoute />} />',
  '<Route path="/toolbox" element={<ClosedLegacyRoute />} />',
  '<Route path="/warroom" element={<ClosedLegacyRoute />} />',
  '<Route path="/culture-center" element={<ClosedLegacyRoute />} />',
]
for (const fragment of requiredRouteFragments) {
  check(app.includes(fragment), `legacy route disposition missing: ${fragment}`)
}

for (const functionName of [
  'get_app_context_v1',
  'get_navigation_manifest_v1',
  'resolve_responsible_profile_v1',
  'admin_apply_member_access_v1',
  'admin_set_supervisor_system_v1',
  'admin_replace_supervisor_scope_v1',
]) {
  check(migration.includes(`function public.${functionName}`), `public P1 RPC missing: ${functionName}`)
}
check(migration.includes('assignment_kind'), 'P1 migration does not classify role assignments')
check(migration.includes('revoke execute on function public.admin_replace_profile_roles'), 'legacy role writer was not retired')
check(!migration.includes('CANWIN_TEAM'), 'P1 migration hard-codes the old company id')
check(sqlTest.includes('rollback;'), 'P1 SQL fixture does not roll back')
check(sqlTest.includes('Five P1 identities'), 'P1 SQL fixture does not cover all five primary roles')
check(sqlTest.includes('Finance changed the supervisor system'), 'P1 SQL fixture lacks direct API overreach coverage')
check(sqlTest.indexOf('insert into auth.users') < sqlTest.indexOf('insert into public.profiles'), 'P1 fixture must create Auth users before completing generated profiles')
check(sqlTest.includes('on conflict (id) do update'), 'P1 fixture does not follow the Auth-to-profile trigger with an idempotent profile completion')

console.log(`[p1:app-shell] summary assertions=${assertions} passed=${assertions - issues.length} failed=${issues.length}`)
if (issues.length > 0) {
  for (const issue of issues) console.error(`[p1:app-shell] FAIL ${issue}`)
  process.exit(1)
}
