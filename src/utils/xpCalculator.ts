/**
 * CanWin Team OS — XP / 等级计算器
 *
 * 整个游戏化系统的核心引擎。所有 XP 增减、等级判断、进度计算
 * 都通过此模块完成，确保等级体系在全局范围内一致。
 *
 * 升级阈值表（累计XP，递增式）：
 *   Lv.1:      0    起始
 *   Lv.2:     50   (+50)
 *   Lv.3:    130   (+80)
 *   Lv.4:    230   (+100)
 *   Lv.5:    350   (+120)
 *   Lv.6:    500   (+150)
 *   Lv.7:    680   (+180)
 *   Lv.8:    900   (+220)
 *   Lv.9:   1160   (+260)
 *   Lv.10:   1460  (+300) — 满级
 */

import { useUserStore } from '@/stores/useUserStore'
import { useActivityStore } from '@/stores/useActivityStore'
import { checkBadges } from '@/utils/badgeChecker'

// ============================================================
// 升级阈值表
// ============================================================
export const LEVEL_THRESHOLDS: readonly number[] = [
  0,      // Lv.1  起始
  50,     // Lv.1 → Lv.2   需50XP（累计50）
  130,    // Lv.2 → Lv.3   需80XP（累计130）
  230,    // Lv.3 → Lv.4   需100XP（累计230）
  350,    // Lv.4 → Lv.5   需120XP（累计350）
  500,    // Lv.5 → Lv.6   需150XP（累计500）
  680,    // Lv.6 → Lv.7   需180XP（累计680）
  900,    // Lv.7 → Lv.8   需220XP（累计900）
  1160,   // Lv.8 → Lv.9   需260XP（累计1160）
  1460,   // Lv.9 → Lv.10  需300XP（累计1460）— 满级
] as const

// ============================================================
// XP 奖励常量
// ============================================================
export const XP_REWARDS = {
  TASK_COMPLETE: 10,       // 普通任务完成
  TASK_IMPORTANT: 30,      // 重要任务完成
  GOAL_COMPLETE: 200,
  VOTE_PARTICIPATE: 10,
  STREAK_LOGIN: 5,
  DAILY_FIRST_TASK: 20,
} as const

// ============================================================
// 活动日志工具（统一通过 useActivityStore 写入）
// ============================================================

function addActivity(
  userId: string,
  content: string,
  type: 'badge_earned' | 'task_completed' | 'announcement',
  metadata?: Record<string, unknown>
): void {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  useActivityStore.getState().addLog({
    userId,
    type,
    content,
    createdAt: new Date().toISOString(),
    expiresAt,
    metadata,
  })
}

// ============================================================
// 纯计算函数
// ============================================================

/**
 * 根据累计 XP 返回当前等级（1-10）
 *
 * 从高到低遍历阈值表，找到第一个满足 xp >= 阈值的位置。
 *
 * @example getLevel(45)  → 1   // 还没到100
 * @example getLevel(100) → 2   // 刚好到阈值
 * @example getLevel(500) → 4   // 达到Lv.4阈值
 */
export function getLevel(xp: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i]) {
      return i + 1
    }
  }
  return 1
}

/**
 * 返回升到该等级所需的总累计 XP
 *
 * @example getXPForLevel(5) → 1000  // Lv.5 阈值
 * @example getXPForLevel(1) → 0
 */
export function getXPForLevel(level: number): number {
  if (level < 1 || level > LEVEL_THRESHOLDS.length) return LEVEL_THRESHOLDS[0]
  return LEVEL_THRESHOLDS[level - 1]
}

/**
 * 返回当前等级内的经验进度
 *
 * @example getXPProgress(280)
 *   → { current: 30, next: 250, percent: 12 }
 *   （280 在 250~500 之间，当前=280-250=30，本等级需=250，进度 30/250=12%）
 */
export function getXPProgress(xp: number): {
  current: number
  next: number
  percent: number
} {
  const level = getLevel(xp)

  // 满级
  if (level >= LEVEL_THRESHOLDS.length) {
    return { current: xp, next: xp, percent: 100 }
  }

  const levelBase = LEVEL_THRESHOLDS[level - 1]
  const nextBase = LEVEL_THRESHOLDS[level]
  const current = xp - levelBase
  const next = nextBase - levelBase
  const percent = next > 0 ? Math.round((current / next) * 100) : 100

  return { current, next, percent }
}

/**
 * 返回升到下一级还需多少 XP（满级返回 0）
 *
 * @example getNextLevelXP(2) → 150  // Lv.2→Lv.3 需 250-100=150
 * @example getNextLevelXP(10) → 0   // 满级
 */
export function getNextLevelXP(currentLevel: number): number {
  if (currentLevel >= LEVEL_THRESHOLDS.length) return 0
  return LEVEL_THRESHOLDS[currentLevel] - LEVEL_THRESHOLDS[currentLevel - 1]
}

// ============================================================
// 带副作用的操作函数
// ============================================================

/**
 * 给用户增加 XP，自动检测升级 + 记录团队动态 + 检查勋章。
 *
 * 直接通过 useUserStore.getState() 访问 Store，
 * 因此可在组件外（如 badgeChecker 等工具函数中）安全调用。
 *
 * @param userId  - 目标用户 ID
 * @param amount  - XP 增加量
 * @param reason  - 为何增加（用于日志）
 *
 * @example
 * addXP('u-001', 50, '完成销售任务')
 */
export function addXP(userId: string, amount: number, reason: string): void {
  const store = useUserStore.getState()
  const user = store.users.find((u) => u.id === userId)
  if (!user || amount <= 0) return

  const oldLevel = getLevel(user.xp)
  const newXP = user.xp + amount
  const newLevel = getLevel(newXP)

  // 更新 Store
  useUserStore.setState((state) => ({
    users: state.users.map((u) =>
      u.id === userId ? { ...u, xp: newXP, level: newLevel } : u
    ),
    currentUser:
      state.currentUser.id === userId
        ? { ...state.currentUser, xp: newXP, level: newLevel }
        : state.currentUser,
  }))

  // 记录动态
  addActivity(userId, `${user.name} 获得 +${amount} XP（${reason}）`, 'announcement')

  // 检测升级，记录团队动态
  if (newLevel > oldLevel) {
    for (let lv = oldLevel + 1; lv <= newLevel; lv++) {
      addActivity(
        userId,
        `${user.name} 升至 Lv.${lv}！`,
        'announcement',
        { levelUp: true, from: oldLevel, to: newLevel }
      )
    }
  }

  // 检查 XP 里程碑勋章
  const newBadges = checkBadges(userId, 'XP_REACH', newXP)
  newBadges.forEach((badge) => {
    store.addBadge(userId, badge.id)
    addActivity(userId, `${user.name} 获得勋章「${badge.name}」`, 'badge_earned')
  })
}
