import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccessAdminDataSource } from './dataSource'
import type { AccessAdminSnapshot, AccessMemberView } from './types'

export function createSupabaseAccessAdminDataSource(client: SupabaseClient): AccessAdminDataSource {
  return { async loadSnapshot(): Promise<AccessAdminSnapshot> {
    const { data: authData, error: authError } = await client.auth.getUser()
    if (authError || !authData.user) throw new Error(`读取当前用户失败：${authError?.message ?? '未登录'}`)
    const [profiles, roles, profileRoles, regions, profileRegions, flags] = await Promise.all([
      client.from('profiles').select('id,name,status,role').order('name'),
      client.from('access_roles').select('id,code,name').order('name'),
      client.from('profile_access_roles').select('profile_id,role_id'),
      client.from('sales_regions').select('id,code,name').order('name'),
      client.from('profile_sales_regions').select('profile_id,region_id,is_primary'),
      client.from('feature_flags').select('id,key,description,enabled').order('key'),
    ])
    const error = profiles.error ?? roles.error ?? profileRoles.error ?? regions.error ?? profileRegions.error ?? flags.error
    if (error) throw new Error(`读取权限总览失败：${error.message}`)
    const roleById = new Map((roles.data ?? []).map((row) => [String(row.id), { id: String(row.id), code: String(row.code), name: String(row.name) }]))
    const regionById = new Map((regions.data ?? []).map((row) => [String(row.id), { id: String(row.id), code: String(row.code), name: String(row.name) }]))
    const members: AccessMemberView[] = (profiles.data ?? []).map((profile) => ({
      id: String(profile.id), name: profile.name === null ? '未命名成员' : String(profile.name),
      status: profile.status === null ? 'unknown' : String(profile.status), legacyRole: profile.role === null ? 'member' : String(profile.role),
      roles: (profileRoles.data ?? []).filter((item) => item.profile_id === profile.id).map((item) => roleById.get(String(item.role_id))).filter((item): item is NonNullable<typeof item> => Boolean(item)),
      regions: (profileRegions.data ?? []).filter((item) => item.profile_id === profile.id).map((item) => {
        const region = regionById.get(String(item.region_id)); return region ? { ...region, primary: item.is_primary === true } : null
      }).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    }))
    const current = members.find((member) => member.id === authData.user.id)
    return {
      members,
      featureFlags: (flags.data ?? []).map((flag) => ({ id: String(flag.id), key: String(flag.key), description: flag.description === null ? '' : String(flag.description), enabled: flag.enabled === true })),
      roles: [...roleById.values()],
      regions: [...regionById.values()],
      currentUserIsAdmin: current?.legacyRole === 'admin' || current?.roles.some((role) => role.code === 'admin') === true,
    }
  },
  async manageProfileAccess(profileId, roleCodes, regionIds) {
    const { error } = await client.rpc('manage_profile_access', { p_profile_id: profileId, p_role_codes: roleCodes, p_region_ids: regionIds })
    if (error) throw new Error(`保存权限失败：${error.message}`)
  } }
}
