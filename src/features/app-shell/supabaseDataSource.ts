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
  if (value.user.status !== 'active'
    || !value.availableWorkViews.some((view) => view.id === value.currentWorkView)) {
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

export async function loadNavigationManifest(workView: PrimaryRoleId): Promise<NavigationManifestItem[]> {
  const { data, error } = await supabase.rpc('get_navigation_manifest_v1', { p_work_view: workView })
  if (error) throw new Error(error.message)
  if (!Array.isArray(data)) throw new Error('4.0 导航清单不是数组，系统已停止显示入口。')

  const items = data.map(parseNavigationItem)
  const routeIds = new Set<string>()
  for (const item of items) {
    if (routeIds.has(item.routeId)) throw new Error(`4.0 导航入口重复：${item.routeId}`)
    routeIds.add(item.routeId)
  }
  for (const requiredRouteId of ['my-workbench', 'progress', 'calendar', 'role-business', 'messages', 'mobile-profile']) {
    if (!routeIds.has(requiredRouteId)) throw new Error(`4.0 必要导航入口缺失：${requiredRouteId}`)
  }
  return items.sort((left, right) => left.order - right.order)
}
