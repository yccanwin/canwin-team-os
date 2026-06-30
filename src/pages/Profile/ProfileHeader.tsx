import { useUserStore } from '@/stores/useUserStore'
import { formatDate } from '@/utils/dateUtils'
import { CalendarDays } from 'lucide-react'
import { isCaptainRole } from '@/services/profile'
import type { User } from '@/types'

interface ProfileHeaderProps {
  user?: User
}

// 根据名字哈希生成颜色
function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 60%, 50%)`
}

export default function ProfileHeader({ user }: ProfileHeaderProps) {
  const currentUser = useUserStore((s) => s.currentUser)
  const displayUser = user ?? currentUser

  if (!displayUser) return null

  const color = avatarColor(displayUser.name)

  return (
    <div className="bg-white rounded-card shadow-card p-6">
      <div className="flex items-center gap-5">
        {/* 头像 - 哈希颜色 */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white flex-shrink-0"
          style={{ backgroundColor: color }}
        >
          {displayUser.name.charAt(0)}
        </div>

        {/* 信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h2 className="font-heading text-2xl font-semibold text-brand-400">{displayUser.name}</h2>

            {/* 队长标签 */}
            {isCaptainRole(displayUser.role) && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                👑 队长
              </span>
            )}
          </div>

          <p className="text-sm text-brand-300 mb-2">{displayUser.position}</p>

          <div className="flex items-center gap-1.5 text-xs text-brand-200">
            <CalendarDays className="w-3.5 h-3.5" />
            <span>{formatDate(displayUser.joinDate)} 入职</span>
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          <div className="text-sm font-semibold text-brand-400">
            协作档案
          </div>
          <p className="text-xs text-brand-200">身份、边界与真实记录</p>
        </div>
      </div>
    </div>
  )
}
