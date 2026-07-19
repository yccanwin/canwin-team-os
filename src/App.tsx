import { Suspense, lazy, useEffect } from 'react'
import { Link, Navigate, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import AuthGate from './components/AuthGate'
import { useUserStore } from './stores/useUserStore'
import { useTaskStore } from './stores/useTaskStore'
import { useFinanceStore } from './stores/useFinanceStore'
import { useInventoryStore } from './stores/useInventoryStore'
import { useGoalStore } from './stores/useGoalStore'
import { usePersonalGoalStore } from './stores/usePersonalGoalStore'
import { useCalendarStore } from './stores/useCalendarStore'
import { useAssetStore } from './stores/useAssetStore'
import { useSkillStore } from './stores/useSkillStore'
import { useSalesStore } from './stores/useSalesStore'
import { isCaptainRole, isFinanceRole, isWarehouseRole, loadTeamProfiles } from './services/profile'
import { loadTasks } from './services/tasks'
import { loadFinancePublicSummary, loadFinanceRecords } from './services/finance'
import { loadInventory, loadInventoryPublic } from './services/inventory'
import { loadGoals } from './services/goals'
import { loadPersonalGoals } from './services/personalGoals'
import { loadCalendarEvents } from './services/calendar'
import { loadAssets, loadPublicAssets } from './services/assets'
import { loadSkills, loadUserSkills } from './services/skills'
import { loadSalesAssessments, loadSalesProducts, loadSalesScoreRecords } from './services/sales'

// 懒加载页面
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Work = lazy(() => import('./pages/Work'))
const Finance = lazy(() => import('./pages/Finance'))
const Profile = lazy(() => import('./pages/Profile'))
const Calendar = lazy(() => import('./pages/Calendar'))
const AssetCenter = lazy(() => import('./pages/AssetCenter'))
const FeatureFlagGate = lazy(() => import('./features/v3'))
const SalesWorkbenchV3 = lazy(() => import('./features/sales-workbench/SalesWorkbenchRealRoute'))
const OperationsLeadIntake = lazy(() => import('./features/sales-workbench/OperationsLeadIntakeRoute'))
const OrderDeliveryWorkbenchV3 = lazy(() => import('./features/order-delivery/OrderDeliveryRealRoute'))
const QuoteOrderRealV3 = lazy(() => import('./features/quote-order/QuoteOrderRealRoute'))
const ManagementBoardRealV3 = lazy(() => import('./features/management-board/ManagementBoardRealRoute'))
const AccessAdminRealV3 = lazy(() => import('./features/access-admin/AccessAdminRealRoute'))
const SettingsHomeV3 = lazy(() => import('./features/system-settings/SettingsHome'))
const RegionAdminRealV3 = lazy(() => import('./features/system-settings/RegionAdminRealRoute'))
const CatalogAdminRealV3 = lazy(() => import('./features/system-settings/CatalogAdminRealRoute'))
const PackageAdminRealV3 = lazy(() => import('./features/system-settings/PackageAdminRealRoute'))
const CustomerImportRealV3 = lazy(() => import('./features/system-settings/CustomerImportRealRoute'))
const NotificationAdminRealV3 = lazy(() => import('./features/notification-admin/NotificationAdminRealRoute'))

function ClosedLegacyRoute() {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">这个3.0入口已暂停</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">原有数据和附件仍完整保留，没有删除。相关有效内容会从4.0的新入口继续使用。</p>
      <Link to="/dashboard" className="mt-5 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">返回我的工作台</Link>
    </div>
  )
}

