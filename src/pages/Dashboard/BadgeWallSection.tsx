import { memo } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { useBadgeStore } from '@/stores/useBadgeStore'
import { useUserStore } from '@/stores/useUserStore'
import EmptyState from '@/components/EmptyState'

const BadgeWallSection = memo(function BadgeWallSection() {
  const badges = useBadgeStore((s) => s.badges)
  const currentUser = useUserStore((s) => s.currentUser)
  const getUserById = useUserStore((s) => s.getUserById)

  // 当前用户已获得的勋章
  const userBadgeIds = currentUser.badges ?? []

  // 取前6个勋章展示
  const displayBadges = badges.slice(0, 6)

  if (displayBadges.length === 0) {
    return (
      <section>
        <h3 className="font-heading text-lg font-semibold text-brand-400 mb-4 pb-3 border-b border-neutral-border">勋章墙</h3>
        <EmptyState title="暂无勋章" description="还没有配置勋章" />
      </section>
    )
  }

  return (
    <section>
      <h3 className="font-heading text-lg font-semibold text-brand-400 mb-4 pb-3 border-b border-neutral-border">勋章墙</h3>

      <div className="grid grid-cols-3 gap-3">
        {displayBadges.map((badge) => {
          const earned = userBadgeIds.includes(badge.id)

          return (
            <div
              key={badge.id}
              className={`relative flex flex-col items-center p-3 rounded-lg transition-all ${
                earned
                  ? 'bg-gradient-to-b from-yellow-50 to-white border border-yellow-200'
                  : 'bg-brand-50 border border-gray-100'
              }`}
              title={badge.description}
            >
              {/* 勋章图标 */}
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl mb-1.5 ${
                  earned ? 'bg-yellow-100' : 'bg-gray-200'
                }`}
              >
                {earned ? (
                  <span>{badge.icon}</span>
                ) : (
                  <Lock className="w-5 h-5 text-brand-200" />
                )}
              </div>

              {/* 勋章名 */}
              <span className={`text-xs font-medium text-center ${
                earned ? 'text-brand-400' : 'text-brand-200'
              }`}>
                {badge.name}
              </span>

              {/* 描述 */}
              <span className="text-[10px] text-brand-200 text-center mt-0.5 line-clamp-2">
                {earned ? badge.description : badge.description}
              </span>
            </div>
          )
        })}
      </div>

      <Link
        to="/profile"
        className="block text-center text-xs text-primary hover:underline mt-4 pt-3 border-t border-neutral-border"
      >
        查看全部勋章 →
      </Link>
    </section>
  )
})

export default BadgeWallSection
