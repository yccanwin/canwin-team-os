import { useMemo, useState, memo } from 'react'
import { Link } from 'react-router-dom'
import { CheckSquare } from 'lucide-react'
import StatusBadge from '@/components/StatusBadge'
import { useTaskStore } from '@/stores/useTaskStore'
import { useUserStore } from '@/stores/useUserStore'
import type { Task } from '@/types'

const TYPE_LABELS: Record<string, string> = {
  sales: '销售',
  operation: '运营',
  purchase: '采购',
  other: '其他',
}

const TYPE_BADGE: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  sales: 'info',
  operation: 'success',
  purchase: 'warning',
  other: 'neutral',
}

const STATUS_VARIANT: Record<string, 'neutral' | 'info' | 'success'> = {
  todo: 'neutral',
  in_progress: 'info',
  done: 'success',
}

const TaskCenterSection = memo(function TaskCenterSection() {
  const tasks = useTaskStore((s) => s.tasks)
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus)
  const currentUser = useUserStore((s) => s.currentUser)
  const [tab, setTab] = useState<'mine' | 'all'>('mine')

  const displayedTasks = useMemo(() => {
    const activeTasks = tasks.filter((t) => t.status !== 'done')
    const sorted = [...activeTasks].sort((a, b) => {
      // 重要任务优先
      if (a.isImportant && !b.isImportant) return -1
      if (!a.isImportant && b.isImportant) return 1
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    if (tab === 'mine') {
      return sorted.filter((t) => t.assigneeId === currentUser.id).slice(0, 5)
    }
    return sorted.slice(0, 5)
  }, [tasks, tab, currentUser.id])

  const handleToggle = (task: Task) => {
    const nextStatus = task.status === 'todo' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'todo'
    updateTaskStatus(task.id, nextStatus)
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-neutral-border">
        <h3 className="font-heading text-lg font-semibold text-brand-400">任务中心</h3>
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          <button
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              tab === 'mine' ? 'bg-white shadow text-brand-400 font-medium' : 'text-brand-300'
            }`}
            onClick={() => setTab('mine')}
          >
            我的任务
          </button>
          <button
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              tab === 'all' ? 'bg-white shadow text-brand-400 font-medium' : 'text-brand-300'
            }`}
            onClick={() => setTab('all')}
          >
            查看全部
          </button>
        </div>
      </div>

      {displayedTasks.length === 0 ? (
        <p className="text-sm text-brand-200 text-center py-6">暂无待办任务</p>
      ) : (
        <div className="divide-y divide-neutral-border">
          {displayedTasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-3 py-2.5 hover:bg-brand-50/50 transition-colors -mx-1 px-1 rounded-lg"
            >
              <button
                className="flex-shrink-0 w-4 h-4 rounded border border-gray-300 flex items-center justify-center hover:border-primary transition-colors"
                onClick={() => handleToggle(task)}
                title={task.status === 'in_progress' ? '标记完成' : '标记进行中'}
              >
                {task.status === 'in_progress' && (
                  <div className="w-2 h-2 rounded-sm bg-primary" />
                )}
                {task.status === 'done' && (
                  <CheckSquare className="w-4 h-4 text-income" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm truncate ${task.status === 'done' ? 'line-through text-brand-200' : 'text-brand-400'}`}>
                    {task.title}
                  </span>
                  {task.isImportant && (
                    <span className="text-xs text-expense font-medium whitespace-nowrap">重要</span>
                  )}
                </div>
              </div>

              <StatusBadge
                label={TYPE_LABELS[task.type] || task.type}
                variant={TYPE_BADGE[task.type] || 'neutral'}
              />

              <StatusBadge
                label={task.status === 'todo' ? '待办' : task.status === 'in_progress' ? '进行中' : '已完成'}
                variant={STATUS_VARIANT[task.status]}
              />

              {task.deadline && (
                <span className="text-xs text-brand-200 whitespace-nowrap">
                  {task.deadline.slice(5)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <Link
        to="/tasks"
        className="block text-center text-xs text-primary hover:underline mt-3 pt-3 border-t border-neutral-border"
      >
        查看全部 →
      </Link>
    </section>
  )
})

export default TaskCenterSection
