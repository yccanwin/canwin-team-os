import { Link } from 'react-router-dom'
import { BriefcaseBusiness, Camera, Heart, Network, Sparkles } from 'lucide-react'
import { roleLabel } from '@/services/profile'
import { usePhotoStore } from '@/stores/usePhotoStore'
import { useSkillStore } from '@/stores/useSkillStore'
import { useUserStore } from '@/stores/useUserStore'

const palette = [
  'from-cyan-400 to-blue-600',
  'from-violet-400 to-fuchsia-600',
  'from-emerald-400 to-teal-600',
  'from-amber-400 to-orange-600',
]

export default function MembersPage() {
  const users = useUserStore((state) => state.users)
  const skills = useSkillStore((state) => state.skills)
  const userSkills = useSkillStore((state) => state.userSkills)
  const photos = usePhotoStore((state) => state.photos)
  const recentPhotos = [...photos].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4)
  const positions = new Set(users.map((user) => user.position).filter(Boolean)).size
  const skillCount = new Set(userSkills.map((item) => item.skillId)).size

  return (
    <div className="px-3 py-4 lg:px-6">
      <header className="relative overflow-hidden rounded-3xl bg-slate-950 px-5 py-7 text-white shadow-xl sm:px-8">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-32 w-32 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-cyan-300">
            <Network size={19} />
            <span className="text-xs font-semibold uppercase tracking-[0.24em]">Function Network</span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">职能中心</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">看见每个人负责什么、擅长什么，以及团队如何互补协作。</p>
          <div className="mt-6 grid grid-cols-3 gap-3 sm:max-w-lg">
            <Metric label="团队成员" value={users.length} />
            <Metric label="岗位职能" value={positions} />
            <Metric label="已点亮技能" value={skillCount} />
          </div>
        </div>
      </header>

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {users.map((user, index) => {
          const memberSkillNames = userSkills
            .filter((item) => item.userId === user.id)
            .map((item) => skills.find((skill) => skill.id === item.skillId)?.name)
            .filter((name): name is string => Boolean(name))
            .slice(0, 5)
          const memberPhoto = recentPhotos.find((photo) => photo.participants.includes(user.id))

          return (
            <article key={user.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
              <div className="relative h-24 overflow-hidden bg-slate-900">
                {memberPhoto ? (
                  <img src={memberPhoto.url} alt="" className="h-full w-full object-cover opacity-60 transition duration-500 group-hover:scale-105" />
                ) : (
                  <div className={`h-full bg-gradient-to-br ${palette[index % palette.length]} opacity-75`} />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />
                <span className="absolute right-3 top-3 rounded-full bg-white/15 px-2.5 py-1 text-xs text-white backdrop-blur">{roleLabel(user.role)}</span>
              </div>

              <div className="relative px-5 pb-5">
                <Avatar user={user} tone={palette[index % palette.length]} />
                <div className="mt-3">
                  <h2 className="text-lg font-semibold text-slate-900">{user.name}</h2>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-cyan-700"><BriefcaseBusiness size={15} />{user.position || '岗位待补充'}</p>
                </div>

                <div className="mt-4 rounded-xl bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">岗位职责</p>
                  <p className="mt-1.5 line-clamp-3 text-sm leading-6 text-slate-600">{user.notes || '暂未填写职责摘要，可在个人档案中完善。'}</p>
                </div>

                <div className="mt-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><Sparkles size={14} className="text-violet-500" />技能与专长</p>
                  <div className="mt-2 flex min-h-7 flex-wrap gap-1.5">
                    {memberSkillNames.length ? memberSkillNames.map((name) => <Tag key={name}>{name}</Tag>) : <span className="text-xs text-slate-400">暂无已点亮技能</span>}
                  </div>
                </div>

                <div className="mt-4 flex items-start gap-2 text-xs text-slate-500">
                  <Heart size={14} className="mt-0.5 shrink-0 text-rose-500" />
                  <span>{user.learningNotes ? `成长关注：${user.learningNotes}` : '兴趣爱好待补充'}</span>
                </div>

                <Link to={`/profile?id=${user.id}`} className="mt-5 inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-cyan-700">查看成员档案</Link>
              </div>
            </article>
          )
        })}
      </section>

      <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Camera size={17} className="text-fuchsia-500" />团队影像</p>
            <p className="mt-1 text-xs text-slate-500">回看一起完成的事和共同经历的瞬间。</p>
          </div>
          <Link to="/photos" className="text-sm font-semibold text-cyan-700">查看全部</Link>
        </div>
        {recentPhotos.length ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {recentPhotos.map((photo) => <img key={photo.id} src={photo.url} alt={photo.title || '团队照片'} className="aspect-[4/3] w-full rounded-xl object-cover" />)}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">暂无团队照片，上传后会自动展示在这里。</div>
        )}
      </section>

      <p className="mt-4 text-xs leading-5 text-slate-400">说明：当前职责复用协作备注，兴趣信息仅展示已有成长记录；后续如需分开维护，再增加独立的 responsibilities 和 interests 字段。</p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur"><strong className="block text-xl text-white">{value}</strong><span className="mt-1 block text-[11px] text-slate-400">{label}</span></div>
}

function Avatar({ user, tone }: { user: ReturnType<typeof useUserStore.getState>['users'][number]; tone: string }) {
  return user.avatar ? <img src={user.avatar} alt={user.name} className="-mt-8 h-16 w-16 rounded-2xl border-4 border-white object-cover shadow-lg" /> : <div className={`-mt-8 flex h-16 w-16 items-center justify-center rounded-2xl border-4 border-white bg-gradient-to-br ${tone} text-xl font-semibold text-white shadow-lg`}>{user.name.slice(0, 1)}</div>
}

function Tag({ children }: { children: string }) {
  return <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">{children}</span>
}
