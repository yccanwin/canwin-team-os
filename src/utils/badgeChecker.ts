/**
 * CanWin Team OS — 勋章检查器
 *
 * 硬编码勋章数据 + 触发条件判断。所有勋章逻辑集中于此，
 * 被 xpCalculator、App 入口、任务/投票页面调用。
 *
 * 支持的 triggerType：
 *   - TASK_COUNT：  完成任务数 ≥ threshold
 *   - GOAL_COUNT：  完成目标数 ≥ threshold
 *   - XP_REACH：   经验值达到 milestone
 *   - STREAK_DAYS： 连续登录天数 ≥ threshold
 */

import { useUserStore } from '@/stores/useUserStore'
import { useBadgeStore } from '@/stores/useBadgeStore'
import { useActivityStore } from '@/stores/useActivityStore'
import { useTaskStore } from '@/stores/useTaskStore'
import { useGoalStore } from '@/stores/useGoalStore'

// ============================================================
// 硬编码勋章类型
// ============================================================
type BadgeTriggerType = 'TASK_COUNT' | 'GOAL_COUNT' | 'XP_REACH' | 'STREAK_DAYS'

interface HardcodedBadge {
  id: string
  name: string
  icon: string
  description: string
  triggerType: BadgeTriggerType
  threshold: number
  xpReward: number
}

// ============================================================
// 勋章数据库（硬编码）
// ============================================================
const BADGE_DB: HardcodedBadge[] = [
  // ── TASK_COUNT ──
  {
    id: 'b-task-05',
    name: '初露锋芒',
    icon: '🌱',
    description: '完成 5 个任务',
    triggerType: 'TASK_COUNT',
    threshold: 5,
    xpReward: 30,
  },
  {
    id: 'b-task-10',
    name: '任务达人',
    icon: '⚡',
    description: '完成 10 个任务',
    triggerType: 'TASK_COUNT',
    threshold: 10,
    xpReward: 60,
  },
  {
    id: 'b-task-25',
    name: '劳模勋章',
    icon: '🔥',
    description: '完成 25 个任务',
    triggerType: 'TASK_COUNT',
    threshold: 25,
    xpReward: 120,
  },
  {
    id: 'b-task-50',
    name: '任务收割机',
    icon: '🏆',
    description: '完成 50 个任务',
    triggerType: 'TASK_COUNT',
    threshold: 50,
    xpReward: 250,
  },

  // ── GOAL_COUNT ──
  {
    id: 'b-goal-01',
    name: '小目标',
    icon: '🎯',
    description: '完成第 1 个目标',
    triggerType: 'GOAL_COUNT',
    threshold: 1,
    xpReward: 50,
  },
  {
    id: 'b-goal-03',
    name: '目标猎人',
    icon: '🏹',
    description: '完成 3 个目标',
    triggerType: 'GOAL_COUNT',
    threshold: 3,
    xpReward: 100,
  },
  {
    id: 'b-goal-05',
    name: '里程碑大师',
    icon: '🗺️',
    description: '完成 5 个目标',
    triggerType: 'GOAL_COUNT',
    threshold: 5,
    xpReward: 200,
  },
  {
    id: 'b-goal-10',
    name: '愿景实现者',
    icon: '🌟',
    description: '完成 10 个目标',
    triggerType: 'GOAL_COUNT',
    threshold: 10,
    xpReward: 400,
  },

  // ── XP_REACH ──
  {
    id: 'b-xp-500',
    name: '新手毕业',
    icon: '🎓',
    description: '累计获得 500 XP',
    triggerType: 'XP_REACH',
    threshold: 500,
    xpReward: 50,
  },
  {
    id: 'b-xp-2000',
    name: '进阶之路',
    icon: '📈',
    description: '累计获得 2000 XP',
    triggerType: 'XP_REACH',
    threshold: 2000,
    xpReward: 100,
  },
  {
    id: 'b-xp-8000',
    name: '大师风范',
    icon: '💎',
    description: '累计获得 8000 XP',
    triggerType: 'XP_REACH',
    threshold: 8000,
    xpReward: 300,
  },
  {
    id: 'b-xp-32000',
    name: '传奇巅峰',
    icon: '👑',
    description: '累计获得 32000 XP',
    triggerType: 'XP_REACH',
    threshold: 32000,
    xpReward: 1000,
  },

  // ── STREAK_DAYS ──
  {
    id: 'b-streak-03',
    name: '连续打卡',
    icon: '🔥',
    description: '连续登录 3 天',
    triggerType: 'STREAK_DAYS',
    threshold: 3,
    xpReward: 15,
  },
  {
    id: 'b-streak-07',
    name: '周常在线',
    icon: '📅',
    description: '连续登录 7 天',
    triggerType: 'STREAK_DAYS',
    threshold: 7,
    xpReward: 50,
  },
  {
    id: 'b-streak-14',
    name: '半月坚守',
    icon: '🛡️',
    description: '连续登录 14 天',
    triggerType: 'STREAK_DAYS',
    threshold: 14,
    xpReward: 100,
  },
  {
    id: 'b-streak-30',
    name: '全勤之星',
    icon: '⭐',
    description: '连续登录 30 天',
    triggerType: 'STREAK_DAYS',
    threshold: 30,
    xpReward: 300,
  },
]

