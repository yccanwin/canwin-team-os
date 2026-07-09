import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import ProfileHeader from './ProfileHeader'
import PersonalInfoCard from './PersonalInfoCard'
import PersonalGoalsCard from './PersonalGoalsCard'
import ProfileStoryBoard from './ProfileStoryBoard'
import ErrorBoundary from '@/components/ErrorBoundary'
import { useUserStore } from '@/stores/useUserStore'
import { isCaptainRole } from '@/services/profile'

export default function ProfilePage() {
  const [searchParams] = useSearchParams()
  const currentUser = useUserStore((s) => s.currentUser)
  const users = useUserStore((s) => s.users)
  const requestedUserId = searchParams.get('id')
  const displayUser = useMemo(() => {
    if (requestedUserId) {
      return users.find((user) => user.id === requestedUserId) ?? currentUser
    }
    return currentUser
  }, [currentUser, requestedUserId, users])

  if (!displayUser) {
    return (
      <div className="px-3 py-4 lg:px-6">
        <div className="mx-auto max-w-4xl rounded-card bg-white p-6 shadow-card">
          <p className="text-sm text-brand-300">用户信息加载失败，请刷新页面重试。</p>
        </div>
      </div>
    )
  }

  const canEdit = currentUser?.id === displayUser.id || isCaptainRole(currentUser?.role)

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 lg:px-6">
      <h1 className="mb-4 font-heading text-xl font-semibold text-brand-400">成员人物档案</h1>

      <div className="space-y-4">
        <ErrorBoundary moduleName="ProfileHeader">
          <ProfileHeader user={displayUser} />
        </ErrorBoundary>

        <ErrorBoundary moduleName="ProfileStoryBoard">
          <ProfileStoryBoard key={displayUser.id} user={displayUser} canEdit={canEdit} />
        </ErrorBoundary>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <ErrorBoundary moduleName="PersonalInfoCard">
            <PersonalInfoCard key={displayUser.id} user={displayUser} canEdit={canEdit} />
          </ErrorBoundary>
          <ErrorBoundary moduleName="PersonalGoalsCard">
            <PersonalGoalsCard user={displayUser} />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}
