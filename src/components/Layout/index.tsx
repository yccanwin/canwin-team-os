import { useState, useEffect, useRef } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  CheckSquare,
  Vote,
  Package,
  Trophy,
  Camera,
  Building2,
  Clock,
  Settings,
  Menu,
  BarChart3,
  ChevronDown,
  LogOut,
  User,
  Users,
  CalendarDays,
  Wrench,
  Shield,
  Network,
  LineChart,
} from 'lucide-react'
import { useUserStore } from '@/stores/useUserStore'
import { roleLabel, signOut } from '@/services/profile'
import PersonalReminderTicker from '@/components/PersonalReminderTicker'

const NAV_GROUPS = [
  {
    label: '今日协作',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: '首页', exact: true },
      { to: '/calendar', icon: CalendarDays, label: '日历' },
      { to: '/work', icon: CheckSquare, label: '推进中心' },
    ],
  },
  {
    label: '经营记录',
    items: [
      { to: '/inventory', icon: Package, label: '仓库' },
      { to: '/finance', icon: BarChart3, label: '财务' },
      { to: '/sales', icon: LineChart, label: '销售中心' },
      { to: '/sales-v3', icon: LineChart, label: '销售工作台' },
      { to: '/assets', icon: Building2, label: '资产馆' },
    ],
  },
  {
    label: '团队文化',
    items: [
      { to: '/timeline', icon: Clock, label: '编年史' },
      { to: '/achievements', icon: Trophy, label: '案例馆' },
      { to: '/photos', icon: Camera, label: '相册' },
    ],
  },
  {
    label: '共同决策',
    items: [
      { to: '/votes', icon: Vote, label: '一起决定' },
      { to: '/warroom', icon: Shield, label: '军机处' },
    ],
  },
  {
    label: '资源与成员',
    items: [
      { to: '/toolbox', icon: Wrench, label: '工具箱' },
      { to: '/skills', icon: Network, label: '技能树' },
      { to: '/members', icon: Users, label: '团队成员' },
      { to: '/profile', icon: User, label: '个人主页' },
    ],
  },
  {
    label: '设置',
    items: [
      { to: '/settings', icon: Settings, label: '设置' },
      { to: '/settings-v3', icon: Settings, label: '系统配置' },
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
    <div className="desktop-tech-mode flex h-screen overflow-hidden page-surface">
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
          app-sidebar w-[200px] bg-slate-950 text-white shadow-2xl shadow-slate-900/20
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="app-sidebar-brand px-6 py-5 border-b border-cyan-300/15 bg-gradient-to-br from-cyan-400/15 via-slate-950 to-emerald-400/10">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 shadow-[0_0_24px_rgba(34,211,238,.18)]">
              <BarChart3 className="w-5 h-5 text-cyan-200 animate-soft-pulse" />
            </span>
            <span className="text-lg font-semibold tracking-wide text-cyan-50">翻身小队</span>
          </div>
          <p className="text-xs text-cyan-100/55 mt-1 ml-11">赢在未来</p>
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {NAV_GROUPS.map((group, groupIdx) => (
            <div key={group.label}>
              {groupIdx > 0 && (
                <div className="mx-3 my-2 border-t border-white/10" />
              )}
              <p className="app-nav-group-label px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-cyan-100/45">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = item.exact
                    ? location.pathname === item.to
                    : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setSidebarOpen(false)}
                      className={`
                        app-nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
                        transition-colors duration-150
                        ${
                          isActive
                            ? 'is-active bg-cyan-300/12 text-cyan-50 font-medium border-l-[3px] border-cyan-300 ml-[-12px] pl-[9px] rounded-l-none'
                            : 'text-cyan-100/58 hover:bg-cyan-300/10 hover:text-cyan-50'
                        }
                      `}
                    >
                      <item.icon
                        className={`w-5 h-5 shrink-0 ${isActive ? 'text-cyan-200' : ''}`}
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
        <div className="app-sidebar-footer px-5 py-3 border-t border-cyan-300/15 flex items-center gap-2">
          <span className="w-2 h-2 bg-emerald-300 rounded-full shrink-0 shadow-[0_0_12px_rgba(52,211,153,.7)]" />
          <span className="bg-cyan-300/10 text-cyan-100/60 px-2 py-0.5 rounded-full text-[10px]">v2.0</span>
        </div>
      </aside>

      {/* 右侧主区域 */}
      <div className="flex-1 flex flex-col overflow-visible bg-transparent">
        {/* 顶栏 */}
        <header className="app-topbar relative z-40 flex items-center justify-between h-14 px-4 overflow-visible bg-white/80 backdrop-blur border-b border-white/70 shadow-sm shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100"
          >
            <Menu className="w-5 h-5 text-brand-400" />
          </button>

          <PersonalReminderTicker />

          {/* 用户切换 */}
          <div className="flex items-center gap-3 md:ml-0 ml-auto" ref={dropdownRef}>
            <div className="relative">
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="app-user-button flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
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
                    {roleLabel(currentUser.role)}
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
                      {roleLabel(currentUser.role)}
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
                      type="button"
                      onClick={() => {
                        setUserDropdownOpen(false)
                        logout()
                        void signOut().catch(() => undefined)
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
        <main className="app-main flex-1 overflow-y-auto p-3 sm:p-5 animate-fade-in-up">
          <Outlet />
        </main>
      </div>

    </div>
  )
}
