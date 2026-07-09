import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Clock, Users, CheckCircle2, Lock, ChevronDown, ChevronUp, User } from 'lucide-react'
import { useVoteStore } from '@/stores/useVoteStore'
import { useUserStore } from '@/stores/useUserStore'
import { useWarRoomStore } from '@/stores/useWarRoomStore'
import StatusBadge from '@/components/StatusBadge'
import ProgressBar from '@/components/ProgressBar'
import { formatDate } from '@/utils/dateUtils'

/** 计算截止倒计时 */
function getDeadlineLabel(deadline: string): { text: string; urgent: boolean; expired: boolean } {
  const now = Date.now()
  const target = new Date(deadline).getTime()
  const diff = target - now

  if (diff <= 0) return { text: '已截止', urgent: false, expired: true }

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)

  if (hours < 1) {
    const mins = Math.floor(diff / (1000 * 60))
    return { text: `还有 ${mins} 分钟`, urgent: true, expired: false }
  }
  if (hours < 24) {
    return { text: `还有 ${hours} 小时`, urgent: true, expired: false }
  }
  return { text: `还有 ${days} 天`, urgent: false, expired: false }
}

const optionColors = ['#6366F1', '#8B5CF6', '#EC4899']

export default function VoteDetail() {
  const { voteId } = useParams<{ voteId: string }>()
  const navigate = useNavigate()

  const votes = useVoteStore((s) => s.votes)
  const castVote = useVoteStore((s) => s.castVote)
  const getVoteStats = useVoteStore((s) => s.getVoteStats)
  const currentUser = useUserStore((s) => s.currentUser)
  const users = useUserStore((s) => s.users)
  const policies = useWarRoomStore((s) => s.policies)

  const vote = votes.find((v) => v.id === voteId)

  const [showVoters, setShowVoters] = useState(false)

  // 自动过期检测
  useEffect(() => {
    if (vote && vote.isActive && new Date(vote.deadline) < new Date()) {
      useVoteStore.getState().closeVote(vote.id)
    }
  }, [vote])

  if (!vote) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <button
          onClick={() => navigate('/votes')}
          className="inline-flex items-center gap-1.5 text-sm text-brand-300 hover:text-brand-400 transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          返回投票列表
        </button>
        <div className="bg-white rounded-card shadow-card p-12 text-center">
          <p className="text-lg text-brand-200">投票不存在或已被删除</p>
        </div>
      </div>
    )
  }

  const creator = users.find((u) => u.id === vote.createdBy)
  const deadlineInfo = getDeadlineLabel(vote.deadline)
  const isExpired = deadlineInfo.expired || !vote.isActive
  const stats = getVoteStats(vote.id)
  const totalVotes = vote.votes.length
  const totalUsers = users.length
  const myVote = vote.votes.find((r) => r.userId === currentUser.id)
  const sourcePolicy = policies.find((policy) => policy.linkedVoteId === vote.id)

  // 最高票选项
  const maxVotes = Math.max(...stats.map((s) => s.count), 0)

  const handleVote = (optionId: string) => {
    if (isExpired || myVote) return
    castVote(vote.id, currentUser.id, optionId)
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* 返回按钮 */}
      <button
        onClick={() => navigate('/votes')}
        className="inline-flex items-center gap-1.5 text-sm text-brand-300 hover:text-brand-400 transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        返回投票列表
      </button>

      {/* 头部 */}
      <div className="bg-white rounded-card shadow-card p-6 mb-4">
        <div className="flex items-start justify-between mb-3">
          <h1 className="">{vote.title}</h1>
          <StatusBadge
            label={isExpired ? '已结束' : '进行中'}
            variant={isExpired ? 'neutral' : 'info'}
          />
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm text-brand-300">
          <span className="flex items-center gap-1">
            <User className="w-3.5 h-3.5" />
            由 <span className="font-medium text-brand-400">{creator?.name ?? '未知'}</span> 发起
          </span>
          <span className={`flex items-center gap-1 ${deadlineInfo.urgent ? 'text-red-500 font-medium' : ''}`}>
            <Clock className="w-3.5 h-3.5" />
            截止：{formatDate(vote.deadline)}
            <span className={deadlineInfo.urgent ? '' : 'text-brand-200'}>
              （{deadlineInfo.text}）
            </span>
          </span>
          <span className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            {totalVotes}/{totalUsers} 人已投票
          </span>
        </div>
        {sourcePolicy && (
          <button
            onClick={() => navigate('/warroom')}
            className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-left text-sm text-amber-800 hover:bg-amber-100"
          >
            来源军机处议题：{sourcePolicy.title}
          </button>
        )}

        {/* 投票锁定横幅 */}
        {isExpired && (
          <div className="mt-4 flex items-center justify-center gap-2 py-2.5 bg-gray-100 rounded-lg text-sm text-brand-400">
            <Lock className="w-4 h-4" />
            投票已结束
          </div>
        )}
        {isExpired && stats.length > 0 && (
          <div className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            最终结果：{stats.slice().sort((a, b) => b.count - a.count)[0].label} · 参与率 {totalUsers ? Math.round((totalVotes / totalUsers) * 100) : 0}%
          </div>
        )}
      </div>

      {/* 选项列表 */}
      <div className="bg-white rounded-card shadow-card p-6 mb-4">
        <h3 className="font-heading text-sm font-semibold text-brand-400 mb-4">
          {isExpired ? '投票结果' : '请选择你的投票'}
        </h3>

        <div className="space-y-3">
          {stats.map((stat, index) => {
            const isLeading = isExpired && stat.count === maxVotes && maxVotes > 0
            const isSelected = myVote?.optionId === stat.optionId

            return (
              <div
                key={stat.optionId}
                onClick={() => handleVote(stat.optionId)}
                className={`relative p-4 rounded-lg border-2 transition-all ${
                  isExpired
                    ? isLeading
                      ? 'border-indigo-400 bg-indigo-50/50 cursor-default'
                      : 'border-gray-100 cursor-default'
                    : myVote
                      ? isSelected
                        ? 'border-indigo-400 bg-indigo-50/50 cursor-pointer'
                        : 'border-gray-100 cursor-default opacity-60'
                      : 'border-gray-100 hover:border-indigo-300 cursor-pointer'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: optionColors[index] || '#6B7280' }}
                    >
                      {String.fromCharCode(65 + index)}
                    </span>
                    <span className="text-sm font-medium text-brand-400">{stat.label}</span>
                    {isSelected && !isExpired && (
                      <CheckCircle2 className="w-4 h-4 text-indigo-500" />
                    )}
                    {isLeading && isExpired && (
                      <span className="text-xs font-medium text-indigo-600">🏆 领先</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-brand-400">
                      {stat.count} 票
                    </span>
                    <span className="text-xs text-brand-200">
                      ({stat.percentage}%)
                    </span>
                  </div>
                </div>

                {/* 进度条 */}
                <ProgressBar
                  progress={stat.percentage}
                  color={optionColors[index] || '#6366F1'}
                  height={6}
                  showPercent={false}
                />
              </div>
            )
          })}
        </div>

        {/* 投票状态提示 */}
        {!isExpired && (
          <div className="mt-4 text-center">
            {myVote ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-indigo-600 bg-indigo-50 px-4 py-2 rounded-full">
                <CheckCircle2 className="w-4 h-4" />
                你已投了「{stats.find((s) => s.optionId === myVote.optionId)?.label}」
              </span>
            ) : (
              <span className="text-sm text-brand-200">
                你还没投票，点击选项进行投票
              </span>
            )}
          </div>
        )}
      </div>

      {/* 投票人列表 */}
      <div className="bg-white rounded-card shadow-card">
        <button
          onClick={() => setShowVoters(!showVoters)}
          className="w-full flex items-center justify-between px-6 py-4 text-sm font-medium text-brand-400 hover:bg-brand-50 transition-colors rounded-t-card"
        >
          <span className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            投票人名单（{totalVotes}）
          </span>
          {showVoters ? (
            <ChevronUp className="w-4 h-4 text-brand-200" />
          ) : (
            <ChevronDown className="w-4 h-4 text-brand-200" />
          )}
        </button>

        {showVoters && (
          <div className="px-6 pb-4 divide-y divide-gray-50">
            {totalVotes === 0 ? (
              <p className="py-4 text-sm text-brand-200 text-center">暂无投票</p>
            ) : (
              vote.votes.map((record) => {
                const voter = users.find((u) => u.id === record.userId)
                const option = vote.options.find((o) => o.id === record.optionId)
                return (
                  <div key={record.userId} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ backgroundColor: '#6366F1' }}
                      >
                        {voter?.name?.charAt(0) ?? '?'}
                      </div>
                      <span className="text-sm text-brand-400">{voter?.name ?? '未知用户'}</span>
                    </div>
                    <span className="text-xs text-brand-300">
                      投了「{option?.label ?? '未知'}」
                    </span>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
