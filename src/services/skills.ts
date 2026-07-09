import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { Skill, UserSkill } from '@/types'

type SkillRow = {
  id: string
  name: string
  category: Skill['category']
  level: Skill['level']
  description: string | null
  learning_url: string | null
  prerequisite_ids: string[] | null
  created_by: string | null
  created_at: string
}

type UserSkillRow = {
  id: string
  user_id: string
  skill_id: string
  note: string | null
  lit_at: string
}

const SKILL_SELECT =
  'id, name, category, level, description, learning_url, prerequisite_ids, created_by, created_at'
const USER_SKILL_SELECT = 'id, user_id, skill_id, note, lit_at'

function rowToSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    category: row.category || 'other',
    level: row.level || 'basic',
    description: row.description || undefined,
    learningUrl: row.learning_url || undefined,
    prerequisiteIds: row.prerequisite_ids ?? [],
    createdBy: row.created_by || '',
    createdAt: row.created_at,
  }
}

function rowToUserSkill(row: UserSkillRow): UserSkill {
  return {
    id: row.id,
    userId: row.user_id,
    skillId: row.skill_id,
    note: row.note || undefined,
    litAt: row.lit_at,
  }
}

export async function loadSkills(): Promise<Skill[]> {
  const { data, error } = await supabase
    .from('skills')
    .select(SKILL_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('created_at', { ascending: true })

  if (error) {
    console.warn('skills table is not available yet:', error.message)
    return []
  }

  return (data ?? []).map((row) => rowToSkill(row as SkillRow))
}

export async function loadUserSkills(): Promise<UserSkill[]> {
  const { data, error } = await supabase
    .from('user_skills')
    .select(USER_SKILL_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('lit_at', { ascending: false })

  if (error) {
    console.warn('user_skills table is not available yet:', error.message)
    return []
  }

  return (data ?? []).map((row) => rowToUserSkill(row as UserSkillRow))
}

export async function createSkillRecord(skill: Omit<Skill, 'id' | 'createdAt'>): Promise<Skill> {
  const { data, error } = await supabase
    .from('skills')
    .insert({
      team_id: CANWIN_TEAM_ID,
      name: skill.name,
      category: skill.category,
      level: skill.level,
      description: skill.description,
      learning_url: skill.learningUrl,
      prerequisite_ids: skill.prerequisiteIds,
      created_by: skill.createdBy,
    })
    .select(SKILL_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToSkill(data as SkillRow)
}

export async function lightSkillRecord(
  skillId: string,
  userId: string,
  note?: string
): Promise<UserSkill> {
  const { data, error } = await supabase
    .from('user_skills')
    .insert({
      team_id: CANWIN_TEAM_ID,
      skill_id: skillId,
      user_id: userId,
      note,
    })
    .select(USER_SKILL_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToUserSkill(data as UserSkillRow)
}

export async function unlightSkillRecord(id: string): Promise<void> {
  const { error } = await supabase.from('user_skills').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
