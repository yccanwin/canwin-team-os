import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import { writeAuditLog } from '@/services/auditLogs'
import { resolveMediaUrl } from '@/services/storage'
import type { PersonalGoal, PersonalGoalUpdate } from '@/types'

type PersonalGoalRow = {
  id: string
  user_id: string
  title: string
  description: string | null
  goal_type: string | null
  target_amount: number | string | null
  deadline: string | null
  visibility: PersonalGoal['visibility']
  lock_status: PersonalGoal['lockStatus']
  locked_at: string | null
  unlock_at: string | null
  created_at: string
}

type GoalUpdateRow = {
  id: string
  goal_id: string
  content: string
  amount_delta: number | string | null
  image_url: string | null
  created_by: string | null
  created_at: string
}

const PERSONAL_GOAL_SELECT =
  'id, user_id, title, description, goal_type, target_amount, deadline, visibility, lock_status, locked_at, unlock_at, created_at'

const GOAL_UPDATE_SELECT =
  'id, goal_id, content, amount_delta, image_url, created_by, created_at'

function goalRowForAudit(row: PersonalGoalRow): Record<string, unknown> {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    description: row.description,
    goal_type: row.goal_type,
    target_amount: row.target_amount,
    deadline: row.deadline,
    visibility: row.visibility,
    lock_status: row.lock_status,
    locked_at: row.locked_at,
    unlock_at: row.unlock_at,
    created_at: row.created_at,
  }
}

function isPastCooldown(row: Pick<PersonalGoalRow, 'created_at' | 'lock_status'>) {
  if (row.lock_status !== 'cooldown') return false
  return Date.now() - new Date(row.created_at).getTime() >= 24 * 60 * 60 * 1000
}

function rowToUpdate(row: GoalUpdateRow): PersonalGoalUpdate {
  return {
    id: row.id,
    content: row.content,
    amountDelta: row.amount_delta == null ? undefined : Number(row.amount_delta),
    imageUrl: row.image_url || undefined,
    createdBy: row.created_by || '',
    createdAt: row.created_at,
  }
}

function rowToGoal(row: PersonalGoalRow, updates: PersonalGoalUpdate[]): PersonalGoal {
  const lockStatus = isPastCooldown(row) ? 'locked' : row.lock_status
  const currentAmount = updates.reduce((sum, update) => sum + (update.amountDelta ?? 0), 0)

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description || undefined,
    goalType: row.goal_type || undefined,
    targetAmount: row.target_amount == null ? undefined : Number(row.target_amount),
    currentAmount,
    deadline: row.deadline || undefined,
    visibility: row.visibility,
    lockStatus,
    lockedAt: row.locked_at || undefined,
    unlockAt: row.unlock_at || undefined,
    createdAt: row.created_at,
    updates,
  }
}

function goalToRow(goal: Omit<PersonalGoal, 'id' | 'createdAt' | 'updates' | 'currentAmount'> | Partial<PersonalGoal>) {
  return {
    title: goal.title,
    description: goal.description,
    goal_type: goal.goalType,
    target_amount: goal.targetAmount,
    deadline: goal.deadline,
    visibility: goal.visibility,
    lock_status: goal.lockStatus,
    locked_at: goal.lockedAt,
    unlock_at: goal.unlockAt,
  }
}

