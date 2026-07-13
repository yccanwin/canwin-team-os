import { useMemo } from 'react'
import { Target, LockKeyhole, MessageSquareText } from 'lucide-react'
import { usePersonalGoalStore } from '@/stores/usePersonalGoalStore'
import type { User } from '@/types'

type PersonalGoalsCardProps = {
  user: User
}

export default function PersonalGoalsCard({ user }: PersonalGoalsCardProps) {
  const allGoals = usePersonalGoalStore((s) => s.personalGoals)
  const goals = useMemo(
    () =>
      allGoals.filter(
        (goal) => goal.userId === user.id && goal.visibility === 'team'
      ),
    [allGoals, user.id]
  )

  return (
    <div className="rounded-card bg-white p-6 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-blue-500" />
          <h3 className="font-heading text-lg font-semibold text-brand-400">公开个人目标</h3>
        </div>
        <span className="text-xs text-brand-200">{goals.length} 项</span>
      </div>

      {goals.length === 0 ? (
        <div className="rounded-lg bg-brand-50 px-4 py-5 text-center">
          <p className="text-sm text-brand-300">还没有公开目标。</p>
          <p className="mt-1 text-xs text-brand-200">可以在目标页创建个人目标，团队会看到公开目标的进展和复盘。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {goals.slice(0, 4).map((goal) => {
            const target = goal.targetAmount ?? 0
            const percent = target > 0 ? Math.min(100, Math.round((goal.currentAmount / target) * 100)) : 0
            return (
              <div key={goal.id} className="rounded-xl border border-brand-100 p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-brand-400">{goal.title}</h4>
                    <p className="mt-0.5 text-xs text-brand-200">
                      {goal.deadline ? `截止 ${goal.deadline}` : '未设置截止日'}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1 text-xs text-brand-300">
                    <LockKeyhole className="h-3 w-3" />
                    {goal.lockStatus === 'cooldown' ? '冷静期' : goal.lockStatus === 'locked' ? '已锁定' : goal.lockStatus === 'review' ? '复盘中' : '已解锁'}
                  </span>
                </div>
                {target > 0 && (
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-brand-300">
                      <span>{goal.currentAmount.toLocaleString()} / {target.toLocaleString()}</span>
                      <span>{percent}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-blue-500" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                )}
                {goal.updates[goal.updates.length - 1] && (
                  <div className="mt-3 flex gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
                    <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{goal.updates[goal.updates.length - 1].content}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
