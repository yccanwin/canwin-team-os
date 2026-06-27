/**
 * CanWin Team OS — 勋章解锁弹窗
 *
 * 从 useBadgeStore.pendingBadges 队列消费勋章，
 * 一次展示一个，底部滑入，3 秒自动消失。
 * 通过 React Portal 渲染到 document.body。
 */

import { useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useBadgeStore, type PendingBadge } from '@/stores/useBadgeStore'

// ============================================================
// 内部组件 — 单个勋章展示
// ============================================================

function BadgeCard({
  badge,
  onClose,
}: {
  badge: PendingBadge
  onClose: () => void
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 自动消失计时器
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onClose()
    }, 3000)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [onClose])

  // 监听 ESC 键关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (timerRef.current) clearTimeout(timerRef.current)
        onClose()
      }
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* 底部滑入动画 */}
      <style>{`
        @keyframes badge-slide-up {
          0%   { transform: translateY(100%); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      <div
        className="bg-white rounded-2xl shadow-2xl px-8 py-10 text-center max-w-sm w-full sm:max-w-md"
        style={{ animation: 'badge-slide-up 0.35s ease-out forwards' }}
      >
        {/* 勋章大图标 */}
        <div className="text-7xl mb-5 select-none">{badge.icon}</div>

        {/* 标题 */}
        <h2 className="font-heading text-xl font-bold text-brand-400 mb-1">
          🎉 获得新勋章！
        </h2>
        <h3 className="font-heading text-lg font-semibold text-indigo-600 mb-3">
          {badge.name}
        </h3>

        {/* 描述 */}
        <p className="text-sm text-brand-300 mb-4">{badge.description}</p>

        {/* XP 奖励 */}
        {badge.xpReward > 0 && (
          <div className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 rounded-full px-4 py-1.5 text-sm font-semibold mb-5">
            +{badge.xpReward} XP
          </div>
        )}

        {/* 关闭按钮 */}
        <div>
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 主组件 — 队列管理
// ============================================================

export default function BadgeUnlockModal() {
  const pendingBadges = useBadgeStore((s) => s.pendingBadges)
  const dismissBadge = useBadgeStore((s) => s.dismissBadge)

  const current = pendingBadges[0]
  const handleClose = useCallback(() => {
    dismissBadge()
  }, [dismissBadge])

  if (!current) return null

  return createPortal(
    <BadgeCard badge={current} onClose={handleClose} />,
    document.body
  )
}
