import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { ToolCategory, ToolItem } from '@/types/toolbox'

type ToolRow = {
  id: string
  title: string
  url: string
  description: string | null
  category: ToolCategory | null
  created_by: string | null
  created_at: string
}

type ToolMeta = Pick<ToolItem, 'description' | 'creatorName' | 'likedBy'>

const TOOL_SELECT = 'id, title, url, description, category, created_by, created_at'

function parseMeta(description: string | null): Partial<ToolMeta> {
  if (!description) return {}
  try {
    const parsed = JSON.parse(description) as Partial<ToolMeta>
    return parsed && typeof parsed === 'object' ? parsed : { description }
  } catch {
    return { description }
  }
}

function rowToTool(row: ToolRow): ToolItem {
  const meta = parseMeta(row.description)
  return {
    id: row.id,
    title: row.title,
    description: meta.description || '',
    url: row.url,
    category: row.category ?? 'other',
    creatorId: row.created_by || '',
    creatorName: meta.creatorName || '',
    likedBy: meta.likedBy ?? [],
    createdAt: row.created_at,
  }
}

function toolToRow(tool: Pick<ToolItem, 'title' | 'description' | 'url' | 'category' | 'creatorName' | 'likedBy'>) {
  return {
    title: tool.title,
    url: tool.url,
    category: tool.category,
    description: JSON.stringify({
      description: tool.description,
      creatorName: tool.creatorName,
      likedBy: tool.likedBy,
    }),
  }
}

export async function loadTools(): Promise<ToolItem[]> {
  const { data, error } = await supabase
    .from('tools')
    .select(TOOL_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => rowToTool(row as ToolRow))
}

export async function createToolRecord(tool: Omit<ToolItem, 'id' | 'createdAt'>): Promise<ToolItem> {
  const { data, error } = await supabase
    .from('tools')
    .insert({
      ...toolToRow(tool),
      team_id: CANWIN_TEAM_ID,
      created_by: tool.creatorId,
    })
    .select(TOOL_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToTool(data as ToolRow)
}

export async function updateToolRecord(tool: ToolItem): Promise<ToolItem> {
  const { data, error } = await supabase
    .from('tools')
    .update(toolToRow(tool))
    .eq('id', tool.id)
    .select(TOOL_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToTool(data as ToolRow)
}

export async function deleteToolRecord(id: string): Promise<void> {
  const { error } = await supabase.from('tools').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
