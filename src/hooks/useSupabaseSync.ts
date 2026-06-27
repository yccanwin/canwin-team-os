import { useEffect, useRef } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useTeamStore } from '@/stores/useTeamStore'

// ============================================================
// Supabase 双向同步 Hook
//
// 每个 Zustand store 调用此 hook 来实现：
//   1. 启动时从 Supabase 拉取数据 → 合并到 store
//   2. 本地变更 → 自动推送到 Supabase
//   3. 远程 Realtime 变更 → 自动更新本地 store
// ============================================================

type StoreApi = {
  getState: () => Record<string, unknown>
  setState: (partial: Record<string, unknown>) => void
  subscribe: (listener: (state: Record<string, unknown>) => void) => () => void
}

const PENDING_WRITES = new Map<string, ReturnType<typeof setTimeout>>()

function getTeamId(): string {
  return useTeamStore.getState().teamId || 'default'
}

function supabaseTable(tableName: string) {
  const teamId = getTeamId()
  return { teamId, key: tableName }
}

function debouncedWriteToSupabase(tableName: string, data: unknown) {
  const existing = PENDING_WRITES.get(tableName)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(async () => {
    PENDING_WRITES.delete(tableName)

    if (!isSupabaseConfigured()) return

    const { teamId } = supabaseTable(tableName)
    if (!teamId || teamId === 'default') return

    try {
      await supabase.from('team_data').upsert(
        {
          team_id: teamId,
          table_name: tableName,
          data: data as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'team_id, table_name' }
      )
    } catch (e) {
      console.warn(`[Supabase] 写入 ${tableName} 失败:`, e)
    }
  }, 300) // 300ms 防抖

  PENDING_WRITES.set(tableName, timer)
}

export function useSupabaseSync(
  tableName: string,
  store: StoreApi,
  options?: { enabled?: boolean }
): void {
  const enabled = options?.enabled !== false
  const initialized = useRef(false)

  // 1. 启动时从 Supabase 拉取数据
  useEffect(() => {
    if (!enabled || !isSupabaseConfigured() || initialized.current) return
    initialized.current = true

    const { teamId } = supabaseTable(tableName)
    if (!teamId || teamId === 'default') return

    supabase
      .from('team_data')
      .select('data')
      .eq('team_id', teamId)
      .eq('table_name', tableName)
      .single()
      .then(({ data, error }) => {
        if (error) {
          if (error.code === 'PGRST116') return // 无数据，正常
          console.warn(`[Supabase] 读取 ${tableName} 失败:`, error.message)
          return
        }
        if (data?.data) {
          const local = store.getState()
          const remote = data.data as Record<string, unknown>

          // 智能合并：保留本地比远程新的数据
          // 简单策略：远端数据直接覆盖本地（首次同步）
          store.setState({ ...local, ...remote })
        }
      })
  }, [tableName, store, enabled])

  // 2. 本地变更 → 推送 Supabase
  useEffect(() => {
    if (!enabled || !isSupabaseConfigured()) return

    const unsub = store.subscribe((state) => {
      // 排除 Zustand 内部字段
      const { destroy, ...data } = state as Record<string, unknown> & {
        destroy?: unknown
      }
      debouncedWriteToSupabase(tableName, data)
    })

    return () => {
      unsub()
      const pending = PENDING_WRITES.get(tableName)
      if (pending) {
        clearTimeout(pending)
        PENDING_WRITES.delete(tableName)
      }
    }
  }, [tableName, store, enabled])

  // 3. Supabase Realtime → 更新本地
  useEffect(() => {
    if (!enabled || !isSupabaseConfigured()) return

    const { teamId } = supabaseTable(tableName)
    if (!teamId || teamId === 'default') return

    const channel = supabase
      .channel(`team_data:${teamId}:${tableName}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'team_data',
          filter: `team_id=eq.${teamId}`,
        },
        (payload) => {
          const row = payload.new as { table_name: string; data: Record<string, unknown> } | null

          // 只处理当前表名
          if (!row || row.table_name !== tableName) return

          // 跳过自己写入的变更（防抖会在本地变更时处理）
          if (payload.eventType === 'UPDATE' && !payload.old) return

          const local = store.getState()
          const remote = row.data
          store.setState({ ...local, ...remote })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tableName, store, enabled])
}
