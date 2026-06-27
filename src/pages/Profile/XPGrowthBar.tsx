import { Zap, Trophy } from 'lucide-react'
import { useUserStore } from '@/stores/useUserStore'
import ProgressBar from '@/components/ProgressBar'
import { getXPProgress } from '@/utils/xpCalculator'

export default function XPGrowthBar() {
  const currentUser = useUserStore((s) => s.currentUser)

  if (!currentUser) return null

  const progress = getXPProgress(currentUser.xp)
  const isMaxLevel = currentUser.level >= 10

  return (
    <div className="bg-white rounded-card shadow-card p-5">
      {/* 等级标签 + XP 数值 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white bg-indigo-500">
            Lv.{currentUser.level}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-lg font-semibold text-brand-400">
                {isMaxLevel
                  ? `${currentUser.xp.toLocaleString()} XP`
                  : `${progress.current.toLocaleString()} / ${progress.next.toLocaleString()} XP`}
              </span>
            </div>
            {!isMaxLevel && (
              <p className="text-xs text-brand-200 mt-0.5">
                还差 {(progress.next - progress.current).toLocaleString()} XP 升到
                Lv.{currentUser.level + 1}
              </p>
            )}
            {isMaxLevel && (
              <p className="text-xs text-amber-500 mt-0.5 font-medium">
                <Trophy className="w-3 h-3 inline mr-1" />
                已达最高等级
              </p>
            )}
          </div>
        </div>

        <div className="text-right">
          <span className="text-2xl font-bold text-brand-400">{progress.percent}%</span>
          <p className="text-xs text-brand-200">进度</p>
        </div>
      </div>

      <ProgressBar
        progress={progress.percent}
        color="#6366F1"
        height={10}
        showPercent={false}
      />

      <div className="flex justify-between mt-2">
        <span className="text-xs text-brand-200">Lv.1</span>
        <span className="text-xs text-brand-200">Lv.10</span>
      </div>
    </div>
  )
}
