import { useMemo, useState, type ReactNode } from 'react'
import { BookOpen, CheckCircle2, ExternalLink, Plus, Sparkles } from 'lucide-react'
import { useSkillStore } from '@/stores/useSkillStore'
import { useUserStore } from '@/stores/useUserStore'
import { isCaptainRole } from '@/services/profile'
import type { Skill } from '@/types'

const CATEGORY_LABEL: Record<Skill['category'], string> = {
  sales: '销售',
  delivery: '实施交付',
  operation: '运营',
  product: '产品',
  management: '管理',
  other: '其他',
}

const LEVEL_LABEL: Record<Skill['level'], string> = {
  basic: '基础',
  intermediate: '进阶',
  advanced: '高级',
}

export default function SkillsPage() {
  const skills = useSkillStore((s) => s.skills)
  const userSkills = useSkillStore((s) => s.userSkills)
  const addSkill = useSkillStore((s) => s.addSkill)
  const lightSkill = useSkillStore((s) => s.lightSkill)
  const unlightSkill = useSkillStore((s) => s.unlightSkill)
  const currentUser = useUserStore((s) => s.currentUser)
  const [showModal, setShowModal] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<Skill['category'] | 'all'>('all')
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Skill['category']>('sales')
  const [level, setLevel] = useState<Skill['level']>('basic')
  const [description, setDescription] = useState('')
  const [learningUrl, setLearningUrl] = useState('')
  const [prerequisiteIds, setPrerequisiteIds] = useState<string[]>([])

  const isCaptain = isCaptainRole(currentUser?.role)
  const mySkillIds = new Set(userSkills.filter((item) => item.userId === currentUser.id).map((item) => item.skillId))

  const filteredSkills = useMemo(
    () => skills.filter((skill) => categoryFilter === 'all' || skill.category === categoryFilter),
    [categoryFilter, skills]
  )

  const groupedSkills = useMemo(() => {
    return filteredSkills.reduce<Record<Skill['category'], Skill[]>>(
      (acc, skill) => {
        acc[skill.category].push(skill)
        return acc
      },
      { sales: [], delivery: [], operation: [], product: [], management: [], other: [] }
    )
  }, [filteredSkills])

  const litCount = skills.filter((skill) => mySkillIds.has(skill.id)).length
  const percent = skills.length > 0 ? Math.round((litCount / skills.length) * 100) : 0

  const resetForm = () => {
    setName('')
    setCategory('sales')
    setLevel('basic')
    setDescription('')
    setLearningUrl('')
    setPrerequisiteIds([])
  }

  const handleCreate = () => {
    if (!name.trim() || !currentUser) return
    addSkill({
      name: name.trim(),
      category,
      level,
      description: description.trim() || undefined,
      learningUrl: learningUrl.trim() || undefined,
      prerequisiteIds,
      createdBy: currentUser.id,
    })
    resetForm()
    setShowModal(false)
  }

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 lg:px-6">
      <div className="mb-5 rounded-card border border-cyan-100 bg-white p-5 shadow-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-700">
              <Sparkles className="h-3.5 w-3.5" />
              团队成长地图
            </div>
            <h1 className="font-heading text-2xl font-semibold text-brand-400">技能树</h1>
            <p className="mt-1 text-sm text-brand-300">管理员维护技能库，成员点亮后同步到个人人物档案。</p>
          </div>
          {isCaptain && (
            <button onClick={() => setShowModal(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700">
              <Plus className="h-4 w-4" />
              创建技能
            </button>
          )}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Metric label="技能总数" value={skills.length} />
          <Metric label="我已点亮" value={litCount} />
          <Metric label="完成度" value={`${percent}%`} />
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <FilterButton active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>全部</FilterButton>
        {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
          <FilterButton key={value} active={categoryFilter === value} onClick={() => setCategoryFilter(value as Skill['category'])}>
            {label}
          </FilterButton>
        ))}
      </div>

      {skills.length === 0 ? (
        <div className="rounded-card bg-white px-6 py-16 text-center shadow-card">
          <BookOpen className="mx-auto mb-3 h-12 w-12 text-brand-100" />
          <p className="text-sm text-brand-200">技能库还没有内容，等待管理员创建第一批技能。</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedSkills).map(([categoryKey, items]) => {
            if (items.length === 0) return null
            return (
              <section key={categoryKey}>
                <h2 className="mb-3 font-heading text-lg font-semibold text-brand-400">{CATEGORY_LABEL[categoryKey as Skill['category']]}</h2>
                <div className="grid gap-4 lg:grid-cols-3">
                  {items.map((skill) => {
                    const isLit = mySkillIds.has(skill.id)
                    const blocked = skill.prerequisiteIds.some((id) => !mySkillIds.has(id))
                    return (
                      <article key={skill.id} className={`rounded-card border bg-white p-5 shadow-card transition ${isLit ? 'border-emerald-200' : 'border-brand-100'}`}>
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-heading text-base font-semibold text-brand-400">{skill.name}</h3>
                            <p className="mt-1 text-xs text-brand-200">{LEVEL_LABEL[skill.level]}</p>
                          </div>
                          {isLit && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                        </div>
                        {skill.description && <p className="mb-4 line-clamp-3 text-sm leading-relaxed text-brand-300">{skill.description}</p>}
                        {skill.prerequisiteIds.length > 0 && (
                          <p className="mb-3 text-xs text-brand-200">
                            前置：{skill.prerequisiteIds.map((id) => skills.find((item) => item.id === id)?.name).filter(Boolean).join('、')}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {skill.learningUrl && (
                            <a href={skill.learningUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100">
                              <ExternalLink className="h-3.5 w-3.5" />
                              学习
                            </a>
                          )}
                          <button
                            onClick={() => (isLit ? unlightSkill(skill.id, currentUser.id) : lightSkill(skill.id, currentUser.id))}
                            disabled={blocked && !isLit}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              isLit ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-cyan-600 text-white hover:bg-cyan-700'
                            }`}
                          >
                            {isLit ? '已点亮' : blocked ? '前置未点亮' : '点亮技能'}
                          </button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            )
          })}
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
                  {Object.entries(CATEGORY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select value={level} onChange={(event) => setLevel(event.target.value as Skill['level'])} className="rounded-xl border border-brand-100 px-4 py-2.5 text-sm">
                  {Object.entries(LEVEL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="技能说明" rows={3} className="w-full resize-none rounded-xl border border-brand-100 px-4 py-2.5 text-sm outline-none focus:border-cyan-300" />
              <input value={learningUrl} onChange={(event) => setLearningUrl(event.target.value)} placeholder="学习资料链接（可选）" className="w-full rounded-xl border border-brand-100 px-4 py-2.5 text-sm outline-none focus:border-cyan-300" />
              <select multiple value={prerequisiteIds} onChange={(event) => setPrerequisiteIds(Array.from(event.target.selectedOptions).map((option) => option.value))} className="min-h-24 w-full rounded-xl border border-brand-100 px-4 py-2.5 text-sm">
                {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
              </select>
              <p className="text-xs text-brand-200">按住 Command/Ctrl 可选择多个前置技能。</p>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="rounded-xl bg-brand-50 px-5 py-2.5 text-sm font-medium text-brand-300 hover:bg-brand-100">取消</button>
              <button onClick={handleCreate} disabled={!name.trim()} className="rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-40">创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-cyan-100 bg-cyan-50/40 p-3">
      <p className="text-xs text-brand-200">{label}</p>
      <p className="mt-1 text-xl font-semibold text-brand-400">{value}</p>
    </div>
  )
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${active ? 'bg-cyan-600 text-white' : 'bg-white text-brand-300 shadow-sm hover:text-brand-400'}`}>
      {children}
    </button>
  )
}
