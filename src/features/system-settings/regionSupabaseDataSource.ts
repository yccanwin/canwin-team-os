import type { SupabaseClient } from '@supabase/supabase-js'
import type { RegionAdminDataSource } from './regionDataSource'
import type { RegionAdminSnapshot, RegionDraft } from './regionTypes'

const errorMessage = (prefix: string, error: { message: string; code?: string }) => {
  if (error.code === '42501' || error.message.includes('ADMIN_REQUIRED')) return '仅老板或管理员可以管理区域'
  return `${prefix}：${error.message}`
}

export function createRegionSupabaseDataSource(client: SupabaseClient): RegionAdminDataSource {
  return {
    async loadSnapshot() {
      const { data, error } = await client.rpc('get_region_admin_snapshot')
      if (error) throw new Error(errorMessage('读取区域配置失败', error))
      return data as RegionAdminSnapshot
    },
    async saveRegion(draft: RegionDraft) {
      const { error } = await client.rpc('manage_sales_region', {
        p_region_id: draft.id ?? null,
        p_code: draft.code,
        p_name: draft.name,
        p_region_level: draft.regionLevel,
        p_parent_id: draft.parentId,
        p_is_active: draft.isActive,
      })
      if (error) throw new Error(errorMessage('保存区域失败', error))
    },
    async saveMemberRegions(profileId, regionIds, primaryRegionId) {
      const { error } = await client.rpc('manage_profile_regions', {
        p_profile_id: profileId,
        p_region_ids: regionIds,
        p_primary_region_id: primaryRegionId,
      })
      if (error) throw new Error(errorMessage('保存人员区域失败', error))
    },
  }
}
