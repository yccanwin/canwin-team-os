import { supabase } from '@/lib/supabase'
import type {
  AdditionalFunctionId,
  AppContext,
  NavigationManifestItem,
  PrimaryRoleId,
  SupervisorScope,
  WorkView,
} from './types'

const APP_CONTEXT_KEYS = [
  'additionalFunctions',
  'availableWorkViews',
  'company',
  'currentWorkView',
  'navigationRevision',
  'permissions',
  'primaryRole',
  'regionScopeIds',
  'skills',
  'supervisorEnabled',
  'supervisorScope',
  'user',
  'warehouseScopeIds',
] as const

const NAVIGATION_KEYS = [
  'canonicalPath',
  'enabled',
  'group',
  'label',
  'order',
  'readOnly',
  'routeId',
  'visible',
] as const

const PRIMARY_ROLES = new Set<PrimaryRoleId>(['sales', 'implementation', 'operations', 'finance', 'admin'])
const ADDITIONAL_FUNCTIONS = new Set<AdditionalFunctionId>(['warehouse', 'supervisor'])
const NAVIGATION_GROUPS = new Set<NavigationManifestItem['group']>([
  'common', 'current_role', 'role_business', 'warehouse', 'supervisor', 'topbar', 'mobile_only',
])

const WORK_VIEW_PATHS: Record<PrimaryRoleId, string> = {
  sales: '/sales-v3?tab=leads',
  implementation: '/orders-v3?view=implementation',
  operations: '/orders-v3?view=operations',
  finance: '/finance?view=receipts',
  admin: '/management-v3?view=approvals',
}

type RequiredNavigationItem = Pick<NavigationManifestItem, 'routeId' | 'order' | 'group' | 'canonicalPath'>