// ============================================================
// 活动日志工具（统一通过 useActivityStore 写入）
// ============================================================

function addActivity(
  userId: string,
  content: string,
  type: 'badge_earned' | 'task_completed' | 'announcement'
): void {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  useActivityStore.getState().addLog({
    userId,
    type,
    content,
    createdAt: new Date().toISOString(),
    expiresAt,
  })
}

// ============================================================
// 核心检查函数
// ============================================================

/**
 * 检查用户是否触发新勋章。
 *
 * 根据 triggerType 和 value，遍历硬编码勋章数据库，
 * 返回用户尚未拥有的达标勋章。
 *
 * @param userId       - 目标用户 ID
 * @param triggerType  - 触发类型
 * @param value        - 当前值（任务数/目标数/XP/连续天数）
 * @returns 新解锁的勋章列表（已排除已拥有的）
 *
 * @example
 * // 用户完成第 5 个任务
 * checkBadges('u-001', 'TASK_COUNT', 5)
 * // → [{ id: 'b-task-05', name: '初露锋芒', ... }]
 */
export function checkBadges(
  userId: string,
  triggerType: BadgeTriggerType,
  value: number
): HardcodedBadge[] {
  const user = useUserStore.getState().users.find((u) => u.id === userId)
  if (!user) return []

  const ownedSet = new Set(user.badges)
  const newlyEarned: HardcodedBadge[] = []

  for (const badge of BADGE_DB) {
    // 只匹配当前 triggerType
    if (badge.triggerType !== triggerType) continue
    // 已拥有，跳过
    if (ownedSet.has(badge.id)) continue
    // 检查阈值
    if (value >= badge.threshold) {
      newlyEarned.push(badge)
      ownedSet.add(badge.id) // 防止同批次重复
    }
  }

  return newlyEarned
}

/**
 * 解锁勋章 — 写入用户数据 + 记录动态 + 加入展示队列。
 *
 * @param userId - 目标用户 ID
 * @param badge  - 要解锁的勋章
 */
export function unlockBadge(userId: string, badge: HardcodedBadge): void {
  // 1. 写入用户勋章列表
  const userStore = useUserStore.getState()
  userStore.addBadge(userId, badge.id)

  // 2. 记录团队动态
  const user = userStore.users.find((u) => u.id === userId)
  const name = user?.name ?? userId
  addActivity(userId, `${name} 获得勋章「${badge.name}」`, 'badge_earned')

  // 3. 加入展示队列（BadgeUnlockModal 消费）
  const badgeStore = useBadgeStore.getState()
  const pending = badgeStore.pendingBadges ?? []
  useBadgeStore.setState({ pendingBadges: [...pending, badge] })
}
