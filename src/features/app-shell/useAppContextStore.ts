import { create } from 'zustand'
import { loadAppContext, loadNavigationManifest } from './supabaseDataSource'
import type { AppContext, NavigationManifestItem, PrimaryRoleId } from './types'

type AppContextStatus = 'idle' | 'loading' | 'ready' | 'error'

type AppContextState = {
  context: AppContext | null
  navigation: NavigationManifestItem[]
  status: AppContextStatus
  error: string | null
  load: () => Promise<void>
  switchWorkView: (workView: PrimaryRoleId) => Promise<void>
  reset: () => void
}

export const useAppContextStore = create<AppContextState>((set, get) => ({
  context: null,
  navigation: [],
  status: 'idle',
  error: null,

  load: async () => {
    if (get().status === 'loading') return
    set({ status: 'loading', error: null, navigation: [] })
    try {
      const context = await loadAppContext()
      const navigation = await loadNavigationManifest(context.currentWorkView)
      set({ context, navigation, status: 'ready', error: null })
    } catch (error) {
      set({
        context: null,
        navigation: [],
        status: 'error',
        error: error instanceof Error ? error.message : '4.0 工作台加载失败。',
      })
    }
  },

  switchWorkView: async (workView) => {
    const current = get().context
    if (!current || !current.availableWorkViews.some((view) => view.id === workView)) {
      set({ status: 'error', error: '该工作视图未获授权。', navigation: [] })
      return
    }
    set({ status: 'loading', error: null, navigation: [] })
    try {
      const navigation = await loadNavigationManifest(workView)
      set({
        context: { ...current, currentWorkView: workView },
        navigation,
        status: 'ready',
        error: null,
      })
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : '切换工作视图失败。',
        navigation: [],
      })
    }
  },

  reset: () => set({ context: null, navigation: [], status: 'idle', error: null }),
}))
