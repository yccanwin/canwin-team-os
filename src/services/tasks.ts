import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { Task } from '@/types'
import { writeAuditLog } from '@/services/auditLogs'

type TaskRow = {
  id: string
  title: string
  type: Task['type']
  assignee_id: string | null
  status: Task['status']
  created_at: string
  completed_at: string | null
  deadline: string | null
  description: string | null
  is_important: boolean | null
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    assigneeId: row.assignee_id || '',
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at || undefined,
    deadline: row.deadline || undefined,
    description: row.description || undefined,
    isImportant: row.is_important || undefined,
  }
}

function taskToRow(task: Omit<Task, 'id'> | Partial<Task>) {
  return {
    title: task.title,
    type: task.type,
    assignee_id: task.assigneeId,
    status: task.status,
    completed_at: task.completedAt,
    deadline: task.deadline,
    description: task.description,
    is_important: task.isImportant ?? false,
  }
}

export async function loadTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, type, assignee_id, status, created_at, completed_at, deadline, description, is_important')
    .eq('team_id', CANWIN_TEAM_ID)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => rowToTask(row as TaskRow))
}

export async function createTask(task: Omit<Task, 'id'>): Promise<Task> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      ...taskToRow(task),
      team_id: CANWIN_TEAM_ID,
      created_by: userData.user.id,
    })
    .select('id, title, type, assignee_id, status, created_at, completed_at, deadline, description, is_important')
    .single()

  if (error) throw new Error(error.message)
  await writeAuditLog({
    action: 'create',
    targetType: 'tasks',
    targetId: data.id,
    afterData: data as Record<string, unknown>,
  })
  return rowToTask(data as TaskRow)
}

export async function updateTaskRecord(id: string, updates: Partial<Task>): Promise<Task> {
  const { data: before, error: beforeError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single()
  if (beforeError) throw new Error(beforeError.message)

  const { data, error } = await supabase
    .from('tasks')
    .update(taskToRow(updates))
    .eq('id', id)
    .select('id, title, type, assignee_id, status, created_at, completed_at, deadline, description, is_important')
    .single()

  if (error) throw new Error(error.message)
  await writeAuditLog({
    action: updates.status !== undefined ? 'status_change' : 'update',
    targetType: 'tasks',
    targetId: id,
    beforeData: before as Record<string, unknown>,
    afterData: data as Record<string, unknown>,
  })
  return rowToTask(data as TaskRow)
}

export async function deleteTaskRecord(id: string): Promise<void> {
  const { data: before, error: beforeError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single()
  if (beforeError) throw new Error(beforeError.message)

  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw new Error(error.message)
  await writeAuditLog({
    action: 'delete',
    targetType: 'tasks',
    targetId: id,
    beforeData: before as Record<string, unknown>,
  })
}
