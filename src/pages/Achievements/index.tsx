import { useState, useMemo } from 'react'
import { Plus, Trophy, Search } from 'lucide-react'
import { useAchievementStore } from '@/stores/useAchievementStore'
import { useUserStore } from '@/stores/useUserStore'
import AchievementDetailModal from './AchievementDetailModal'
import AchievementFormModal from './AchievementFormModal'
import EmptyStateIllustration from '@/components/EmptyStateIllustration'
import type { Achievement } from '@/types'

// 分类筛选配置
const CATEGORY_TABS = [
  { key: 'all', label: '全部' },
  { key: 'chain', label: '连锁' },
  { key: 'big-meal', label: '大餐' },
  { key: 'small-meal', label: '小餐' },
  { key: 'other', label: '其他' },
] as const

const CATEGORY_LABELS: Record<string, string> = {
  chain: '连锁',
  'big-meal': '大餐',
  'small-meal': '小餐',
  other: '其他',
}

export default function AchievementsPage() {
  const { achievements, addAchievement, updateAchievement, deleteAchievement } =
    useAchievementStore()
  const currentUser = useUserStore((s) => s.currentUser)
  const isCaptain = currentUser?.role === 'captain'

  // 筛选 + 搜索
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [keyword, setKeyword] = useState('')

  // 弹窗状态
  const [detailAch, setDetailAch] = useState<Achievement | null>(null)
  const [formAch, setFormAch] = useState<Achievement | null | 'new'>(null)

  // 筛选逻辑
  const filtered = useMemo(() => {
    let list = achievements
    if (activeCategory !== 'all') {
      list = list.filter((a) => a.category === activeCategory)
    }
    if (keyword.trim()) {
      const k = keyword.toLowerCase()
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(k) ||
          a.description.toLowerCase().includes(k)
      )
    }
    return list
  }, [achievements, activeCategory, keyword])

  // 删除
  const handleDelete = (id: string) => {
    deleteAchievement(id)
    setDetailAch(null)
  }

  // 提交表单
  const handleSubmit = (
    data: Omit<Achievement, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>
  ) => {
    if (formAch === 'new') {
      addAchievement({ ...data, createdBy: currentUser!.id })
    } else if (formAch && typeof formAch === 'object') {
      updateAchievement(formAch.id, data)
    }
    setFormAch(null)
  }

  return (
    <div className="px-3 lg:px-6 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="">案例馆</h1>
          <p className="text-sm text-brand-300 mt-1">
            记录团队的标杆案例
          </p>
        </div>
        {isCaptain && (
          <button
            onClick={() => setFormAch('new')}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加案例
          </button>
        )}
      </div>

      {/* Filter + Search Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
        {/* Category Tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveCategory(tab.key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeCategory === tab.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-brand-400 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-200" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索案例..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
          />
        </div>
      </div>

      {/* Empty State */}
      {achievements.length === 0 ? (
        <EmptyStateIllustration
          variant="achievements"
          title="每个里程碑都值得被铭记"
          description={
            isCaptain
              ? '点击右上角添加第一个案例'
              : '等待队长添加团队案例'
          }
        />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-brand-200">
          <p className="text-lg font-medium text-brand-300">
            没有匹配的案例
          </p>
          <p className="text-sm mt-1">
            试试调整筛选条件
          </p>
        </div>
      ) : null}

      {/* Grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filtered.map((ach) => (
            <button
              key={ach.id}
              onClick={() => setDetailAch(ach)}
              className="bg-white rounded-2xl border border-gray-100 p-5 text-center hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
            >
              {/* Logo */}
              {ach.icon ? (
                <div className="w-16 h-16 mx-auto mb-3 rounded-xl overflow-hidden border border-gray-100 bg-brand-50 flex items-center justify-center">
                  <img
                    src={ach.icon}
                    alt={ach.name}
                    className="w-12 h-12 object-contain"
                  />
                </div>
              ) : (
                <div className="w-16 h-16 mx-auto mb-3 rounded-xl bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center text-neutral-tertiary text-2xl">
                  🏢
                </div>
              )}

              {/* Name */}
              <h3 className="font-heading text-base font-bold text-brand-400 mb-1 line-clamp-1">
                {ach.name}
              </h3>

              {/* Date */}
              <p className="text-sm text-brand-200">
                {ach.achievedDate.slice(0, 7).replace('-', '.')}
              </p>

              {/* Category Badge */}
              <span className="inline-block mt-2 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-600">
                {CATEGORY_LABELS[ach.category] || ach.category}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {detailAch && (
        <AchievementDetailModal
          achievement={detailAch}
          onClose={() => setDetailAch(null)}
          onEdit={(ach) => {
            setDetailAch(null)
            setFormAch(ach)
          }}
          onDelete={handleDelete}
          isCaptain={isCaptain}
        />
      )}

      {/* Form Modal */}
      {(formAch === 'new' || (formAch && typeof formAch === 'object')) && (
        <AchievementFormModal
          achievement={formAch === 'new' ? undefined : (formAch as Achievement)}
          onClose={() => setFormAch(null)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}
