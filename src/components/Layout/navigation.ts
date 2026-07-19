import type { LucideIcon } from 'lucide-react'
import {
  BadgeCheck,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  CheckSquare,
  CircleUserRound,
  ContactRound,
  FileText,
  LayoutDashboard,
  PackageCheck,
  Settings,
  ShieldCheck,
  Store,
  Warehouse,
  Wrench,
} from 'lucide-react'
import type { NavigationManifestItem } from '@/features/app-shell/types'

export type NavigationLink = {
  type: 'link'
  routeId: string
  label: string
  to: string
  icon: LucideIcon
  exact?: boolean
  priority?: 'high' | 'normal'
  disabled?: boolean
  readOnly?: boolean
}

export type NavigationCollection = {
  type: 'collection'
  label: string
  icon: LucideIcon
  description: string
  children: NavigationLink[]
}

export type NavigationItem = NavigationLink | NavigationCollection

export type NavigationGroup = {
  id: string
  label: string
  items: NavigationItem[]
}

const exactRouteIds = new Set(['my-workbench', 'progress', 'calendar', 'mobile-profile'])

function iconFor(item: NavigationManifestItem): LucideIcon {
  if (item.routeId === 'my-workbench') return LayoutDashboard
  if (item.routeId === 'progress') return CheckSquare
  if (item.routeId === 'calendar') return CalendarDays
  if (item.routeId === 'mobile-profile') return CircleUserRound
  if (item.routeId === 'warehouse-processing') return Warehouse
  if (item.routeId === 'team-approval') return ShieldCheck
  if (item.routeId.includes('customer') || item.routeId.includes('lead')) return ContactRound
  if (item.routeId.includes('finance') || item.routeId.includes('payment') || item.routeId.includes('profit')) return Banknote
  if (item.routeId.includes('order') || item.routeId.includes('quote')) return FileText
  if (item.routeId.includes('implementation') || item.routeId.includes('operations')) return Wrench
  if (item.routeId.includes('goods')) return PackageCheck
  if (item.routeId.includes('settings') || item.routeId.includes('people')) return Settings
  if (item.routeId.includes('case')) return BadgeCheck
  if (item.routeId === 'role-business') return BriefcaseBusiness
  return Store
}

function toLink(item: NavigationManifestItem): NavigationLink {
  return {
    type: 'link',
    routeId: item.routeId,
    label: item.label,
    to: item.canonicalPath,
    icon: iconFor(item),
    exact: exactRouteIds.has(item.routeId),
    priority: item.group === 'common' || item.group === 'current_role' ? 'high' : 'normal',
    disabled: !item.enabled,
    readOnly: item.readOnly,
  }
}

export function buildNavigationGroups(manifest: NavigationManifestItem[]): NavigationGroup[] {
  const visible = manifest.filter((item) => item.visible)
  const base = visible
    .filter((item) => item.group === 'common' || item.group === 'current_role')
    .map(toLink)
  const roleBusiness = visible.filter((item) => item.group === 'role_business').map(toLink)
  const warehouse = visible.filter((item) => item.group === 'warehouse').map(toLink)
  const supervisor = visible.filter((item) => item.group === 'supervisor').map(toLink)

  const groups: NavigationGroup[] = []
  if (base.length > 0) groups.push({ id: 'daily', label: '我的工作', items: base })
  if (roleBusiness.length > 0) {
    groups.push({
      id: 'role-business',
      label: '岗位业务',
      items: [{
        type: 'collection',
        label: '业务入口',
        icon: BriefcaseBusiness,
        description: '只显示当前工作视图获准处理的业务',
        children: roleBusiness,
      }],
    })
  }
  if (warehouse.length > 0) groups.push({ id: 'warehouse', label: '仓库职能', items: warehouse })
  if (supervisor.length > 0) groups.push({ id: 'supervisor', label: '主管职能', items: supervisor })
  return groups
}

export function buildMobileLinks(manifest: NavigationManifestItem[]): NavigationLink[] {
  const order = ['my-workbench', 'progress', 'calendar', 'role-business', 'mobile-profile']
  const byId = new Map(
    manifest
      .filter((item) => item.visible && item.enabled)
      .map((item) => [item.routeId, item]),
  )
  return order.flatMap((routeId) => {
    const item = byId.get(routeId)
    return item ? [toLink(item)] : []
  })
}

export function findTopbarLink(manifest: NavigationManifestItem[], routeId: string): NavigationLink | null {
  const item = manifest.find((candidate) => candidate.routeId === routeId && candidate.visible)
  return item ? toLink(item) : null
}

function linkMatches(item: NavigationLink, currentLocation: string): boolean {
  const currentUrl = new URL(currentLocation, 'https://navigation.local')
  const targetUrl = new URL(item.to, 'https://navigation.local')
  const pathMatches = item.exact
    ? currentUrl.pathname === targetUrl.pathname || (targetUrl.pathname === '/dashboard' && currentUrl.pathname === '/')
    : currentUrl.pathname === targetUrl.pathname || currentUrl.pathname.startsWith(`${targetUrl.pathname}/`)

  if (!pathMatches) return false
  if (item.exact && currentUrl.searchParams.size !== targetUrl.searchParams.size) return false
  for (const [key, value] of targetUrl.searchParams) {
    if (currentUrl.searchParams.get(key) !== value) return false
  }
  return true
}

export function navigationItemMatches(item: NavigationItem, currentLocation: string): boolean {
  return item.type === 'link'
    ? linkMatches(item, currentLocation)
    : item.children.some((child) => linkMatches(child, currentLocation))
}
