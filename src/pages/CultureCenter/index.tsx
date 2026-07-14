import { useMemo } from 'react'
import { BookOpen, Camera, ChevronRight, Images, Landmark, Sparkles, Trophy } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import AchievementsPage from '@/pages/Achievements'
import PhotosPage from '@/pages/Photos'
import TimelinePage from '@/pages/Timeline'
import { useAchievementStore } from '@/stores/useAchievementStore'
import { usePhotoStore } from '@/stores/usePhotoStore'
import { useTimelineStore } from '@/stores/useTimelineStore'

type CultureView = 'overview' | 'timeline' | 'achievements' | 'photos'

const tabs: Array<{ key: CultureView; label: string; icon: typeof Sparkles }> = [
  { key: 'overview', label: '文化首页', icon: Sparkles },
  { key: 'timeline', label: '编年史', icon: Landmark },
  { key: 'achievements', label: '案例馆', icon: Trophy },
  { key: 'photos', label: '团队相册', icon: Images },
]

function isCultureView(value: string | null): value is CultureView {
  return value === 'overview' || value === 'timeline' || value === 'achievements' || value === 'photos'
}

export default function CultureCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const activeView: CultureView = isCultureView(requestedView) ? requestedView : 'overview'
  const events = useTimelineStore((state) => state.events)
  const achievements = useAchievementStore((state) => state.achievements)
  const photos = usePhotoStore((state) => state.photos)

  const selectView = (view: CultureView) => {
    const next = new URLSearchParams(searchParams)
    next.set('view', view)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-violet-50/70 via-white to-white">
      <header className="relative overflow-hidden border-b border-violet-100 bg-gradient-to-br from-slate-950 via-indigo-950 to-fuchsia-950 px-4 py-7 text-white lg:px-6">
        <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-cyan-400/15 blur-3xl" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-violet-300">
              <BookOpen className="h-4 w-4" />
              Team legacy
            </div>
            <h1 className="font-heading text-2xl font-semibold sm:text-3xl">团队文化</h1>
            <p className="mt-2 max-w-2xl text-sm text-violet-100/80">把重要时刻、实战案例和并肩同行的画面，沉淀为团队共同履历。</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:min-w-[360px]">
            <CultureMetric label="团队记忆" value={events.length} className="text-cyan-200" />
            <CultureMetric label="实战案例" value={achievements.length} className="text-amber-200" />
            <CultureMetric label="团队照片" value={photos.length} className="text-pink-200" />
          </div>
        </div>
      </header>

      <nav aria-label="团队文化二级导航" className="sticky top-0 z-10 border-b border-brand-100 bg-white/95 px-3 py-3 backdrop-blur lg:px-6">
        <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-4 sm:pb-0">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const selected = tab.key === activeView
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => selectView(tab.key)}
                aria-current={selected ? 'page' : undefined}
                className={`flex min-w-fit items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${selected ? 'border-violet-300 bg-violet-50 text-violet-800 shadow-sm' : 'border-transparent text-brand-300 hover:border-brand-100 hover:bg-brand-50'}`}
              >
                <Icon className={`h-4 w-4 ${selected ? 'text-violet-600' : 'text-brand-200'}`} />
                {tab.label}
              </button>
            )
          })}
        </div>
      </nav>

      {activeView === 'overview' && <CultureOverview onSelect={selectView} />}
      {activeView === 'timeline' && <TimelinePage />}
      {activeView === 'achievements' && <AchievementsPage />}
      {activeView === 'photos' && <PhotosPage />}
    </div>
  )
}

function CultureOverview({ onSelect }: { onSelect: (view: CultureView) => void }) {
  const events = useTimelineStore((state) => state.events)
  const achievements = useAchievementStore((state) => state.achievements)
  const photos = usePhotoStore((state) => state.photos)

  const latestEvents = useMemo(() => [...events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3), [events])
  const latestCases = useMemo(
    () => [...achievements].sort((a, b) => b.achievedDate.localeCompare(a.achievedDate)).slice(0, 3),
    [achievements],
  )
  const latestPhotos = useMemo(() => [...photos].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6), [photos])

  return (
    <main className="grid gap-5 px-3 py-5 lg:grid-cols-12 lg:px-6 lg:py-6">
      <section className="overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-card lg:col-span-7">
        <SectionHeader icon={Landmark} title="最近记忆" action="查看编年史" onClick={() => onSelect('timeline')} tone="violet" />
        {latestEvents.length ? (
          <div className="divide-y divide-brand-100 px-5">
            {latestEvents.map((event) => (
              <article key={event.id} className="grid grid-cols-[72px_1fr] gap-4 py-4">
                <time className="text-sm font-semibold text-violet-600">{event.date}</time>
                <div>
                  <h3 className="font-semibold text-brand-400">{event.title}</h3>
                  {event.description && <p className="mt-1 line-clamp-2 text-sm text-brand-300">{event.description}</p>}
                </div>
              </article>
            ))}
          </div>
        ) : <EmptyCopy text="还没有团队记忆，第一条编年史会出现在这里。" />}
      </section>

      <section className="overflow-hidden rounded-2xl border border-amber-100 bg-white shadow-card lg:col-span-5">
        <SectionHeader icon={Trophy} title="最新案例" action="进入案例馆" onClick={() => onSelect('achievements')} tone="amber" />
        {latestCases.length ? (
          <div className="space-y-3 p-4">
            {latestCases.map((item, index) => (
              <article key={item.id} className="rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-xs font-bold text-white">{index + 1}</span>
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-brand-400">{item.name}</h3>
                    <p className="mt-1 text-xs text-amber-700">{item.achievedDate}</p>
                    {item.description && <p className="mt-2 line-clamp-2 text-sm text-brand-300">{item.description}</p>}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : <EmptyCopy text="还没有案例，沉淀后的实战经验会出现在这里。" />}
      </section>

      <section className="overflow-hidden rounded-2xl border border-pink-100 bg-white shadow-card lg:col-span-12">
        <SectionHeader icon={Camera} title="团队影像" action="打开相册" onClick={() => onSelect('photos')} tone="pink" />
        {latestPhotos.length ? (
          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6">
            {latestPhotos.map((photo) => (
              <button key={photo.id} type="button" onClick={() => onSelect('photos')} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-pink-50 text-left">
                <img src={photo.url} alt={photo.title || '团队照片'} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2 pt-8 text-xs font-medium text-white">
                  {photo.title || photo.date}
                </span>
              </button>
            ))}
          </div>
        ) : <EmptyCopy text="还没有团队照片，第一张影像会出现在这里。" />}
      </section>
    </main>
  )
}

function CultureMetric({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur">
      <p className={`text-[11px] ${className}`}>{label}</p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
    </div>
  )
}

function SectionHeader({ icon: Icon, title, action, onClick, tone }: { icon: typeof Trophy; title: string; action: string; onClick: () => void; tone: 'violet' | 'amber' | 'pink' }) {
  const toneClass = { violet: 'bg-violet-50 text-violet-600', amber: 'bg-amber-50 text-amber-600', pink: 'bg-pink-50 text-pink-600' }[tone]
  return (
    <div className="flex items-center justify-between border-b border-brand-100 px-5 py-4">
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${toneClass}`}><Icon className="h-5 w-5" /></span>
        <h2 className="font-heading text-lg font-semibold text-brand-400">{title}</h2>
      </div>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-300 hover:text-brand-400">
        {action}<ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

function EmptyCopy({ text }: { text: string }) {
  return <p className="px-5 py-12 text-center text-sm text-brand-300">{text}</p>
}

