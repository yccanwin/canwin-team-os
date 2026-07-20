import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccessAdminDataSource } from './dataSource'
import { localizeAccessRole, type AccessAdminSnapshot } from './types'
import { splitV1RoleSelection } from './v1AccessMapping'

const requestKey = () => crypto.randomUUID()

function fail(message: string, error: { message: string } | null) {
  if (error) throw new Error(`${message}：${error.message}`)
}

const adminErrorMessages: Record<string, string> = {
  ACCESS_ADMIN_REQUIRED: '当前账号没有人员与权限管理权限。',
  LAST_ADMIN_REQUIRED: '团队必须保留至少一名启用中的管理员。',
  INVALID_INVITATION: '邀请信息无效，请检查姓名和邮箱。',
  INVALID_ROLE_SET: '所选角色无效，请重新选择。',
  WAREHOUSE_FUNCTION_NOT_ASSIGNABLE: '仓库职能只能授予实施或管理员岗位。',
  MEMBER_ACCESS_STATE_READ_FAILED: '未能读取成员现有技能和管辖范围，请刷新后重试。',
  IDEMPOTENCY_KEY_CONFLICT: '本次请求与已提交的操作冲突，请刷新后重试。',
  Unauthorized: '登录状态已失效，请重新登录。',
  PASSWORD_LENGTH_INVALID: '新密码长度必须为 8 至 72 位。',
  MEMBER_NOT_FOUND: '没有找到该团队成员。',
}

async function failFunction(message: string, error: { message: string; context?: unknown } | null) {
  if (!error) return
  let serverError = ''
  if (error.context instanceof Response) {
    try {
      const payload = await error.context.clone().json() as { error?: string; message?: string; code?: string }
      serverError = payload.error || payload.message || payload.code || ''
    } catch {
      try { serverError = await error.context.clone().text() } catch { /* keep the generic fallback */ }
    }
  }
  const code = serverError.trim()
  const explanation = adminErrorMessages[code]
  if (explanation) throw new Error(`${explanation}（服务端：${code}）`)
  if (code) throw new Error(`${message}：${code}`)
  throw new Error(`${message}：${error.message}`)
}

export function createSupabaseAccessAdminDataSource(client: SupabaseClient): AccessAdminDataSource {
  return {
    async loadSnapshot() {
      const [{ data, error }, { data: authData }] = await Promise.all([
        client.rpc('get_access_admin_snapshot'),
        client.auth.getUser(),
      ])
      fail('读取权限配置失败', error)
      const snapshot = data as AccessAdminSnapshot
      return {
        ...snapshot,
        currentUserId: authData.user?.id ?? '',
        roles: snapshot.roles.map(localizeAccessRole),
        members: snapshot.members.map((member) => ({
          ...member,
          roles: member.roles.map(localizeAccessRole),
        })),
      }
    },
    async replaceRoles(profileId, roleCodes) {
      splitV1RoleSelection(roleCodes)
      const { error } = await client.functions.invoke('admin-members', {
        body: {
          action: 'apply-access', id: profileId, roleCodes,
          idempotencyKey: requestKey(),
        },
      })
      await failFunction('保存岗位与职能失败', error)
    },
    async createInvitation(email, displayName, roleCodes) {
      const { error } = await client.functions.invoke('admin-members', {
        body: {
          action: 'invite', email, name: displayName, roleCodes,
          idempotencyKey: requestKey(),
        },
      })
      await failFunction('登记邀请失败', error)
    },
    async setProfileStatus(profileId, status) {
      const { error } = await client.functions.invoke('admin-members', {
        body: { action: 'set-status', id: profileId, status, idempotencyKey: requestKey() },
      })
      await failFunction('修改账号状态失败', error)
    },
    async resetPassword(profileId, password) {
      const { error } = await client.functions.invoke('admin-members', {
        body: { action: 'reset-password', id: profileId, password },
      })
      await failFunction('重置成员密码失败', error)
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
      const { error } = await client.functions.invoke('admin-members', {
        body: {
          action: 'replace-supervisor-scope', id: supervisorId, subordinateIds,
          idempotencyKey: requestKey(),
        },
      })
      await failFunction('保存主管关系失败', error)
    },
    async reassignOwnership(fromProfileId, toProfileId, reason) {
      const { error } = await client.rpc('admin_reassign_crm_ownership', { p_from_profile_id: fromProfileId, p_to_profile_id: toProfileId, p_reason: reason, p_idempotency_key: requestKey() })
      fail('批量转移客户失败', error)
    },
  }
}
