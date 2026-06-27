// ============================================================
// CanWin Team OS V2 — 相册类型定义
// ============================================================

export interface Photo {
  id: string;
  url: string;            // base64 图片
  title?: string;
  date: string;           // YYYY-MM-DD
  location?: string;
  description?: string;
  participants: string[]; // userId 数组
  uploadedBy: string;
  uploadedAt: string;
  year: number;
  month: number;
}
