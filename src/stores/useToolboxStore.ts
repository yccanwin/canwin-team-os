import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ToolItem, ToolCategory } from '@/types/toolbox'
import { useUserStore } from '@/stores/useUserStore'

interface ToolboxState {
  tools: ToolItem[]

  addTool: (data: {
    title: string
    description: string
    url: string
    category: ToolCategory
  }) => void

  deleteTool: (id: string) => void

  toggleLike: (toolId: string) => void

  hasLiked: (toolId: string, userId: string) => boolean

  getToolsByCategory: (category: ToolCategory | 'all') => ToolItem[]
}

export const useToolboxStore = create<ToolboxState>()(
  persist(
    (set, get) => ({
      tools: [],

      addTool: (data) => {
        const currentUser = useUserStore.getState().currentUser
        if (!currentUser) return

        const newTool: ToolItem = {
          id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title: data.title,
          description: data.description,
          url: data.url,
          category: data.category,
          creatorId: currentUser.id,
          creatorName: currentUser.name,
          likedBy: [],
          createdAt: new Date().toISOString(),
        }

        set((s) => ({ tools: [newTool, ...s.tools] }))
      },

      deleteTool: (id) => {
        set((s) => ({ tools: s.tools.filter((t) => t.id !== id) }))
      },

      toggleLike: (toolId) => {
        const currentUser = useUserStore.getState().currentUser
        if (!currentUser) return

        set((s) => {
          const tools = s.tools.map((t) => {
            if (t.id !== toolId) return t

            const alreadyLiked = t.likedBy.includes(currentUser.id)

            if (alreadyLiked) {
              // 取消点赞：只移除 ID，不扣 XP
              return {
                ...t,
                likedBy: t.likedBy.filter((uid) => uid !== currentUser.id),
              }
            } else {
              // 点赞：给分享者 +5 XP（不给自己的工具点赞）
              if (t.creatorId !== currentUser.id) {
                const userStore = useUserStore.getState()
                userStore.addXP(t.creatorId, 5)
              }

              return {
                ...t,
                likedBy: [...t.likedBy, currentUser.id],
              }
            }
          })

          return { tools }
        })
      },

      hasLiked: (toolId, userId) => {
        const tool = get().tools.find((t) => t.id === toolId)
        return tool ? tool.likedBy.includes(userId) : false
      },

      getToolsByCategory: (category) => {
        const { tools } = get()
        if (category === 'all') return tools
        return tools.filter((t) => t.category === category)
      },
    }),
    {
      name: 'canwin-toolbox',
      version: 1,
    }
  )
)
