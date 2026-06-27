import { useState } from 'react'
import { useTeamStore } from '@/stores/useTeamStore'
import { isSupabaseConfigured } from '@/lib/supabase'
import { Users, Plus, LogIn, AlertCircle } from 'lucide-react'

export default function TeamRoomGate() {
  const { teamId, createTeam, joinTeam, teamName, setTeamName } = useTeamStore()
  const [mode, setMode] = useState<'create' | 'join' | null>(null)
  const [joinCode, setJoinCode] = useState('')
  const [joinName, setJoinName] = useState('')
  const [error, setError] = useState('')
  const [newTeamCode, setNewTeamCode] = useState<string | null>(null)
  const supabaseReady = isSupabaseConfigured()

  const handleCreate = () => {
    const id = createTeam()
    setNewTeamCode(id)
  }

  const handleJoin = () => {
    if (!joinCode.trim()) {
      setError('请输入团队码')
      return
    }
    joinTeam(joinCode.trim())
    if (joinName.trim()) setTeamName(joinName.trim())
  }

  const handleShareCode = async () => {
    const code = newTeamCode || teamId
    if (!code) return
    await navigator.clipboard.writeText(code)
    // 显示 toast 效果
    const el = document.getElementById('copied-toast')
    if (el) {
      el.style.opacity = '1'
      setTimeout(() => { el.style.opacity = '0' }, 2000)
    }
  }

  if (newTeamCode || (teamId && mode === 'create')) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center space-y-5">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <Users className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-800">团队已创建</h2>
          <p className="text-gray-500 text-sm">把下面的团队码分享给队友，他们就能加入你的团队</p>

          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <span className="text-xs text-gray-400 block mb-1">团队码</span>
            <span className="text-2xl font-mono font-bold text-indigo-600 tracking-wider select-all">
              {newTeamCode || teamId}
            </span>
          </div>

          <button
            onClick={handleShareCode}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors"
          >
            复制团队码
          </button>
          <span
            id="copied-toast"
            className="text-xs text-green-600 block opacity-0 transition-opacity"
          >
            已复制到剪贴板
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto">
            <Users className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-xl font-semibold text-gray-800">CanWin Team OS</h1>
          <p className="text-sm text-gray-500">
            {supabaseReady
              ? '创建一个团队或加入已有团队，开始协作'
              : '⚠️ 未连接云数据库，数据仅保存在本地'}
          </p>
        </div>

        {!supabaseReady && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2 items-start">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              请在 <code className="bg-amber-100 px-1 rounded">src/lib/supabase.ts</code> 中配置 Supabase URL 和 Key
            </p>
          </div>
        )}

        <div className="grid gap-3">
          <button
            onClick={() => setMode('create')}
            disabled={!supabaseReady}
            className="flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-4 h-4" />
            创建新团队
          </button>

          <button
            onClick={() => setMode('join')}
            disabled={!supabaseReady}
            className="flex items-center justify-center gap-2 py-3 bg-white text-gray-700 border border-gray-200 rounded-xl font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <LogIn className="w-4 h-4" />
            加入已有团队
          </button>
        </div>

        {mode === 'create' && (
          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                团队名称（可选）
              </label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="例如：星辰小队"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={handleCreate}
              className="w-full py-2.5 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors"
            >
              确认创建
            </button>
          </div>
        )}

        {mode === 'join' && (
          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                团队码
              </label>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value); setError('') }}
                placeholder="输入队长分享的 8 位团队码"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                你的名称（可选）
              </label>
              <input
                type="text"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                placeholder="让队友认识你"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={handleJoin}
              className="w-full py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors"
            >
              加入团队
            </button>
          </div>
        )}

        {!supabaseReady && mode && (
          <p className="text-xs text-center text-gray-400">
            配置 Supabase 后即可使用团队功能
          </p>
        )}
      </div>
    </div>
  )
}
