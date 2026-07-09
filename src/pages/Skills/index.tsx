import { useMemo, useState, type ReactNode } from 'react'
import { BookOpen, CheckCircle2, ExternalLink, LockKeyhole, Plus, Sparkles, Swords } from 'lucide-react'
import { useSkillStore } from '@/stores/useSkillStore'
import { useUserStore } from '@/stores/useUserStore'
import { isCaptainRole } from '@/services/profile'
import type { Skill } from '@/types'

const CATEGORY_LABEL: Record<Skill['category'], string> = {
  sales: '销售路线',
  delivery: '实施交付',
  operation: '运营路线',
  product: '产品路线',
  management: '管理路线',
  other: '通用能力',
}

const LEVEL_LABEL: Record<Skill['level'], string> = {
  basic: '基础层',
  intermediate: '进阶层',
  advanced: '高级层',
}

const LEVEL_ORDER: Skill['level'][] = ['basic', 'intermediate', 'advanced']
const CATEGORY_ORDER: Skill['category'][] = ['sales', 'delivery', 'operation', 'product', 'management', 'other']

function skillErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/relation .*skills|schema cache|permission denied|violates row-level security|does not exist/i.test(message)) {
    return '保存失败：请先在 Supabase 执行 skills / user_skills 表和 RLS 策略迁移，或检查当前账号权限。'
  }
  return `保存失败：${message}`
}

