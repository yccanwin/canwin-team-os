import { useState, useMemo } from 'react'
import { Search, Plus, Filter } from 'lucide-react'
import { useTimelineStore } from '../../stores/useTimelineStore'
import { useUserStore } from '../../stores/useUserStore'
import { CATEGORY_CONFIG, type TimelineEvent } from '../../types/timeline'
import TimelineAxis from '../../components/Timeline/TimelineAxis'
import EventModal from './EventModal'
import EventDetail from './EventDetail'
import { isCaptainRole } from '@/services/profile'

const CATEGORY_FILTERS = [
  { key: 'all', label: '全部', color: '#6B7280' },
  ...Object.entries(CATEGORY_CONFIG).map(([key, val]) => ({
    key,
    label: val.label,
    color: val.color,
  })),
]

export default function TimelinePage() {
  const { events, deleteEvent } = useTimelineStore()
  const currentUser = useUserStore((s) => s.currentUser)
  const isCaptain = isCaptainRole(currentUser?.role)

  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [keyword, setKeyword] = useState('')
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null)

  // Filter
  const filteredEvents = useMemo(() => {
    let list = [...events]
    if (activeCategory !== 'all') {
      list = list.filter((e) => e.category === activeCategory)
    }
    if (keyword.trim()) {
      const k = keyword.toLowerCase()
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(k) ||
          e.description?.toLowerCase().includes(k),
      )
    }
    // Sort by date descending
    list.sort((a, b) => b.date.localeCompare(a.date))
    return list
  }, [events, activeCategory, keyword])

  // Check if any events exist for empty state
  const hasAnyEvents = events.length > 0

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="">编年史</h1>
          <p className="text-sm text-brand-300 mt-1">记录团队的每一个重要时刻</p>
        </div>
        {isCaptain && (
          <button
            onClick={() => {
              setEditingEvent(null)
              setShowEditModal(true)
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            添加事件
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="mb-6 space-y-3">
        {/* Category Tabs */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setActiveCategory(f.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                activeCategory === f.key
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-brand-400 border border-brand-100 hover:border-gray-300 hover:bg-brand-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-200" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索事件标题或描述..."
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-brand-100 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-shadow"
          />
        </div>
      </div>

      {/* Timeline Content */}
      {filteredEvents.length > 0 ? (
        <TimelineAxis
          events={filteredEvents}
          onEventClick={(event) => setSelectedEvent(event)}
          currentUserId={currentUser?.id || ''}
          isCaptain={isCaptain}
        />
      ) : (
        <div className="text-center py-20">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <Filter className="w-8 h-8 text-neutral-tertiary" />
          </div>
          {hasAnyEvents ? (
            <>
              <h3 className="font-heading text-lg font-semibold text-brand-400">没有匹配的事件</h3>
              <p className="text-sm text-brand-200 mt-1">试试调整筛选条件或搜索关键词</p>
            </>
          ) : (
            <>
              <h3 className="font-heading text-lg font-semibold text-brand-400">暂无编年史事件</h3>
              <p className="text-sm text-brand-200 mt-1">
                {isCaptain ? '点击右上角「添加事件」开始记录团队时刻' : '等待队长添加第一个事件'}
              </p>
            </>
          )}
        </div>
      )}

      {/* Event Detail Modal */}
      {selectedEvent && (
        <EventDetail
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onEdit={() => {
            setEditingEvent(selectedEvent)
            setShowEditModal(true)
            setSelectedEvent(null)
          }}
          onDelete={() => {
            deleteEvent(selectedEvent.id)
          }}
          isCaptain={isCaptain}
        />
      )}

      {/* Edit/Create Modal */}
      {showEditModal && (
        <EventModal
          open={showEditModal}
          onClose={() => {
            setShowEditModal(false)
            setEditingEvent(null)
          }}
          event={editingEvent || undefined}
          isCaptain={isCaptain}
        />
      )}
    </div>
  )
}
