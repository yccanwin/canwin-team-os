import { useState, useMemo } from 'react'
import { Lock, Award } from 'lucide-react'
import { useUserStore } from '@/stores/useUserStore'
import { useBadgeStore } from '@/stores/useBadgeStore'
import EmptyState from '@/components/EmptyState'
import { formatDate } from '@/utils/dateUtils'
import type { BadgeConfig } from '@/types'

const categoryTabs: { key: BadgeConfig['category'] | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'basic', label: '基础' },
  { key: 'business', label: '业务' },
  { key: 'behavior', label: '行为' },
]

export default function BadgeGallery() {
  const currentUser = useUserStore((s) => s.currentUser)
  const allBadges = useBadgeStore((s) => s.badges)
  const [category, setCategory] = useState<BadgeConfig['category'] | 'all'>('all')

  // 防御性检查
  if (!currentUser) {
    return null
  }

  // 已获得 / 未获得（防御性处理 badges 为 undefined 的情况）
  const ownedBadgeIds = new Set(currentUser.badges ?? [])

  const filteredBadges = useMemo(() => {
    let badges = allBadges
    if (category !== 'all') {
      badges = badges.filter((b) => b.category === category)
    }
    return badges
  }, [allBadges, category])

  const ownedBadges = filteredBadges.filter((b) => ownedBadgeIds.has(b.id))
  const unownedBadges = filteredBadges.filter((b) => !ownedBadgeIds.has(b.id))

  return (
    <div className="space-y-5">
      {/* 分类标签 */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {categoryTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setCategory(tab.key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              category === tab.key
                ? 'bg-white text-brand-400 shadow-sm'
                : 'text-brand-300 hover:text-brand-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 已获得勋章 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Award className="w-4 h-4 text-indigo-500" />
          <h3 className="font-heading text-sm font-semibold text-brand-400">
            已获得勋章（{ownedBadges.length}）
          </h3>
        </div>

        {ownedBadges.length === 0 ? (
          <EmptyState
            title="暂无勋章"
            description="完成任务、持续登录即可获得勋章"
          />
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
            {ownedBadges.map((badge) => (
              <BadgeCard key={badge.id} badge={badge} owned />
            ))}
          </div>
        )}
      </div>

      {/* 未获得勋章 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Lock className="w-4 h-4 text-brand-200" />
          <h3 className="font-heading text-sm font-semibold text-brand-400">
            未获得勋章（{unownedBadges.length}）
          </h3>
        </div>

        {unownedBadges.length === 0 ? (
          <p className="text-sm text-brand-200 py-4 text-center">🎉 全部集齐！</p>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
            {unownedBadges.map((badge) => (
              <BadgeCard key={badge.id} badge={badge} owned={false} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// 单个勋章卡片
// ============================================================

function BadgeCard({ badge, owned }: { badge: BadgeConfig; owned: boolean }) {
  const [showTooltip, setShowTooltip] = useState(false)

  return (
    <div
      className="relative flex flex-col items-center p-3 rounded-lg bg-white border border-gray-100 hover:shadow-md transition-shadow cursor-default"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* 图标 */}
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center text-3xl relative"
        style={{ backgroundColor: owned ? '#EEF2FF' : '#CBD5E1' }}
      >
        {owned ? (
          badge.icon
        ) : (
          <>
            <span className="opacity-30">{badge.icon}</span>
            <Lock className="absolute w-3 h-3 text-brand-300" style={{ bottom: -2, right: -2 }} />
          </>
        )}
      </div>

      {/* 名称 */}
      <span className={`mt-2 text-sm text-center leading-tight ${owned ? 'text-brand-400 font-medium' : 'text-brand-200'}`}>
        {badge.name}
      </span>

      {/* 获得日期（仅已获得） */}
      {owned && (
        <span className="mt-0.5 text-xs text-brand-200">
          {formatDate(new Date().toISOString())}
        </span>
      )}

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10">
          <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 max-w-[200px] text-center shadow-lg">
            <p className="font-medium mb-0.5">{badge.name}</p>
            <p className="text-neutral-tertiary">{badge.description}</p>
            {!owned && (
              <p className="text-brand-200 mt-1 text-[10px]">
                +{badge.xpReward} XP 奖励
              </p>
            )}
          </div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45 -mt-1" />
        </div>
      )}
    </div>
  )
}
