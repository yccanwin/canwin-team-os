/**
 * CanWin Team OS — 日期工具函数集
 *
 * 提供跨模块使用的日期格式化、范围计算、过期判断等纯函数。
 * 所有函数均无副作用，可安全用于任意组件和 Store 中。
 */

// ============================================================
// 内部辅助
// ============================================================

/** Date | string → Date（无效时返回 null） */
function toDate(input: Date | string): Date | null {
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input
  const d = new Date(input)
  return isNaN(d.getTime()) ? null : d
}

/** Date → YYYY-MM-DD */
function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ============================================================
// 公开方法
// ============================================================

/**
 * 返回 YYYY-MM-DD 格式
 *
 * @example formatDate(new Date(2026, 5, 24)) → "2026-06-24"
 * @example formatDate("2026-03-15") → "2026-03-15"
 */
export function formatDate(input: Date | string): string {
  const d = toDate(input)
  if (!d) return String(input)
  return toISODate(d)
}

/**
 * 返回相对时间描述
 *
 * @example formatRelative(now)                   → "刚刚"
 * @example formatRelative("3分钟前")              → "3分钟前"
 * @example formatRelative("2小时前")              → "2小时前"
 * @example formatRelative(昨天的时间戳)            → "昨天 14:30"
 * @example formatRelative("3天前")                → "3天前"
 * @example formatRelative("8天前")                → "2026-06-16"
 */
export function formatRelative(input: Date | string): string {
  const d = toDate(input)
  if (!d) return String(input)

  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  // 1分钟内
  if (diffSec < 60) return '刚刚'
  // 1小时内
  if (diffMin < 60) return `${diffMin}分钟前`
  // 今天内
  if (diffHour < 24 && now.getDate() === d.getDate()) return `${diffHour}小时前`
  // 昨天
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) {
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `昨天 ${hh}:${mm}`
  }
  // 7天内
  if (diffDay < 7) return `${diffDay}天前`
  // 超过7天 → 显示日期
  return toISODate(d)
}

/**
 * 判断日期是否已过期（早于现在）
 *
 * @example isOverdue("2026-01-01") → true
 * @example isOverdue("2030-01-01") → false
 */
export function isOverdue(input: Date | string): boolean {
  const d = toDate(input)
  if (!d) return true // 无法解析视为已过期
  return d.getTime() < Date.now()
}

/**
 * 返回距离目标日期还有多少天（负数表示已过期）
 *
 * @example daysUntil("2026-06-30") → 6  // 假设今天是 6/24
 * @example daysUntil("2026-06-20") → -4
 */
export function daysUntil(input: Date | string): number {
  const d = toDate(input)
  if (!d) return 0

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)

  return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * 返回指定月份的第一天和最后一天（YYYY-MM-DD）
 *
 * @example getMonthRange(2026, 3) → { start: "2026-03-01", end: "2026-03-31" }
 */
export function getMonthRange(year: number, month: number): {
  start: string
  end: string
} {
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0) // 下月第0天 = 本月最后一天
  return {
    start: toISODate(start),
    end: toISODate(end),
  }
}

/**
 * 返回最近 N 个月的 YYYY-MM 数组（从最早到最新）
 *
 * @example getRecentMonths(3) → ["2026-04", "2026-05", "2026-06"]
 */
export function getRecentMonths(count: number): string[] {
  const now = new Date()
  const result: string[] = []

  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    result.push(`${y}-${m}`)
  }

  return result
}

/**
 * 返回今天的 YYYY-MM-DD
 *
 * @example getToday() → "2026-06-24"
 */
export function getToday(): string {
  return toISODate(new Date())
}
