import { useMemo, useState } from 'react'
import {
  Archive,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  HeartHandshake,
  Lightbulb,
  Target,
  Vote,
} from 'lucide-react'
import { useAchievementStore } from '@/stores/useAchievementStore'
import { useAssetStore } from '@/stores/useAssetStore'
import { useInventoryStore } from '@/stores/useInventoryStore'
import { usePersonalGoalStore } from '@/stores/usePersonalGoalStore'
import { usePhotoStore } from '@/stores/usePhotoStore'
import { useTaskStore } from '@/stores/useTaskStore'
import { useTimelineStore } from '@/stores/useTimelineStore'
import { useToolboxStore } from '@/stores/useToolboxStore'
import { useUserStore } from '@/stores/useUserStore'
import { useVoteStore } from '@/stores/useVoteStore'
import { isCaptainRole } from '@/services/profile'
import type { User } from '@/types'

type ContributionKind =
  | 'task'
  | 'culture'
  | 'tool'
  | 'inventory'
  | 'decision'
  | 'asset'
  | 'goal'

type ContributionItem = {
  id: string
  kind: ContributionKind
  label: string
  title: string
  createdAt: string
}

const KIND_META: Record<ContributionKind, { label: string; icon: typeof CheckCircle2; color: string }> = {
  task: { label: '任务推进者', icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50' },
  culture: { label: '文化记录官', icon: HeartHandshake, color: 'text-sky-600 bg-sky-50' },
  tool: { label: '工具分享者', icon: Lightbulb, color: 'text-amber-600 bg-amber-50' },
  inventory: { label: '仓库守护者', icon: Boxes, color: 'text-indigo-600 bg-indigo-50' },
  decision: { label: '决策参与者', icon: Vote, color: 'text-violet-600 bg-violet-50' },
  asset: { label: '资产维护者', icon: Archive, color: 'text-slate-600 bg-slate-50' },
  goal: { label: '目标实践者', icon: Target, color: 'text-rose-600 bg-rose-50' },
}

function userOptions(users: User[], currentUser: User | null): User[] {
  const activeUsers = users.filter((user) => user.id && user.name)
  if (activeUsers.length > 0) return activeUsers
  return currentUser ? [currentUser] : []
}

export default function ContributionStats() {
  const currentUser = useUserStore((s) => s.currentUser)
  const users = useUserStore((s) => s.users)
  const tasks = useTaskStore((s) => s.tasks)
  const timelineEvents = useTimelineStore((s) => s.events)
  const achievements = useAchievementStore((s) => s.achievements)
  const photos = usePhotoStore((s) => s.photos)
  const tools = useToolboxStore((s) => s.tools)
  const logs = useInventoryStore((s) => s.logs)
  const votes = useVoteStore((s) => s.votes)
  const assets = useAssetStore((s) => s.assets)
  const personalGoals = usePersonalGoalStore((s) => s.personalGoals)

  const isCaptain = isCaptainRole(currentUser?.role)
  const options = useMemo(() => userOptions(users, currentUser), [currentUser, users])
  const [selectedUserId, setSelectedUserId] = useState(currentUser?.id ?? '')
  const targetUserId = isCaptain ? selectedUserId || currentUser?.id || '' : currentUser?.id || ''

  const contributions = useMemo<ContributionItem[]>(() => {
    if (!targetUserId) return []

    const completedTasks = tasks
      .filter((task) => task.assigneeId === targetUserId && task.status === 'done')
      .map((task) => ({
        id: `task-${task.id}`,
        kind: 'task' as const,
        label: '完成任务',
        title: task.title,
        createdAt: task.completedAt || task.createdAt,
      }))

    const cultureRecords = [
      ...timelineEvents
        .filter((event) => event.createdBy === targetUserId || event.participants.includes(targetUserId))
        .map((event) => ({
          id: `timeline-${event.id}`,
          kind: 'culture' as const,
          label: event.createdBy === targetUserId ? '记录团队记忆' : '参与团队记忆',
          title: event.title,
          createdAt: event.createdAt,
        })),
      ...achievements
        .filter((achievement) => achievement.createdBy === targetUserId)
        .map((achievement) => ({
          id: `achievement-${achievement.id}`,
          kind: 'culture' as const,
          label: '沉淀案例',
          title: achievement.name,
          createdAt: achievement.createdAt,
        })),
      ...photos
        .filter((photo) => photo.uploadedBy === targetUserId || photo.participants.includes(targetUserId))
        .map((photo) => ({
          id: `photo-${photo.id}`,
          kind: 'culture' as const,
          label: photo.uploadedBy === targetUserId ? '上传照片' : '参与照片',
          title: photo.title || '团队瞬间',
          createdAt: photo.uploadedAt,
        })),
    ]

    const toolRecords = tools
      .filter((tool) => tool.creatorId === targetUserId)
      .map((tool) => ({
        id: `tool-${tool.id}`,
        kind: 'tool' as const,
        label: '分享工具',
        title: tool.title,
        createdAt: tool.createdAt,
      }))

    const inventoryRecords = logs
      .filter((log) => log.operatorId === targetUserId)
      .map((log) => ({
        id: `inventory-${log.id}`,
        kind: 'inventory' as const,
        label: log.operation === 'in' ? '入库记录' : '出库记录',
        title: `${log.itemName} x ${log.quantityChange}`,
        createdAt: log.createdAt,
      }))

    const decisionRecords = votes.flatMap((vote) =>
      vote.votes
        .filter((record) => record.userId === targetUserId)
        .map((record) => ({
          id: `vote-${vote.id}-${record.userId}`,
          kind: 'decision' as const,
          label: '参与决定',
          title: vote.title,
          createdAt: record.votedAt,
        }))
    )

    const assetRecords = assets
      .filter((asset) => asset.createdBy === targetUserId)
      .map((asset) => ({
        id: `asset-${asset.id}`,
        kind: 'asset' as const,
        label: '记录资产',
        title: asset.name,
        createdAt: asset.createdAt,
      }))

    const goalRecords = personalGoals
      .filter((goal) => goal.userId === targetUserId)
      .flatMap((goal) => [
        {
          id: `goal-${goal.id}`,
          kind: 'goal' as const,
          label: '创建个人目标',
          title: goal.title,
          createdAt: goal.createdAt,
        },
        ...goal.updates.map((update) => ({
          id: `goal-update-${update.id}`,
          kind: 'goal' as const,
          label: '追加目标进展',
          title: goal.title,
          createdAt: update.createdAt,
        })),
      ])

    return [
      ...completedTasks,
      ...cultureRecords,
      ...toolRecords,
      ...inventoryRecords,
      ...decisionRecords,
      ...assetRecords,
      ...goalRecords,
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [
    achievements,
    assets,
    logs,
    personalGoals,
    photos,
    targetUserId,
    tasks,
    timelineEvents,
    tools,
    votes,
  ])

  const counts = useMemo(() => {
    return contributions.reduce<Record<ContributionKind, number>>(
      (acc, item) => {
        acc[item.kind] += 1
        return acc
      },
      { task: 0, culture: 0, tool: 0, inventory: 0, decision: 0, asset: 0, goal: 0 }
    )
  }, [contributions])

  const topKinds = (Object.entries(counts) as [ContributionKind, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])

  if (!currentUser) {
    return (
      <section className="rounded-card bg-white p-5 shadow-card">
        <p className="text-sm text-brand-300">用户信息加载失败，请刷新页面重试</p>
      </section>
    )
  }

  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-brand-400">真实贡献画像</h2>
          <p className="mt-1 text-xs text-brand-200">根据正式记录自动生成，不支持手动填写</p>
        </div>
        <ClipboardCheck className="h-5 w-5 text-emerald-500" />
      </div>

      {isCaptain && options.length > 0 && (
        <label className="mb-4 block text-xs text-brand-300">
          查看成员
          <select
            value={targetUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-brand-400 outline-none focus:border-primary"
          >
            {options.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {topKinds.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {topKinds.slice(0, 6).map(([kind, count]) => {
            const meta = KIND_META[kind]
            const Icon = meta.icon
            return (
              <div key={kind} className="rounded-xl border border-gray-100 bg-brand-50/40 p-3">
                <div className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${meta.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <p className="text-sm font-medium text-brand-400">{meta.label}</p>
                <p className="mt-1 text-xs text-brand-200">{count} 条真实记录</p>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-xl bg-brand-50 px-4 py-5 text-center">
          <p className="text-sm text-brand-300">还没有可用于生成画像的正式记录</p>
        </div>
      )}

      <div className="mt-4 border-t border-gray-100 pt-4">
        <h3 className="mb-2 text-sm font-semibold text-brand-400">最近参与记录</h3>
        {contributions.length > 0 ? (
          <div className="space-y-2">
            {contributions.slice(0, 5).map((item) => {
              const meta = KIND_META[item.kind]
              const Icon = meta.icon
              return (
                <div key={item.id} className="flex items-start gap-2 rounded-lg bg-white py-1.5">
                  <div className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full ${meta.color}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-brand-400">{item.title}</p>
                    <p className="text-xs text-brand-200">{item.label}</p>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-brand-200">暂无参与记录</p>
        )}
      </div>
    </section>
  )
}
