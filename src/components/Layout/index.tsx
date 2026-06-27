import { useState, useEffect, useRef } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  CheckSquare,
  Target,
  Vote,
  Package,
  Trophy,
  Camera,
  Building2,
  Clock,
  Settings,
  Menu,
  X,
  BarChart3,
  ChevronDown,
  Lock,
  User,
  CalendarDays,
  Wrench,
  Shield,
} from 'lucide-react'
import { useUserStore } from '@/stores/useUserStore'

const NAV_GROUPS = [
  {
    label: '核心功能',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: '工作台', exact: true },
      { to: '/profile', icon: User, label: '个人主页' },
      { to: '/tasks', icon: CheckSquare, label: '任务' },
      { to: '/calendar', icon: CalendarDays, label: '日历中心' },
      { to: '/toolbox', icon: Wrench, label: '工具箱' },
      { to: '/warroom', icon: Shield, label: '军机处' },
      { to: '/goals', icon: Target, label: '目标' },
      { to: '/votes', icon: Vote, label: '投票' },
    ],
  },
  {
    label: '文化展示',
    items: [
      { to: '/inventory', icon: Package, label: '仓库' },
      { to: '/timeline', icon: Clock, label: '编年史' },
      { to: '/achievements', icon: Trophy, label: '案例馆' },
      { to: '/photos', icon: Camera, label: '相册' },
      { to: '/assets', icon: Building2, label: '资产馆' },
    ],
  },
  {
    label: '设置',
    items: [
      { to: '/settings', icon: Settings, label: '设置' },
    ],
  },
]


