// 工具箱 — 员工之间分享实用工具（链接形式）

export type ToolCategory = string

export interface ToolCategoryItem {
  id: string
  code: string
  name: string
  sortOrder: number
  isSystem: boolean
  toolCount: number
}

/** 数据库分类尚未加载时的只读兜底；成功加载后以数据库配置为准。 */
export const TOOL_CATEGORIES: ToolCategoryItem[] = [
  { id: 'efficiency', code: 'efficiency', name: '效率工具', sortOrder: 10, isSystem: false, toolCount: 0 },
  { id: 'design', code: 'design', name: '设计资源', sortOrder: 20, isSystem: false, toolCount: 0 },
  { id: 'dev', code: 'dev', name: '开发利器', sortOrder: 30, isSystem: false, toolCount: 0 },
  { id: 'marketing', code: 'marketing', name: '营销运营', sortOrder: 40, isSystem: false, toolCount: 0 },
  { id: 'other', code: 'other', name: '其他', sortOrder: 50, isSystem: false, toolCount: 0 },
]

export interface ToolItem {
  id: string
  title: string
  description: string
  url: string
  category: ToolCategory
  creatorId: string
  creatorName: string
  likedBy: string[]
  createdAt: string
  /** 服务端按创建人、legacy admin、access owner/admin、access.manage 计算。 */
  canManage?: boolean
}

export interface ToolDraft {
  title: string
  description: string
  url: string
  category: ToolCategory
}
