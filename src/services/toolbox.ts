import { supabase } from '@/lib/supabase'
import type { ToolCategory, ToolCategoryItem, ToolDraft, ToolItem } from '@/types/toolbox'

type ToolRow = {
  id: string
  title: string
  url: string
  description: string | null
  category: ToolCategory | null
  created_by: string | null
  created_at: string
  can_manage?: boolean
}

type ToolboxToolRow = {
  id: string
  title: string
  url: string
  description: string | null
  category: ToolCategory | null
  created_by: string | null
  created_at: string
  can_manage: boolean
}

type ToolMeta = Pick<ToolItem, 'description' | 'creatorName' | 'likedBy'>

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
    canManage: row.can_manage ?? false,
  }
}

function singleRpcRow<T>(data: T | T[] | null): T {
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('服务器未返回工具数据')
  return row
}

export async function loadTools(): Promise<ToolItem[]> {
  const { data, error } = await supabase.rpc('toolbox_list_tools')

  if (error) throw new Error(error.message)
  return (data ?? []).map((row: ToolboxToolRow) => rowToTool(row))
}

export async function createToolRecord(tool: ToolDraft): Promise<ToolItem> {
  const { data, error } = await supabase.rpc('toolbox_create_tool', {
    p_title: tool.title,
    p_url: tool.url,
    p_description: tool.description,
    p_category_code: tool.category,
  })

  if (error) throw new Error(error.message)
  return rowToTool(singleRpcRow(data) as ToolRow)
}

export async function updateToolRecord(toolId: string, patch: ToolDraft): Promise<ToolItem> {
  const { data, error } = await supabase.rpc('toolbox_update_tool', {
    p_tool_id: toolId,
    p_title: patch.title,
    p_url: patch.url,
    p_description: patch.description,
    p_category_code: patch.category,
  })

  if (error) throw new Error(error.message)
  return rowToTool(singleRpcRow(data) as ToolRow)
}

export async function deleteToolRecord(id: string): Promise<void> {
  const { error } = await supabase.rpc('toolbox_delete_tool', { p_tool_id: id })
  if (error) throw new Error(error.message)
}

export async function toggleToolLikeRecord(toolId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('toolbox_toggle_tool_like', { p_tool_id: toolId })
  if (error) throw new Error(error.message)
  return Boolean(data)
}

type CategoryRow = {
  id: string
  code: string
  name: string
  sort_order: number
  is_system: boolean
  tool_count: number | string
}

function rowToCategory(row: CategoryRow): ToolCategoryItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    sortOrder: Number(row.sort_order),
    isSystem: row.is_system,
    toolCount: Number(row.tool_count),
  }
}

export async function loadToolCategories(): Promise<ToolCategoryItem[]> {
  const { data, error } = await supabase.rpc('toolbox_list_categories')
  if (error) throw new Error(error.message)
  return ((data ?? []) as CategoryRow[]).map(rowToCategory)
}

export async function createToolCategory(name: string): Promise<void> {
  const { error } = await supabase.rpc('toolbox_create_category', { p_name: name })
  if (error) throw new Error(error.message)
}

export async function updateToolCategory(categoryId: string, name: string, sortOrder: number): Promise<void> {
  const { error } = await supabase.rpc('toolbox_update_category', {
    p_category_id: categoryId,
    p_name: name,
    p_sort_order: sortOrder,
  })
  if (error) throw new Error(error.message)
}

export async function reorderToolCategories(categoryIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('toolbox_reorder_categories', { p_category_ids: categoryIds })
  if (error) throw new Error(error.message)
}

export async function deleteToolCategory(categoryId: string, moveToCategoryId: string | null): Promise<void> {
  const { error } = await supabase.rpc('toolbox_delete_category', {
    p_category_id: categoryId,
    p_move_to_category_id: moveToCategoryId,
  })
  if (error) throw new Error(error.message)
}