// ============================================================
// 主布局组件
// ============================================================

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const [passwordModal, setPasswordModal] = useState<string | null>(null)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  const currentUser = useUserStore((s) => s.currentUser)
  const users = useUserStore((s) => s.users)
  const switchUser = useUserStore((s) => s.switchUser)

  // 点击外部关闭下拉
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setUserDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 防御：如果用户数据损坏，显示重置按钮
  if (!currentUser || !currentUser.id || !currentUser.name) {
    return (
      <div className="flex items-center justify-center h-screen bg-brand-50">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <p className="text-brand-400 mb-4">用户数据加载失败，可能是本地存储损坏。</p>
          <button
            onClick={() => {
              useUserStore.persist.clearStorage()
              window.location.reload()
            }}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            重置数据并刷新
          </button>
        </div>
      </div>
    )
  }

  const handleSwitchUser = (userId: string) => {
    const targetUser = users.find((u) => u.id === userId)
    if (!targetUser) return

    // 切换到自己，直接关闭
    if (targetUser.id === currentUser.id) {
      setUserDropdownOpen(false)
      return
    }

    // 目标用户有密码 → 需要输入密码
    if (targetUser.switchPassword) {
      setPasswordModal(userId)
      setPasswordInput('')
      setPasswordError('')
      return
    }

    // 无密码 → 直接切换
    switchUser(userId)
    setUserDropdownOpen(false)
  }

  const handlePasswordSubmit = () => {
    const targetUser = users.find((u) => u.id === passwordModal)
    if (targetUser && passwordInput === targetUser.switchPassword) {
      switchUser(passwordModal!)
      setPasswordModal(null)
      setUserDropdownOpen(false)
      setPasswordInput('')
      setPasswordError('')
    } else {
      setPasswordError('密码错误')
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 左侧导航栏 */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-30
          flex flex-col
          w-[200px] bg-[#1E293B] text-white
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="px-6 py-5 border-b border-white/10 bg-gradient-to-br from-primary/10 to-primary/5">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-primary" />
            <span className="text-lg font-semibold tracking-wide">翻身小队</span>
          </div>
          <p className="text-xs text-gray-400 mt-1 ml-9">赢在未来</p>
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {NAV_GROUPS.map((group, groupIdx) => (
            <div key={group.label}>
              {groupIdx > 0 && (
                <div className="mx-3 my-2 border-t border-white/10" />
              )}
              <p className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-gray-500">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = item.exact
                    ? location.pathname === item.to
                    : location.pathname.startsWith(item.to)

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setSidebarOpen(false)}
                      className={`
                        flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
                        transition-colors duration-150
                        ${
                          isActive
                            ? 'bg-primary/20 text-white font-medium border-l-[3px] border-primary ml-[-12px] pl-[9px] rounded-l-none'
                            : 'text-neutral-tertiary hover:bg-white/10 hover:text-white'
                        }
                      `}
                    >
                      <item.icon
                        className={`w-5 h-5 shrink-0 ${isActive ? 'text-primary' : ''}`}
                      />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* 底部版本号 */}
        <div className="px-5 py-3 border-t border-white/10 flex items-center gap-2">
          <span className="w-2 h-2 bg-green-400 rounded-full shrink-0" />
          <span className="bg-white/10 text-gray-400 px-2 py-0.5 rounded-full text-[10px]">v2.0</span>
        </div>
      </aside>

      {/* 右侧主区域 */}
      <div className="flex-1 flex flex-col overflow-hidden bg-brand-50">
        {/* 顶栏 */}
        <header className="flex items-center justify-between h-14 px-4 bg-white border-b border-brand-100 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100"
          >
            <Menu className="w-5 h-5 text-brand-400" />
          </button>

          {/* 用户切换 */}
          <div className="flex items-center gap-3 ml-auto" ref={dropdownRef}>
            <div className="relative">
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                  style={{ backgroundColor: '#6366F1' }}
                >
                  {currentUser.name.charAt(0)}
                </div>
                <div className="text-left hidden sm:block">
                  <p className="text-sm font-medium text-brand-400">{currentUser.name}</p>
                  <p className="text-xs text-brand-200">
                    {currentUser.role === 'captain' ? '队长' : '成员'} · Lv.{currentUser.level}
                  </p>
                </div>
                <ChevronDown className="w-4 h-4 text-brand-200" />
              </button>

              {/* 下拉菜单 */}
              {userDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg shadow-lg border border-brand-100 py-1 z-50">
                  <p className="px-3 py-2 text-xs text-brand-200 font-medium">切换用户</p>
                  {users.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => handleSwitchUser(user.id)}
                      className={`
                        w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors
                        ${user.id === currentUser.id ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-brand-50 text-brand-400'}
                      `}
                    >
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ backgroundColor: '#6366F1' }}
                      >
                        {user.name.charAt(0)}
                      </div>
                      <span>{user.name}</span>
                      {user.role === 'captain' && (
                        <Lock className="w-3 h-3 text-brand-200 ml-auto" />
                      )}
                    </button>
                  ))}
                  <div className="border-t border-gray-100 mt-1 pt-1">
                    <NavLink
                      to="/profile"
                      onClick={() => setUserDropdownOpen(false)}
                      className="block px-3 py-2 text-sm text-brand-400 hover:bg-brand-50"
                    >
                      个人主页
                    </NavLink>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* 内容区域 */}
        <main className="flex-1 overflow-y-auto p-5">
          <Outlet />
        </main>
      </div>

      {/* 密码验证弹窗 */}
      {passwordModal && (() => {
        const targetUser = users.find((u) => u.id === passwordModal)
        return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setPasswordModal(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl px-6 py-6 max-w-xs w-full">
            <div className="flex items-center gap-2 mb-4">
              <Lock className="w-5 h-5 text-indigo-600" />
              <h3 className="font-heading text-base font-bold text-brand-400">
                切换到 {targetUser?.name || '成员'} 需要密码
              </h3>
            </div>
            <input
              type="password"
              maxLength={4}
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value)
                setPasswordError('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              placeholder="请输入4位密码"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-center text-lg tracking-widest focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              autoFocus
            />
            {passwordError && (
              <p className="text-xs text-red-500 mt-2 text-center">{passwordError}</p>
            )}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setPasswordModal(null)}
                className="flex-1 px-4 py-2 text-sm font-medium text-brand-400 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handlePasswordSubmit}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                确认
              </button>
            </div>
          </div>
        </div>
        )
      })()}
    </div>
  )
}
