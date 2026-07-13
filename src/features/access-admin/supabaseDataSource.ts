import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccessAdminDataSource } from './dataSource'
import type { AccessAdminSnapshot } from './types'

const requestKey = () => crypto.randomUUID()

function fail(message: string, error: { message: string } | null) {
  if (error) throw new Error(`${message}：${error.message}`)
}

export function createSupabaseAccessAdminDataSource(client: SupabaseClient): AccessAdminDataSource {
  return {
    async loadSnapshot() {
      const { data, error } = await client.rpc('get_access_admin_snapshot')
      fail('读取权限配置失败', error)
      return data as AccessAdminSnapshot
    },
    async replaceRoles(profileId, roleCodes) {
      const { error } = await client.rpc('admin_replace_profile_roles', { p_profile_id: profileId, p_role_codes: roleCodes, p_idempotency_key: requestKey() })
      fail('保存角色失败', error)
    },
    async createInvitation(email, displayName, roleCodes) {
      const { error } = await client.functions.invoke('admin-members', {
        body: {
          action: 'invite', email, name: displayName, roleCodes,
          idempotencyKey: requestKey(),
        },
      })
      fail('登记邀请失败', error)
    },
    async setProfileStatus(profileId, status) {
      const { error } = await client.functions.invoke('admin-members', {
        body: { action: 'set-status', id: profileId, status, idempotencyKey: requestKey() },
      })
      fail('修改账号状态失败', error)
    },
    async createDelegation(input) {
      const { error } = await client.rpc('admin_create_delegation', {
        p_delegator_id: input.delegatorId, p_delegate_id: input.delegateId,
        p_starts_at: input.startsAt, p_ends_at: input.endsAt, p_reason: input.reason,
        p_idempotency_key: requestKey(),
      })
      fail('创建临时代理失败', error)
    },
    async replaceSupervisorSubordinates(supervisorId, subordinateIds) {
      const { error } = await client.rpc('admin_replace_supervisor_subordinates', { p_supervisor_id: supervisorId, p_subordinate_ids: subordinateIds, p_idempotency_key: requestKey() })
      fail('保存主管关系失败', error)
    },
    async reassignOwnership(fromProfileId, toProfileId, reason) {
      const { error } = await client.rpc('admin_reassign_crm_ownership', { p_from_profile_id: fromProfileId, p_to_profile_id: toProfileId, p_reason: reason, p_idempotency_key: requestKey() })
      fail('批量转移客户失败', error)
    },
  }
}
