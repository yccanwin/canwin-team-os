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
  communication_preference?: string | null
  mood?: string | null
  taboos?: string | null
  notes?: string | null
  learning_notes?: string | null
}

const PROFILE_SELECT =
  'id, team_id, name, role, position, avatar_url, join_date, status, rest_days, communication_preference, mood, taboos, notes'

type PackedProfileNotes = {
  __canwinProfileNotes: true
  notes?: string
  learningNotes?: string
}

const ADMIN_LOGIN_EMAIL = 'admin@yccanwin.com'
const SUPABASE_AUTH_STORAGE_KEY = 'sb-agygfhmkazcbqaqwmljb-auth-token'

function normalizeLoginEmail(value: string): string {
  const input = value.trim()
  if (input.toLowerCase() === 'admin') return ADMIN_LOGIN_EMAIL
  return input
}

function unpackProfileNotes(value: string | null | undefined): { notes?: string; learningNotes?: string } {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as Partial<PackedProfileNotes>
    if (parsed?.__canwinProfileNotes) {
      return {
        notes: parsed.notes || undefined,
        learningNotes: parsed.learningNotes || undefined,
      }
    }
  } catch {
    // Plain text notes from older profiles.
  }
  return { notes: value }
}

function packProfileNotes(notes?: string, learningNotes?: string): string {
  return JSON.stringify({
    __canwinProfileNotes: true,
    notes: notes || '',
    learningNotes: learningNotes || '',
  } satisfies PackedProfileNotes)
}

function profileToUser(profile: ProfileRow): User {
  const unpackedNotes = unpackProfileNotes(profile.notes)
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
    notes: unpackedNotes.notes,
    learningNotes: profile.learning_notes ?? unpackedNotes.learningNotes,
  }
}

async function loadProfileLearningNotes(ids: string[]): Promise<Record<string, string | undefined>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
  if (uniqueIds.length === 0) return {}

  const { data, error } = await supabase
    .from('profiles')
    .select('id, learning_notes')
    .in('id', uniqueIds)

  if (error) {
    console.warn('learning_notes column is not available yet:', error.message)
    return {}
  }

  return Object.fromEntries(
    (data ?? []).map((profile) => [
      profile.id as string,
      (profile.learning_notes as string | null) ?? undefined,
    ])
  )
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

export function isFinanceRole(role?: UserRole): boolean {
  return role === 'admin' || role === 'captain' || role === 'finance'
}

export function isWarehouseRole(role?: UserRole): boolean {
  return role === 'admin' || role === 'captain' || role === 'warehouse'
}

export async function loadCurrentProfile(session?: Session | null): Promise<User | null> {
  const activeSession = session ?? (await supabase.auth.getSession()).data.session
  const authUser = activeSession?.user
  if (!authUser) return null

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('id', authUser.id)
    .eq('team_id', CANWIN_TEAM_ID)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('当前账号缺少 profiles 资料，请先执行 Supabase schema 并初始化 admin profile。')
  if (data.status && data.status !== 'active') throw new Error('当前账号已停用，请联系管理员。')

  const user = profileToUser(data as ProfileRow)
  const learningNotes = await loadProfileLearningNotes([user.id])
  return { ...user, learningNotes: learningNotes[user.id] }
}

export async function loadTeamProfiles(): Promise<User[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  const users = (data ?? []).map((profile) => profileToUser(profile as ProfileRow))
  const learningNotes = await loadProfileLearningNotes(users.map((user) => user.id))
  return users.map((user) => ({ ...user, learningNotes: learningNotes[user.id] }))
}

export async function updateProfileRecord(
  id: string,
  updates: Pick<Partial<User>, 'name' | 'position' | 'avatar' | 'joinDate' | 'restDays' | 'communicationPreference' | 'mood' | 'taboos' | 'notes' | 'learningNotes'>
): Promise<User> {
  const baseUpdates: Record<string, unknown> = {}
  if ('name' in updates) baseUpdates.name = updates.name
  if ('position' in updates) baseUpdates.position = updates.position
  if ('avatar' in updates) baseUpdates.avatar_url = updates.avatar
  if ('joinDate' in updates) baseUpdates.join_date = updates.joinDate
  if ('restDays' in updates) baseUpdates.rest_days = updates.restDays
  if ('communicationPreference' in updates) baseUpdates.communication_preference = updates.communicationPreference
  if ('mood' in updates) baseUpdates.mood = updates.mood
  if ('taboos' in updates) baseUpdates.taboos = updates.taboos
  if ('notes' in updates) baseUpdates.notes = updates.notes

  let user: User
  if (Object.keys(baseUpdates).length > 0) {
    if ('notes' in updates && !('learningNotes' in updates)) {
      const existingLearningNotes = await loadProfileLearningNotes([id])
      if (existingLearningNotes[id] === undefined) {
        const { data: existing } = await supabase
          .from('profiles')
          .select('notes')
          .eq('id', id)
          .single()
        const unpacked = unpackProfileNotes((existing as { notes?: string | null } | null)?.notes)
        if (unpacked.learningNotes) {
          baseUpdates.notes = packProfileNotes(updates.notes, unpacked.learningNotes)
        }
      }
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(baseUpdates)
      .eq('id', id)
      .select(PROFILE_SELECT)
      .single()

    if (error) throw new Error(error.message)
    user = profileToUser(data as ProfileRow)
  } else {
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_SELECT)
      .eq('id', id)
      .single()

    if (error) throw new Error(error.message)
    user = profileToUser(data as ProfileRow)
  }

  if ('learningNotes' in updates) {
    const { error: learningError } = await supabase
      .from('profiles')
      .update({ learning_notes: updates.learningNotes })
      .eq('id', id)

    if (learningError) {
      const { data, error: fallbackError } = await supabase
        .from('profiles')
        .update({ notes: packProfileNotes(user.notes, updates.learningNotes) })
        .eq('id', id)
        .select(PROFILE_SELECT)
        .single()

      if (fallbackError) throw new Error(fallbackError.message || learningError.message)
      return profileToUser(data as ProfileRow)
    }
    return { ...user, learningNotes: updates.learningNotes }
  }

  return user
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
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY)
    window.localStorage.removeItem(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`)
    window.localStorage.removeItem(`${SUPABASE_AUTH_STORAGE_KEY}-user`)
  }

  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) throw new Error(error.message)
}
