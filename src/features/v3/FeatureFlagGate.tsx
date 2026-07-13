import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'

const TEAM_ID = 'CANWIN_TEAM'

type GateState = 'checking' | 'allowed' | 'denied'

export interface FeatureFlagGateProps {
  flagKey: string
  children: ReactNode
}

export function FeatureFlagGate({ flagKey, children }: FeatureFlagGateProps) {
  const [state, setState] = useState<GateState>('checking')

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) setState('checking') })

    async function checkFlag() {
      try {
        const { data, error } = await supabase.rpc('is_feature_enabled', {
          target_team_id: TEAM_ID,
          target_key: flagKey,
        })
        if (!cancelled) setState(!error && data === true ? 'allowed' : 'denied')
      } catch {
        if (!cancelled) setState('denied')
      }
    }

    void checkFlag()
    return () => { cancelled = true }
  }, [flagKey])

  if (state === 'checking') {
    return <div className="p-6 text-sm text-slate-500">正在检查功能权限…</div>
  }

  if (state !== 'allowed') {
    return (
      <section className="m-4 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">功能未开放</h1>
        <p className="mt-2 text-sm text-slate-500">此入口尚未对当前团队开放。</p>
      </section>
    )
  }

  return <>{children}</>
}

export default FeatureFlagGate
