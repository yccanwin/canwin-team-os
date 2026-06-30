import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Clock, Users, Vote as VoteIcon, CheckCircle2 } from 'lucide-react'
import { useVoteStore } from '@/stores/useVoteStore'
import { useUserStore } from '@/stores/useUserStore'
import StatusBadge from '@/components/StatusBadge'
import EmptyState from '@/components/EmptyState'
import CreateVoteModal from './CreateVoteModal'
import { isCaptainRole } from '@/services/profile'
import type { Vote, VoteRecord } from '@/types'

/** 计算截止倒计时 */
function getDeadlineLabel(deadline: string): { text: string; urgent: boolean } {
  const now = Date.now()
  const target = new Date(deadline).getTime()
  const diff = target - now

  if (diff <= 0) return { text: '已截止', urgent: false }

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)

  if (hours < 1) {
    const mins = Math.floor(diff / (1000 * 60))
    return { text: `还有 ${mins} 分钟`, urgent: true }
  }
  if (hours < 24) {
    return { text: `还有 ${hours} 小时`, urgent: true }
  }
  return { text: `还有 ${days} 天`, urgent: false }
}

export default function VotesPage() {
  const navigate = useNavigate()
  const votes = useVoteStore((s) => s.votes)
  const currentUser = useUserStore((s) => s.currentUser)
  const users = useUserStore((s) => s.users)
  const getUserById = useUserStore((s) => s.getUserById)

  const isCaptain = isCaptainRole(currentUser.role)
  const [showCreateModal, setShowCreateModal] = useState(false)

  // 排序：进行中的在前，已结束的在后；按 deadline 最近 -> 最远
  const sortedVotes = useMemo(() => {
    return [...votes].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
    })
  }, [votes])

  return (
    <div className="px-3 lg:px-6 py-4">
      {/* ========== 头部 ========== */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="">投票系统</h1>
          <p className="text-sm text-brand-300 mt-1">团队决策，人人参与</p>
        </div>
        {isCaptain && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
            style={{ backgroundColor: '#6366F1' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#4F46E5')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#6366F1')}
          >
            <Plus className="w-4 h-4" />
            发起投票
          </button>
        )}
      </div>

      {/* ========== 投票列表 ========== */}
      {sortedVotes.length === 0 ? (
        <EmptyState
          title="暂无投票"
          description="还没有任何投票议题，让队长来发起第一个吧"
          action={
            isCaptain ? (
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
                style={{ backgroundColor: '#6366F1' }}
              >
                <Plus className="w-4 h-4" />
                发起投票
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {sortedVotes.map((vote) => {
            const creator = getUserById(vote.createdBy)
            const deadlineInfo = getDeadlineLabel(vote.deadline)
            const totalUsers = users.length
            const votedCount = vote.votes.length
            const hasVoted = vote.votes.some((r) => r.userId === currentUser.id)

            return (
              <div
                key={vote.id}
                onClick={() => navigate(`/votes/${vote.id}`)}
                className="bg-white rounded-card shadow-card p-5 cursor-pointer hover:shadow-md transition-shadow group"
              >
                <div className="flex items-start justify-between">
                  {/* 左侧：议题信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-heading text-lg font-semibold text-brand-400 group-hover:text-indigo-600 transition-colors truncate">
                        {vote.title}
                      </h3>
                      <StatusBadge
                        label={vote.isActive ? '进行中' : '已结束'}
                        variant={vote.isActive ? 'info' : 'neutral'}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-sm text-brand-300">
                      {/* 发起人 */}
                      <span className="flex items-center gap-1">
                        由 <span className="font-medium text-brand-400">{creator?.name ?? '未知'}</span> 发起
                      </span>

                      {/* 截止时间 */}
                      <span className={`flex items-center gap-1 ${deadlineInfo.urgent ? 'text-red-500 font-medium' : ''}`}>
                        <Clock className="w-3.5 h-3.5" />
                        {deadlineInfo.text}
                      </span>

                      {/* 参与人数 */}
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        {votedCount}/{totalUsers} 人已投票
                      </span>

                      {/* 已投票标记 */}
                      {hasVoted && vote.isActive && (
                        <span className="flex items-center gap-1 text-green-600">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          已投票
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 右侧箭头 */}
                  <div className="flex-shrink-0 ml-4 text-neutral-tertiary group-hover:text-indigo-400 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ========== 创建投票弹窗 ========== */}
      <CreateVoteModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />

    </div>
  )
}
