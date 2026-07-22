import type { User } from '@supabase/supabase-js'
import { isPrimaryRole } from '../../../../packages/team-os-4-domain/src/index'
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

  return {
    userId: profileResult.data.id,
    companyId: profileResult.data.company_id,
    companyName: companyResult.data.name,
    displayName: profileResult.data.display_name,
    primaryRole: roleKey,
  }
}
