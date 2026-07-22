import type { User } from '@supabase/supabase-js'
import { isAdditionalCapability, isPrimaryRole } from '../../../../packages/team-os-4-domain/src/index'
import { getGreenfieldSupabase } from './supabase'
import type { AuthenticatedWorkspace } from './access'

interface ProfileRow {
  id: string
  company_id: string
  primary_role_id: string
  display_name: string
  is_active: boolean
}

interface RoleRow { role_key: string; label: string; is_active: boolean }
interface CompanyRow { name: string }
interface ProfileCapabilityRow { capability_id: string }
interface CapabilityRow { capability_key: string; is_active: boolean }

export async function loadAuthenticatedWorkspace(authUser: User): Promise<AuthenticatedWorkspace> {
  const supabase = getGreenfieldSupabase()
  const profileResult = await supabase
    .from('profiles')
    .select('id,company_id,primary_role_id,display_name,is_active')
    .eq('id', authUser.id)
    .single<ProfileRow>()

  if (profileResult.error || !profileResult.data?.is_active) {
    throw new Error('当前用户资料加载失败或账号已停用，请联系管理员。')
  }

  const [roleResult, companyResult] = await Promise.all([
    supabase.from('primary_roles').select('role_key,label,is_active').eq('id', profileResult.data.primary_role_id).single<RoleRow>(),
    supabase.from('companies').select('name').eq('id', profileResult.data.company_id).single<CompanyRow>(),
  ])
  const roleKey = roleResult.data?.role_key
  if (roleResult.error || !roleResult.data?.is_active || !roleKey || !isPrimaryRole(roleKey)) {
    throw new Error('当前用户的主岗位信息加载失败，请联系管理员。')
  }
  if (companyResult.error || !companyResult.data?.name) {
    throw new Error('当前公司的资料加载失败，请联系管理员。')
  }

  const linksResult = await supabase
    .from('profile_capabilities')
    .select('capability_id')
    .eq('profile_id', profileResult.data.id)
    .eq('company_id', profileResult.data.company_id)
    .is('revoked_at', null)
    .returns<ProfileCapabilityRow[]>()
  if (linksResult.error) {
    throw new Error('当前用户的附加职能加载失败，请联系管理员。')
  }

  const capabilityIds = (linksResult.data ?? []).map((item) => item.capability_id)
  let additionalCapabilities: AuthenticatedWorkspace['additionalCapabilities'] = Object.freeze([])
  if (capabilityIds.length > 0) {
    const capabilitiesResult = await supabase
      .from('capabilities')
      .select('capability_key,is_active')
      .eq('company_id', profileResult.data.company_id)
      .in('id', capabilityIds)
      .returns<CapabilityRow[]>()
    if (capabilitiesResult.error || (capabilitiesResult.data ?? []).some((item) => !item.is_active)) {
      throw new Error('当前用户的附加职能加载失败，请联系管理员。')
    }
    const keys = (capabilitiesResult.data ?? []).map((item) => item.capability_key)
    if (!keys.every(isAdditionalCapability)) {
      throw new Error('当前用户的附加职能配置无效，请联系管理员。')
    }
    additionalCapabilities = Object.freeze([...keys])
  }

  return {
    userId: profileResult.data.id,
    companyId: profileResult.data.company_id,
    companyName: companyResult.data.name,
    displayName: profileResult.data.display_name,
    primaryRole: roleKey,
    additionalCapabilities,
  }
}
