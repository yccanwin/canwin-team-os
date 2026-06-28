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

type SupabaseSyncOptions = {
  enabled?: boolean
  excludeKeys?: string[]
}

const PENDING_WRITES = new Map<string, ReturnType<typeof setTimeout>>()

function pendingWriteKey(teamId: string, tableName: string): string {
  return `${teamId}:${tableName}`
}

function debouncedWriteToSupabase(teamId: string, tableName: string, data: unknown) {
  const key = pendingWriteKey(teamId, tableName)
  const existing = PENDING_WRITES.get(key)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(async () => {
    PENDING_WRITES.delete(key)

    if (!isSupabaseConfigured()) return

    if (!teamId || teamId === 'default') return

    try {
      const { error } = await supabase.from('team_data').upsert(
        {
          team_id: teamId,
          table_name: tableName,
          data: data as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'team_id, table_name' }
      )
      if (error) {
        console.warn(`[Supabase] 写入 ${tableName} 失败:`, error.message)
      }
    } catch (e) {
      console.warn(`[Supabase] 写入 ${tableName} 失败:`, e)
    }
  }, 300) // 300ms 防抖

  PENDING_WRITES.set(key, timer)
}

function removeExcludedKeys(
  data: Record<string, unknown>,
  excludeKeys: string[] = []
): Record<string, unknown> {
  if (excludeKeys.length === 0) return data

  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !excludeKeys.includes(key))
  )
}

export function useSupabaseSync(
  tableName: string,
  store: StoreApi,
  options?: SupabaseSyncOptions
): void {
  const enabled = options?.enabled !== false
  const excludeKeys = options?.excludeKeys ?? []
  const teamId = useTeamStore((s) => s.teamId)
  const isApplyingRemote = useRef(false)
  const loadedKey = useRef<string | null>(null)

  // 1. 启动时从 Supabase 拉取数据
  useEffect(() => {
    if (!teamId || teamId === 'default') return
    if (!enabled || !isSupabaseConfigured()) return

    const key = pendingWriteKey(teamId, tableName)
    let cancelled = false

    async function loadRemoteData() {
      try {
        const { data, error } = await supabase
          .from('team_data')
          .select('data')
          .eq('team_id', teamId)
          .eq('table_name', tableName)
          .maybeSingle()

        if (cancelled) return

        if (error) {
          console.warn(`[Supabase] 读取 ${tableName} 失败:`, error.message)
          return
        }
        if (data?.data) {
          const local = store.getState()
          const remote = removeExcludedKeys(data.data as Record<string, unknown>, excludeKeys)

          isApplyingRemote.current = true
          try {
            store.setState({ ...local, ...remote })
          } finally {
            isApplyingRemote.current = false
          }
        }
      } catch (e) {
        if (!cancelled) console.warn(`[Supabase] 读取 ${tableName} 失败:`, e)
      } finally {
        if (!cancelled) loadedKey.current = key
      }
    }

    loadRemoteData()

    return () => {
      cancelled = true
    }
  }, [tableName, store, enabled, teamId])

  // 2. 本地变更 → 推送 Supabase
  useEffect(() => {
    if (!enabled || !isSupabaseConfigured()) return
    if (!teamId || teamId === 'default') return

    const unsub = store.subscribe((state) => {
      if (isApplyingRemote.current) return
      if (loadedKey.current !== pendingWriteKey(teamId, tableName)) return

      // 排除 Zustand 内部字段
      const { destroy, ...data } = state as Record<string, unknown> & {
        destroy?: unknown
      }
      debouncedWriteToSupabase(teamId, tableName, removeExcludedKeys(data, excludeKeys))
    })

    return () => {
      unsub()
      const pending = PENDING_WRITES.get(pendingWriteKey(teamId, tableName))
      if (pending) {
        clearTimeout(pending)
        PENDING_WRITES.delete(pendingWriteKey(teamId, tableName))
      }
    }
  }, [tableName, store, enabled, teamId])

  // 3. Supabase Realtime → 更新本地
  useEffect(() => {
    if (!enabled || !isSupabaseConfigured()) return

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
          const remote = removeExcludedKeys(row.data, excludeKeys)
          isApplyingRemote.current = true
          try {
            store.setState({ ...local, ...remote })
          } finally {
            isApplyingRemote.current = false
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tableName, store, enabled, teamId])
}
