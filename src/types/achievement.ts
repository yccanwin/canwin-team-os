// ============================================================
// CanWin Team OS V2 — 案例馆类型定义
// ============================================================

export interface Achievement {
  id: string;
  name: string;
  icon: string;           // base64 logo 图片
  description: string;    // ≤100字
  achievedDate: string;   // YYYY-MM-DD
  timelineEventId?: string;
  images: string[];       // base64 图片数组，最多3张
  category: 'chain' | 'big-meal' | 'small-meal' | 'other';
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}
