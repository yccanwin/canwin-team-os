import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { Goal } from '@/types'

type GoalRow = {
  id: string
  title: string
  description: string | null
  target_amount: number | null
  current_amount: number | null
  deadline: string | null
  status: Goal['status']
}

const GOAL_SELECT =
  'id, title, description, target_amount, current_amount, deadline, status'

type GoalMeta = Pick<Goal, 'priority' | 'estimatedMonths' | 'monthlyGrowth' | 'icon'>

function parseMeta(description: string | null): Partial<GoalMeta> {
  if (!description) return {}
  try {
    const parsed = JSON.parse(description) as Partial<GoalMeta>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function rowToGoal(row: GoalRow): Goal {
  const meta = parseMeta(row.description)
  return {
    id: row.id,
    title: row.title,
    targetAmount: Number(row.target_amount ?? 0),
    currentAmount: Number(row.current_amount ?? 0),
    priority: meta.priority ?? 3,
    status: row.status,
    estimatedMonths: meta.estimatedMonths,
    monthlyGrowth: meta.monthlyGrowth,
    icon: meta.icon,
    deadline: row.deadline || undefined,
  }
}

function goalToRow(goal: Omit<Goal, 'id'> | Partial<Goal>, description?: string | null) {
  const hasMetaUpdate =
    goal.priority !== undefined ||
    goal.estimatedMonths !== undefined ||
    goal.monthlyGrowth !== undefined ||
    goal.icon !== undefined
  const nextMeta = hasMetaUpdate
    ? {
        ...parseMeta(description ?? null),
        ...(goal.priority !== undefined ? { priority: goal.priority } : {}),
        ...(goal.estimatedMonths !== undefined ? { estimatedMonths: goal.estimatedMonths } : {}),
        ...(goal.monthlyGrowth !== undefined ? { monthlyGrowth: goal.monthlyGrowth } : {}),
        ...(goal.icon !== undefined ? { icon: goal.icon } : {}),
      }
    : undefined

  return {
    title: goal.title,
    description: nextMeta ? JSON.stringify(nextMeta) : undefined,
    target_amount: goal.targetAmount,
    current_amount: goal.currentAmount,
    deadline: goal.deadline,
    status: goal.status,
  }
}

export async function loadGoals(): Promise<Goal[]> {
  const { data, error } = await supabase
    .from('team_goals')
    .select(GOAL_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? [])
    .map((row) => rowToGoal(row as GoalRow))
    .sort((a, b) => b.priority - a.priority)
}

export async function createGoalRecord(goal: Omit<Goal, 'id'>): Promise<Goal> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)

  const { data, error } = await supabase
    .from('team_goals')
    .insert({
      ...goalToRow(goal, null),
      team_id: CANWIN_TEAM_ID,
      created_by: userData.user.id,
    })
    .select(GOAL_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToGoal(data as GoalRow)
}

export async function updateGoalRecord(id: string, updates: Partial<Goal>): Promise<Goal> {
  let description: string | null = null
  if (
    updates.priority !== undefined ||
    updates.estimatedMonths !== undefined ||
    updates.monthlyGrowth !== undefined ||
    updates.icon !== undefined
  ) {
    const { data, error } = await supabase
      .from('team_goals')
      .select('description')
      .eq('id', id)
      .single()
    if (error) throw new Error(error.message)
    description = data.description
  }

  const { data, error } = await supabase
    .from('team_goals')
    .update(goalToRow(updates, description))
    .eq('id', id)
    .select(GOAL_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToGoal(data as GoalRow)
}

export async function deleteGoalRecord(id: string): Promise<void> {
  const { error } = await supabase.from('team_goals').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
