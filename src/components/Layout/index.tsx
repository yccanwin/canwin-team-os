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
  LogOut,
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
  const dropdownRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  const currentUser = useUserStore((s) => s.currentUser)
  const logout = useUserStore((s) => s.logout)

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

  return (
    <div className="flex h-screen overflow-hidden page-surface">
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
          w-[200px] bg-[#172033] text-white shadow-2xl shadow-slate-900/20
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="px-6 py-5 border-b border-white/10 bg-gradient-to-br from-primary/20 to-emerald-400/10">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-primary animate-soft-pulse" />
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
      <div className="flex-1 flex flex-col overflow-hidden bg-transparent">
        {/* 顶栏 */}
        <header className="flex items-center justify-between h-14 px-4 bg-white/80 backdrop-blur border-b border-white/70 shadow-sm shrink-0">
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
                  <div className="px-3 py-3">
                    <p className="text-sm font-medium text-brand-400">{currentUser.name}</p>
                    <p className="text-xs text-brand-200">
                      {currentUser.role === 'captain' ? '队长' : '成员'} · Lv.{currentUser.level}
                    </p>
                  </div>
                  <div className="border-t border-gray-100 mt-1 pt-1">
                    <NavLink
                      to="/profile"
                      onClick={() => setUserDropdownOpen(false)}
                      className="block px-3 py-2 text-sm text-brand-400 hover:bg-brand-50"
                    >
                      个人主页
                    </NavLink>
                    <button
                      onClick={() => {
                        logout()
                        setUserDropdownOpen(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-expense hover:bg-red-50"
                    >
                      <LogOut className="h-4 w-4" />
                      退出登录
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* 内容区域 */}
        <main className="flex-1 overflow-y-auto p-5 animate-fade-in-up">
          <Outlet />
        </main>
      </div>

    </div>
  )
}
