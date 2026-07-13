import type { SupabaseClient } from '@supabase/supabase-js'
import type { CatalogAdminDataSource } from './catalogDataSource'
import type { CatalogItemDraft, CatalogSnapshot } from './catalogTypes'

const explain = (prefix: string, error: { message: string; code?: string }) => {
  if (error.code === '42501' || error.message.includes('ADMIN_REQUIRED')) return '仅老板或管理员可以查看采购成本并维护商品'
  return `${prefix}：${error.message}`
}

export function createCatalogSupabaseDataSource(client: SupabaseClient): CatalogAdminDataSource {
  return {
    async loadSnapshot() {
      const { data, error } = await client.rpc('get_catalog_item_admin_snapshot')
      if (error) throw new Error(explain('读取商品配置失败', error))
      return data as CatalogSnapshot
    },
    async saveItem(item: CatalogItemDraft) {
      const { error } = await client.rpc('manage_catalog_draft_item', {
        p_item_id: item.id ?? null,
        p_sku: item.sku,
        p_name: item.name,
        p_item_type: item.itemType,
        p_procurement_cost: item.procurementCost,
        p_customer_list_price: item.customerListPrice,
        p_points: item.points,
        p_applicable_business_types: item.applicableBusinessTypes,
        p_is_active: item.isActive,
      })
      if (error) throw new Error(explain('保存商品失败', error))
    },
  }
}
