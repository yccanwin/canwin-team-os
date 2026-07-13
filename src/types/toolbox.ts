// ============================================================
// 工具箱 — 员工之间分享小工具/小技能（链接形式）
// ============================================================

export type ToolCategory = 'efficiency' | 'design' | 'dev' | 'marketing' | 'other'

export const TOOL_CATEGORIES: { value: ToolCategory; label: string }[] = [
  { value: 'efficiency', label: '效率工具' },
  { value: 'design', label: '设计资源' },
  { value: 'dev', label: '开发利器' },
  { value: 'marketing', label: '营销运营' },
  { value: 'other', label: '其他' },
]

export interface ToolItem {
  id: string
  title: string
  description: string
  url: string              // 链接地址
  category: ToolCategory
  creatorId: string
  creatorName: string
  likedBy: string[]        // 点赞用户 ID 列表，防重复点赞
  createdAt: string        // ISO 格式
}
