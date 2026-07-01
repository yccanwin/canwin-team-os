import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ToolItem, ToolCategory } from '@/types/toolbox'
import { useUserStore } from '@/stores/useUserStore'
import { createToolRecord, deleteToolRecord, updateToolRecord } from '@/services/toolbox'
import { safeStorage } from '@/utils/safeStorage'

interface ToolboxState {
  tools: ToolItem[]

  setTools: (tools: ToolItem[]) => void

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

      setTools: (tools) => set({ tools }),

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
        void createToolRecord(newTool)
          .then((savedTool) =>
            set((s) => ({
              tools: s.tools.map((t) => (t.id === newTool.id ? savedTool : t)),
            }))
          )
          .catch(() =>
            set((s) => ({
              tools: s.tools.filter((t) => t.id !== newTool.id),
            }))
          )
      },

      deleteTool: (id) => {
        const previous = get().tools
        set((s) => ({ tools: s.tools.filter((t) => t.id !== id) }))
        void deleteToolRecord(id).catch(() => set({ tools: previous }))
      },

      toggleLike: (toolId) => {
        const currentUser = useUserStore.getState().currentUser
        if (!currentUser) return

        const previous = get().tools
        let changedTool: ToolItem | undefined
        set((s) => {
          const tools = s.tools.map((t) => {
            if (t.id !== toolId) return t

            const alreadyLiked = t.likedBy.includes(currentUser.id)

            if (alreadyLiked) {
              changedTool = {
                ...t,
                likedBy: t.likedBy.filter((uid) => uid !== currentUser.id),
              }
              return changedTool
            } else {
              changedTool = {
                ...t,
                likedBy: [...t.likedBy, currentUser.id],
              }
              return changedTool
            }
          })

          return { tools }
        })
        if (changedTool) {
          void updateToolRecord(changedTool).catch(() => set({ tools: previous }))
        }
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
      version: 2,
      storage: safeStorage,
      migrate: () => ({ tools: [] }),
    }
  )
)
