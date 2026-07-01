import { memo, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Camera, CheckCircle2, Clock, Trophy } from 'lucide-react'
import { useAchievementStore } from '@/stores/useAchievementStore'
import { usePhotoStore } from '@/stores/usePhotoStore'
import { useTaskStore } from '@/stores/useTaskStore'
import { useTimelineStore } from '@/stores/useTimelineStore'
import { useUserStore } from '@/stores/useUserStore'
import { formatRelative } from '@/utils/dateUtils'
import EmptyState from '@/components/EmptyState'

type FeedItem = {
  id: string
  userId: string
  type: 'task' | 'timeline' | 'achievement' | 'photo'
  content: string
  createdAt: string
}

const TYPE_ICONS: Record<FeedItem['type'], typeof Trophy> = {
  task: CheckCircle2,
  timeline: Clock,
  achievement: Trophy,
  photo: Camera,
}

const TYPE_COLORS: Record<FeedItem['type'], string> = {
  task: 'text-green-500 bg-green-50',
  timeline: 'text-blue-500 bg-blue-50',
  achievement: 'text-yellow-500 bg-yellow-50',
  photo: 'text-pink-500 bg-pink-50',
}

const ActivityFeedSection = memo(function ActivityFeedSection() {
  const tasks = useTaskStore((s) => s.tasks)
  const events = useTimelineStore((s) => s.events)
  const achievements = useAchievementStore((s) => s.achievements)
  const photos = usePhotoStore((s) => s.photos)
  const getUserById = useUserStore((s) => s.getUserById)

  const recentLogs = useMemo<FeedItem[]>(() => {
    const taskItems = tasks
      .filter((task) => task.status === 'done' && task.completedAt)
      .map((task) => ({
        id: `task-${task.id}`,
        userId: task.assigneeId,
        type: 'task' as const,
        content: `完成任务「${task.title}」`,
        createdAt: task.completedAt as string,
      }))

    const timelineItems = events.map((event) => ({
      id: `timeline-${event.id}`,
      userId: event.createdBy,
      type: 'timeline' as const,
      content: `记录了团队记忆「${event.title}」`,
      createdAt: event.createdAt || event.date,
    }))

    const achievementItems = achievements.map((achievement) => ({
      id: `achievement-${achievement.id}`,
      userId: achievement.createdBy,
      type: 'achievement' as const,
      content: `沉淀案例「${achievement.name}」`,
      createdAt: achievement.createdAt || achievement.achievedDate,
    }))

    const photoItems = photos.map((photo) => ({
      id: `photo-${photo.id}`,
      userId: photo.uploadedBy,
      type: 'photo' as const,
      content: `上传团队照片「${photo.title || '团队瞬间'}」`,
      createdAt: photo.uploadedAt || photo.date,
    }))

    return [...taskItems, ...timelineItems, ...achievementItems, ...photoItems]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
  }, [achievements, events, photos, tasks])

  if (recentLogs.length === 0) {
    return (
      <section className="bg-white rounded-card shadow-card p-5">
        <h3 className="font-heading text-lg font-semibold text-brand-400 mb-4">团队动态</h3>
        <EmptyState title="暂无动态" description="正式数据表中还没有团队动态" />
      </section>
    )
  }

  return (
    <section className="bg-white rounded-card shadow-card p-5">
      <h3 className="font-heading text-lg font-semibold text-brand-400 mb-4">团队动态</h3>

      <div className="space-y-0">
        {recentLogs.map((log, idx) => {
          const user = getUserById(log.userId)
          const Icon = TYPE_ICONS[log.type] || Clock
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
        to="/timeline"
        className="block text-center text-xs text-primary hover:underline mt-3 pt-3 border-t border-gray-100"
      >
        查看团队记忆 →
      </Link>
    </section>
  )
})

export default ActivityFeedSection
