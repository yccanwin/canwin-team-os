import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerImportRowInput, CustomerImportSnapshot } from './customerImportTypes'

const requestKey = () => crypto.randomUUID()
function ensure(error: { message: string } | null, label: string) { if (error) throw new Error(`${label}：${error.message}`) }

export function createCustomerImportDataSource(client: SupabaseClient) {
  return {
    async load(batchId?: string | null) {
      const { data, error } = await client.rpc('get_customer_import_admin_snapshot', { p_batch_id: batchId ?? null })
      ensure(error, '读取导入批次失败'); return data as CustomerImportSnapshot
    },
    async stage(sourceName: string, rows: CustomerImportRowInput[]) {
      const { data, error } = await client.rpc('stage_customer_import_batch', { p_source_name: sourceName, p_rows: rows, p_idempotency_key: requestKey(), p_template_version: 'customer-v1' })
      ensure(error, '上传导入文件失败'); return String(data)
    },
    async precheck(batchId: string) {
      const { error } = await client.rpc('precheck_customer_import', { p_batch_id: batchId }); ensure(error, '服务端预检失败')
    },
    async commit(batchId: string) {
      const { error } = await client.rpc('commit_customer_import_admin', { p_batch_id: batchId }); ensure(error, '确认导入失败')
    },
  }
}

