import { useMemo, useState } from 'react'
import {
  Archive,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Fingerprint,
  History,
  PenLine,
  Sparkles,
  Users,
} from 'lucide-react'
import { useAchievementStore } from '@/stores/useAchievementStore'
import { useAssetStore } from '@/stores/useAssetStore'
import { useInventoryStore } from '@/stores/useInventoryStore'
import { usePersonalGoalStore } from '@/stores/usePersonalGoalStore'
import { usePhotoStore } from '@/stores/usePhotoStore'
import { useTaskStore } from '@/stores/useTaskStore'
import { useTimelineStore } from '@/stores/useTimelineStore'
import { useToolboxStore } from '@/stores/useToolboxStore'
import { useUserStore } from '@/stores/useUserStore'
import { useVoteStore } from '@/stores/useVoteStore'
import { useSkillStore } from '@/stores/useSkillStore'
import { updateProfileRecord } from '@/services/profile'
import { formatDate } from '@/utils/dateUtils'
import { buildProfileStory, type StoryRecord } from './profileStory'
import type { User } from '@/types'

type ProfileStoryBoardProps = {
  user: User
  canEdit: boolean
}

const SECTION_META = [
  { key: 'learned', title: '学会了什么', empty: '还没有可归纳的学习线索。', icon: BookOpenCheck },
  { key: 'accomplished', title: '做成了什么', empty: '还没有完成记录。', icon: CheckCircle2 },
  { key: 'leftBehind', title: '留下了什么', empty: '还没有留下团队资产或记忆。', icon: Archive },
  { key: 'experienced', title: '和我们一起经历过什么', empty: '还没有共同经历记录。', icon: Users },
] as const

