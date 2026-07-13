import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { Achievement } from '@/types'
import { resolveMediaUrl, resolveMediaUrls, resolveStoredMediaUrl, resolveStoredMediaUrls } from '@/services/storage'

type AchievementRow = {
  id: string
  name: string
  category: Achievement['category'] | null
  description: string | null
  achieved_date: string | null
  timeline_event_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

type AchievementMeta = Pick<Achievement, 'description' | 'icon' | 'images'>

const ACHIEVEMENT_SELECT =
  'id, name, category, description, achieved_date, timeline_event_id, created_by, created_at, updated_at'

function parseMeta(description: string | null): Partial<AchievementMeta> {
  if (!description) return {}
  try {
    const parsed = JSON.parse(description) as Partial<AchievementMeta>
    return parsed && typeof parsed === 'object' ? parsed : { description }
  } catch {
    return { description }
  }
}

function rowToAchievement(row: AchievementRow): Achievement {
  const meta = parseMeta(row.description)
  return {
    id: row.id,
    name: row.name,
    icon: meta.icon || '',
    description: meta.description || '',
    achievedDate: row.achieved_date || '',
    timelineEventId: row.timeline_event_id || undefined,
    images: meta.images ?? [],
    category: row.category ?? 'other',
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function achievementToRow(achievement: Omit<Achievement, 'id' | 'createdAt'> | Partial<Achievement>) {
  const meta = {
    description: achievement.description,
    icon: achievement.icon,
    images: achievement.images ?? [],
  }

  return {
    name: achievement.name,
    category: achievement.category,
    description:
      achievement.description !== undefined ||
      achievement.icon !== undefined ||
      achievement.images !== undefined
        ? JSON.stringify(meta)
        : undefined,
    achieved_date: achievement.achievedDate,
    timeline_event_id: achievement.timelineEventId,
  }
}

export async function loadAchievements(): Promise<Achievement[]> {
  const { data, error } = await supabase
    .from('achievements')
    .select(ACHIEVEMENT_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('achieved_date', { ascending: false })

  if (error) throw new Error(error.message)
  return Promise.all((data ?? []).map(async (row) => {
    const achievement = rowToAchievement(row as AchievementRow)
    return {
      ...achievement,
      icon: (await resolveStoredMediaUrl(achievement.icon)) || achievement.icon,
      images: (await resolveStoredMediaUrls(achievement.images)) || achievement.images,
    }
  }))
}

export async function createAchievementRecord(
  achievement: Omit<Achievement, 'id' | 'createdAt'>
): Promise<Achievement> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)

  const { data, error } = await supabase
    .from('achievements')
    .insert({
      ...achievementToRow({
        ...achievement,
        icon: (await resolveMediaUrl(achievement.icon, 'achievements/icons')) || achievement.icon,
        images: (await resolveMediaUrls(achievement.images, 'achievements/images')) || achievement.images,
      }),
      team_id: CANWIN_TEAM_ID,
      created_by: userData.user.id,
    })
    .select(ACHIEVEMENT_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToAchievement(data as AchievementRow)
}

export async function updateAchievementRecord(
  id: string,
  updates: Partial<Achievement>
): Promise<Achievement> {
  const { data: existing, error: existingError } = await supabase
    .from('achievements')
    .select('description')
    .eq('id', id)
    .single()
  if (existingError) throw new Error(existingError.message)

  const previous = parseMeta(existing.description)
  const storedUpdates = {
    ...updates,
    ...(updates.icon !== undefined
      ? { icon: (await resolveMediaUrl(updates.icon, 'achievements/icons')) || updates.icon }
      : {}),
    ...(updates.images !== undefined
      ? { images: (await resolveMediaUrls(updates.images, 'achievements/images')) || updates.images }
      : {}),
  }
  const { data, error } = await supabase
    .from('achievements')
    .update(achievementToRow({ ...previous, ...storedUpdates }))
    .eq('id', id)
    .select(ACHIEVEMENT_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToAchievement(data as AchievementRow)
}

export async function deleteAchievementRecord(id: string): Promise<void> {
  const { error } = await supabase.from('achievements').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
