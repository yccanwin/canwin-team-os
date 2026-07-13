import { useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import { Bell, ChevronRight } from 'lucide-react'
import { useTaskStore } from '@/stores/useTaskStore'
import { useVoteStore } from '@/stores/useVoteStore'
import { useUserStore } from '@/stores/useUserStore'
import { useSkillStore } from '@/stores/useSkillStore'
import { useWarRoomStore } from '@/stores/useWarRoomStore'

type Reminder = {
  label: string
  text: string
  to: string
}

function daysUntil(dateText?: string): number | null {
  if (!dateText) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateText.slice(0, 10))
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function deadlineText(dateText?: string): string {
  const days = daysUntil(dateText)
  if (days === null) return '待安排'
  if (days < 0) return '已逾期'
  if (days === 0) return '今天截止'
  if (days === 1) return '明天截止'
  return `${days} 天后截止`
}

export default function PersonalReminderTicker() {
  const currentUser = useUserStore((s) => s.currentUser)
  const tasks = useTaskStore((s) => s.tasks)
  const votes = useVoteStore((s) => s.votes)
  const skills = useSkillStore((s) => s.skills)
  const userSkills = useSkillStore((s) => s.userSkills)
  const policies = useWarRoomStore((s) => s.policies)

  const reminders = useMemo<Reminder[]>(() => {
    if (!currentUser) return []
    const mySkillIds = new Set(userSkills.filter((item) => item.userId === currentUser.id).map((item) => item.skillId))
    const items: Reminder[] = []

    tasks
      .filter((task) => task.assigneeId === currentUser.id && task.status !== 'done')
      .filter((task) => task.isImportant || (daysUntil(task.deadline) ?? 99) <= 3)
      .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
      .slice(0, 3)
      .forEach((task) => {
        items.push({ label: '任务', text: `${task.title} · ${deadlineText(task.deadline)}`, to: '/work' })
      })

    votes
      .filter((vote) => vote.isActive && !vote.votes.some((record) => record.userId === currentUser.id))
      .filter((vote) => (daysUntil(vote.deadline) ?? 99) <= 3)
      .slice(0, 2)
      .forEach((vote) => {
        items.push({ label: '投票', text: `${vote.title} · ${deadlineText(vote.deadline)}`, to: `/votes/${vote.id}` })
      })

    skills
      .filter((skill) => !mySkillIds.has(skill.id))
      .filter((skill) => skill.prerequisiteIds.every((id) => mySkillIds.has(id)))
      .slice(0, 2)
      .forEach((skill) => {
        items.push({ label: '技能', text: `${skill.name} 已解锁`, to: '/skills' })
      })

    policies
      .filter((policy) => policy.creatorId === currentUser.id && ['discussing', 'voting'].includes(policy.status))
      .slice(0, 1)
      .forEach((policy) => {
        items.push({ label: '军机处', text: `${policy.title} 需要继续推进`, to: '/warroom' })
      })

    if (!currentUser.communicationPreference || !currentUser.restDays?.length) {
      items.push({ label: '资料', text: '个人协作资料还可以补充', to: '/profile' })
    }

    if (items.length === 0) {
      items.push({ label: '状态', text: '当前没有紧急个人事项', to: '/dashboard' })
    }

    return items.slice(0, 6)
  }, [currentUser, policies, skills, tasks, userSkills, votes])

  return (
    <div className="personal-reminder-ticker hidden min-w-0 flex-1 items-center justify-center px-4 md:flex">
      <div className="ticker-shell flex h-9 max-w-3xl items-center gap-2 overflow-hidden rounded-full border border-cyan-200/50 bg-white/55 px-3 text-sm shadow-sm backdrop-blur">
        <Bell className="h-4 w-4 shrink-0 text-cyan-600" />
        <div className="ticker-track min-w-0">
          <div className="ticker-content flex items-center gap-6 whitespace-nowrap">
            {[...reminders, ...reminders].map((item, index) => (
              <NavLink key={`${item.label}-${item.text}-${index}`} to={item.to} className="inline-flex items-center gap-1.5 text-brand-300 hover:text-cyan-700">
                <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-700">{item.label}</span>
                <span>{item.text}</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
