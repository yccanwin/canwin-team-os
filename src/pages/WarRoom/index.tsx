import { useState } from 'react'
import { Shield, Plus, MessageSquare, Trash2, X, Send } from 'lucide-react'
import { useWarRoomStore } from '@/stores/useWarRoomStore'
import { useUserStore } from '@/stores/useUserStore'
import { isCaptainRole } from '@/services/profile'

type ExpandedPolicy = string | null

export default function WarRoomPage() {
  const policies = useWarRoomStore((s) => s.policies)
  const addPolicy = useWarRoomStore((s) => s.addPolicy)
  const deletePolicy = useWarRoomStore((s) => s.deletePolicy)
  const addComment = useWarRoomStore((s) => s.addComment)
  const deleteComment = useWarRoomStore((s) => s.deleteComment)

  const currentUser = useUserStore((s) => s.currentUser)
  const users = useUserStore((s) => s.users)

  const [showNewModal, setShowNewModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [expanded, setExpanded] = useState<ExpandedPolicy>(null)
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({})

  const isCaptain = isCaptainRole(currentUser?.role)

  const getUserName = (userId: string) => {
    const u = users.find((u) => u.id === userId)
    return u?.name ?? '未知成员'
  }

  const handlePublish = () => {
    if (!newTitle.trim() || !newContent.trim() || !currentUser) return
    addPolicy({
      title: newTitle.trim(),
      content: newContent.trim(),
      creatorId: currentUser.id,
    })
    setNewTitle('')
    setNewContent('')
    setShowNewModal(false)
  }

  const handleAddComment = (policyId: string) => {
    const text = (commentTexts[policyId] ?? '').trim()
    if (!text || !currentUser) return
    addComment(policyId, currentUser.id, text)
    setCommentTexts((prev) => ({ ...prev, [policyId]: '' }))
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => (prev === id ? null : id))
  }

  // 按时间格式化为相对时间
  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins}分钟前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}小时前`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}天前`
    const months = Math.floor(days / 30)
    return `${months}个月前`
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* 页面头部 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-red-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-brand-400">军机处</h1>
            <p className="text-sm text-brand-200">团队政策发布 · 永久公开讨论</p>
          </div>
        </div>
        {isCaptain && (
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-red-500 text-white rounded-xl text-sm font-semibold hover:from-amber-600 hover:to-red-600 transition-all shadow-lg shadow-amber-500/20"
          >
            <Plus className="w-4 h-4" />
            发布新政
          </button>
        )}
      </div>

      {/* 空状态 */}
      {policies.length === 0 && (
        <div className="text-center py-16">
          <Shield className="w-16 h-16 text-brand-100 mx-auto mb-4 opacity-50" />
          <p className="text-brand-200 text-lg font-medium">暂无政策发布</p>
          <p className="text-brand-100 text-sm mt-1">
            {isCaptain ? '点击上方按钮发布第一条团队政策' : '等待队长发布第一条团队政策'}
          </p>
        </div>
      )}

      {/* 政策列表 */}
      <div className="space-y-4">
        {policies.map((policy) => {
          const isExpanded = expanded === policy.id
          const commentCount = policy.comments.length

          return (
            <div
              key={policy.id}
              className="bg-white rounded-2xl border border-brand-100 overflow-hidden hover:border-amber-200 transition-colors"
            >
              {/* 政策卡片主体 */}
              <div
                onClick={() => toggleExpand(policy.id)}
                className="p-5 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-md text-xs font-medium">
                        政策
                      </span>
                      <span className="text-xs text-brand-200">
                        {timeAgo(policy.createdAt)}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-brand-400 mb-2">
                      {policy.title}
                    </h3>
                    <p
                      className={`text-sm text-brand-200 whitespace-pre-wrap ${
                        isExpanded ? '' : 'line-clamp-3'
                      }`}
                    >
                      {policy.content}
                    </p>
                  </div>
                </div>

                {/* 底部信息栏 */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-brand-50">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-[10px] font-bold text-white">
                      {getUserName(policy.creatorId).charAt(0)}
                    </div>
                    <span className="text-xs text-brand-200">
                      {getUserName(policy.creatorId)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button className="flex items-center gap-1 text-xs text-brand-200 hover:text-amber-600 transition-colors">
                      <MessageSquare className="w-3.5 h-3.5" />
                      {commentCount > 0 ? `${commentCount} 条讨论` : '参与讨论'}
                    </button>
                    {currentUser && currentUser.id === policy.creatorId && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (confirm('确定删除这条政策吗？所有讨论也将被删除。')) {
                            deletePolicy(policy.id)
                            if (isExpanded) setExpanded(null)
                          }
                        }}
                        className="text-xs text-brand-100 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* 评论区（展开时显示） */}
              {isExpanded && (
                <div className="border-t border-brand-100 bg-brand-50/50">
                  <div className="p-5">
                    <p className="text-xs font-semibold text-brand-200 mb-4 uppercase tracking-wider">
                      讨论区 ({commentCount})
                    </p>

                    {/* 评论列表 */}
                    {policy.comments.length === 0 ? (
                      <p className="text-sm text-brand-100 text-center py-4">
                        暂无讨论，发表第一条意见吧
                      </p>
                    ) : (
                      <div className="space-y-3 mb-4">
                        {policy.comments.map((comment) => (
                          <div
                            key={comment.id}
                            className="flex gap-3 p-3 rounded-xl bg-white border border-brand-50"
                          >
                            <div className="w-7 h-7 rounded-full bg-brand-200 flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5">
                              {getUserName(comment.userId).charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-semibold text-brand-400">
                                  {getUserName(comment.userId)}
                                </span>
                                <span className="text-[10px] text-brand-100">
                                  {timeAgo(comment.createdAt)}
                                </span>
                              </div>
                              <p className="text-sm text-brand-300 whitespace-pre-wrap">
                                {comment.content}
                              </p>
                            </div>
                            {currentUser && currentUser.id === comment.userId && (
                              <button
                                onClick={() => deleteComment(policy.id, comment.id)}
                                className="text-brand-100 hover:text-red-500 transition-colors shrink-0 mt-0.5"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 发表评论 */}
                    <div className="flex gap-2">
                      <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-2">
                        {currentUser?.name?.charAt(0) ?? '?'}
                      </div>
                      <div className="flex-1 flex gap-2">
                        <input
                          type="text"
                          value={commentTexts[policy.id] ?? ''}
                          onChange={(e) =>
                            setCommentTexts((prev) => ({
                              ...prev,
                              [policy.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddComment(policy.id)
                          }}
                          placeholder="发表你的意见..."
                          className="flex-1 px-3 py-2 text-sm border border-brand-100 rounded-lg bg-white focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none"
                        />
                        <button
                          onClick={() => handleAddComment(policy.id)}
                          disabled={!(commentTexts[policy.id] ?? '').trim()}
                          className="px-3 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 发布新政弹窗 */}
      {showNewModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setShowNewModal(false)
              setNewTitle('')
              setNewContent('')
            }}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full">
            <div className="flex items-center gap-2 mb-5">
              <Shield className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold text-brand-400 text-lg">发布新政策</h3>
            </div>

            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="政策标题"
              className="w-full px-4 py-2.5 text-sm border border-brand-100 rounded-xl bg-brand-50/50 focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none mb-3"
              autoFocus
            />

            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="政策详细内容..."
              rows={5}
              className="w-full px-4 py-2.5 text-sm border border-brand-100 rounded-xl bg-brand-50/50 focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none resize-none mb-4"
            />

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowNewModal(false)
                  setNewTitle('')
                  setNewContent('')
                }}
                className="px-5 py-2.5 text-sm font-medium text-brand-300 bg-brand-50 rounded-xl hover:bg-brand-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handlePublish}
                disabled={!newTitle.trim() || !newContent.trim()}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-amber-500 to-red-500 rounded-xl hover:from-amber-600 hover:to-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                确认发布
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
