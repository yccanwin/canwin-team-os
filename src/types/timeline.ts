// ============================================================
// CanWin Team OS — 编年史 Timeline 类型定义
// ============================================================

export interface TimelineEvent {
  id: string
  title: string                    // ≤50字
  date: string                    // YYYY-MM 或 YYYY-MM-DD
  description?: string            // ≤500字，支持Markdown
  images: string[]               // Supabase Storage URL，最多9张
  attachments: {
    name: string
    url: string                  // Supabase Storage URL
    size: number
    type: string
  }[]
  participants: string[]          // userId数组
  category: 'milestone' | 'achievement' | 'team' | 'business' | 'other'
  createdBy: string
  createdAt: string
  updatedAt?: string
}

export const CATEGORY_CONFIG = {
  milestone:    { label: '里程碑', icon: '🚩', color: '#6366F1', bg: 'bg-indigo-100',  text: 'text-indigo-700' },
  achievement:  { label: '成就',   icon: '🏆', color: '#F59E0B', bg: 'bg-amber-100',   text: 'text-amber-700' },
  team:         { label: '团队',   icon: '👥', color: '#10B981', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  business:     { label: '业务',   icon: '💼', color: '#3B82F6', bg: 'bg-blue-100',    text: 'text-blue-700' },
  other:        { label: '其他',   icon: '📌', color: '#6B7280', bg: 'bg-gray-100',    text: 'text-brand-400' },
} as const
