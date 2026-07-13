import type { SupabaseClient } from '@supabase/supabase-js'
import { ManagementBoardDataError, type ManagementBoardDataSource, type SupervisorExceptionRecord } from './dataSource'

type RawException = { entity_id: string; owner_id: string; item_type: 'action_exception' | 'closing_opportunity'; due_at: string; title: string; details: string }

export const createSupabaseManagementBoardDataSource = (client: SupabaseClient): ManagementBoardDataSource => ({
  async listExceptions(): Promise<SupervisorExceptionRecord[]> {
    const { data, error } = await client.from('crm_supervisor_board').select('entity_id,owner_id,item_type,due_at,title,details').order('due_at', { ascending: true })
    if (error || !data) throw new ManagementBoardDataError(error ? `读取主管异常失败：${error.message}` : '读取主管异常失败：服务器未返回数据', error?.code)
    const rows = data as RawException[]
    const ownerIds = [...new Set(rows.map(row => row.owner_id))]
    const names = new Map<string, string>()
    if (ownerIds.length > 0) {
      const { data: profiles, error: profileError } = await client.from('profiles').select('id,name').in('id', ownerIds)
      if (profileError) throw new ManagementBoardDataError(`读取负责人失败：${profileError.message}`, profileError.code)
      for (const profile of profiles ?? []) names.set(String(profile.id), String(profile.name))
    }
    return rows.map(row => ({ entityId: row.entity_id, ownerId: row.owner_id, itemType: row.item_type, ownerName: names.get(row.owner_id) ?? '负责人名称不可见', entityType: row.item_type, actionType: row.details, dueAt: row.due_at, title: row.title, urgency: row.item_type === 'closing_opportunity' ? '7天内决策' : '异常' }))
  },
  async resolveException(input) {
    const { error } = await client.rpc('resolve_supervisor_exception', { p_item_type: input.itemType, p_entity_id: input.entityId, p_owner_id: input.ownerId, p_resolution_due_at: input.dueAt, p_resolution_note: input.note })
    if (error) throw new ManagementBoardDataError(`提交处置失败：${error.message}`, error.code)
  },
})
