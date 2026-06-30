import { useMemo, useState } from 'react'
import ProgressBar from '@/components/ProgressBar'
import EmptyStateIllustration from '@/components/EmptyStateIllustration'
import { useGoalStore } from '@/stores/useGoalStore'
import { useUserStore } from '@/stores/useUserStore'
import GoalEditModal from './GoalEditModal'
import PersonalGoalModal from './PersonalGoalModal'
import { isCaptainRole } from '@/services/profile'
import { Target, TrendingUp, Rocket, Trophy, X, Plus, UserRound } from 'lucide-react'
import { usePersonalGoalStore } from '@/stores/usePersonalGoalStore'
import type { PersonalGoal } from '@/types'

// 阶段图标（Lucide）
const phaseIcons = [Target, TrendingUp, Rocket, Trophy]

// 状态配置
const statusConfig: Record<
  string,
  { label: string; bg: string; text: string; border?: string }
> = {
  enabled: { label: '待开始', bg: '#DBEAFE', text: '#1E40AF' },
  in_progress: {
    label: '进行中',
    bg: '#6366F1',
    text: '#FFFFFF',
    border: '2px solid #6366F1',
  },
  completed: { label: '已完成 ✓', bg: '#D1FAE5', text: '#065F46' },
  locked: { label: '未解锁 🔒', bg: '#F1F5F9', text: '#94A3B8' },
}

