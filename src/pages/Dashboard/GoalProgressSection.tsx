import { memo } from 'react'
import { Link } from 'react-router-dom'
import ProgressBar from '@/components/ProgressBar'
import { useGoalStore } from '@/stores/useGoalStore'
import { useUserStore } from '@/stores/useUserStore'

const GoalProgressSection = memo(function GoalProgressSection() {
  const goals = useGoalStore((s) => s.goals)
  const getUserById = useUserStore((s) => s.getUserById)
  const users = useUserStore((s) => s.users)

  // 活跃目标：in_progress + enabled
  const activeGoals = goals
    .filter((g) => g.status === 'in_progress' || g.status === 'enabled')
    .slice(0, 4)

  if (activeGoals.length === 0) {
    return (
      <section className="bg-white rounded-card shadow-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading text-lg font-semibold text-brand-400">目标进度</h3>
        </div>
        <p className="text-sm text-brand-200 text-center py-8">暂无活跃目标</p>
      </section>
    )
  }

  return (
    <section className="bg-white rounded-card shadow-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading text-lg font-semibold text-brand-400">目标进度</h3>
        {goals.filter((g) => g.status === 'in_progress' || g.status === 'enabled').length > 4 && (
          <Link to="/goals" className="text-xs text-primary hover:underline">
            查看全部 →
          </Link>
        )}
      </div>

      <div className="space-y-4">
        {activeGoals.map((goal) => {
          const pct = goal.targetAmount > 0
            ? Math.min(Math.round((goal.currentAmount / goal.targetAmount) * 100), 100)
            : 0
          const etaMonths = goal.monthlyGrowth && goal.monthlyGrowth > 0
            ? Math.ceil((goal.targetAmount - goal.currentAmount) / (goal.targetAmount * goal.monthlyGrowth / 100))
            : null

          return (
            <div key={goal.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-brand-400 truncate">{goal.title}</span>
                  <span className="text-xs text-brand-200 whitespace-nowrap">
                    {'★'.repeat(goal.priority)}
                  </span>
                </div>
                {/* 负责人头像 */}
                <div className="flex -space-x-1 ml-2">
                  {users.slice(0, 2).map((u) => (
                    <div
                      key={u.id}
                      className="w-6 h-6 rounded-full bg-primary/10 border border-white flex items-center justify-center text-[10px] font-medium text-primary"
                      title={u.name}
                    >
                      {u.name.charAt(0)}
                    </div>
                  ))}
                  {users.length > 2 && (
                    <div className="w-6 h-6 rounded-full bg-gray-100 border border-white flex items-center justify-center text-[10px] text-brand-300">
                      +{users.length - 2}
                    </div>
                  )}
                </div>
              </div>

              <ProgressBar
                progress={pct}
                color={goal.status === 'in_progress' ? '#6366F1' : '#3B82F6'}
              />

              <div className="flex items-center gap-4 text-xs text-brand-200">
                <span>还差 ¥{(goal.targetAmount - goal.currentAmount).toLocaleString()}</span>
                {goal.monthlyGrowth != null && (
                  <span>月增长 {goal.monthlyGrowth}%</span>
                )}
                {etaMonths != null && (
                  <span>预计 {etaMonths} 个月达成</span>
                )}
                {goal.monthlyGrowth == null && (
                  <span className="text-yellow-500">数据不足</span>
                )}
                {goal.status === 'completed' && (
                  <span className="text-income font-medium">✓ 已达成</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
})

export default GoalProgressSection
