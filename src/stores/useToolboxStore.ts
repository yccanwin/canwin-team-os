import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ToolCategory, ToolCategoryItem, ToolDraft, ToolItem } from '@/types/toolbox'
import {
  createToolCategory,
  createToolRecord,
  deleteToolCategory,
  deleteToolRecord,
  loadToolCategories,
  reorderToolCategories,
  toggleToolLikeRecord,
  updateToolCategory,
  updateToolRecord,
} from '@/services/toolbox'
import { useUserStore } from '@/stores/useUserStore'
import { safeStorage } from '@/utils/safeStorage'

interface ToolboxState {
  tools: ToolItem[]
  categories: ToolCategoryItem[]
  setTools: (tools: ToolItem[]) => void
  refreshCategories: () => Promise<void>
  addTool: (data: ToolDraft) => Promise<void>
  updateTool: (id: string, data: ToolDraft) => Promise<void>
  deleteTool: (id: string) => Promise<void>
  toggleLike: (toolId: string) => Promise<void>
  createCategory: (name: string) => Promise<void>
  renameCategory: (categoryId: string, name: string) => Promise<void>
  reorderCategories: (categoryIds: string[]) => Promise<void>
  deleteCategory: (categoryId: string, moveToCategoryId?: string) => Promise<void>
  hasLiked: (toolId: string, userId: string) => boolean
  getToolsByCategory: (category: ToolCategory | 'all') => ToolItem[]
}

export const useToolboxStore = create<ToolboxState>()(
  persist(
    (set, get) => ({
      tools: [],
      categories: [],
      setTools: (tools) => set({ tools }),

      refreshCategories: async () => {
        const categories = await loadToolCategories()
        set({ categories })
      },

      addTool: async (data) => {
        const savedTool = await createToolRecord(data)
        set((state) => ({ tools: [savedTool, ...state.tools] }))
      },

      updateTool: async (id, data) => {
        const savedTool = await updateToolRecord(id, data)
        set((state) => ({
          tools: state.tools.map((tool) => (tool.id === id ? savedTool : tool)),
        }))
      },

      deleteTool: async (id) => {
        await deleteToolRecord(id)
        set((state) => ({ tools: state.tools.filter((tool) => tool.id !== id) }))
      },

      toggleLike: async (toolId) => {
        const currentUser = useUserStore.getState().currentUser
        if (!currentUser) return
        const liked = await toggleToolLikeRecord(toolId)
        set((state) => ({
          tools: state.tools.map((tool) => {
            if (tool.id !== toolId) return tool
            const withoutCurrentUser = tool.likedBy.filter((id) => id !== currentUser.id)
            return {
              ...tool,
              likedBy: liked ? [...withoutCurrentUser, currentUser.id] : withoutCurrentUser,
            }
          }),
        }))
      },

      createCategory: async (name) => {
        await createToolCategory(name)
        await get().refreshCategories()
      },

      renameCategory: async (categoryId, name) => {
        const category = get().categories.find((item) => item.id === categoryId)
        if (!category) throw new Error('分类不存在')
        await updateToolCategory(categoryId, name, category.sortOrder)
        await get().refreshCategories()
      },

      reorderCategories: async (categoryIds) => {
        await reorderToolCategories(categoryIds)
        await get().refreshCategories()
      },

      deleteCategory: async (categoryId, moveToCategoryId) => {
        await deleteToolCategory(categoryId, moveToCategoryId ?? null)
        await get().refreshCategories()
      },

      hasLiked: (toolId, userId) => {
        const tool = get().tools.find((item) => item.id === toolId)
        return tool ? tool.likedBy.includes(userId) : false
      },

      getToolsByCategory: (category) => {
        const { tools } = get()
        return category === 'all' ? tools : tools.filter((tool) => tool.category === category)
      },
    }),
    {
      name: 'canwin-toolbox',
      version: 3,
      storage: safeStorage,
      partialize: (state) => ({ tools: state.tools }),
      migrate: () => ({ tools: [], categories: [] }),
    }
  )
)
