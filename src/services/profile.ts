import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { User } from '@/types'

export type UserRole = 'admin' | 'captain' | 'finance' | 'warehouse' | 'member'

type ProfileRow = {
  id: string
  team_id: string
  name: string | null
  role: UserRole | null
  position: string | null
  avatar_url: string | null
  join_date: string | null
  status: string | null
  rest_days?: string[] | null
  mood?: string | null
  taboos?: string | null
}

const ADMIN_LOGIN_EMAIL = 'admin@canwin.local'

function normalizeLoginEmail(value: string): string {
  const input = value.trim()
  if (input.toLowerCase() === 'admin') return ADMIN_LOGIN_EMAIL
  return input
}

function profileToUser(profile: ProfileRow): User {
  return {
    id: profile.id,
    name: profile.name || '未命名成员',
    role: profile.role || 'member',
    position: profile.position || '',
    avatar: profile.avatar_url || undefined,
    joinDate: profile.join_date || new Date().toISOString(),
    xp: 0,
    level: 1,
    badges: [],
    restDays: profile.rest_days ?? undefined,
    mood: profile.mood ?? undefined,
    taboos: profile.taboos ?? undefined,
  }
}

export function roleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    admin: '管理员',
    captain: '队长',
    finance: '财务',
    warehouse: '仓库',
    member: '成员',
  }
  return labels[role]
}

export function isAdminRole(role?: UserRole): boolean {
  return role === 'admin'
}

export function isCaptainRole(role?: UserRole): boolean {
  return role === 'admin' || role === 'captain'
}

export async function loadCurrentProfile(session?: Session | null): Promise<User | null> {
  const activeSession = session ?? (await supabase.auth.getSession()).data.session
  const authUser = activeSession?.user
  if (!authUser) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('id, team_id, name, role, position, avatar_url, join_date, status, rest_days, mood, taboos')
    .eq('id', authUser.id)
    .eq('team_id', CANWIN_TEAM_ID)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('当前账号缺少 profiles 资料，请先执行 Supabase schema 并初始化 admin profile。')
  if (data.status && data.status !== 'active') throw new Error('当前账号已停用，请联系管理员。')

  return profileToUser(data as ProfileRow)
}

export async function signInWithPassword(login: string, password: string): Promise<User> {
  const email = normalizeLoginEmail(login)
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)

  const user = await loadCurrentProfile(data.session)
  if (!user) throw new Error('登录成功，但没有找到成员资料。')
  return user
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(error.message)
}