export default function GoalsPage() {
  const goals = useGoalStore((s) => s.goals)
  const personalGoals = usePersonalGoalStore((s) => s.personalGoals)
  const unlockNextPhase = useGoalStore((s) => s.unlockNextPhase)
  const currentUser = useUserStore((s) => s.currentUser)

  const isCaptain = isCaptainRole(currentUser.role)

  // 编辑弹窗状态
  const [editingGoal, setEditingGoal] = useState<typeof goals[0] | null>(null)
  const [editingPersonalGoal, setEditingPersonalGoal] = useState<PersonalGoal | null>(null)
  const [newGoalOpen, setNewGoalOpen] = useState(false)
  const [newPersonalGoalOpen, setNewPersonalGoalOpen] = useState(false)
  const [activeView, setActiveView] = useState<'team' | 'personal'>('team')

  // 确认弹窗状态
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false)
  const [nextPhaseTitle, setNextPhaseTitle] = useState('')

  // 按 priority 降序排列（阶段1 priority最高）
  const sortedGoals = useMemo(() => {
    return [...goals].sort((a, b) => b.priority - a.priority)
  }, [goals])

  // 是否有 enabled 状态的阶段（显示"启用下一阶段"按钮）
  const hasEnabled = useMemo(() => {
    return sortedGoals.some((g) => g.status === 'enabled')
  }, [sortedGoals])

  // ETA 计算
  const calculateETA = (goal: (typeof goals)[0]): string => {
    if (!goal.monthlyGrowth || goal.monthlyGrowth <= 0) return '数据不足'
    const remaining = goal.targetAmount - goal.currentAmount
    if (remaining <= 0) return '即将达成'
    const months = Math.ceil(remaining / goal.monthlyGrowth)
    return `预计 ${months} 个月`
  }

  return (
    <>
    <div className="px-3 lg:px-6 py-4">
      <div className="mb-5 inline-flex rounded-xl border border-brand-100 bg-white p-1 shadow-sm">
        <button
          onClick={() => setActiveView('team')}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${activeView === 'team' ? 'bg-primary text-white' : 'text-brand-300 hover:bg-brand-50'}`}
        >
          团队目标
        </button>
        <button
          onClick={() => setActiveView('personal')}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${activeView === 'personal' ? 'bg-primary text-white' : 'text-brand-300 hover:bg-brand-50'}`}
        >
          个人目标
        </button>
      </div>

      {activeView === 'personal' ? (
        <PersonalGoalsView
          goals={personalGoals}
          currentUserId={currentUser.id}
          onCreate={() => setNewPersonalGoalOpen(true)}
          onEdit={setEditingPersonalGoal}
        />
      ) : (
      <>
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-lg font-semibold text-brand-400">目标路线图</h1>
          <p className="mt-1 text-sm text-brand-300">团队阶段目标与进度追踪</p>
        </div>
        {isCaptain && hasEnabled && (
          <button
            onClick={() => {
              const next = sortedGoals.find((g) => g.status === 'enabled') || sortedGoals.find((g) => g.status === 'locked')
              setNextPhaseTitle(next?.title || '下一阶段')
              setShowUnlockConfirm(true)
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-indigo-600 transition-colors"
          >
            启用下一阶段
          </button>
        )}
        {isCaptain && (
          <button
            onClick={() => setNewGoalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-indigo-600 transition-colors"
          >
            新增目标
          </button>
        )}
      </div>

      {/* 阶段列表 / 空状态 */}
      {goals.length === 0 ? (
        <EmptyStateIllustration
          variant="goals"
          title="设定季度目标，让团队有清晰方向"
          description="为每个阶段设定收入目标，追踪团队成长轨迹"
          action={
            isCaptain ? (
              <button
                onClick={() => setNewGoalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors shadow-sm hover:shadow-md"
                style={{ backgroundColor: '#6366F1' }}
              >
                <Plus className="w-4 h-4" />
                新增目标
              </button>
            ) : undefined
          }
        />
      ) : (
      <div className="relative max-w-2xl mx-auto">
        {sortedGoals.map((goal, index) => {
          const config = statusConfig[goal.status]
          const isCurrent = goal.status === 'in_progress'
          const percentage =
            goal.targetAmount > 0
              ? Math.min(
                  Math.round((goal.currentAmount / goal.targetAmount) * 100),
                  100
                )
              : 0

          return (
            <div key={goal.id} className="relative">
              {/* 连接线（非最后一个） */}
              {index < sortedGoals.length - 1 && (
                <div className="absolute left-8 top-full w-0.5 h-8 bg-gray-300" />
              )}

              {/* 阶段卡片 */}
              <div
                className={`relative bg-white rounded-card shadow-card p-5 mb-4 transition-all ${
                  isCurrent ? 'ring-2 ring-primary' : ''
                } ${goal.status === 'completed' ? 'phase-completed-card' : ''}`}
                style={isCurrent ? { border: config.border } : {}}
              >
                <div className="flex items-start gap-4">
                  {/* 左侧图标 */}
                  <div
                    className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                      goal.status === 'completed' ? 'phase-completed-glow' : ''
                    }`}
                    style={{
                      backgroundColor:
                        goal.status === 'locked'
                          ? '#F1F5F9'
                          : goal.status === 'completed'
                            ? '#D1FAE5'
                            : '#EEF2FF',
                    }}
                  >
                    {(() => {
                      const Icon = phaseIcons[index] || phaseIcons[0]
                      const iconColor =
                        goal.status === 'locked'
                          ? '#94A3B8'
                          : goal.status === 'completed'
                            ? '#10B981'
                            : '#6366F1'
                      return <Icon className="w-5 h-5" style={{ color: iconColor }} />
                    })()}
                  </div>

                  {/* 右侧内容 */}
                  <div className="flex-1 min-w-0">
                    {/* 标题行 + 状态标签 */}
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-heading text-base font-semibold text-brand-400">
                        {goal.title}
                      </h3>
                      <span
                        className="inline-flex px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          backgroundColor: config.bg,
                          color: config.text,
                        }}
                      >
                        {config.label}
                      </span>

                      {/* 队长编辑按钮 */}
                      {isCaptain && (
                        <button
                          onClick={() => setEditingGoal(goal)}
                          className="ml-auto text-xs text-brand-200 hover:text-primary transition-colors"
                          title="编辑"
                        >
                          编辑
                        </button>
                      )}
                    </div>

                    {/* 金额 + 进度条 */}
                    <div className="mb-3">
                      <div className="flex items-baseline gap-1 mb-1">
                        <span className="text-lg font-bold text-brand-400">
                          ¥{goal.currentAmount.toLocaleString()}
                        </span>
                        <span className="text-sm text-brand-200">
                          / ¥{goal.targetAmount.toLocaleString()}
                        </span>
                        <span className="text-xs text-brand-200 ml-auto">
                          {percentage}%
                        </span>
                      </div>
                      {/* 进度条 */}
                      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500 ease-out"
                          style={{
                            width: `${percentage}%`,
                            backgroundColor:
                              goal.status === 'completed'
                                ? '#10B981'
                                : goal.status === 'locked'
                                  ? '#CBD5E1'
                                  : '#6366F1',
                          }}
                        />
                      </div>
                    </div>

                    {/* ETA + 时间信息 */}
                    <div className="flex items-center gap-4 text-xs text-brand-300">
                      <span>{calculateETA(goal)}</span>
                      {goal.monthlyGrowth && goal.monthlyGrowth > 0 && (
                        <span>
                          月均增长 ¥{goal.monthlyGrowth.toLocaleString()}
                        </span>
                      )}
                      {goal.status === 'in_progress' && goal.targetAmount > goal.currentAmount && (
                        <span className="text-amber-600 font-medium">
                          还差 ¥{(goal.targetAmount - goal.currentAmount).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      )}

      {/* 确认弹窗 — 启用下一阶段 */}
      {showUnlockConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* 遮罩 */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowUnlockConfirm(false)}
          />
          {/* 弹窗卡片 */}
          <div className="relative bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading text-base font-semibold text-brand-400">确认启用</h3>
              <button
                onClick={() => setShowUnlockConfirm(false)}
                className="p-1 rounded-md hover:bg-gray-100 transition-colors"
              >
                <X className="w-4 h-4 text-brand-200" />
              </button>
            </div>
            <p className="text-sm text-brand-400 mb-2">
              即将启动 <span className="font-medium text-brand-400">{nextPhaseTitle}</span>
            </p>
            <p className="text-xs text-brand-200 mb-6">
              启用后该阶段将进入「进行中」状态，团队动态将同步通知。
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowUnlockConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-brand-400 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  unlockNextPhase()
                  setShowUnlockConfirm(false)
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-indigo-600 transition-colors"
              >
                确认启用
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑弹窗 */}
      {editingGoal && (
        <GoalEditModal
          isOpen={!!editingGoal}
          onClose={() => setEditingGoal(null)}
          goal={editingGoal}
        />
      )}

      {/* 新建弹窗 */}
      {newGoalOpen && (
        <GoalEditModal
          isOpen={newGoalOpen}
          onClose={() => setNewGoalOpen(false)}
          goal={null}
        />
      )}
      </>
      )}
    </div>

    {newPersonalGoalOpen && (
      <PersonalGoalModal
        isOpen={newPersonalGoalOpen}
        onClose={() => setNewPersonalGoalOpen(false)}
      />
    )}

    {editingPersonalGoal && (
      <PersonalGoalModal
        isOpen={!!editingPersonalGoal}
        onClose={() => setEditingPersonalGoal(null)}
        goal={editingPersonalGoal}
      />
    )}

    {/* 全局动画样式 */}
    <style dangerouslySetInnerHTML={{ __html: `
      @keyframes phaseGlow {
        0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); border-color: rgba(16, 185, 129, 0.3); }
        50% { box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.6); }
      }
      @keyframes phaseIconPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
      }
      .phase-completed-card {
        animation: phaseGlow 3s ease-in-out infinite;
        border: 1.5px solid rgba(16, 185, 129, 0.3);
      }
      .phase-completed-glow .lucide {
        animation: phaseIconPulse 3s ease-in-out infinite;
      }
      @keyframes fadeInZoom {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
      }
      .animate-fade-in-zoom {
        animation: fadeInZoom 0.2s ease-out;
      }
    `}} />
    </>
  )
}

function PersonalGoalsView({
  goals,
  currentUserId,
  onCreate,
  onEdit,
}: {
  goals: PersonalGoal[]
  currentUserId: string
  onCreate: () => void
  onEdit: (goal: PersonalGoal) => void
}) {
  const visibleGoals = useMemo(
    () => goals.filter((goal) => goal.userId === currentUserId || goal.visibility === 'team'),
    [currentUserId, goals]
  )

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-lg font-semibold text-brand-400">个人目标</h1>
          <p className="mt-1 text-sm text-brand-300">个人承诺、公开见证和阶段复盘，不用于排名考核。</p>
        </div>
        <button
          onClick={onCreate}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-indigo-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建个人目标
        </button>
      </div>

      {visibleGoals.length === 0 ? (
        <EmptyStateIllustration
          variant="goals"
          title="写下一个愿意被见证的目标"
          description="目标会有 24 小时冷静期，之后锁定核心信息，只追加进展和复盘。"
          action={
            <button
              onClick={onCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg bg-primary"
            >
              <Plus className="w-4 h-4" />
              新建个人目标
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleGoals.map((goal) => {
            const target = goal.targetAmount ?? 0
            const percent = target > 0 ? Math.min(100, Math.round((goal.currentAmount / target) * 100)) : 0
            const lockedLabel =
              goal.lockStatus === 'cooldown' ? '冷静期' :
              goal.lockStatus === 'locked' ? '已锁定' :
              goal.lockStatus === 'review' ? '复盘中' : '已解锁'

            return (
              <button
                key={goal.id}
                onClick={() => onEdit(goal)}
                className="rounded-xl border border-brand-100 bg-white p-5 text-left shadow-card transition hover:border-primary/30"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                      <UserRound className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="font-heading text-base font-semibold text-brand-400">{goal.title}</h3>
                      <p className="text-xs text-brand-200">{goal.goalType || '个人目标'} · {goal.visibility === 'team' ? '团队可见' : '仅自己可见'}</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-brand-50 px-2 py-1 text-xs text-brand-300">{lockedLabel}</span>
                </div>
                {goal.description && <p className="mb-3 text-sm text-brand-300">{goal.description}</p>}
                {target > 0 && (
                  <div className="mb-3">
                    <div className="mb-1 flex justify-between text-xs text-brand-300">
                      <span>{goal.currentAmount.toLocaleString()} / {target.toLocaleString()}</span>
                      <span>{percent}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-blue-500" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-brand-200">
                  <span>{goal.deadline ? `截止 ${goal.deadline}` : '未设置截止日'}</span>
                  <span>{goal.updates.length} 条进展</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