export async function loadPersonalGoals(): Promise<PersonalGoal[]> {
  const { data: goals, error } = await supabase
    .from('personal_goals')
    .select(PERSONAL_GOAL_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  const goalRows = (goals ?? []) as PersonalGoalRow[]
  if (goalRows.length === 0) return []

  const { data: updates, error: updatesError } = await supabase
    .from('goal_updates')
    .select(GOAL_UPDATE_SELECT)
    .eq('goal_type', 'personal')
    .in('goal_id', goalRows.map((goal) => goal.id))
    .order('created_at', { ascending: true })

  if (updatesError) throw new Error(updatesError.message)

  const updatesByGoal = new Map<string, PersonalGoalUpdate[]>()
  ;((updates ?? []) as GoalUpdateRow[]).forEach((row) => {
    const list = updatesByGoal.get(row.goal_id) ?? []
    list.push(rowToUpdate(row))
    updatesByGoal.set(row.goal_id, list)
  })

  return goalRows.map((goal) => rowToGoal(goal, updatesByGoal.get(goal.id) ?? []))
}

export async function createPersonalGoalRecord(
  goal: Omit<PersonalGoal, 'id' | 'createdAt' | 'updates' | 'currentAmount'>
): Promise<PersonalGoal> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)

  const { data, error } = await supabase
    .from('personal_goals')
    .insert({
      ...goalToRow({ ...goal, lockStatus: 'cooldown' }),
      team_id: CANWIN_TEAM_ID,
      user_id: goal.userId,
      created_by: userData.user.id,
    })
    .select(PERSONAL_GOAL_SELECT)
    .single()

  if (error) throw new Error(error.message)
  const savedRow = data as PersonalGoalRow
  await writeAuditLog({
    action: 'create',
    targetType: 'personal_goals',
    targetId: savedRow.id,
    afterData: goalRowForAudit(savedRow),
  })

  return rowToGoal(savedRow, [])
}

export async function updatePersonalGoalRecord(id: string, updates: Partial<PersonalGoal>): Promise<PersonalGoal> {
  const { data: before, error: beforeError } = await supabase
    .from('personal_goals')
    .select(PERSONAL_GOAL_SELECT)
    .eq('id', id)
    .single()

  if (beforeError) throw new Error(beforeError.message)

  const { data, error } = await supabase
    .from('personal_goals')
    .update(goalToRow(updates))
    .eq('id', id)
    .select(PERSONAL_GOAL_SELECT)
    .single()

  if (error) throw new Error(error.message)
  const savedRow = data as PersonalGoalRow
  await writeAuditLog({
    action: 'update',
    targetType: 'personal_goals',
    targetId: id,
    beforeData: goalRowForAudit(before as PersonalGoalRow),
    afterData: goalRowForAudit(savedRow),
  })

  return rowToGoal(savedRow, [])
}

export async function unlockPersonalGoalRecord(id: string): Promise<PersonalGoal> {
  const { data: before, error: beforeError } = await supabase
    .from('personal_goals')
    .select(PERSONAL_GOAL_SELECT)
    .eq('id', id)
    .single()

  if (beforeError) throw new Error(beforeError.message)

  const unlockedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('personal_goals')
    .update({
      lock_status: 'unlocked',
      locked_at: null,
      unlock_at: unlockedAt,
    })
    .eq('id', id)
    .select(PERSONAL_GOAL_SELECT)
    .single()

  if (error) throw new Error(error.message)
  const savedRow = data as PersonalGoalRow
  await writeAuditLog({
    action: 'unlock',
    targetType: 'personal_goals',
    targetId: id,
    beforeData: goalRowForAudit(before as PersonalGoalRow),
    afterData: goalRowForAudit(savedRow),
  })

  return rowToGoal(savedRow, [])
}

export async function addPersonalGoalUpdateRecord(
  goalId: string,
  update: Pick<PersonalGoalUpdate, 'content' | 'amountDelta' | 'imageUrl'>
): Promise<PersonalGoalUpdate> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)
  if (!userData.user) throw new Error('未登录，无法写入目标进展')

  const imageUrl = await resolveMediaUrl(update.imageUrl, 'personal-goals/updates')

  const { data, error } = await supabase
    .from('goal_updates')
    .insert({
      goal_type: 'personal',
      goal_id: goalId,
      content: update.content,
      amount_delta: update.amountDelta,
      image_url: imageUrl,
      created_by: userData.user.id,
    })
    .select(GOAL_UPDATE_SELECT)
    .single()

  if (error) throw new Error(error.message)
  const savedRow = data as GoalUpdateRow
  await writeAuditLog({
    action: 'create',
    targetType: 'goal_updates',
    targetId: savedRow.id,
    afterData: {
      id: savedRow.id,
      goal_id: savedRow.goal_id,
      goal_type: 'personal',
      amount_delta: savedRow.amount_delta,
      image_url: savedRow.image_url,
      created_by: savedRow.created_by,
      created_at: savedRow.created_at,
    },
  })

  return rowToUpdate(savedRow)
}
