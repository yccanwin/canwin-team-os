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
  mood?: string | null
  taboos?: string | null
}

export type MemberPayload = {
  id?: string
  email?: string
  password?: string
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
    mood: profile.mood ?? undefined,
    taboos: profile.taboos ?? undefined,
  }
}

async function invokeAdminMembers(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-members', { body })
  if (error) {
    throw new Error(error.message || '成员管理函数调用失败，请确认 Supabase Edge Function 已部署。')
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export async function createTeamMember(payload: MemberPayload): Promise<User> {
  const data = await invokeAdminMembers({
    action: 'create',
    ...payload,
  })
  return profileToUser(data.profile as ProfileRow)
}

export async function updateTeamMember(payload: MemberPayload): Promise<User> {
  const data = await invokeAdminMembers({
    action: 'update',
    ...payload,
  })
  return profileToUser(data.profile as ProfileRow)
}

export async function disableTeamMember(id: string): Promise<void> {
  await invokeAdminMembers({ action: 'disable', id })
}