export default function SkillsPage() {
  const skills = useSkillStore((s) => s.skills)
  const userSkills = useSkillStore((s) => s.userSkills)
  const addSkill = useSkillStore((s) => s.addSkill)
  const lightSkill = useSkillStore((s) => s.lightSkill)
  const unlightSkill = useSkillStore((s) => s.unlightSkill)
  const currentUser = useUserStore((s) => s.currentUser)

  const [showModal, setShowModal] = useState(false)
  const [activeCategory, setActiveCategory] = useState<Skill['category']>('sales')
  const [selectedSkillId, setSelectedSkillId] = useState<string>('')
  const [skillSaveError, setSkillSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Skill['category']>('sales')
  const [level, setLevel] = useState<Skill['level']>('basic')
  const [description, setDescription] = useState('')
  const [learningUrl, setLearningUrl] = useState('')
  const [prerequisiteIds, setPrerequisiteIds] = useState<string[]>([])

  const isCaptain = isCaptainRole(currentUser?.role)
  const mySkillIds = useMemo(
    () => new Set(userSkills.filter((item) => item.userId === currentUser.id).map((item) => item.skillId)),
    [currentUser.id, userSkills]
  )
  const activeSkills = skills.filter((skill) => skill.category === activeCategory)
  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId) || activeSkills[0] || skills[0]
  const litCount = skills.filter((skill) => mySkillIds.has(skill.id)).length
  const percent = skills.length > 0 ? Math.round((litCount / skills.length) * 100) : 0

  const groupedByLevel = useMemo(() => {
    return LEVEL_ORDER.reduce<Record<Skill['level'], Skill[]>>(
      (acc, levelKey) => {
        acc[levelKey] = activeSkills.filter((skill) => skill.level === levelKey)
        return acc
      },
      { basic: [], intermediate: [], advanced: [] }
    )
  }, [activeSkills])

  const resetForm = () => {
    setName('')
    setCategory(activeCategory)
    setLevel('basic')
    setDescription('')
    setLearningUrl('')
    setPrerequisiteIds([])
    setSkillSaveError('')
  }

  const canUnlock = (skill: Skill) => skill.prerequisiteIds.every((id) => mySkillIds.has(id))

  const handleCreate = async () => {
    if (!name.trim() || !currentUser) return
    setSaving(true)
    setSkillSaveError('')
    try {
      await addSkill({
        name: name.trim(),
        category,
        level,
        description: description.trim() || undefined,
        learningUrl: learningUrl.trim() || undefined,
        prerequisiteIds,
        createdBy: currentUser.id,
      })
      setActiveCategory(category)
      resetForm()
      setShowModal(false)
    } catch (error) {
      setSkillSaveError(skillErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const handleToggleSkill = async (skill: Skill) => {
    setSkillSaveError('')
    try {
      if (mySkillIds.has(skill.id)) {
        await unlightSkill(skill.id, currentUser.id)
      } else if (canUnlock(skill)) {
        await lightSkill(skill.id, currentUser.id)
      }
    } catch (error) {
      setSkillSaveError(skillErrorMessage(error))
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-3 py-4 lg:px-6">
      <div className="mb-5 overflow-hidden rounded-card border border-cyan-100 bg-white shadow-card">
        <div className="relative bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 p-5 text-white">
          <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(34,211,238,.35)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,.35)_1px,transparent_1px)] [background-size:28px_28px]" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-100">
                <Sparkles className="h-3.5 w-3.5" />
                团队成长地图
              </div>
              <h1 className="font-heading text-2xl font-semibold">职业分支技能树</h1>
              <p className="mt-1 text-sm text-cyan-100/80">点亮前置技能后，解锁下一层能力节点。</p>
            </div>
            {isCaptain && (
              <button onClick={() => { resetForm(); setShowModal(true) }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300">
                <Plus className="h-4 w-4" />
                创建技能
              </button>
            )}
          </div>
          <div className="relative mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="技能总数" value={skills.length} />
            <Metric label="我已点亮" value={litCount} />
            <Metric label="完成度" value={`${percent}%`} />
          </div>
        </div>
      </div>

      {skillSaveError && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {skillSaveError}
        </div>
      )}

      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {CATEGORY_ORDER.map((item) => (
          <FilterButton key={item} active={activeCategory === item} onClick={() => setActiveCategory(item)}>
            {CATEGORY_LABEL[item]}
          </FilterButton>
        ))}
      </div>

      {skills.length === 0 ? (
        <div className="rounded-card bg-white px-6 py-16 text-center shadow-card">
          <BookOpen className="mx-auto mb-3 h-12 w-12 text-brand-100" />
          <p className="text-sm text-brand-200">技能库还没有内容。管理员创建第一批技能后，会在这里形成职业路线。</p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="overflow-hidden rounded-card border border-slate-800 bg-slate-950 p-4 shadow-card">
            <div className="mb-4 flex items-center gap-2 text-cyan-100">
              <Swords className="h-5 w-5 text-cyan-300" />
              <h2 className="font-heading text-lg font-semibold">{CATEGORY_LABEL[activeCategory]}</h2>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              {LEVEL_ORDER.map((levelKey, levelIndex) => (
                <div key={levelKey} className="relative">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-cyan-200/70">{LEVEL_LABEL[levelKey]}</p>
                  <div className="space-y-4">
                    {groupedByLevel[levelKey].length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-xs text-slate-500">等待配置</div>
                    ) : groupedByLevel[levelKey].map((skill) => (
                      <SkillNode
                        key={skill.id}
                        skill={skill}
                        isSelected={selectedSkill?.id === skill.id}
                        isLit={mySkillIds.has(skill.id)}
                        isUnlocked={canUnlock(skill)}
                        onSelect={() => setSelectedSkillId(skill.id)}
                      />
                    ))}
                  </div>
                  {levelIndex < LEVEL_ORDER.length - 1 && (
                    <div className="pointer-events-none absolute right-[-18px] top-24 hidden h-[2px] w-9 bg-gradient-to-r from-cyan-400/70 to-slate-700 lg:block" />
                  )}
                </div>
              ))}
            </div>
          </div>

          <aside className="rounded-card bg-white p-5 shadow-card">
            {selectedSkill ? (
              <SkillDetail
                skill={selectedSkill}
                skills={skills}
                isLit={mySkillIds.has(selectedSkill.id)}
                isUnlocked={canUnlock(selectedSkill)}
                onToggle={() => handleToggleSkill(selectedSkill)}
              />
            ) : (
              <p className="text-sm text-brand-200">选择一个技能节点查看详情。</p>
            )}
          </aside>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-5 text-lg font-bold text-brand-400">创建技能</h3>
            <div className="space-y-3">
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="技能名称" className="w-full rounded-xl border border-brand-100 px-4 py-2.5 text-sm outline-none focus:border-cyan-300" />
              <div className="grid gap-3 sm:grid-cols-2">
                <select value={category} onChange={(event) => setCategory(event.target.value as Skill['category'])} className="rounded-xl border border-brand-100 px-4 py-2.5 text-sm">
                  {CATEGORY_ORDER.map((value) => <option key={value} value={value}>{CATEGORY_LABEL[value]}</option>)}
                </select>
                <select value={level} onChange={(event) => setLevel(event.target.value as Skill['level'])} className="rounded-xl border border-brand-100 px-4 py-2.5 text-sm">
                  {LEVEL_ORDER.map((value) => <option key={value} value={value}>{LEVEL_LABEL[value]}</option>)}
                </select>
              </div>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="技能说明" rows={3} className="w-full resize-none rounded-xl border border-brand-100 px-4 py-2.5 text-sm outline-none focus:border-cyan-300" />
              <input value={learningUrl} onChange={(event) => setLearningUrl(event.target.value)} placeholder="学习资料链接（可选）" className="w-full rounded-xl border border-brand-100 px-4 py-2.5 text-sm outline-none focus:border-cyan-300" />
              <select multiple value={prerequisiteIds} onChange={(event) => setPrerequisiteIds(Array.from(event.target.selectedOptions).map((option) => option.value))} className="min-h-24 w-full rounded-xl border border-brand-100 px-4 py-2.5 text-sm">
                {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
              </select>
              <p className="text-xs text-brand-200">按住 Command/Ctrl 可选择多个前置技能。前置技能全部点亮后，当前技能才可点亮。</p>
              {skillSaveError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{skillSaveError}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="rounded-xl bg-brand-50 px-5 py-2.5 text-sm font-medium text-brand-300 hover:bg-brand-100">取消</button>
              <button onClick={handleCreate} disabled={!name.trim() || saving} className="rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-40">
                {saving ? '保存中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SkillNode({
  skill,
  isSelected,
  isLit,
  isUnlocked,
  onSelect,
}: {
  skill: Skill
  isSelected: boolean
  isLit: boolean
  isUnlocked: boolean
  onSelect: () => void
}) {
  const locked = !isLit && !isUnlocked
  return (
    <button
      onClick={onSelect}
      className={`relative w-full rounded-2xl border px-4 py-4 text-left transition ${
        isLit
          ? 'border-emerald-300 bg-emerald-400/15 shadow-[0_0_24px_rgba(52,211,153,.25)]'
          : locked
            ? 'border-slate-800 bg-slate-900/80 opacity-70'
            : 'border-cyan-300 bg-cyan-400/10 shadow-[0_0_24px_rgba(34,211,238,.18)]'
      } ${isSelected ? 'ring-2 ring-cyan-300' : ''}`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className={`font-heading text-sm font-semibold ${locked ? 'text-slate-400' : 'text-white'}`}>{skill.name}</span>
        {isLit ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : locked ? <LockKeyhole className="h-5 w-5 text-slate-500" /> : <Sparkles className="h-5 w-5 text-cyan-300" />}
      </div>
      <p className={`text-xs ${locked ? 'text-slate-500' : 'text-cyan-100/75'}`}>
        {isLit ? '已点亮' : locked ? '未解锁' : '可点亮'}
      </p>
    </button>
  )
}

function SkillDetail({
  skill,
  skills,
  isLit,
  isUnlocked,
  onToggle,
}: {
  skill: Skill
  skills: Skill[]
  isLit: boolean
  isUnlocked: boolean
  onToggle: () => void
}) {
  const prerequisiteNames = skill.prerequisiteIds
    .map((id) => skills.find((item) => item.id === id)?.name)
    .filter(Boolean)

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-cyan-700">{CATEGORY_LABEL[skill.category]} · {LEVEL_LABEL[skill.level]}</p>
          <h3 className="mt-1 font-heading text-xl font-semibold text-brand-400">{skill.name}</h3>
        </div>
        {isLit ? <CheckCircle2 className="h-6 w-6 text-emerald-500" /> : !isUnlocked ? <LockKeyhole className="h-6 w-6 text-brand-200" /> : <Sparkles className="h-6 w-6 text-cyan-500" />}
      </div>
      <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm leading-relaxed text-brand-300">
        {skill.description || '还没有技能说明。'}
      </p>
      <div className="mb-4 rounded-xl border border-brand-100 p-3">
        <p className="mb-2 text-xs font-semibold text-brand-400">前置要求</p>
        {prerequisiteNames.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {prerequisiteNames.map((name) => (
              <span key={name} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-brand-300">{name}</span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-brand-200">无前置技能，可直接点亮。</p>
        )}
      </div>
      {skill.learningUrl && (
        <a href={skill.learningUrl} target="_blank" rel="noreferrer" className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-100">
          <ExternalLink className="h-4 w-4" />
          打开学习资料
        </a>
      )}
      <button
        onClick={onToggle}
        disabled={!isLit && !isUnlocked}
        className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
          isLit ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-cyan-600 text-white hover:bg-cyan-700'
        }`}
      >
        {isLit ? '取消点亮' : isUnlocked ? '点亮技能' : '前置未完成'}
      </button>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-cyan-300/20 bg-white/10 p-3 backdrop-blur">
      <p className="text-xs text-cyan-100/70">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
    </div>
  )
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${active ? 'bg-slate-950 text-cyan-100 shadow-sm' : 'bg-white text-brand-300 shadow-sm hover:text-brand-400'}`}>
      {children}
    </button>
  )
}
