import { useUserStore } from '@/stores/useUserStore'
import { CATEGORY_CONFIG } from '@/types'
import type { TimelineEvent } from '@/types'
import { Clock } from 'lucide-react'

interface TimelineAxisProps {
  events: TimelineEvent[]
  onEventClick: (event: TimelineEvent) => void
  currentUserId: string
  isCaptain: boolean
}

export default function TimelineAxis({
  events,
  onEventClick,
  currentUserId,
}: TimelineAxisProps) {
  const getUserById = useUserStore((s) => s.getUserById)

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-brand-200">
        <Clock className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-sm">暂无事件记录</p>
        <p className="text-xs mt-1">添加第一个编年史事件吧</p>
      </div>
    )
  }

  // 按年份分组
  const grouped: Record<string, TimelineEvent[]> = {}
  events.forEach((e) => {
    const year = e.date.slice(0, 4)
    if (!grouped[year]) grouped[year] = []
    grouped[year].push(e)
  })

  // 年份降序
  const years = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  return (
    <div className="space-y-10">
      {years.map((year) => (
        <div key={year}>
          {/* 年份标题 */}
          <h3 className="font-heading text-2xl font-bold text-brand-400 mb-6">{year}</h3>

          {/* 竖线 + 事件列表 */}
          <div className="border-l-2 border-indigo-200 pl-8 space-y-6">
            {grouped[year].map((event) => {
              const cat = CATEGORY_CONFIG[event.category]
              const createdByUser = getUserById(event.createdBy)

              return (
                <div
                  key={event.id}
                  className="relative group cursor-pointer"
                  onClick={() => onEventClick(event)}
                >
                  {/* 圆点节点 */}
                  <div
                    className="absolute -left-[37px] w-[14px] h-[14px] rounded-full border-2 border-white shadow-sm"
                    style={{ backgroundColor: cat.color }}
                  />

                  {/* 事件卡片 */}
                  <div className="bg-white rounded-xl border border-brand-100 p-4 shadow-sm hover:shadow-md transition-shadow duration-200">
                    {/* 顶部：日期 + 分类标签 */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-xs text-brand-300 font-mono">
                        {event.date}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${cat.bg} ${cat.text}`}
                      >
                        {cat.icon} {cat.label}
                      </span>
                      {event.updatedAt && (
                        <span className="text-xs text-brand-200">（已编辑）</span>
                      )}
                    </div>

                    {/* 标题 */}
                    <h4 className="font-semibold text-brand-400 mb-1 group-hover:text-indigo-600 transition-colors">
                      {event.title}
                    </h4>

                    {/* 描述（≤2行截断）*/}
                    {event.description && (
                      <p className="text-sm text-brand-300 line-clamp-2 mb-3">
                        {event.description.replace(/\*\*(.+?)\*\*/g, '$1')}
                      </p>
                    )}

                    {/* 图片缩略图 */}
                    {event.images.length > 0 && (
                      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3 scrollbar-thin">
                        {event.images.slice(0, 5).map((img, i) => (
                          <img
                            key={i}
                            src={img}
                            alt=""
                            className="w-12 h-12 object-cover rounded-lg border border-brand-100 flex-shrink-0"
                          />
                        ))}
                        {event.images.length > 5 && (
                          <div className="w-12 h-12 rounded-lg bg-gray-100 border border-brand-100 flex items-center justify-center flex-shrink-0 text-xs text-brand-300">
                            +{event.images.length - 5}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 底部：参与人头像 + 创建人 */}
                    <div className="flex items-center justify-between">
                      {/* 参与人头像 */}
                      <div className="flex items-center gap-1">
                        {event.participants.slice(0, 3).map((pid) => {
                          const u = getUserById(pid)
                          return (
                            <div
                              key={pid}
                              className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary border border-primary/20"
                              title={u?.name || pid}
                            >
                              {u?.name?.charAt(0) || '?'}
                            </div>
                          )
                        })}
                        {event.participants.length > 3 && (
                          <span className="text-xs text-brand-200 ml-1">
                            +{event.participants.length - 3}
                          </span>
                        )}
                        {event.participants.length === 0 && (
                          <span className="text-xs text-brand-200">无参与人</span>
                        )}
                      </div>

                      {/* 创建人 */}
                      <span className="text-xs text-brand-200">
                        {createdByUser?.name || '未知'}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
