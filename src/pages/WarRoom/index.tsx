import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FileCheck2, Link2, MessageSquare, Plus, Send, Shield, Trash2, X } from 'lucide-react'
import { useTaskStore } from '@/stores/useTaskStore'
import { useUserStore } from '@/stores/useUserStore'
import { useVoteStore } from '@/stores/useVoteStore'
import { useWarRoomStore } from '@/stores/useWarRoomStore'
import { isCaptainRole } from '@/services/profile'
import { formatRelative } from '@/utils/dateUtils'
import type { WarRoomPolicy } from '@/types/warroom'

const CATEGORY_LABEL: Record<WarRoomPolicy['category'], string> = {
  strategy: '经营策略',
  process: '制度流程',
  client: '客户项目',
  finance: '财务库存',
  team: '团队建设',
}

const STATUS_LABEL: Record<WarRoomPolicy['status'], string> = {
  discussing: '讨论中',
  voting: '待投票',
  decided: '已形成决议',
  archived: '已归档',
}

const PRIORITY_LABEL: Record<WarRoomPolicy['priority'], string> = {
  low: '普通',
  medium: '重要',
  high: '紧急',
}

type ExpandedPolicy = string | null

export default function WarRoomPage() {
  const policies = useWarRoomStore((s) => s.policies)
  const addPolicy = useWarRoomStore((s) => s.addPolicy)
  const updatePolicy = useWarRoomStore((s) => s.updatePolicy)
  const deletePolicy = useWarRoomStore((s) => s.deletePolicy)
  const addComment = useWarRoomStore((s) => s.addComment)
  const deleteComment = useWarRoomStore((s) => s.deleteComment)
  const currentUser = useUserStore((s) => s.currentUser)
  const users = useUserStore((s) => s.users)
  const votes = useVoteStore((s) => s.votes)
  const tasks = useTaskStore((s) => s.tasks)

  const [showNewModal, setShowNewModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState<WarRoomPolicy['category']>('strategy')
  const [newPriority, setNewPriority] = useState<WarRoomPolicy['priority']>('medium')
  const [expanded, setExpanded] = useState<ExpandedPolicy>(null)
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({})
  const [categoryFilter, setCategoryFilter] = useState<WarRoomPolicy['category'] | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<WarRoomPolicy['status'] | 'all'>('all')
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, string>>({})
  const [linkedVoteDrafts, setLinkedVoteDrafts] = useState<Record<string, string>>({})
  const [linkedTaskDrafts, setLinkedTaskDrafts] = useState<Record<string, string>>({})

  const isCaptain = isCaptainRole(currentUser?.role)

  const filteredPolicies = useMemo(
    () =>
      policies.filter((policy) => {
        if (categoryFilter !== 'all' && policy.category !== categoryFilter) return false
        if (statusFilter !== 'all' && policy.status !== statusFilter) return false
        return true
      }),
    [categoryFilter, policies, statusFilter]
  )

  const counts = useMemo(
    () => ({
      discussing: policies.filter((policy) => policy.status === 'discussing').length,
      voting: policies.filter((policy) => policy.status === 'voting').length,
      decided: policies.filter((policy) => policy.status === 'decided').length,
    }),
    [policies]
  )

  const getUserName = (userId: string) => users.find((user) => user.id === userId)?.name ?? '未知成员'

  const handlePublish = () => {
    if (!newTitle.trim() || !newContent.trim() || !currentUser) return
    addPolicy({
      title: newTitle.trim(),
      content: newContent.trim(),
      category: newCategory,
      priority: newPriority,
      creatorId: currentUser.id,
    })
    setNewTitle('')
    setNewContent('')
    setNewCategory('strategy')
    setNewPriority('medium')
    setShowNewModal(false)
  }

  const handleAddComment = (policyId: string) => {
    const text = (commentTexts[policyId] ?? '').trim()
    if (!text || !currentUser) return
    addComment(policyId, currentUser.id, text)
    setCommentTexts((prev) => ({ ...prev, [policyId]: '' }))
  }

  const toggleExpand = (policy: WarRoomPolicy) => {
    setExpanded((prev) => (prev === policy.id ? null : policy.id))
    setDecisionDrafts((prev) => ({ ...prev, [policy.id]: policy.decisionSummary ?? '' }))
    setLinkedVoteDrafts((prev) => ({ ...prev, [policy.id]: policy.linkedVoteId ?? '' }))
    setLinkedTaskDrafts((prev) => ({ ...prev, [policy.id]: policy.linkedTaskIds[0] ?? '' }))
  }

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 lg:px-6">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-red-500 shadow-lg shadow-amber-500/20">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-brand-400">军机处</h1>
            <p className="text-sm text-brand-200">议题讨论 · 投票前置 · 决议沉淀</p>
          </div>
        </div>
        {isCaptain && (
          <button
            onClick={() => setShowNewModal(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-red-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/20 transition hover:from-amber-600 hover:to-red-600"
          >
            <Plus className="h-4 w-4" />
            新建议题
          </button>
        )}
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Metric label="讨论中" value={counts.discussing} />
        <Metric label="待投票" value={counts.voting} />
        <Metric label="已形成决议" value={counts.decided} />
      </div>

      <div className="mb-5 flex flex-wrap gap-3 rounded-card bg-white p-3 shadow-card">
        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value as WarRoomPolicy['category'] | 'all')}
          className="rounded-lg border border-brand-100 px-3 py-2 text-sm text-brand-400 outline-none focus:border-amber-300"
        >
          <option value="all">全部分类</option>
          {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as WarRoomPolicy['status'] | 'all')}
          className="rounded-lg border border-brand-100 px-3 py-2 text-sm text-brand-400 outline-none focus:border-amber-300"
        >
          <option value="all">全部状态</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-4">
        {filteredPolicies.map((policy) => {
          const isExpanded = expanded === policy.id
          const linkedVote = votes.find((vote) => vote.id === policy.linkedVoteId)
          const linkedTask = tasks.find((task) => task.id === policy.linkedTaskIds[0])
          return (
            <article key={policy.id} className="overflow-hidden rounded-card border border-brand-100 bg-white shadow-card">
              <button onClick={() => toggleExpand(policy)} className="block w-full p-5 text-left">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone="amber">{CATEGORY_LABEL[policy.category]}</Badge>
                  <Badge tone={policy.status === 'decided' ? 'green' : policy.status === 'voting' ? 'blue' : 'gray'}>
                    {STATUS_LABEL[policy.status]}
                  </Badge>
                  <Badge tone={policy.priority === 'high' ? 'red' : 'gray'}>{PRIORITY_LABEL[policy.priority]}</Badge>
                  <span className="text-xs text-brand-200">{formatRelative(policy.createdAt)}</span>
                </div>
                <h2 className="font-heading text-lg font-semibold text-brand-400">{policy.title}</h2>
                <p className={`mt-2 text-sm leading-relaxed text-brand-300 ${isExpanded ? '' : 'line-clamp-2'}`}>{policy.content}</p>
                {policy.decisionSummary && (
                  <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    结论：{policy.decisionSummary}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-brand-50 pt-3 text-xs text-brand-200">
                  <span>发起人：{getUserName(policy.creatorId)}</span>
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare className="h-3.5 w-3.5" />
                    {policy.comments.length} 条讨论
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-brand-100 bg-brand-50/50 p-5">
                  <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-brand-400">讨论区</h3>
                      <div className="mb-4 space-y-3">
                        {policy.comments.length === 0 ? (
                          <p className="rounded-xl bg-white px-4 py-5 text-center text-sm text-brand-200">暂无讨论，发表第一条意见吧</p>
                        ) : policy.comments.map((comment) => (
                          <div key={comment.id} className="flex gap-3 rounded-xl border border-brand-50 bg-white p-3">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-200 text-[10px] font-bold text-white">
                              {getUserName(comment.userId).charAt(0)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-brand-400">{getUserName(comment.userId)}</p>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-brand-300">{comment.content}</p>
                            </div>
                            {currentUser?.id === comment.userId && (
                              <button onClick={() => deleteComment(policy.id, comment.id)} className="text-brand-100 hover:text-red-500">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={commentTexts[policy.id] ?? ''}
                          onChange={(event) => setCommentTexts((prev) => ({ ...prev, [policy.id]: event.target.value }))}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') handleAddComment(policy.id)
                          }}
                          placeholder="发表你的意见..."
                          className="flex-1 rounded-lg border border-brand-100 bg-white px-3 py-2 text-sm outline-none focus:border-amber-300"
                        />
                        <button onClick={() => handleAddComment(policy.id)} className="rounded-lg bg-amber-500 px-3 py-2 text-white hover:bg-amber-600">
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-xl bg-white p-4">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-400">
                        <FileCheck2 className="h-4 w-4 text-emerald-600" />
                        决议沉淀
                      </h3>
                      {isCaptain && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <select
                            value={policy.status}
                            onChange={(event) => updatePolicy(policy.id, { status: event.target.value as WarRoomPolicy['status'] })}
                            className="rounded-lg border border-brand-100 px-3 py-2 text-sm"
                          >
                            {Object.entries(STATUS_LABEL).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                          <select
                            value={policy.priority}
                            onChange={(event) => updatePolicy(policy.id, { priority: event.target.value as WarRoomPolicy['priority'] })}
                            className="rounded-lg border border-brand-100 px-3 py-2 text-sm"
                          >
                            {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <textarea
                        value={decisionDrafts[policy.id] ?? ''}
                        onChange={(event) => setDecisionDrafts((prev) => ({ ...prev, [policy.id]: event.target.value }))}
                        readOnly={!isCaptain}
                        rows={3}
                        placeholder="写下最终结论、执行口径或待确认事项..."
                        className="w-full resize-none rounded-lg border border-brand-100 px-3 py-2 text-sm outline-none focus:border-emerald-300 read-only:bg-brand-50"
                      />
                      {isCaptain && (
                        <button
                          onClick={() => updatePolicy(policy.id, { decisionSummary: decisionDrafts[policy.id] ?? '' })}
                          className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                        >
                          保存结论
                        </button>
                      )}

                      <div className="border-t border-brand-100 pt-3">
                        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-400">
                          <Link2 className="h-4 w-4 text-blue-600" />
                          关联投票 / 执行任务
                        </h4>
                        {linkedVote && (
                          <Link to={`/votes/${linkedVote.id}`} className="mb-2 block rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100">
                            投票：{linkedVote.title}
                          </Link>
                        )}
                        {linkedTask && (
                          <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            任务：{linkedTask.title}
                          </div>
                        )}
                        {isCaptain && (
                          <div className="space-y-2">
                            <select
                              value={linkedVoteDrafts[policy.id] ?? ''}
                              onChange={(event) => setLinkedVoteDrafts((prev) => ({ ...prev, [policy.id]: event.target.value }))}
                              className="w-full rounded-lg border border-brand-100 px-3 py-2 text-sm"
                            >
                              <option value="">不关联投票</option>
                              {votes.map((vote) => <option key={vote.id} value={vote.id}>{vote.title}</option>)}
                            </select>
                            <select
                              value={linkedTaskDrafts[policy.id] ?? ''}
                              onChange={(event) => setLinkedTaskDrafts((prev) => ({ ...prev, [policy.id]: event.target.value }))}
                              className="w-full rounded-lg border border-brand-100 px-3 py-2 text-sm"
                            >
                              <option value="">不关联任务</option>
                              {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                            </select>
                            <button
                              onClick={() =>
                                updatePolicy(policy.id, {
                                  linkedVoteId: linkedVoteDrafts[policy.id] || undefined,
                                  linkedTaskIds: linkedTaskDrafts[policy.id] ? [linkedTaskDrafts[policy.id]] : [],
                                })
                              }
                              className="w-full rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
                            >
                              保存关联
                            </button>
                          </div>
                        )}
                      </div>

                      {currentUser?.id === policy.creatorId && (
                        <button
                          onClick={() => {
                            if (confirm('确定删除这条议题吗？所有讨论也将被删除。')) deletePolicy(policy.id)
                          }}
                          className="inline-flex items-center gap-1 text-xs text-brand-200 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除议题
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>

      {filteredPolicies.length === 0 && (
        <div className="rounded-card bg-white px-6 py-14 text-center shadow-card">
          <Shield className="mx-auto mb-3 h-12 w-12 text-brand-100" />
          <p className="text-sm text-brand-200">暂无符合条件的议题</p>
        </div>
      )}

      {showNewModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowNewModal(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-5 text-lg font-bold text-brand-400">新建议题</h3>
            <div className="space-y-3">
              <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="议题标题" className="w-full rounded-xl border border-brand-100 px-4 py-2.5 text-sm outline-none focus:border-amber-300" />
              <div className="grid gap-3 sm:grid-cols-2">
                <select value={newCategory} onChange={(event) => setNewCategory(event.target.value as WarRoomPolicy['category'])} className="rounded-xl border border-brand-100 px-4 py-2.5 text-sm">
                  {Object.entries(CATEGORY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select value={newPriority} onChange={(event) => setNewPriority(event.target.value as WarRoomPolicy['priority'])} className="rounded-xl border border-brand-100 px-4 py-2.5 text-sm">
                  {Object.entries(PRIORITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <textarea value={newContent} onChange={(event) => setNewContent(event.target.value)} placeholder="说明背景、争议点、希望团队讨论什么..." rows={5} className="w-full resize-none rounded-xl border border-brand-100 px-4 py-2.5 text-sm outline-none focus:border-amber-300" />
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setShowNewModal(false)} className="rounded-xl bg-brand-50 px-5 py-2.5 text-sm font-medium text-brand-300 hover:bg-brand-100">取消</button>
              <button onClick={handlePublish} disabled={!newTitle.trim() || !newContent.trim()} className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-40">发布</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card bg-white p-4 shadow-card">
      <p className="text-xs text-brand-200">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-brand-400">{value}</p>
    </div>
  )
}

function Badge({ children, tone }: { children: ReactNode; tone: 'amber' | 'green' | 'blue' | 'red' | 'gray' }) {
  const classes = {
    amber: 'bg-amber-50 text-amber-700',
    green: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    red: 'bg-red-50 text-red-700',
    gray: 'bg-brand-50 text-brand-300',
  }
  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${classes[tone]}`}>{children}</span>
}
