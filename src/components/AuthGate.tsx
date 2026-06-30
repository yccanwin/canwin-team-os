import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { LockKeyhole, LogIn, ShieldCheck, Sparkles } from 'lucide-react'
import { loadCurrentProfile, signInWithPassword } from '@/services/profile'
import { useUserStore } from '@/stores/useUserStore'

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
      setError('请输入账号和密码')
      return
    }

    setLoading(true)
    setError('')
    try {
      const user = await signInWithPassword(login, password)
      setCurrentUser(user)
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.18),transparent_32%),radial-gradient(circle_at_82%_12%,rgba(16,185,129,0.16),transparent_26%),linear-gradient(135deg,#f8fafc,#eef2ff)]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-5 py-10">
        <div className="grid w-full gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <section className="space-y-7 animate-fade-in-up">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white/70 px-3 py-1 text-xs font-medium text-indigo-700 shadow-sm backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              CanWin Team OS
            </div>
            <div className="space-y-4">
              <h1 className="max-w-xl text-4xl font-semibold leading-tight text-brand-400 sm:text-5xl">
                翻身小队内部作战系统
              </h1>
              <p className="max-w-lg text-base leading-7 text-brand-300">
                统一任务、目标、库存、财务、案例与团队动态。网页端和移动端使用同一份云端数据。
              </p>
            </div>
            <div className="grid max-w-xl gap-3 sm:grid-cols-3">
              {['固定团队空间', '云端同步', '账号登录'].map((label) => (
                <div key={label} className="rounded-xl border border-white/70 bg-white/65 p-4 shadow-sm backdrop-blur card-hover">
                  <ShieldCheck className="mb-3 h-5 w-5 text-income" />
                  <p className="text-sm font-medium text-brand-400">{label}</p>
                </div>
              ))}
            </div>
          </section>

          <form
            onSubmit={handleSubmit}
            className="animate-fade-in-up rounded-2xl border border-white/80 bg-white/85 p-6 shadow-2xl shadow-indigo-100/60 backdrop-blur md:p-8"
          >
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-brand-400">Supabase Auth 登录</h2>
                <p className="text-sm text-brand-200">使用管理员创建的团队账号进入系统</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-brand-300">
                  邮箱 / admin
                </label>
                <input
                  type="text"
                  value={login}
                  onChange={(e) => {
                    setLogin(e.target.value)
                    setError('')
                  }}
                  placeholder="admin 或 admin@canwin.local"
                  className="w-full rounded-xl border border-neutral-border bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-brand-300">
                  密码
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError('')
                  }}
                  placeholder="请输入密码"
                  className="w-full rounded-xl border border-neutral-border bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                />
              </div>
            </div>

            {error && (
              <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-press mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogIn className="h-4 w-4" />
              {loading ? '登录中...' : '进入系统'}
            </button>

            <p className="mt-4 text-center text-xs text-brand-200">
              初始账号只保留 admin，密码由 Supabase Auth 中的 admin 用户设置
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