const REQUIRED_NAVIGATION_ITEMS: RequiredNavigationItem[] = [
  { routeId: 'messages', order: 5, group: 'topbar', canonicalPath: '/notifications-v3' },
  { routeId: 'my-workbench', order: 10, group: 'common', canonicalPath: '/dashboard' },
  { routeId: 'progress', order: 20, group: 'common', canonicalPath: '/work' },
  { routeId: 'calendar', order: 30, group: 'common', canonicalPath: '/calendar' },
  { routeId: 'mobile-profile', order: 50, group: 'mobile_only', canonicalPath: '/profile' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isWorkView(value: unknown): value is WorkView {
  return isRecord(value)
    && hasExactKeys(value, ['id', 'label'])
    && typeof value.id === 'string'
    && PRIMARY_ROLES.has(value.id as PrimaryRoleId)
    && typeof value.label === 'string'
}

function isSupervisorScope(value: unknown): value is SupervisorScope {
  return isRecord(value)
    && hasExactKeys(value, ['businessScopes', 'regionIds', 'userIds'])
    && isStringArray(value.regionIds)
    && isStringArray(value.userIds)
    && isStringArray(value.businessScopes)
}

function parseAppContext(value: unknown): AppContext {
  if (!isRecord(value) || !hasExactKeys(value, APP_CONTEXT_KEYS)) {
    throw new Error('4.0 会话上下文字段不完整，系统已停止进入工作台。')
  }
  if (!isRecord(value.company)
    || !hasExactKeys(value.company, ['id', 'logoAssetRef', 'name'])
    || typeof value.company.id !== 'string'
    || typeof value.company.name !== 'string'
    || (value.company.logoAssetRef !== null && typeof value.company.logoAssetRef !== 'string')) {
    throw new Error('4.0 公司身份无效，系统已停止进入工作台。')
  }
  if (!isRecord(value.user)
    || !hasExactKeys(value.user, ['id', 'name', 'status'])
    || typeof value.user.id !== 'string'
    || typeof value.user.name !== 'string'
    || !['active', 'disabled'].includes(String(value.user.status))) {
    throw new Error('4.0 成员身份无效，系统已停止进入工作台。')
  }
  if (typeof value.primaryRole !== 'string' || !PRIMARY_ROLES.has(value.primaryRole as PrimaryRoleId)
    || typeof value.currentWorkView !== 'string' || !PRIMARY_ROLES.has(value.currentWorkView as PrimaryRoleId)
    || !Array.isArray(value.additionalFunctions)
    || !value.additionalFunctions.every((item) => typeof item === 'string' && ADDITIONAL_FUNCTIONS.has(item as AdditionalFunctionId))
    || !isStringArray(value.skills)
    || !isStringArray(value.regionScopeIds)
    || !isStringArray(value.warehouseScopeIds)
    || !isStringArray(value.permissions)
    || !Array.isArray(value.availableWorkViews)
    || !value.availableWorkViews.every(isWorkView)
    || typeof value.supervisorEnabled !== 'boolean'
    || (value.supervisorScope !== null && !isSupervisorScope(value.supervisorScope))
    || typeof value.navigationRevision !== 'string') {
    throw new Error('4.0 岗位权限上下文无效，系统已停止进入工作台。')
  }
  const workViewIds = value.availableWorkViews.map((view) => view.id)
  if (value.user.status !== 'active'
    || value.company.id.length === 0
    || value.user.id.length === 0
    || value.navigationRevision !== `p1-nav-1:${value.company.id}`
    || new Set(workViewIds).size !== workViewIds.length
    || !workViewIds.includes(value.primaryRole as PrimaryRoleId)
    || !workViewIds.includes(value.currentWorkView as PrimaryRoleId)
    || (value.additionalFunctions.includes('warehouse') && !['admin', 'implementation'].includes(String(value.primaryRole)))
    || (!value.additionalFunctions.includes('supervisor') && value.supervisorScope !== null)) {
    throw new Error('当前账号已停用或工作视图未获授权。')
  }
  return value as AppContext
}

function parseNavigationItem(value: unknown): NavigationManifestItem {
  if (!isRecord(value)
    || !hasExactKeys(value, NAVIGATION_KEYS)
    || typeof value.routeId !== 'string'
    || typeof value.label !== 'string'
    || typeof value.order !== 'number'
    || typeof value.group !== 'string'
    || !NAVIGATION_GROUPS.has(value.group as NavigationManifestItem['group'])
    || typeof value.canonicalPath !== 'string'
    || !value.canonicalPath.startsWith('/')
    || typeof value.visible !== 'boolean'
    || typeof value.enabled !== 'boolean'
    || typeof value.readOnly !== 'boolean') {
    throw new Error('4.0 导航清单无效，系统已停止显示入口。')
  }
  return value as NavigationManifestItem
}

export async function loadAppContext(): Promise<AppContext> {
  const { data, error } = await supabase.rpc('get_app_context_v1')
  if (error) throw new Error(error.message)
  return parseAppContext(data)
}

function validateNavigationManifest(
  items: NavigationManifestItem[],
  workView: PrimaryRoleId,
  context: AppContext,
): void {
  const byId = new Map(items.map((item) => [item.routeId, item]))
  const requiredItems = [
    ...REQUIRED_NAVIGATION_ITEMS,
    { routeId: 'role-business', order: 40, group: 'current_role' as const, canonicalPath: WORK_VIEW_PATHS[workView] },
  ]
  for (const expected of requiredItems) {
    const item = byId.get(expected.routeId)
    if (!item
      || item.order !== expected.order
      || item.group !== expected.group
      || item.canonicalPath !== expected.canonicalPath
      || !item.visible
      || !item.enabled
      || item.readOnly) {
      throw new Error(`4.0 必要导航入口与冻结合同不一致：${expected.routeId}`)
    }
  }

  const conditionalItems: Array<{
    routeId: string
    expected: boolean
    order: number
    group: NavigationManifestItem['group']
    canonicalPath: string
  }> = [
    {
      routeId: 'warehouse-processing',
      expected: context.additionalFunctions.includes('warehouse'),
      order: 200,
      group: 'warehouse',
      canonicalPath: '/asset-center?view=inventory',
    },
    {
      routeId: 'team-approval',
      expected: context.additionalFunctions.includes('supervisor') && context.supervisorEnabled,
      order: 210,
      group: 'supervisor',
      canonicalPath: '/management-v3?view=approvals',
    },
  ]
  for (const expected of conditionalItems) {
    const item = byId.get(expected.routeId)
    if (Boolean(item) !== expected.expected) {
      throw new Error(`4.0 附加职能导航与服务器授权不一致：${expected.routeId}`)
    }
    if (item && (item.order !== expected.order
      || item.group !== expected.group
      || item.canonicalPath !== expected.canonicalPath
      || !item.visible
      || !item.enabled
      || item.readOnly)) {
      throw new Error(`4.0 附加职能导航与冻结合同不一致：${expected.routeId}`)
    }
  }
}

export async function loadNavigationManifest(workView: PrimaryRoleId, context: AppContext): Promise<NavigationManifestItem[]> {
  const { data, error } = await supabase.rpc('get_navigation_manifest_v1', { p_work_view: workView })
  if (error) throw new Error(error.message)
  if (!Array.isArray(data)) throw new Error('4.0 导航清单不是数组，系统已停止显示入口。')

  const items = data.map(parseNavigationItem)
  const routeIds = new Set<string>()
  for (const item of items) {
    if (routeIds.has(item.routeId)) throw new Error(`4.0 导航入口重复：${item.routeId}`)
    routeIds.add(item.routeId)
  }
  validateNavigationManifest(items, workView, context)
  return items.sort((left, right) => left.order - right.order)
}
