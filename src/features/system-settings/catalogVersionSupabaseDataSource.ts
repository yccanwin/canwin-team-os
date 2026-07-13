import type { SupabaseClient } from '@supabase/supabase-js'
import type { CatalogVersionDataSource } from './catalogVersionDataSource'
import type { CatalogVersionSnapshot } from './catalogVersionTypes'
const explain = (prefix: string, error: { message: string; code?: string }) => error.code === '42501' || error.message.includes('ADMIN_REQUIRED') ? '仅老板或管理员可以管理目录版本' : `${prefix}：${error.message}`
export function createCatalogVersionSupabaseDataSource(client: SupabaseClient): CatalogVersionDataSource {
  return {
    async loadSnapshot() { const { data, error } = await client.rpc('get_catalog_version_admin_snapshot'); if (error) throw new Error(explain('读取目录版本失败', error)); return data as CatalogVersionSnapshot },
    async createDraft(idempotencyKey) { const { data, error } = await client.rpc('create_catalog_draft_from_latest', { p_idempotency_key: idempotencyKey }); if (error) throw new Error(explain('创建工作草稿失败', error)); return String(data) },
    async publishDraft(versionId, idempotencyKey) { const { data, error } = await client.rpc('publish_catalog_draft', { p_version_id: versionId, p_idempotency_key: idempotencyKey }); if (error) throw new Error(explain('发布目录失败', error)); return String(data) },
  }
}
