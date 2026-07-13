import { useMemo, useState, type ReactNode } from 'react'
import { CheckSquare, Clock, Target, UserRound } from 'lucide-react'
import { useGoalStore } from '@/stores/useGoalStore'
import { usePersonalGoalStore } from '@/stores/usePersonalGoalStore'
import { useTaskStore } from '@/stores/useTaskStore'
import GoalsPage from '@/pages/Goals'
import TasksPage from '@/pages/Tasks'

type WorkView = 'tasks' | 'teamGoals' | 'personalGoals'

export default function WorkPage() {
  const [activeView, setActiveView] = useState<WorkView>('tasks')
  const tasks = useTaskStore((s) => s.tasks)
  const goals = useGoalStore((s) => s.goals)
  const personalGoals = usePersonalGoalStore((s) => s.personalGoals)

  const stats = useMemo(() => {
    const now = new Date().getTime()
    const openTasks = tasks.filter((task) => task.status !== 'done')
    const upcomingTasks = openTasks.filter((task) => {
      if (!task.deadline) return false
      const diffDays = (new Date(task.deadline).getTime() - now) / 86400000
      return diffDays >= 0 && diffDays <= 7
    })
    const activeGoals = goals.filter((goal) => goal.status === 'in_progress' || goal.status === 'enabled')
    const personalUpdates = personalGoals.reduce((sum, goal) => sum + goal.updates.length, 0)
    return {
      openTasks: openTasks.length,
      upcomingTasks: upcomingTasks.length,
      activeGoals: activeGoals.length,
      personalUpdates,
    }
  }, [goals, personalGoals, tasks])

  return (
    <div className="space-y-5">
      <div className="px-3 lg:px-6">
        <div className="rounded-card border border-cyan-100 bg-white p-5 shadow-card">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="font-heading text-xl font-semibold text-brand-400">推进中心</h1>
              <p className="mt-1 text-sm text-brand-300">把任务、团队目标和个人目标收进一个工作台。</p>
            </div>
            <div className="inline-flex rounded-xl border border-brand-100 bg-brand-50 p-1">
              <TabButton active={activeView === 'tasks'} onClick={() => setActiveView('tasks')} icon={CheckSquare}>任务</TabButton>
              <TabButton active={activeView === 'teamGoals'} onClick={() => setActiveView('teamGoals')} icon={Target}>团队目标</TabButton>
              <TabButton active={activeView === 'personalGoals'} onClick={() => setActiveView('personalGoals')} icon={UserRound}>个人目标</TabButton>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="待推进任务" value={stats.openTasks} icon={CheckSquare} />
            <Metric label="7天内截止" value={stats.upcomingTasks} icon={Clock} />
            <Metric label="活跃团队目标" value={stats.activeGoals} icon={Target} />
            <Metric label="个人目标进展" value={stats.personalUpdates} icon={UserRound} />
          </div>
        </div>
      </div>

      {activeView === 'tasks' ? (
        <TasksPage />
      ) : (
        <GoalsPage
          key={activeView}
          initialView={activeView === 'teamGoals' ? 'team' : 'personal'}
          embedded
        />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: typeof CheckSquare
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
        active ? 'bg-white text-primary shadow-sm' : 'text-brand-300 hover:text-brand-400'
      }`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  )
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof CheckSquare }) {
  return (
    <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-3">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white text-cyan-600">
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-xs text-brand-200">{label}</p>
      <p className="mt-1 text-xl font-semibold text-brand-400">{value}</p>
    </div>
  )
}
