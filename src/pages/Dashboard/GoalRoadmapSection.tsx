import { useMemo, memo } from 'react'
import { Target, Check, Lock, Clock, Loader } from 'lucide-react'
import { useGoalStore } from '@/stores/useGoalStore'
import { getToday } from '@/utils/dateUtils'

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof Target }> = {
  completed: { bg: 'bg-[#10B981]/10', text: 'text-[#10B981]', icon: Check },
  in_progress: { bg: 'bg-[#6366F1]/10', text: 'text-[#6366F1]', icon: Loader },
  enabled: { bg: 'bg-[#3B82F6]/10', text: 'text-[#3B82F6]', icon: Clock },
  locked: { bg: 'bg-[#CBD5E1]/10', text: 'text-brand-200', icon: Lock },
}

const STATUS_LABELS: Record<string, string> = {
  completed: '已完成',
  in_progress: '进行中',
  enabled: '待启动',
  locked: '未解锁',
}

const GoalRoadmapSection = memo(function GoalRoadmapSection() {
  const goals = useGoalStore((s) => s.goals)

  // 按 priority 排序（从高到低）
  const sorted = useMemo(() => [...goals].sort((a, b) => b.priority - a.priority), [goals])

  // 未来30天：用 estimatedMonths 表示；如果不是 completed/locked，则显示在时间线上
  const today = getToday()

  return (
    <section className="bg-white rounded-card shadow-card p-5">
      <h3 className="font-heading text-lg font-semibold text-brand-400 mb-4">路线图时间线</h3>

      <div className="relative">
        {/* 垂直时间线 */}
        {sorted.map((goal, idx) => {
          const style = STATUS_STYLES[goal.status] || STATUS_STYLES.locked
          const Icon = style.icon
          const isLast = idx === sorted.length - 1

          const deadlineText = goal.estimatedMonths
            ? `预计 ${goal.estimatedMonths} 个月`
            : goal.status === 'completed'
              ? '已达成'
              : goal.status === 'locked'
                ? '等待解锁'
                : '进行中'

          return (
            <div key={goal.id} className="flex gap-4">
              {/* 左侧时间线节点 */}
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${style.bg}`}>
                  <Icon className={`w-4 h-4 ${style.text}`} />
                </div>
                {!isLast && <div className="w-0.5 flex-1 bg-gray-200 min-h-[40px]" />}
              </div>

              {/* 右侧内容 */}
              <div className={`flex-1 pb-5 ${isLast ? '' : ''}`}>
                <div className={`p-3 rounded-lg ${
                  goal.status === 'in_progress' ? 'border border-[#6366F1]/30 bg-[#6366F1]/5' :
                  goal.status === 'locked' ? 'bg-brand-50' :
                  'bg-brand-50'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <h4 className={`text-sm font-medium ${
                      goal.status === 'locked' ? 'text-brand-200' : 'text-brand-400'
                    }`}>
                      {goal.title}
                    </h4>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.bg} ${style.text}`}>
                      {STATUS_LABELS[goal.status]}
                    </span>
                  </div>

                  {goal.status !== 'locked' && (
                    <div className="flex items-center gap-4 text-xs text-brand-300 mt-2">
                      <span>当前 ¥{goal.currentAmount.toLocaleString()} / ¥{goal.targetAmount.toLocaleString()}</span>
                      <span>{deadlineText}</span>
                    </div>
                  )}

                  {goal.status === 'locked' && (
                    <p className="text-xs text-brand-200 mt-1">
                      需完成前置阶段后自动解锁
                    </p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
})

export default GoalRoadmapSection
