import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { LockKeyhole, LogIn } from 'lucide-react'
import { loadCurrentProfile, signInWithPassword } from '@/services/profile'
import { useUserStore } from '@/stores/useUserStore'

const CODE_COLUMNS = [
  ['AUTH://CANWIN', '0x7A42', 'SYNC_TEAM()', 'ACCESS_KEY', '01011010'],
  ['ROUTE_DASH', 'TOKEN:LIVE', 'LOAD_PROFILE', 'SYS_READY', '10010110'],
  ['TASK_STREAM', 'CACHE_OK', 'VERIFY_ID', 'LOGIN_GATE', '01100101'],
  ['FINANCE_NODE', 'RLS_ON', 'SESSION_MAP', 'OPEN_CORE', '11001010'],
  ['INVENTORY_IO', 'EDGE_FN', 'PROFILE_ID', 'TEAM_OS', '00110111'],
]

export default function AuthGate() {
  const setCurrentUser = useUserStore((s) => s.setCurrentUser)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function restoreSession() {
      setLoading(true)
      try {
        const user = await loadCurrentProfile()
        if (!cancelled && user) setCurrentUser(user)
      } catch {
        if (!cancelled) setCurrentUser(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    restoreSession()

    return () => {
      cancelled = true
    }
  }, [setCurrentUser])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!login.trim() || !password) {
      setError('Account and password are required')
      return
    }

    setLoading(true)
    setError('')
    try {
      const user = await signInWithPassword(login, password)
      setCurrentUser(user)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-shell relative min-h-screen overflow-hidden bg-[#070b16] text-white">
      <div className="login-grid absolute inset-0" />
      <div className="login-code-rain absolute inset-0" aria-hidden="true">
        {CODE_COLUMNS.map((column, columnIndex) => (
          <div
            key={column.join('-')}
            className="login-code-column"
            style={{ left: `${9 + columnIndex * 21}%`, animationDelay: `${columnIndex * -2.1}s` }}
          >
            {Array.from({ length: 8 }).map((_, groupIndex) => (
              <div key={groupIndex} className="login-code-group">
                {column.map((line) => (
                  <span key={`${groupIndex}-${line}`}>{line}</span>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="login-scan absolute inset-0" />
      <div className="login-beam login-beam-a absolute" />
      <div className="login-beam login-beam-b absolute" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-5 py-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-7 text-center animate-fade-in-up">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center border border-cyan-300/35 bg-cyan-300/10 shadow-[0_0_34px_rgba(34,211,238,0.22)] backdrop-blur">
              <LockKeyhole className="h-6 w-6 text-cyan-200" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200/80">
              CanWin Team OS
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="animate-fade-in-up border border-white/12 bg-white/[0.07] p-6 shadow-2xl shadow-cyan-950/60 backdrop-blur-xl md:p-8"
          >
            <div className="space-y-4">
              <div>
                <input
                  type="text"
                  aria-label="Account"
                  value={login}
                  onChange={(e) => {
                    setLogin(e.target.value)
                    setError('')
                  }}
                  placeholder="Account ID or email"
                  className="w-full border border-white/12 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/70 focus:ring-4 focus:ring-cyan-300/10"
                />
              </div>

              <div>
                <input
                  type="password"
                  aria-label="Password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError('')
                  }}
                  placeholder="Password"
                  className="w-full border border-white/12 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/70 focus:ring-4 focus:ring-cyan-300/10"
                />
              </div>
            </div>

            {error && (
              <p className="mt-4 bg-red-500/10 px-3 py-2 text-sm text-red-200 ring-1 ring-red-400/25">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`cyber-login-button btn-press mt-6 flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-semibold ${loading ? 'is-loading' : ''}`}
            >
              <LogIn className="h-4 w-4" />
              <span>{loading ? 'ACCESSING CORE' : 'ENTER SYSTEM'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
