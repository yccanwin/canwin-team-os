import ProfileHeader from './ProfileHeader'
import ContributionStats from './ContributionStats'
import XPGrowthBar from './XPGrowthBar'
import BadgeGallery from './BadgeGallery'
import PersonalInfoCard from './PersonalInfoCard'
import ErrorBoundary from '@/components/ErrorBoundary'

export default function ProfilePage() {
  return (
    <div className="px-3 lg:px-6 py-4 max-w-4xl mx-auto">
      <h1 className="">个人主页</h1>

      <div className="space-y-4">
        <ErrorBoundary moduleName="ProfileHeader">
          <ProfileHeader />
        </ErrorBoundary>

        {/* 个人资料卡 — 自定义可编辑区域 */}
        <ErrorBoundary moduleName="PersonalInfoCard">
          <PersonalInfoCard />
        </ErrorBoundary>

        {/* 工资分红 + XP 进度 双栏布局 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ErrorBoundary moduleName="ContributionStats">
            <ContributionStats />
          </ErrorBoundary>
          <ErrorBoundary moduleName="XPGrowthBar">
            <XPGrowthBar />
          </ErrorBoundary>
        </div>

        <ErrorBoundary moduleName="BadgeGallery">
          <BadgeGallery />
        </ErrorBoundary>
      </div>
    </div>
  )
}
