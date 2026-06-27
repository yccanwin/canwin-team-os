// ============================================================
// CanWin Team OS V2 — 资产馆类型定义
// ============================================================

export type AssetCategory = 'vehicle' | 'equipment' | 'computer' | 'warehouse' | 'other';
export type AssetStatus = 'in_use' | 'idle' | 'disposed';

export interface Asset {
  id: string;
  name: string;
  category: AssetCategory;
  purchaseDate: string;   // YYYY-MM-DD
  amount: number;         // 购入金额（元）
  currentStatus: AssetStatus;
  description?: string;
  images: string[];       // base64 图片数组，最多3张
  location?: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}
