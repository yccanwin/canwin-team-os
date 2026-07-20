import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeAccessRoleCodes,
  splitV1RoleSelection,
  updateV1RoleSelection,
} from '../../src/features/access-admin/v1AccessMapping.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')

assert.deepEqual(normalizeAccessRoleCodes(['owner', 'supervisor', 'owner']), ['admin', 'supervisor'])
assert.deepEqual(splitV1RoleSelection(['implementation', 'warehouse']), {
  primaryRole: 'implementation',
  additionalFunctions: ['warehouse'],
})
assert.deepEqual(splitV1RoleSelection(['admin', 'warehouse', 'supervisor']), {
  primaryRole: 'admin',
  additionalFunctions: ['warehouse', 'supervisor'],
})
assert.deepEqual(updateV1RoleSelection(['implementation', 'warehouse'], 'sales'), ['sales'])
assert.deepEqual(updateV1RoleSelection(['sales'], 'supervisor'), ['sales', 'supervisor'])
assert.throws(() => splitV1RoleSelection(['sales', 'finance']), /INVALID_ROLE_SET/)
assert.throws(() => splitV1RoleSelection(['sales', 'warehouse']), /WAREHOUSE_FUNCTION_NOT_ASSIGNABLE/)
assert.throws(() => splitV1RoleSelection(['member']), /INVALID_ROLE_SET/)

const migration = read('supabase/migrations/20260719130910_team_os_4_p1_access_shell.sql')
const repairMigration = read('supabase/migrations/20260720015435_harden_server_only_rpc_acl.sql')
const sqlTest = read('supabase/tests/team_os_4_p1_access_shell.sql')
for (const signature of [
  'public.admin_apply_member_access_v1(',
  'p_profile_id uuid,',
  'p_primary_role text,',
  'p_additional_functions text[],',
  'p_skill_ids uuid[],',
  'p_region_scope_ids uuid[],',
  'p_warehouse_scope_ids text[],',
  'public.admin_replace_supervisor_scope_v1(',
  'p_supervisor_id uuid,',
  'p_region_ids uuid[],',
  'p_user_ids uuid[],',
  'p_business_scopes text[],',
]) assert.ok(migration.includes(signature), `P1 v1 RPC signature missing ${signature}`)
assert.ok(migration.includes("private.navigation_item_v1('admin-people',"), 'P1 access navigation key missing')
assert.ok(migration.includes("'role_business', '/settings-v3/access')"), 'P1 access navigation route missing')

const freeze = JSON.parse(read('scripts/p0/p1-interface-freeze.json'))
const frozenRpcNames = freeze.rpcInterfaces.map((entry: { name: string }) => entry.name)
assert.ok(frozenRpcNames.includes('admin_apply_member_access_v1'))
assert.ok(frozenRpcNames.includes('admin_replace_supervisor_scope_v1'))
assert.equal(freeze.authorizationRules.frontendMayDeriveSecondAuthorizationModel, false)

const frontendDataSource = read('src/features/access-admin/supabaseDataSource.ts')
const edgeFunction = read('supabase/functions/admin-members/index.ts')
const editor = read('src/features/access-admin/AccessAdminEditor.tsx')
assert.ok(frontendDataSource.includes("action: 'apply-access'"), 'frontend member write does not use the preserving Edge action')
assert.ok(frontendDataSource.includes("action: 'replace-supervisor-scope'"), 'frontend supervisor write does not use the preserving Edge action')
assert.ok(edgeFunction.includes("rpc('admin_apply_member_access_v1'"), 'Edge member writer is not v1')
assert.ok(!edgeFunction.includes("code === 'owner' ? 'admin'"), 'Edge must not accept owner as a new 4.0 role write')
assert.ok(!edgeFunction.includes('legacyProfileRole'), 'Edge must not derive or service-write the legacy authorization role')
assert.ok(!edgeFunction.includes('role: legacyRole'), 'Edge still writes profiles.role with service_role')
assert.ok(!edgeFunction.includes('role: payload.role'), 'Edge still accepts a client-supplied legacy authorization role')
assert.ok(!edgeFunction.includes("role?: 'admin'"), 'Edge payload still exposes the retired legacy authorization field')
for (const field of [
  'p_primary_role', 'p_additional_functions', 'p_skill_ids',
  'p_region_scope_ids', 'p_warehouse_scope_ids', 'p_idempotency_key',
]) assert.ok(edgeFunction.includes(field), `v1 member payload missing ${field}`)
for (const source of [frontendDataSource, edgeFunction]) {
  assert.ok(!source.includes("rpc('admin_replace_profile_roles'"), 'retired role writer is still called')
}
assert.ok(edgeFunction.includes("rpc('admin_replace_supervisor_scope_v1'"))
for (const field of ['p_region_ids', 'p_user_ids', 'p_business_scopes']) {
  assert.ok(edgeFunction.includes(field), `v1 supervisor payload missing ${field}`)
}
assert.ok(!frontendDataSource.includes("rpc('admin_replace_supervisor_subordinates'"))
for (const preservedSource of ['user_skills', 'profile_sales_regions', 'feature_flags']) {
  assert.ok(edgeFunction.includes(preservedSource), `Edge update does not preserve ${preservedSource}`)
}
assert.ok(!frontendDataSource.includes("from('user_skills')"), 'frontend must not reconstruct member access state')
assert.ok(!frontendDataSource.includes("from('feature_flags')"), 'frontend must not reconstruct warehouse/supervisor scopes')
assert.ok(repairMigration.includes('create or replace function private.admin_apply_member_access_v1('))
assert.ok(repairMigration.includes('update public.profiles p'), 'v1 member writer does not synchronize the legacy role')
assert.ok(repairMigration.includes("'legacyRole', legacy_role"), 'idempotency payload does not cover the legacy role')
assert.ok(repairMigration.includes("'legacyRole', target.role"), 'audit before-state does not cover the legacy role')
for (const mapping of [
  "when p_primary_role = 'admin' then 'admin'",
  "when 'supervisor' = any(functions) then 'captain'",
  "when p_primary_role = 'finance' then 'finance'",
  "when 'warehouse' = any(functions) then 'warehouse'",
  "else 'member'",
]) assert.ok(repairMigration.includes(mapping), `legacy role mapping missing ${mapping}`)
for (const sameTeamGuard of [
  'actor.team_id <> target.team_id',
  'item <> actor.team_id',
  's.team_id = actor.team_id',
  'r.team_id = actor.team_id',
]) assert.ok(repairMigration.includes(sameTeamGuard), `v1 same-team guard missing ${sameTeamGuard}`)
assert.ok(!repairMigration.toLowerCase().includes('create trigger'), 'repair must not change the sealed public trigger fingerprint')
assert.ok(sqlTest.includes('P1 role save did not atomically synchronize the legacy role mapping'))
assert.ok(sqlTest.includes('P1 failed role save left a partial legacy or 4.0 permission write'))
assert.ok(sqlTest.includes('P1_ATOMICITY_SENTINEL'))
assert.ok(editor.includes("type={isPrimaryAccessRole(role.code) ? 'radio' : 'checkbox'}"))
assert.ok(editor.includes('updateV1RoleSelection(invite.roleCodes, roleCode)'))

console.log('P1_ACCESS_ADMIN_V1_WRITE_CHAIN_OK mapping=8/8 legacySync=5/5 atomicityControls=2/2 rpcCallers=2/2 retiredCallers=0 preservedState=skills,regions,warehouse,supervisor')
