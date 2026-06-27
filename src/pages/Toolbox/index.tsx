import { useState, useMemo } from 'react'
import {
  Wrench,
  Plus,
  Heart,
  ExternalLink,
  Trash2,
  X,
  Link2,
  Search,
  Sparkles,
} from 'lucide-react'
import { useToolboxStore } from '@/stores/useToolboxStore'
import { useUserStore } from '@/stores/useUserStore'
import { TOOL_CATEGORIES, type ToolCategory } from '@/types/toolbox'

export default function Toolbox() {
  const tools = useToolboxStore((s) => s.tools)
  const addTool = useToolboxStore((s) => s.addTool)
  const deleteTool = useToolboxStore((s) => s.deleteTool)
  const toggleLike = useToolboxStore((s) => s.toggleLike)
  const currentUser = useUserStore((s) => s.currentUser)

  const [activeCategory, setActiveCategory] = useState<ToolCategory | 'all'>('all')
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)

  // 新工具表单
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formCategory, setFormCategory] = useState<ToolCategory>('efficiency')

  // 筛选+搜索
  const filteredTools = useMemo(() => {
    let list = activeCategory === 'all'
      ? tools
      : tools.filter((t) => t.category === activeCategory)

    if (search.trim()) {
      const kw = search.trim().toLowerCase()
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(kw) ||
          t.description.toLowerCase().includes(kw) ||
          t.creatorName.toLowerCase().includes(kw)
      )
    }

    return list
  }, [tools, activeCategory, search])

  const resetForm = () => {
    setFormTitle('')
    setFormDesc('')
    setFormUrl('')
    setFormCategory('efficiency')
  }

  const handleSubmit = () => {
    if (!formTitle.trim() || !formUrl.trim()) return

    addTool({
      title: formTitle.trim(),
      description: formDesc.trim(),
      url: formUrl.trim(),
      category: formCategory,
    })

    resetForm()
    setShowAddModal(false)
  }

  // 分类统计
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tools.length }
    TOOL_CATEGORIES.forEach((c) => {
      counts[c.value] = tools.filter((t) => t.category === c.value).length
    })
    return counts
  }, [tools])

  return (
    <div className="max-w-6xl mx-auto">
      {/* ======== Hero 头部 ======== */}
      <div className="bg-gradient-to-br from-violet-500/10 via-white to-fuchsia-500/5 rounded-2xl p-6 mb-6 border border-violet-200/50">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
              <Wrench className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h2 className="text-xl font-heading font-bold text-brand-400">🧰 工具箱</h2>
              <p className="text-sm text-brand-300 mt-0.5">
                分享好用小工具 · 好资源一起点赞 · 分享者得经验
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              resetForm()
              setShowAddModal(true)
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            分享工具
          </button>
        </div>
      </div>

      {/* ======== 搜索+分类筛选 ======== */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-200" />
          <input
            type="text"
            placeholder="搜索工具..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-brand-100 rounded-lg focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 outline-none bg-white"
          />
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {[{ value: 'all', label: '全部' }, ...TOOL_CATEGORIES].map((cat) => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value as ToolCategory | 'all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                activeCategory === cat.value
                  ? 'bg-violet-600 text-white'
                  : 'bg-white text-brand-400 border border-brand-100 hover:bg-brand-50'
              }`}
            >
              {cat.label}
              <span className="ml-1 opacity-60">{categoryCounts[cat.value] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ======== 工具卡片网格 ======== */}
      {filteredTools.length === 0 ? (
        <div className="text-center py-16">
          <Sparkles className="w-12 h-12 text-brand-200 mx-auto mb-3" />
          <p className="text-brand-400 font-medium">还没有工具分享</p>
          <p className="text-sm text-brand-200 mt-1">
            成为第一个分享好用小工具的人吧！
          </p>
          <button
            onClick={() => {
              resetForm()
              setShowAddModal(true)
            }}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            分享第一个工具
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTools.map((tool) => {
            const liked = currentUser ? tool.likedBy.includes(currentUser.id) : false
            const isOwner = currentUser?.id === tool.creatorId

            return (
              <div
                key={tool.id}
                className="bg-white rounded-xl border border-brand-100 p-5 hover:border-violet-300 hover:shadow-md transition-all duration-200 flex flex-col"
              >
                {/* 分类标签 */}
                <div className="flex items-center justify-between mb-2">
                  <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-violet-50 text-violet-600">
                    {TOOL_CATEGORIES.find((c) => c.value === tool.category)?.label}
                  </span>
                  {isOwner && (
                    <button
                      onClick={() => deleteTool(tool.id)}
                      className="p-1 rounded hover:bg-red-50 text-brand-200 hover:text-red-500 transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* 标题 */}
                <h3 className="font-heading font-semibold text-brand-400 text-base mb-1.5">
                  {tool.title}
                </h3>

                {/* 描述 */}
                <p className="text-sm text-brand-300 mb-3 flex-1 line-clamp-2">
                  {tool.description || '暂无描述'}
                </p>

                {/* 链接 */}
                <a
                  href={tool.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 mb-3 truncate"
                >
                  <Link2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{tool.url}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>

                {/* 底部：分享者 + 点赞 */}
                <div className="flex items-center justify-between pt-3 border-t border-brand-50">
                  <span className="text-xs text-brand-200">
                    {tool.creatorName}
                  </span>

                  <button
                    onClick={() => toggleLike(tool.id)}
                    disabled={isOwner && tool.likedBy.length === 0}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                      liked
                        ? 'bg-red-50 text-red-500 border border-red-200'
                        : 'bg-brand-50 text-brand-300 border border-brand-100 hover:bg-red-50 hover:text-red-400 hover:border-red-200'
                    } ${isOwner && tool.likedBy.length === 0 ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}
                    title={isOwner ? '不能给自己的工具点赞' : liked ? '取消点赞' : '点赞'}
                  >
                    <Heart
                      className={`w-3.5 h-3.5 ${liked ? 'fill-red-500' : ''}`}
                    />
                    {tool.likedBy.length > 0 && (
                      <span>{tool.likedBy.length}</span>
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ======== 添加工具弹窗 ======== */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-heading text-lg font-bold text-brand-400">分享新工具</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1.5 rounded-lg hover:bg-brand-50 text-brand-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* 标题 */}
              <div>
                <label className="block text-sm font-medium text-brand-400 mb-1">
                  工具名称 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="例如：Figma 插件推荐"
                  maxLength={40}
                  className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 outline-none"
                  autoFocus
                />
              </div>

              {/* 分类 */}
              <div>
                <label className="block text-sm font-medium text-brand-400 mb-1">分类</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as ToolCategory)}
                  className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 outline-none bg-white"
                >
                  {TOOL_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* 链接 */}
              <div>
                <label className="block text-sm font-medium text-brand-400 mb-1">
                  工具链接 <span className="text-red-400">*</span>
                </label>
                <input
                  type="url"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 outline-none"
                />
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-sm font-medium text-brand-400 mb-1">描述</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="简单介绍一下这个工具..."
                  maxLength={200}
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-brand-100 rounded-lg focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 outline-none resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-4 py-2 text-sm font-medium text-brand-400 bg-brand-50 rounded-lg hover:bg-brand-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={!formTitle.trim() || !formUrl.trim()}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                确认分享
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
