// ============================================================
// CanWin Team OS V2 — 案例馆类型定义
// ============================================================

export interface Achievement {
  id: string;
  name: string;
  icon: string;           // Supabase Storage URL
  description: string;    // ≤100字
  achievedDate: string;   // YYYY-MM-DD
  timelineEventId?: string;
  images: string[];       // Supabase Storage URL 数组，最多3张
  category: 'chain' | 'big-meal' | 'small-meal' | 'other';
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}
