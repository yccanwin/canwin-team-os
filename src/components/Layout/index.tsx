import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  LogOut,
  Menu,
  RefreshCw,
} from 'lucide-react'
import PersonalReminderTicker from '@/components/PersonalReminderTicker'
import { useAppContextStore } from '@/features/app-shell/useAppContextStore'
import type { PrimaryRoleId } from '@/features/app-shell/types'
import { roleLabel, signOut } from '@/services/profile'
import { useUserStore } from '@/stores/useUserStore'
import {
  buildMobileLinks,
  buildNavigationGroups,
  findTopbarLink,
  navigationItemMatches,
  type NavigationCollection,
  type NavigationLink,
} from './navigation'

function SidebarLink({
  item,
  currentLocation,
  nested = false,
  onNavigate,
}: {
  item: NavigationLink
  currentLocation: string
  nested?: boolean
  onNavigate: () => void
}) {
  const isActive = navigationItemMatches(item, currentLocation)
  const className = `
    app-nav-item flex items-center gap-3 rounded-lg text-sm transition-colors duration-150
    ${nested ? 'py-2 pl-9 pr-3 text-[13px]' : 'px-3 py-2.5'}
    ${item.disabled
      ? 'cursor-not-allowed text-cyan-100/30'
      : isActive
        ? 'is-active ml-[-12px] rounded-l-none border-l-[3px] border-cyan-300 bg-cyan-300/12 pl-[9px] font-medium text-cyan-50'
        : 'text-cyan-100/58 hover:bg-cyan-300/10 hover:text-cyan-50'}
  `

  if (item.disabled) {
    return (
      <span className={className} aria-disabled="true">
        <item.icon className="h-5 w-5 shrink-0" />
        <span className="truncate">{item.label}</span>
      </span>
    )
  }

  return (
    <NavLink to={item.to} onClick={onNavigate} className={className}>
      <item.icon className={`h-5 w-5 shrink-0 ${nested ? 'h-4 w-4' : ''} ${isActive ? 'text-cyan-200' : ''}`} />
      <span className="truncate">{item.label}</span>
      {item.readOnly && <span className="ml-auto text-[10px] text-cyan-100/45">只读</span>}
    </NavLink>
  )
}

