import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Edit3,
  ExternalLink,
  FolderCog,
  Heart,
  Link2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { useToolboxStore } from '@/stores/useToolboxStore'
import { useUserStore } from '@/stores/useUserStore'
import {
  TOOL_CATEGORIES,
  type ToolCategoryItem,
  type ToolDraft,
  type ToolItem,
} from '@/types/toolbox'
import { canEditCategory, canManageTool, validateCategoryDeletion } from './toolboxRules'

const EMPTY_FORM: ToolDraft = { title: '', description: '', url: '', category: 'efficiency' }

export default function Toolbox() {
  const tools = useToolboxStore((state) => state.tools)
  const storedCategories = useToolboxStore((state) => state.categories)
  const refreshCategories = useToolboxStore((state) => state.refreshCategories)
  const addTool = useToolboxStore((state) => state.addTool)
  const updateTool = useToolboxStore((state) => state.updateTool)
  const deleteTool = useToolboxStore((state) => state.deleteTool)
  const toggleLike = useToolboxStore((state) => state.toggleLike)
  const createCategory = useToolboxStore((state) => state.createCategory)
  const renameCategory = useToolboxStore((state) => state.renameCategory)
  const reorderCategories = useToolboxStore((state) => state.reorderCategories)
  const deleteCategory = useToolboxStore((state) => state.deleteCategory)
  const currentUser = useUserStore((state) => state.currentUser)

  const categories = storedCategories.length > 0 ? storedCategories : TOOL_CATEGORIES
  const assignableCategories = categories.filter((category) => category.code !== 'all')
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [editingTool, setEditingTool] = useState<ToolItem | null>(null)
  const [showToolModal, setShowToolModal] = useState(false)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [form, setForm] = useState<ToolDraft>(EMPTY_FORM)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingName, setRenamingName] = useState('')
  const [deletingCategory, setDeletingCategory] = useState<ToolCategoryItem | null>(null)
  const [moveTargetId, setMoveTargetId] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void refreshCategories().catch((reason: unknown) => {
      setError(`读取分类失败：${reason instanceof Error ? reason.message : '请稍后重试'}`)
    })
  }, [refreshCategories])

  const categoryName = (code: string) => categories.find((item) => item.code === code)?.name ?? code
  const filteredTools = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return tools.filter((tool) => {
      if (activeCategory !== 'all' && tool.category !== activeCategory) return false
      if (!keyword) return true
      return [tool.title, tool.description, tool.creatorName].some((value) => value.toLowerCase().includes(keyword))
    })
  }, [activeCategory, search, tools])

  const openCreate = () => {
    setEditingTool(null)
    setForm({ ...EMPTY_FORM, category: assignableCategories[0]?.code ?? 'other' })
    setShowToolModal(true)
    setError('')
  }

  const openEdit = (tool: ToolItem) => {
    setEditingTool(tool)
    setForm({ title: tool.title, description: tool.description, url: tool.url, category: tool.category })
    setShowToolModal(true)
    setError('')
  }

  const submitTool = async () => {
    if (!form.title.trim() || !form.url.trim()) return
    setSaving(true)
    setError('')
    try {
      const draft = { ...form, title: form.title.trim(), description: form.description.trim(), url: form.url.trim() }
      if (editingTool) await updateTool(editingTool.id, draft)
      else await addTool(draft)
      setShowToolModal(false)
    } catch (reason) {
      setError(`${editingTool ? '编辑' : '分享'}失败：${reason instanceof Error ? reason.message : '请稍后重试'}`)
    } finally {
      setSaving(false)
    }
  }

  const confirmDeleteTool = async (tool: ToolItem) => {
    if (!window.confirm(`确认删除“${tool.title}”吗？`)) return
    try {
      await deleteTool(tool.id)
    } catch (reason) {
      setError(`删除失败：${reason instanceof Error ? reason.message : '请稍后重试'}`)
    }
  }

  const moveCategory = async (index: number, direction: -1 | 1) => {
    const next = [...categories]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    try {
      await reorderCategories(next.map((item) => item.id))
    } catch (reason) {
      setError(`调整顺序失败：${reason instanceof Error ? reason.message : '请稍后重试'}`)
    }
  }

  const confirmDeleteCategory = async () => {
    if (!deletingCategory) return
    const validation = validateCategoryDeletion(deletingCategory, moveTargetId || undefined)
    if (validation) {
      setError(validation)
      return
    }
    try {
      await deleteCategory(deletingCategory.id, moveTargetId || undefined)
      if (activeCategory === deletingCategory.code) setActiveCategory('all')
      setDeletingCategory(null)
      setMoveTargetId('')
    } catch (reason) {
      setError(`删除分类失败：${reason instanceof Error ? reason.message : '请稍后重试'}`)
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-gradient-to-br from-violet-500/10 via-white to-fuchsia-500/5 rounded-2xl p-6 mb-6 border border-violet-200/50">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center"><Wrench className="w-5 h-5 text-violet-600" /></div>
            <div><h2 className="text-xl font-heading font-bold text-brand-400">🧰 工具箱</h2><p className="text-sm text-brand-300 mt-0.5">分享好用小工具 · 好资源一起点赞 · 分享者得经验</p></div>
          </div>
          <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700"><Plus className="w-4 h-4" />分享工具</button>
        </div>
      </div>

      {error && <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button onClick={() => setError('')}><X className="w-4 h-4" /></button></div>}

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-200" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索工具..." className="w-full pl-9 pr-3 py-2 text-sm border border-brand-100 rounded-lg outline-none bg-white" /></div>
        <div className="flex gap-1.5 flex-wrap">
          {categories.map((category) => <button key={category.id} onClick={() => setActiveCategory(category.code)} className={`px-3 py-1.5 text-xs rounded-full ${activeCategory === category.code ? 'bg-violet-600 text-white' : 'bg-white border border-brand-100'}`}>{category.name} <span className="opacity-60">{category.code === 'all' ? tools.length : tools.filter((tool) => tool.category === category.code).length}</span></button>)}
          <button data-testid="category-manage" onClick={() => setShowCategoryModal(true)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border border-violet-200 text-violet-700 bg-violet-50"><FolderCog className="w-3.5 h-3.5" />管理分类</button>
        </div>
      </div>

      {filteredTools.length === 0 ? (
        <div className="text-center py-16"><Sparkles className="w-12 h-12 text-brand-200 mx-auto mb-3" /><p className="text-brand-400 font-medium">还没有工具分享</p><button onClick={openCreate} className="mt-4 px-4 py-2 bg-violet-600 text-white text-sm rounded-lg">分享第一个工具</button></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTools.map((tool) => {
            const liked = Boolean(currentUser && tool.likedBy.includes(currentUser.id))
            const manageable = canManageTool(tool)
            return <article key={tool.id} className="bg-white rounded-xl border border-brand-100 p-5 hover:border-violet-300 hover:shadow-md transition-all flex flex-col">
              <div className="flex items-center justify-between mb-2"><span className="px-2 py-0.5 text-[10px] rounded-full bg-violet-50 text-violet-600">{categoryName(tool.category)}</span>{manageable && <div className="flex items-center gap-1"><button data-testid={`tool-edit-${tool.id}`} onClick={() => openEdit(tool)} className="p-1.5 rounded hover:bg-violet-50 text-brand-300 hover:text-violet-600" title="编辑"><Edit3 className="w-3.5 h-3.5" /></button><button data-testid={`tool-delete-${tool.id}`} onClick={() => void confirmDeleteTool(tool)} className="p-1.5 rounded hover:bg-red-50 text-brand-300 hover:text-red-500" title="删除"><Trash2 className="w-3.5 h-3.5" /></button></div>}</div>
              <h3 className="font-heading font-semibold text-brand-400 mb-1.5">{tool.title}</h3><p className="text-sm text-brand-300 mb-3 flex-1 line-clamp-2">{tool.description || '暂无描述'}</p>
              <a href={tool.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-violet-600 mb-3 truncate"><Link2 className="w-3.5 h-3.5" /><span className="truncate">{tool.url}</span><ExternalLink className="w-3 h-3" /></a>
              <div className="flex items-center justify-between pt-3 border-t border-brand-50"><span className="text-xs text-brand-200">{tool.creatorName}</span><button onClick={() => void toggleLike(tool.id).catch((reason: unknown) => setError(`点赞失败：${reason instanceof Error ? reason.message : '请稍后重试'}`))} className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border ${liked ? 'bg-red-50 text-red-500 border-red-200' : 'bg-brand-50 text-brand-300 border-brand-100'}`}><Heart className={`w-3.5 h-3.5 ${liked ? 'fill-red-500' : ''}`} />{tool.likedBy.length || ''}</button></div>
            </article>
          })}
        </div>
      )}

      {showToolModal && <Modal title={editingTool ? '编辑分享' : '分享新工具'} onClose={() => setShowToolModal(false)}>
        <div className="space-y-4">
          <Field label="工具名称 *"><input autoFocus value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={40} className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg outline-none focus:border-violet-400" /></Field>
          <Field label="分类"><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg outline-none focus:border-violet-400 bg-white">{assignableCategories.map((category) => <option key={category.id} value={category.code}>{category.name}</option>)}</select></Field>
          <Field label="工具链接 *"><input type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://..." className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg outline-none focus:border-violet-400" /></Field>
          <Field label="描述"><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={200} rows={3} className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg outline-none focus:border-violet-400 resize-none" /></Field>
        </div>
        <div className="flex gap-3 mt-6"><button onClick={() => setShowToolModal(false)} className="flex-1 px-4 py-2 bg-brand-50 rounded-lg">取消</button><button onClick={() => void submitTool()} disabled={saving || !form.title.trim() || !form.url.trim()} className="flex-1 px-4 py-2 text-white bg-violet-600 rounded-lg disabled:opacity-40">{saving ? '保存中...' : '保存'}</button></div>
      </Modal>}

      {showCategoryModal && <Modal title="分类管理" onClose={() => setShowCategoryModal(false)}>
        <p className="text-xs text-brand-300 mb-4">全员可维护分类。“全部”为系统筛选项，不能改名或删除。</p>
        <div className="flex gap-2 mb-4"><input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="新分类名称" className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg outline-none focus:border-violet-400" /><button data-testid="category-add" onClick={() => void createCategory(newCategoryName.trim()).then(() => setNewCategoryName('')).catch((reason: unknown) => setError(`新增分类失败：${reason instanceof Error ? reason.message : '请稍后重试'}`))} disabled={!newCategoryName.trim()} className="shrink-0 px-3 py-2 bg-violet-600 text-white rounded-lg disabled:opacity-40"><Plus className="w-4 h-4" /></button></div>
        <div className="space-y-2 max-h-80 overflow-auto">{categories.map((category, index) => <div key={category.id} className="flex items-center gap-2 rounded-lg border border-brand-100 p-2">
          {renamingId === category.id ? <input value={renamingName} onChange={(event) => setRenamingName(event.target.value)} className="w-full px-2 py-1 text-sm border border-brand-100 rounded-lg outline-none focus:border-violet-400" /> : <span className="flex-1 text-sm font-medium">{category.name} <span className="text-brand-200">{category.toolCount || tools.filter((tool) => tool.category === category.code).length}</span></span>}
          {renamingId === category.id ? <button onClick={() => void renameCategory(category.id, renamingName.trim()).then(() => setRenamingId(null)).catch((reason: unknown) => setError(`重命名失败：${reason instanceof Error ? reason.message : '请稍后重试'}`))} className="text-xs text-violet-600">保存</button> : <button data-testid={`category-edit-${category.id}`} disabled={!canEditCategory(category)} onClick={() => { setRenamingId(category.id); setRenamingName(category.name) }} className="p-1 disabled:opacity-25"><Edit3 className="w-4 h-4" /></button>}
          <button data-testid={`category-move-up-${category.id}`} disabled={index === 0 || !canEditCategory(category)} onClick={() => void moveCategory(index, -1)} className="p-1 disabled:opacity-25"><ArrowUp className="w-4 h-4" /></button><button data-testid={`category-move-down-${category.id}`} disabled={index === categories.length - 1 || !canEditCategory(category)} onClick={() => void moveCategory(index, 1)} className="p-1 disabled:opacity-25"><ArrowDown className="w-4 h-4" /></button><button data-testid={`category-delete-${category.id}`} disabled={!canEditCategory(category)} onClick={() => { setDeletingCategory(category); setMoveTargetId('') }} className="p-1 text-red-500 disabled:opacity-25"><Trash2 className="w-4 h-4" /></button>
        </div>)}</div>
      </Modal>}

      {deletingCategory && <Modal title={`删除分类“${deletingCategory.name}”`} onClose={() => setDeletingCategory(null)}>
        {deletingCategory.toolCount > 0 || tools.some((tool) => tool.category === deletingCategory.code) ? <><p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">该分类下已有工具。删除前必须选择迁移目标，工具不会丢失。</p><select data-testid="category-migrate-target" value={moveTargetId} onChange={(event) => setMoveTargetId(event.target.value)} className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg outline-none focus:border-violet-400 bg-white"><option value="">请选择迁移目标</option>{categories.filter((item) => item.id !== deletingCategory.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></> : <p className="text-sm text-brand-300">这是空分类，可以直接删除。</p>}
        <div className="flex gap-3 mt-6"><button onClick={() => setDeletingCategory(null)} className="flex-1 px-4 py-2 bg-brand-50 rounded-lg">取消</button><button onClick={() => void confirmDeleteCategory()} className="flex-1 px-4 py-2 text-white bg-red-600 rounded-lg">确认删除</button></div>
      </Modal>}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"><button aria-label="关闭" className="absolute inset-0 bg-black/40" onClick={onClose} /><div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg p-6"><div className="flex items-center justify-between mb-5"><h3 className="font-heading text-lg font-bold text-brand-400">{title}</h3><button onClick={onClose} className="p-1.5 rounded-lg hover:bg-brand-50"><X className="w-5 h-5" /></button></div>{children}</div></div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-sm font-medium text-brand-400 mb-1">{label}</span>{children}</label>
}
