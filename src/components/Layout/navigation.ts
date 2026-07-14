import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Camera,
  CheckSquare,
  CircleUserRound,
  Clock,
  Compass,
  ContactRound,
  FolderCog,
  History,
  LayoutDashboard,
  LibraryBig,
  LineChart,
  Network,
  Package,
  Settings,
  Shield,
  ShoppingBasket,
  Sparkles,
  Trophy,
  UserCog,
  Users,
  Vote,
  Warehouse,
  Wrench,
} from 'lucide-react'

export type NavigationLink = {
  type: 'link'
  label: string
  to: string
  icon: LucideIcon
  exact?: boolean
  priority?: 'high' | 'normal'
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
  label: '日常工作' | '经营管理' | '团队沉淀' | '组织治理'
  items: NavigationItem[]
}

const link = (
  label: string,
  to: string,
  icon: LucideIcon,
  options: Pick<NavigationLink, 'exact' | 'priority'> = {},
): NavigationLink => ({ type: 'link', label, to, icon, ...options })

export const NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    label: '日常工作',
    items: [
      link('工作台', '/dashboard', LayoutDashboard, { exact: true, priority: 'high' }),
      link('推进中心', '/work', CheckSquare, { priority: 'high' }),
      link('日历', '/calendar', CalendarDays, { priority: 'high' }),
      {
        type: 'collection',
        label: '客如云中心',
        icon: LineChart,
        description: '销售、客户、订单与交付',
        children: [
          link('今日工作台', '/sales-v3', Compass, { priority: 'high' }),
          link('客户与线索', '/sales', ContactRound, { priority: 'high' }),
          link('报价与订单', '/quotes-v3', ShoppingBasket),
          link('交付与售后', '/orders-v3', BriefcaseBusiness),
          link('管理看板', '/management-v3', BarChart3),
        ],
      },
    ],
  },
  {
    label: '经营管理',
    items: [
      link('财务中心', '/finance', BarChart3, { priority: 'high' }),
      {
        type: 'collection',
        label: '资产中心',
        icon: Building2,
        description: '库存、资产与流转记录',
        children: [
          link('库存物品', '/asset-center?view=inventory', Warehouse, { priority: 'high' }),
          link('固定资产', '/asset-center?view=assets', Package),
          link('出入库记录', '/asset-center?view=logs', History),
        ],
      },
    ],
  },
  {
    label: '团队沉淀',
    items: [
      {
        type: 'collection',
        label: '团队文化',
        icon: Sparkles,
        description: '历史、案例与团队影像',
        children: [
          link('文化首页', '/culture-center?view=overview', Sparkles, { priority: 'high' }),
          link('编年史', '/culture-center?view=timeline', Clock),
          link('案例馆', '/culture-center?view=achievements', Trophy),
          link('团队相册', '/culture-center?view=photos', Camera),
        ],
      },
      {
        type: 'collection',
        label: '职能中心',
        icon: Users,
        description: '成员、岗位与专业能力',
        children: [
          link('成员总览', '/members', CircleUserRound, { priority: 'high' }),
          link('岗位职责', '/members', UserCog),
          link('技能与专长', '/skills', Network),
        ],
      },
      {
        type: 'collection',
        label: '知识工具',
        icon: LibraryBig,
        description: '团队工具与能力资产',
        children: [
          link('工具箱', '/toolbox', Wrench),
          link('技能树', '/skills', Network),
        ],
      },
    ],
  },
  {
    label: '组织治理',
    items: [
      {
        type: 'collection',
        label: '共同决策',
        icon: Vote,
        description: '团队提案与重要议事',
        children: [
          link('一起决定', '/votes', Vote),
          link('军机处', '/warroom', Shield),
        ],
      },
      {
        type: 'collection',
        label: '设置中心',
        icon: Settings,
        description: '人员权限、区域与商品配置',
        children: [
          link('人员与权限', '/settings-v3/access', UserCog),
          link('区域配置', '/settings-v3/regions', FolderCog),
          link('商品与套餐', '/settings-v3/catalog', ShoppingBasket),
          link('旧版设置', '/settings', Settings),
        ],
      },
    ],
  },
]

function linkMatches(item: NavigationLink, currentLocation: string): boolean {
  const currentUrl = new URL(currentLocation, 'https://navigation.local')
  const targetUrl = new URL(item.to, 'https://navigation.local')
  const pathMatches = item.exact
    ? currentUrl.pathname === targetUrl.pathname || (targetUrl.pathname === '/dashboard' && currentUrl.pathname === '/')
    : currentUrl.pathname === targetUrl.pathname || currentUrl.pathname.startsWith(`${targetUrl.pathname}/`)

  if (!pathMatches) return false

  for (const [key, value] of targetUrl.searchParams) {
    if (currentUrl.searchParams.get(key) !== value) return false
  }

  return true
}

export function navigationItemMatches(item: NavigationItem, currentLocation: string): boolean {
  if (item.type === 'link') {
    return linkMatches(item, currentLocation)
  }

  return item.children.some((child): boolean => navigationItemMatches(child, currentLocation))
}

