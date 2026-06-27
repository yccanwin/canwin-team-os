import { memo } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, CheckCircle2, Megaphone } from 'lucide-react'
import { useActivityStore } from '@/stores/useActivityStore'
import { useUserStore } from '@/stores/useUserStore'
import { formatRelative } from '@/utils/dateUtils'
import EmptyState from '@/components/EmptyState'
import type { ActivityLog } from '@/types'

const TYPE_ICONS: Record<ActivityLog['type'], typeof Trophy> = {
  badge_earned: Trophy,
  task_completed: CheckCircle2,
  announcement: Megaphone,
}

const TYPE_COLORS: Record<ActivityLog['type'], string> = {
  badge_earned: 'text-yellow-500 bg-yellow-50',
  task_completed: 'text-green-500 bg-green-50',
  announcement: 'text-blue-500 bg-blue-50',
}

const ActivityFeedSection = memo(function ActivityFeedSection() {
  const getRecentLogs = useActivityStore((s) => s.getRecentLogs)
  const getUserById = useUserStore((s) => s.getUserById)
  const recentLogs = getRecentLogs(5)

  if (recentLogs.length === 0) {
    return (
      <section className="bg-white rounded-card shadow-card p-5">
        <h3 className="font-heading text-lg font-semibold text-brand-400 mb-4">团队动态</h3>
        <EmptyState title="暂无动态" description="团队还没有任何活动记录" />
      </section>
    )
  }

  return (
    <section className="bg-white rounded-card shadow-card p-5">
      <h3 className="font-heading text-lg font-semibold text-brand-400 mb-4">团队动态</h3>

      <div className="space-y-0">
        {recentLogs.map((log, idx) => {
          const user = getUserById(log.userId)
          const Icon = TYPE_ICONS[log.type] || Megaphone
          const colorClass = TYPE_COLORS[log.type] || 'text-brand-300 bg-brand-50'

          return (
            <div key={log.id}>
              <div className="flex items-start gap-3 py-3">
                {/* 头像 */}
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                  {user?.name?.charAt(0) || '?'}
                </div>

                {/* 内容 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-sm font-medium text-brand-400">
                      {user?.name || '未知用户'}
                    </span>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center ${colorClass}`}>
                      <Icon className="w-3 h-3" />
                    </div>
                  </div>
                  <p className="text-sm text-brand-400">{log.content}</p>
                  <p className="text-xs text-brand-200 mt-0.5">{formatRelative(log.createdAt)}</p>
                </div>
              </div>
              {idx < recentLogs.length - 1 && <div className="border-b border-gray-50" />}
            </div>
          )
        })}
      </div>

      <Link
        to="/profile"
        className="block text-center text-xs text-primary hover:underline mt-3 pt-3 border-t border-gray-100"
      >
        查看更多动态 →
      </Link>
    </section>
  )
})

export default ActivityFeedSection