function SidebarCollection({
  item,
  currentLocation,
  expanded,
  onToggle,
  onNavigate,
}: {
  item: NavigationCollection
  currentLocation: string
  expanded: boolean
  onToggle: () => void
  onNavigate: () => void
}) {
  const isActive = navigationItemMatches(item, currentLocation)
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`app-nav-item flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-150 ${
          isActive
            ? 'is-active bg-cyan-300/12 font-medium text-cyan-50'
            : 'text-cyan-100/58 hover:bg-cyan-300/10 hover:text-cyan-50'
        }`}
      >
        <item.icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-cyan-200' : ''}`} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5 border-l border-cyan-200/10">
          {item.children.map((child) => (
            <SidebarLink
              key={child.routeId}
              item={child}
              currentLocation={currentLocation}
              nested
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ShellStatus({ error, retry }: { error?: string; retry?: () => void }) {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-50 px-5">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
        {error ? (
          <>
            <h1 className="text-lg font-semibold text-slate-900">4.0 工作台已安全停止</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>
            {retry && (
              <button
                type="button"
                onClick={retry}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                <RefreshCw className="h-4 w-4" />
                重新读取权限
              </button>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center gap-3 text-sm font-medium text-slate-600">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            正在读取4.0岗位与权限
          </div>
        )}
      </div>
    </div>
  )
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const [expandedCollection, setExpandedCollection] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const currentLocation = `${location.pathname}${location.search}`

  const currentUser = useUserStore((state) => state.currentUser)
  const logout = useUserStore((state) => state.logout)
  const context = useAppContextStore((state) => state.context)
  const navigation = useAppContextStore((state) => state.navigation)
  const status = useAppContextStore((state) => state.status)
  const error = useAppContextStore((state) => state.error)
  const load = useAppContextStore((state) => state.load)
  const switchWorkView = useAppContextStore((state) => state.switchWorkView)
  const resetAppContext = useAppContextStore((state) => state.reset)

  const navigationGroups = useMemo(() => buildNavigationGroups(navigation), [navigation])
  const mobileLinks = useMemo(() => buildMobileLinks(navigation), [navigation])
  const messagesLink = useMemo(() => findTopbarLink(navigation, 'messages'), [navigation])
  const activeCollectionLabel = useMemo(
    () => navigationGroups
      .flatMap((group) => group.items)
      .find((item) => item.type === 'collection' && navigationItemMatches(item, currentLocation))?.label ?? null,
    [currentLocation, navigationGroups],
  )
  const visibleExpandedCollection = expandedCollection ?? activeCollectionLabel

  useEffect(() => {
    if (status === 'idle') void load()
  }, [load, status])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setUserDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!currentUser?.id || !currentUser.name) {
    return <ShellStatus error="成员资料未加载，无法进入4.0工作台。" />
  }
  if (status === 'idle' || status === 'loading') return <ShellStatus />
  if (status === 'error' || !context) return <ShellStatus error={error ?? '岗位权限读取失败。'} retry={() => void load()} />

  const handleWorkViewSwitch = async (workView: PrimaryRoleId) => {
    await switchWorkView(workView)
    setUserDropdownOpen(false)
  }

  const handleSignOut = () => {
    setUserDropdownOpen(false)
    resetAppContext()
    logout()
    void signOut().catch(() => undefined)
  }

  return (
    <div className="desktop-tech-mode flex h-screen overflow-hidden page-surface">
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed inset-y-0 left-0 z-30 flex w-[220px] flex-col bg-slate-950 text-white shadow-2xl shadow-slate-900/20 transition-transform duration-300 ease-in-out lg:static ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="app-sidebar-brand border-b border-cyan-300/15 bg-gradient-to-br from-cyan-400/15 via-slate-950 to-emerald-400/10 px-5 py-5">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 shadow-[0_0_24px_rgba(34,211,238,.18)]">
              <BarChart3 className="h-5 w-5 text-cyan-200" />
            </span>
            <span className="min-w-0 truncate text-base font-semibold tracking-wide text-cyan-50">{context.company.name}</span>
          </div>
          <p className="ml-11 mt-1 text-[10px] uppercase tracking-[0.22em] text-cyan-100/55">CanWin Team OS</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="4.0岗位导航">
          {navigationGroups.map((group, groupIndex) => (
            <div key={group.id}>
              {groupIndex > 0 && <div className="mx-3 my-2 border-t border-white/10" />}
              <p className="app-nav-group-label px-3 pb-1 pt-3 text-[10px] uppercase tracking-wider text-cyan-100/45">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => item.type === 'link' ? (
                  <SidebarLink
                    key={item.routeId}
                    item={item}
                    currentLocation={currentLocation}
                    onNavigate={() => setSidebarOpen(false)}
                  />
                ) : (
                  <SidebarCollection
                    key={item.label}
                    item={item}
                    currentLocation={currentLocation}
                    expanded={visibleExpandedCollection === item.label}
                    onToggle={() => setExpandedCollection(visibleExpandedCollection === item.label ? '' : item.label)}
                    onNavigate={() => setSidebarOpen(false)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="app-sidebar-footer flex items-center gap-2 border-t border-cyan-300/15 px-5 py-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,.7)]" />
          <span className="rounded-full bg-cyan-300/10 px-2 py-0.5 text-[10px] text-cyan-100/60">v4.0 岗位壳层</span>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-visible bg-transparent">
        <header className="app-topbar relative z-40 flex h-14 shrink-0 items-center justify-between overflow-visible border-b border-white/70 bg-white/80 px-4 shadow-sm backdrop-blur">
          <button type="button" onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 hover:bg-gray-100 lg:hidden">
            <Menu className="h-5 w-5 text-brand-400" />
          </button>

          <PersonalReminderTicker />

          <div className="ml-auto flex items-center gap-2 md:ml-0" ref={dropdownRef}>
            {messagesLink && !messagesLink.disabled && (
              <NavLink to={messagesLink.to} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label={messagesLink.label}>
                <Bell className="h-5 w-5" />
              </NavLink>
            )}
            <div className="relative">
              <button type="button" onClick={() => setUserDropdownOpen((open) => !open)} className="app-user-button flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors hover:bg-gray-100">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-sm font-bold text-white">
                  {context.user.name.charAt(0)}
                </div>
                <div className="hidden text-left sm:block">
                  <p className="text-sm font-medium text-brand-400">{context.user.name}</p>
                  <p className="text-xs text-brand-200">{roleLabel(context.currentWorkView)}</p>
                </div>
                <ChevronDown className="h-4 w-4 text-brand-200" />
              </button>

              {userDropdownOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-brand-100 bg-white py-1 shadow-lg">
                  <div className="px-3 py-3">
                    <p className="text-sm font-medium text-brand-400">{context.user.name}</p>
                    <p className="text-xs text-brand-200">主岗位：{roleLabel(context.primaryRole)}</p>
                  </div>
                  {context.availableWorkViews.length > 1 && (
                    <div className="border-t border-gray-100 px-2 py-2">
                      <p className="px-2 pb-1 text-[11px] font-medium text-slate-400">切换工作视图</p>
                      {context.availableWorkViews.map((view) => (
                        <button
                          key={view.id}
                          type="button"
                          onClick={() => void handleWorkViewSwitch(view.id)}
                          className={`block w-full rounded-lg px-2 py-2 text-left text-sm ${view.id === context.currentWorkView ? 'bg-cyan-50 font-medium text-cyan-800' : 'text-slate-700 hover:bg-slate-50'}`}
                        >
                          {view.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="border-t border-gray-100 pt-1">
                    <NavLink to="/profile" onClick={() => setUserDropdownOpen(false)} className="block px-3 py-2 text-sm text-brand-400 hover:bg-brand-50">
                      个人主页
                    </NavLink>
                    <button type="button" onClick={handleSignOut} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-expense hover:bg-red-50">
                      <LogOut className="h-4 w-4" />
                      退出登录
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="app-main flex-1 overflow-y-auto p-3 pb-24 sm:p-5 sm:pb-24 lg:pb-5">
          <Outlet />
        </main>

        <nav aria-label="移动端岗位导航" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-slate-200 bg-white/95 px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
          {mobileLinks.map((item) => {
            const active = navigationItemMatches(item, currentLocation)
            return (
              <NavLink key={item.routeId} to={item.to} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium ${active ? 'bg-cyan-50 text-cyan-700' : 'text-slate-500'}`}>
                <item.icon className="h-5 w-5" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
