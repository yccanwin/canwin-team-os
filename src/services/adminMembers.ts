import { supabase } from '@/lib/supabase'
import type { User } from '@/types'

type ProfileRow = {
  id: string
  name: string | null
  role: User['role'] | null
  position: string | null
  avatar_url: string | null
  join_date: string | null
  rest_days?: string[] | null
  communication_preference?: string | null
  mood?: string | null
  taboos?: string | null
  notes?: string | null
  learning_notes?: string | null
}

export type MemberPayload = {
  id?: string
  email?: string
  name: string
  role: User['role']
  position: string
  avatarUrl?: string
  joinDate: string
}

function profileToUser(profile: ProfileRow): User {
  return {
    id: profile.id,
    name: profile.name || '未命名成员',
    role: profile.role || 'member',
    position: profile.position || '',
    avatar: profile.avatar_url || undefined,
    joinDate: profile.join_date || new Date().toISOString(),
    badges: [],
    restDays: profile.rest_days ?? undefined,
    communicationPreference: profile.communication_preference ?? undefined,
    mood: profile.mood ?? undefined,
    taboos: profile.taboos ?? undefined,
    notes: profile.notes ?? undefined,
    learningNotes: profile.learning_notes ?? undefined,
  }
}

async function invokeAdminMembers(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-members', { body })
  if (error) {
    throw new Error(await describeAdminMembersError(error))
  }
  if (data?.error) throw new Error(data.error)
  return data
}

const adminErrorMessages: Record<string, string> = {
  ACCESS_ADMIN_REQUIRED: '当前账号没有人员与权限管理权限。',
  LAST_ADMIN_REQUIRED: '团队必须保留至少一名启用中的管理员。',
  INVALID_INVITATION: '邀请信息无效，请检查姓名和邮箱。',
  INVALID_ROLE_SET: '所选角色无效，请重新选择。',
  IDEMPOTENCY_KEY_CONFLICT: '本次请求与已提交的操作冲突，请刷新后重试。',
  Unauthorized: '登录状态已失效，请重新登录。',
}

async function describeAdminMembersError(error: { message?: string; context?: unknown }): Promise<string> {
  let serverError = ''
  const context = error.context
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: string; message?: string; code?: string }
      serverError = payload.error || payload.message || payload.code || ''
    } catch {
      try { serverError = await context.clone().text() } catch { /* keep the generic fallback */ }
    }
  }
  const code = serverError.trim()
  const explanation = adminErrorMessages[code]
  if (explanation) return `${explanation}（服务端：${code}）`
  if (code) return `成员管理失败：${code}`
  return error.message || '成员管理函数调用失败，请确认 Supabase Edge Function 已部署。'
}

export async function createTeamMember(payload: MemberPayload): Promise<User> {
  const data = await invokeAdminMembers({
    action: 'invite',
    ...payload,
    roleCodes: [payload.role === 'captain' ? 'supervisor' : payload.role === 'member' ? 'sales' : payload.role],
    idempotencyKey: crypto.randomUUID(),
  })
  return profileToUser(data.profile as ProfileRow)
}

export async function updateTeamMember(payload: MemberPayload): Promise<User> {
  const data = await invokeAdminMembers({
    action: 'update',
    ...payload,
    roleCodes: [payload.role === 'captain' ? 'supervisor' : payload.role === 'member' ? 'sales' : payload.role],
    idempotencyKey: crypto.randomUUID(),
  })
  return profileToUser(data.profile as ProfileRow)
}

export async function disableTeamMember(id: string): Promise<void> {
  await invokeAdminMembers({
    action: 'set-status', id, status: 'disabled', idempotencyKey: crypto.randomUUID(),
  })
}
