import { memo, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, HeartHandshake, MessageCircle, NotebookText } from 'lucide-react'
import { useTaskStore } from '@/stores/useTaskStore'
import { useTimelineStore } from '@/stores/useTimelineStore'
import { useUserStore } from '@/stores/useUserStore'
import { formatRelative } from '@/utils/dateUtils'

const CollaborationSnapshotSection = memo(function CollaborationSnapshotSection() {
  const users = useUserStore((s) => s.users)
  const tasks = useTaskStore((s) => s.tasks)
  const events = useTimelineStore((s) => s.events)

  const todayWeekday = new Date().getDay()
  const restDayIndex: Record<string, number> = {
    周日: 0,
    周一: 1,
    周二: 2,
    周三: 3,
    周四: 4,
    周五: 5,
    周六: 6,
  }

  const restUsers = users.filter((user) =>
    (user.restDays ?? []).some((day) => restDayIndex[day] === todayWeekday)
  )
  const activeUsers = users.filter((user) => !restUsers.some((restUser) => restUser.id === user.id))
  const profilesReady = users.filter(
    (user) =>
      (user.restDays?.length ?? 0) > 0 ||
      Boolean(user.communicationPreference) ||
      Boolean(user.notes)
  ).length

  const latestMemory = useMemo(() => {
    return [...events]
      .sort((a, b) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime())
      .slice(0, 3)
  }, [events])

  const dueTasks = tasks
    .filter((task) => task.status !== 'done' && task.deadline)
    .sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''))
    .slice(0, 3)

  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-neutral-border pb-3">
        <div>
          <h3 className="font-heading text-lg font-semibold text-brand-400">团队协作快照</h3>
          <p className="mt-1 text-xs text-brand-200">休息边界、近期交付和团队记忆</p>
        </div>
        <HeartHandshake className="h-5 w-5 text-emerald-500" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-amber-50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <CalendarDays className="h-3.5 w-3.5" />
            今日休息
          </div>
          <p className="mt-1 text-sm font-semibold text-amber-900">
            {restUsers.length ? restUsers.map((user) => user.name).join('、') : '无人休息'}
          </p>
        </div>
        <div className="rounded-lg bg-emerald-50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <MessageCircle className="h-3.5 w-3.5" />
            在岗协作
          </div>
          <p className="mt-1 text-sm font-semibold text-emerald-900">
            {activeUsers.length}/{users.length || 0} 人
          </p>
        </div>
        <div className="rounded-lg bg-sky-50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-sky-700">
            <NotebookText className="h-3.5 w-3.5" />
            协作资料
          </div>
          <p className="mt-1 text-sm font-semibold text-sky-900">
            {profilesReady}/{users.length || 0} 人已填写
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold text-brand-300">近期需要对齐</p>
          {dueTasks.length ? (
            <div className="space-y-2">
              {dueTasks.map((task) => (
                <div key={task.id} className="rounded-lg bg-brand-50 px-3 py-2">
                  <p className="line-clamp-1 text-sm font-medium text-brand-400">{task.title}</p>
                  <p className="mt-0.5 text-xs text-brand-200">截止 {task.deadline}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-brand-50 px-3 py-3 text-sm text-brand-200">暂无临近截止任务</p>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-brand-300">最近团队记忆</p>
          {latestMemory.length ? (
            <div className="space-y-2">
              {latestMemory.map((event) => (
                <div key={event.id} className="rounded-lg bg-rose-50 px-3 py-2">
                  <p className="line-clamp-1 text-sm font-medium text-rose-900">{event.title}</p>
                  <p className="mt-0.5 text-xs text-rose-700">{formatRelative(event.createdAt || event.date)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-brand-50 px-3 py-3 text-sm text-brand-200">等待记录新的团队时刻</p>
          )}
        </div>
      </div>

      <Link
        to="/members"
        className="mt-4 block border-t border-neutral-border pt-3 text-center text-xs text-primary hover:underline"
      >
        查看团队成员
      </Link>
    </section>
  )
})

export default CollaborationSnapshotSection
