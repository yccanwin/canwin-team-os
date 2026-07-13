import { useMemo, memo } from 'react'
import { Link } from 'react-router-dom'
import { Vote } from 'lucide-react'
import ProgressBar from '@/components/ProgressBar'
import EmptyState from '@/components/EmptyState'
import { useVoteStore } from '@/stores/useVoteStore'
import { useUserStore } from '@/stores/useUserStore'
import { daysUntil } from '@/utils/dateUtils'

const QuickVoteSection = memo(function QuickVoteSection() {
  const votes = useVoteStore((s) => s.votes)
  const getVoteStats = useVoteStore((s) => s.getVoteStats)
  const castVote = useVoteStore((s) => s.castVote)
  const currentUser = useUserStore((s) => s.currentUser)

  // 找到第一个活跃投票
  const activeVote = useMemo(() => votes.find((v) => v.isActive), [votes])

  if (!activeVote) {
    return (
      <section className="bg-white rounded-card shadow-card p-5">
        <h3 className="font-heading text-lg font-semibold text-brand-400 mb-4">快速投票</h3>
        <EmptyState title="暂无活跃投票" description="去投票页面发起新投票" />
        <Link
          to="/votes"
          className="block text-center text-xs text-primary hover:underline mt-2"
        >
          查看全部 →
        </Link>
      </section>
    )
  }

  const stats = getVoteStats(activeVote.id)
  const totalVotes = activeVote.votes.length
  const userVoted = activeVote.votes.some((v) => v.userId === currentUser.id)
  const remainingDays = daysUntil(activeVote.deadline)
  const deadlineText = remainingDays > 0
    ? `还有 ${remainingDays} 天`
    : remainingDays === 0
      ? '今天截止'
      : '已截止'

  const handleVote = (optionId: string) => {
    castVote(activeVote.id, currentUser.id, optionId)
  }

  return (
    <section className="bg-white rounded-card shadow-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading text-lg font-semibold text-brand-400">快速投票</h3>
        <span className="text-xs text-brand-200">{deadlineText}</span>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Vote className="w-4 h-4 text-primary" />
        <h4 className="text-sm font-medium text-brand-400">{activeVote.title}</h4>
      </div>

      <p className="text-xs text-brand-200 mb-4">
        已投票 {totalVotes} 人
        {userVoted && <span className="text-income ml-1">· 已投票</span>}
      </p>

      <div className="space-y-3">
        {stats.map((s) => (
          <div key={s.optionId}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-brand-400">{s.label}</span>
              <span className="text-xs text-brand-300">{s.count} 票 ({s.percentage}%)</span>
            </div>
            <div className="relative">
              <ProgressBar
                progress={s.percentage}
                color="#6366F1"
                showPercent={false}
              />
              {/* 投票按钮（未投时） */}
              {!userVoted && (
                <button
                  className="absolute inset-0 w-full h-full opacity-0"
                  onClick={() => handleVote(s.optionId)}
                >
                  投票
                </button>
              )}
            </div>
            {!userVoted && (
              <button
                className="text-xs text-primary hover:underline mt-1"
                onClick={() => handleVote(s.optionId)}
              >
                投此选项
              </button>
            )}
          </div>
        ))}
      </div>

      <Link
        to={`/votes/${activeVote.id}`}
        className="block text-center text-xs text-primary hover:underline mt-4 pt-3 border-t border-gray-100"
      >
        去投票 →
      </Link>
    </section>
  )
})

export default QuickVoteSection
