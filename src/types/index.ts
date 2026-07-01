// ============================================================
// CanWin Team OS — 全局类型定义
// 这是整个项目的类型契约，所有 Store 和组件必须遵守
// ============================================================

// ---------- 用户 ----------
export interface User {
  id: string;
  name: string;
  role: 'admin' | 'captain' | 'finance' | 'warehouse' | 'member';
  avatar?: string;
  position: string;
  joinDate: string;       // ISO 格式
  badges: string[];       // 团队记忆标签 ID 列表

  // ---- 个人自定义资料（全员可见） ----
  restDays?: string[];    // 每周休息日，如 ["周一","周三"]
  mood?: string;          // 最近心情
  taboos?: string;        // 个人忌讳
}

// ---------- 任务 ----------
export interface Task {
  id: string;
  title: string;
  type: 'sales' | 'operation' | 'purchase' | 'other';
  assigneeId: string;
  status: 'todo' | 'in_progress' | 'done';
  createdAt: string;
  completedAt?: string;
  deadline?: string;
  description?: string;
  isImportant?: boolean;
}

// ---------- 财务记录 ----------
export interface FinanceRecord {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  date: string;           // YYYY-MM-DD
  category: string;
  note?: string;
  createdBy: string;      // 录入人
  userId?: string;         // 归属成员（工资/分红时必填）
}

// ---------- 目标 ----------
export interface Goal {
  id: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  priority: number;       // 1-5
  status: 'enabled' | 'in_progress' | 'completed' | 'locked';
  estimatedMonths?: number;
  monthlyGrowth?: number;
  icon?: string;
  deadline?: string;
}

export interface PersonalGoalUpdate {
  id: string;
  content: string;
  amountDelta?: number;
  imageUrl?: string;
  createdBy: string;
  createdAt: string;
}

export interface PersonalGoal {
  id: string;
  userId: string;
  title: string;
  description?: string;
  goalType?: string;
  targetAmount?: number;
  currentAmount: number;
  deadline?: string;
  visibility: 'team' | 'private';
  lockStatus: 'cooldown' | 'locked' | 'review' | 'unlocked';
  lockedAt?: string;
  unlockAt?: string;
  createdAt: string;
  updates: PersonalGoalUpdate[];
}

// ---------- 投票 ----------
export interface VoteOption {
  id: string;
  label: string;
}

export interface VoteRecord {
  userId: string;
  optionId: string;
  votedAt: string;
}

export interface Vote {
  id: string;
  title: string;
  options: VoteOption[];
  deadline: string;
  createdBy: string;
  votes: VoteRecord[];
  isActive: boolean;
}

// ---------- 勋章配置 ----------
export interface BadgeConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  triggerType: 'task_count' | 'login_streak' | 'metric' | 'custom';
  triggerParams: Record<string, any>;
  memoryWeight: number;
  category: 'basic' | 'business' | 'behavior';
}

// ---------- 库存 ----------
export interface InventoryItem {
  id: string;
  name: string;
  sku?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lastUpdated: string;
}

// ---------- 编年史 ----------
export * from './timeline'

// ---------- V2 文化层 ----------
export * from './achievement'
export * from './photo'
export * from './asset'

// ---------- 库存日志 ----------
export interface InventoryLog {
  id: string;
  itemId: string;
  itemName: string;
  operation: 'in' | 'out';
  quantityChange: number;
  operatorId: string;
  createdAt: string;
  /** 关联的财务记录ID，删除日志时可联动清除 */
  financeId?: string;
}
