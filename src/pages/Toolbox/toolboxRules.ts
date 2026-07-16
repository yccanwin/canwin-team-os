import type { User } from '@/types'
import type { ToolCategoryItem, ToolItem } from '@/types/toolbox'

export function canManageTool(user: User | null | undefined, tool: ToolItem): boolean {
  return Boolean(user && (user.role === 'admin' || user.id === tool.creatorId))
}

export function canEditCategory(category: ToolCategoryItem): boolean {
  return !category.isSystem && category.code !== 'all'
}

export function validateCategoryDeletion(
  category: ToolCategoryItem,
  moveToCategoryId?: string
): string | null {
  if (!canEditCategory(category)) return '系统分类“全部”不能修改或删除'
  if (category.toolCount > 0 && !moveToCategoryId) return '该分类已有工具，请先选择迁移目标分类'
  if (moveToCategoryId === category.id) return '迁移目标不能是当前分类'
  return null
}