function yearsInTeam(joinDate: string) {
  const start = new Date(joinDate)
  if (Number.isNaN(start.getTime())) return '时间待确认'

  const now = new Date()
  const days = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86400000))
  if (days < 31) return `${days || 1} 天`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月`

  const years = Math.floor(months / 12)
  const restMonths = months % 12
  return restMonths > 0 ? `${years} 年 ${restMonths} 个月` : `${years} 年`
}

function recordDate(record?: StoryRecord) {
  return record ? formatDate(record.date) : '等待第一条记录'
}

function StoryList({ records, empty }: { records: StoryRecord[]; empty: string }) {
  if (records.length === 0) {
    return <p className="rounded-xl bg-brand-50 px-4 py-5 text-sm text-brand-200">{empty}</p>
  }

  return (
    <div className="space-y-2">
      {records.map((record) => (
        <div key={record.id} className="rounded-xl border border-brand-100/70 bg-white/80 p-3 transition hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-sm">
          <div className="mb-1 flex items-start justify-between gap-3">
            <p className="min-w-0 text-sm font-semibold text-brand-400">{record.title}</p>
            <span className="shrink-0 text-xs text-brand-200">{formatDate(record.date)}</span>
          </div>
          <p className="text-xs font-medium text-cyan-700">{record.label}</p>
          {record.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-brand-300">{record.description}</p>
          )}
        </div>
      ))}
    </div>
  )
}

export default function ProfileStoryBoard({ user, canEdit }: ProfileStoryBoardProps) {
  const updateUser = useUserStore((s) => s.updateUser)
  const tasks = useTaskStore((s) => s.tasks)
  const timelineEvents = useTimelineStore((s) => s.events)
  const achievements = useAchievementStore((s) => s.achievements)
  const photos = usePhotoStore((s) => s.photos)
  const tools = useToolboxStore((s) => s.tools)
  const logs = useInventoryStore((s) => s.logs)
  const votes = useVoteStore((s) => s.votes)
  const assets = useAssetStore((s) => s.assets)
  const personalGoals = usePersonalGoalStore((s) => s.personalGoals)
  const skills = useSkillStore((s) => s.skills)
  const userSkills = useSkillStore((s) => s.userSkills)

  const [editingLearning, setEditingLearning] = useState(false)
  const [learningNotes, setLearningNotes] = useState(user.learningNotes ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const story = useMemo(
    () =>
      buildProfileStory({
        user,
        tasks,
        timelineEvents,
        achievements,
        photos,
        tools,
        logs,
        votes,
        assets,
        personalGoals,
      }),
    [achievements, assets, logs, personalGoals, photos, tasks, timelineEvents, tools, user, votes]
  )

  const litSkills = useMemo(
    () =>
      userSkills
        .filter((item) => item.userId === user.id)
        .map((item) => ({
          record: item,
          skill: skills.find((skill) => skill.id === item.skillId),
        }))
        .filter((item) => item.skill)
        .sort((a, b) => new Date(b.record.litAt).getTime() - new Date(a.record.litAt).getTime()),
    [skills, user.id, userSkills]
  )

  const handleSaveLearning = async () => {
    const previous = user.learningNotes
    setSaving(true)
    setSaveError('')
    updateUser(user.id, { learningNotes })
    try {
      await updateProfileRecord(user.id, { learningNotes })
      setEditingLearning(false)
    } catch (error) {
      updateUser(user.id, { learningNotes: previous })
      setLearningNotes(previous ?? '')
      setSaveError('保存失败，请确认 Supabase profiles 表已新增 learning_notes 字段。')
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="overflow-hidden rounded-card border border-cyan-100 bg-white shadow-card">
        <div className="relative bg-gradient-to-br from-cyan-50 via-white to-emerald-50 p-6">
          <div className="absolute right-6 top-5 hidden h-20 w-20 rounded-full bg-cyan-200/30 blur-2xl lg:block" />
          <div className="relative grid gap-4 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-100 bg-white/80 px-3 py-1 text-xs font-medium text-cyan-700">
                <Fingerprint className="h-3.5 w-3.5" />
                成员人物档案
              </div>
              <h2 className="font-heading text-2xl font-semibold text-brand-400">这个人是谁</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-brand-300">
                {user.name}，{user.position || '岗位待补充'}。{user.notes || user.communicationPreference || '团队正在继续补齐这个人的协作习惯、擅长方向和工作边界。'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="在队时间" value={yearsInTeam(user.joinDate)} />
              <Metric label="完成任务" value={`${story.counts.tasksDone}`} />
              <Metric label="团队记忆" value={`${story.counts.memories}`} />
              <Metric label="参与决定" value={`${story.counts.decisions}`} />
            </div>
          </div>
        </div>

        <div className="grid gap-0 border-t border-cyan-100 lg:grid-cols-2">
          <div className="border-b border-cyan-100 p-5 lg:border-b-0 lg:border-r">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-400">
              <CalendarClock className="h-4 w-4 text-cyan-600" />
              什么时候来的
            </div>
            <p className="text-sm text-brand-300">{formatDate(user.joinDate)} 加入，已经一起走过 {yearsInTeam(user.joinDate)}。</p>
          </div>
          <div className="p-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-400">
              <Clock3 className="h-4 w-4 text-emerald-600" />
              第一条团队记录
            </div>
            <p className="text-sm text-brand-300">
              {story.firstRecord ? `${recordDate(story.firstRecord)}：${story.firstRecord.title}` : '等待团队记录补齐。'}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-card bg-white p-5 shadow-card">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-cyan-600" />
              <h3 className="font-heading text-lg font-semibold text-brand-400">本人补充的学习记录</h3>
            </div>
            <p className="text-xs text-brand-200">自动归纳之外，保留这个人自己说清楚的成长。</p>
          </div>
          {canEdit && !editingLearning && (
            <button
              onClick={() => setEditingLearning(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-brand-300 transition hover:bg-cyan-50 hover:text-cyan-700"
            >
              <PenLine className="h-3.5 w-3.5" />
              编辑
            </button>
          )}
        </div>

        {editingLearning ? (
          <div className="space-y-3">
            <textarea
              value={learningNotes}
              onChange={(event) => setLearningNotes(event.target.value)}
              maxLength={500}
              rows={4}
              placeholder="比如：学会了独立做门店交付、处理客户异议、整理案例复盘、带新人跑流程..."
              className="w-full resize-none rounded-xl border border-brand-100 px-3 py-2 text-sm text-brand-400 outline-none transition placeholder:text-brand-200/70 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setLearningNotes(user.learningNotes ?? '')
                  setEditingLearning(false)
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-brand-300 transition hover:bg-brand-50"
              >
                取消
              </button>
              <button
                onClick={handleSaveLearning}
                disabled={saving}
                className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
            {saveError && <p className="text-xs text-rose-500">{saveError}</p>}
          </div>
        ) : user.learningNotes ? (
          <p className="whitespace-pre-wrap rounded-xl bg-cyan-50/70 px-4 py-3 text-sm leading-relaxed text-brand-300">{user.learningNotes}</p>
        ) : (
          <p className="rounded-xl bg-brand-50 px-4 py-4 text-sm text-brand-200">
            {canEdit ? '还没有补充学习记录，可以点击编辑写下自己真正学会的东西。' : '这个成员还没有补充学习记录。'}
          </p>
        )}

        <div className="mt-4 border-t border-brand-100 pt-4">
          <h4 className="mb-3 text-sm font-semibold text-brand-400">技能树点亮</h4>
          {litSkills.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {litSkills.map(({ record, skill }) => (
                <span key={record.id} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {skill?.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-brand-50 px-4 py-4 text-sm text-brand-200">还没有点亮技能。</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {SECTION_META.map((section) => {
          const Icon = section.icon
          return (
            <div key={section.key} className="rounded-card bg-white p-5 shadow-card">
              <div className="mb-4 flex items-center gap-2">
                <Icon className="h-5 w-5 text-cyan-600" />
                <h3 className="font-heading text-lg font-semibold text-brand-400">{section.title}</h3>
              </div>
              <StoryList records={story[section.key]} empty={section.empty} />
            </div>
          )
        })}
      </div>

      <div className="rounded-card bg-white p-5 shadow-card">
        <div className="mb-4 flex items-center gap-2">
          <History className="h-5 w-5 text-cyan-600" />
          <h3 className="font-heading text-lg font-semibold text-brand-400">代表事件时间线</h3>
        </div>
        {story.timeline.length > 0 ? (
          <div className="space-y-3">
            {story.timeline.map((record) => (
              <div key={record.id} className="relative border-l border-cyan-100 pl-4">
                <span className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-white bg-cyan-500 shadow" />
                <p className="text-xs text-brand-200">{formatDate(record.date)} · {record.label}</p>
                <p className="mt-1 text-sm font-semibold text-brand-400">{record.title}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl bg-brand-50 px-4 py-5 text-sm text-brand-200">还没有足够记录生成时间线。</p>
        )}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-cyan-100 bg-white/75 px-3 py-2">
      <p className="text-xs text-brand-200">{label}</p>
      <p className="mt-1 text-lg font-semibold text-brand-400">{value}</p>
    </div>
  )
}