function App() {
  const currentUser = useUserStore((s) => s.currentUser)
  const setUsers = useUserStore((s) => s.setUsers)
  const setTasks = useTaskStore((s) => s.setTasks)
  const setRecords = useFinanceStore((s) => s.setRecords)
  const setInventoryData = useInventoryStore((s) => s.setInventoryData)
  const setGoals = useGoalStore((s) => s.setGoals)
  const setPersonalGoals = usePersonalGoalStore((s) => s.setPersonalGoals)
  const setEvents = useCalendarStore((s) => s.setEvents)
  const setAssets = useAssetStore((s) => s.setAssets)
  const setSkillData = useSkillStore((s) => s.setSkillData)
  const setSalesData = useSalesStore((s) => s.setSalesData)

  useEffect(() => {
    if (!currentUser) return

    let cancelled = false

    async function loadCloudData() {
      async function loadModule<T>(name: string, loader: () => Promise<T>, apply: (data: T) => void) {
        try {
          const data = await loader()
          if (!cancelled) apply(data)
        } catch (error) {
          console.error(`[bootstrap] Failed to load ${name}.`, error)
        }
      }

      await Promise.all([
        loadModule('profiles', loadTeamProfiles, setUsers),
        loadModule('tasks', loadTasks, setTasks),
        loadModule(
          'finance',
          () => (isFinanceRole(currentUser.role) ? loadFinanceRecords() : loadFinancePublicSummary()),
          setRecords
        ),
        loadModule(
          'inventory',
          () => (isWarehouseRole(currentUser.role) ? loadInventory() : loadInventoryPublic()),
          setInventoryData
        ),
        loadModule('goals', loadGoals, setGoals),
        loadModule('personal goals', loadPersonalGoals, setPersonalGoals),
        loadModule('calendar events', loadCalendarEvents, setEvents),
        loadModule(
          'assets',
          () =>
            isCaptainRole(currentUser.role) || isFinanceRole(currentUser.role) || isWarehouseRole(currentUser.role)
              ? loadAssets()
              : loadPublicAssets(),
          setAssets
        ),
        loadModule(
          'skills',
          async () => {
            const [skills, userSkills] = await Promise.all([loadSkills(), loadUserSkills()])
            return { skills: skills ?? [], userSkills: userSkills ?? [] }
          },
          setSkillData
        ),
        loadModule(
          'sales data',
          async () => {
            const [products, records, assessments] = await Promise.all([
              loadSalesProducts(),
              loadSalesScoreRecords(),
              loadSalesAssessments(),
            ])
            return {
              products: products ?? [],
              records: records ?? [],
              assessments: assessments ?? [],
            }
          },
          setSalesData
        ),
      ])
    }

    void loadCloudData()

    return () => {
      cancelled = true
    }
  }, [
    currentUser,
    setAssets,
    setEvents,
    setGoals,
    setPersonalGoals,
    setInventoryData,
    setRecords,
    setTasks,
    setSkillData,
    setSalesData,
    setUsers,
  ])

  if (!currentUser) {
    return <AuthGate />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Suspense fallback={null}><Dashboard /></Suspense>} />
        <Route path="/work" element={<Suspense fallback={null}><Work /></Suspense>} />
        <Route path="/tasks" element={<Navigate to="/work" replace />} />
        <Route path="/goals" element={<Navigate to="/profile?view=goals" replace />} />
        <Route path="/votes" element={<ClosedLegacyRoute />} />
        <Route path="/votes/:voteId" element={<ClosedLegacyRoute />} />
        <Route path="/inventory" element={<Navigate to="/asset-center?view=inventory" replace />} />
        <Route path="/finance" element={<Suspense fallback={null}><Finance /></Suspense>} />
        <Route path="/sales" element={<Navigate to="/profile?view=earnings" replace />} />
        <Route path="/timeline" element={<ClosedLegacyRoute />} />
        <Route path="/achievements" element={<Navigate to="/management-v3?view=case-candidates" replace />} />
        <Route path="/photos" element={<ClosedLegacyRoute />} />
        <Route path="/assets" element={<Navigate to="/asset-center?view=assets" replace />} />
        <Route path="/calendar" element={<Suspense fallback={null}><Calendar /></Suspense>} />
        <Route path="/toolbox" element={<ClosedLegacyRoute />} />
        <Route path="/skills" element={<Navigate to="/settings-v3/access?view=skills" replace />} />
        <Route path="/warroom" element={<ClosedLegacyRoute />} />
        <Route path="/members" element={<Navigate to="/settings-v3/access?view=members" replace />} />
        <Route path="/profile" element={<Suspense fallback={null}><Profile /></Suspense>} />
        <Route path="/settings" element={<Navigate to="/settings-v3" replace />} />
        <Route path="/asset-center" element={<Suspense fallback={null}><AssetCenter /></Suspense>} />
        <Route path="/culture-center" element={<ClosedLegacyRoute />} />
        <Route path="/sales-v3" element={<Suspense fallback={null}><FeatureFlagGate flagKey="sales_os_v3"><SalesWorkbenchV3 /></FeatureFlagGate></Suspense>} />
        <Route path="/operations/lead-intake" element={<Suspense fallback={null}><FeatureFlagGate flagKey="sales_os_v3"><OperationsLeadIntake /></FeatureFlagGate></Suspense>} />
        <Route path="/orders-v3" element={<Suspense fallback={null}><FeatureFlagGate flagKey="sales_os_v3"><OrderDeliveryWorkbenchV3 /></FeatureFlagGate></Suspense>} />
        <Route path="/quotes-v3" element={<Suspense fallback={null}><FeatureFlagGate flagKey="sales_os_v3"><QuoteOrderRealV3 /></FeatureFlagGate></Suspense>} />
        <Route path="/management-v3" element={<Suspense fallback={null}><FeatureFlagGate flagKey="sales_os_v3"><ManagementBoardRealV3 /></FeatureFlagGate></Suspense>} />
        <Route path="/access-v3" element={<Navigate to="/settings-v3/access" replace />} />
        <Route path="/settings-v3" element={<Suspense fallback={null}><FeatureFlagGate flagKey="sales_os_v3"><SettingsHomeV3 /></FeatureFlagGate></Suspense>} />
        <Route path="/settings-v3/regions" element={<Suspense fallback={null}><FeatureFlagGate flagKey="sales_os_v3"><RegionAdminRealV3 /></FeatureFlagGate></Suspense>} />
        <Route path="/settings-v3/catalog" element={<Suspense fallback={null}><FeatureFlagGate flagKey="sales_os_v3"><CatalogAdminRealV3 /></FeatureFlagGate></Suspense>} />
        <Route path="/settings-v3/catalog/packages" element={<Suspense fallback={null}><FeatureFlagGate flagKey="sales_os_v3"><PackageAdminRealV3 /></FeatureFlagGate></Suspense>} />
        <Route path="/settings-v3/access" element={<Suspense fallback={null}><FeatureFlagGate flagKey="sales_os_v3"><AccessAdminRealV3 /></FeatureFlagGate></Suspense>} />
        <Route path="/settings-v3/customer-import" element={<Suspense fallback={null}><FeatureFlagGate flagKey="sales_os_v3"><CustomerImportRealV3 /></FeatureFlagGate></Suspense>} />
        <Route path="/notifications-v3" element={<Suspense fallback={null}><FeatureFlagGate flagKey="sales_os_v3"><NotificationAdminRealV3 /></FeatureFlagGate></Suspense>} />
      </Route>
    </Routes>
  )
}

export default App

