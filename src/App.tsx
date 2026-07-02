import { Suspense, lazy, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import AuthGate from './components/AuthGate'
import { useUserStore } from './stores/useUserStore'
import { useTaskStore } from './stores/useTaskStore'
import { useFinanceStore } from './stores/useFinanceStore'
import { useInventoryStore } from './stores/useInventoryStore'
import { useVoteStore } from './stores/useVoteStore'
import { useGoalStore } from './stores/useGoalStore'
import { usePersonalGoalStore } from './stores/usePersonalGoalStore'
import { useCalendarStore } from './stores/useCalendarStore'
import { useTimelineStore } from './stores/useTimelineStore'
import { useAchievementStore } from './stores/useAchievementStore'
import { usePhotoStore } from './stores/usePhotoStore'
import { useAssetStore } from './stores/useAssetStore'
import { useToolboxStore } from './stores/useToolboxStore'
import { useWarRoomStore } from './stores/useWarRoomStore'
import { isCaptainRole, isFinanceRole, isWarehouseRole, loadTeamProfiles } from './services/profile'
import { loadTasks } from './services/tasks'
import { loadFinancePublicSummary, loadFinanceRecords } from './services/finance'
import { loadInventory, loadInventoryPublic } from './services/inventory'
import { loadVotes } from './services/votes'
import { loadGoals } from './services/goals'
import { loadPersonalGoals } from './services/personalGoals'
import { loadCalendarEvents } from './services/calendar'
import { loadTimelineEvents } from './services/timeline'
import { loadAchievements } from './services/achievements'
import { loadPhotos } from './services/photos'
import { loadAssets, loadPublicAssets } from './services/assets'
import { loadTools } from './services/toolbox'
import { loadWarRoomPolicies } from './services/warroom'

// 懒加载页面
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Tasks = lazy(() => import('./pages/Tasks'))
const Goals = lazy(() => import('./pages/Goals'))
const Votes = lazy(() => import('./pages/Votes'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Finance = lazy(() => import('./pages/Finance'))
const Timeline = lazy(() => import('./pages/Timeline'))
const Achievements = lazy(() => import('./pages/Achievements'))
const Photos = lazy(() => import('./pages/Photos'))
const Assets = lazy(() => import('./pages/Assets'))
const Profile = lazy(() => import('./pages/Profile'))
const Members = lazy(() => import('./pages/Members'))
const Calendar = lazy(() => import('./pages/Calendar'))
const Toolbox = lazy(() => import('./pages/Toolbox'))
const WarRoom = lazy(() => import('./pages/WarRoom'))
const Settings = lazy(() => import('./pages/Settings'))

function App() {
  const currentUser = useUserStore((s) => s.currentUser)
  const setUsers = useUserStore((s) => s.setUsers)
  const setTasks = useTaskStore((s) => s.setTasks)
  const setRecords = useFinanceStore((s) => s.setRecords)
  const setInventoryData = useInventoryStore((s) => s.setInventoryData)
  const setVotes = useVoteStore((s) => s.setVotes)
  const setGoals = useGoalStore((s) => s.setGoals)
  const setPersonalGoals = usePersonalGoalStore((s) => s.setPersonalGoals)
  const setEvents = useCalendarStore((s) => s.setEvents)
  const setTimelineEvents = useTimelineStore((s) => s.setEvents)
  const setAchievements = useAchievementStore((s) => s.setAchievements)
  const setPhotos = usePhotoStore((s) => s.setPhotos)
  const setAssets = useAssetStore((s) => s.setAssets)
  const setTools = useToolboxStore((s) => s.setTools)
  const setPolicies = useWarRoomStore((s) => s.setPolicies)

  useEffect(() => {
    if (!currentUser) return

    let cancelled = false

    async function loadCloudData() {
      const [
        profiles,
        tasks,
        records,
        inventory,
        votes,
        goals,
        personalGoals,
        events,
        timelineEvents,
        achievements,
        photos,
        assets,
        tools,
        policies,
      ] = await Promise.all([
        loadTeamProfiles(),
        loadTasks(),
        isFinanceRole(currentUser.role) ? loadFinanceRecords() : loadFinancePublicSummary(),
        isWarehouseRole(currentUser.role) ? loadInventory() : loadInventoryPublic(),
        loadVotes(),
        loadGoals(),
        loadPersonalGoals(),
        loadCalendarEvents(),
        loadTimelineEvents(),
        loadAchievements(),
        loadPhotos(),
        isCaptainRole(currentUser.role) || isFinanceRole(currentUser.role) || isWarehouseRole(currentUser.role)
          ? loadAssets()
          : loadPublicAssets(),
        loadTools(),
        loadWarRoomPolicies(),
      ])
      if (cancelled) return
      setUsers(profiles)
      setTasks(tasks)
      setRecords(records)
      setInventoryData(inventory)
      setVotes(votes)
      setGoals(goals)
      setPersonalGoals(personalGoals)
      setEvents(events)
      setTimelineEvents(timelineEvents)
      setAchievements(achievements)
      setPhotos(photos)
      setAssets(assets)
      setTools(tools)
      setPolicies(policies)
    }

    void loadCloudData()

    return () => {
      cancelled = true
    }
  }, [
    currentUser,
    setAchievements,
    setAssets,
    setEvents,
    setGoals,
    setPersonalGoals,
    setInventoryData,
    setPhotos,
    setRecords,
    setTasks,
    setTools,
    setTimelineEvents,
    setPolicies,
    setUsers,
    setVotes,
  ])

  if (!currentUser) {
    return <AuthGate />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Suspense fallback={null}><Dashboard /></Suspense>} />
        <Route path="/dashboard" element={<Suspense fallback={null}><Dashboard /></Suspense>} />
        <Route path="/tasks" element={<Suspense fallback={null}><Tasks /></Suspense>} />
        <Route path="/goals" element={<Suspense fallback={null}><Goals /></Suspense>} />
        <Route path="/votes" element={<Suspense fallback={null}><Votes /></Suspense>} />
        <Route path="/inventory" element={<Suspense fallback={null}><Inventory /></Suspense>} />
        <Route path="/finance" element={<Suspense fallback={null}><Finance /></Suspense>} />
        <Route path="/timeline" element={<Suspense fallback={null}><Timeline /></Suspense>} />
        <Route path="/achievements" element={<Suspense fallback={null}><Achievements /></Suspense>} />
        <Route path="/photos" element={<Suspense fallback={null}><Photos /></Suspense>} />
        <Route path="/assets" element={<Suspense fallback={null}><Assets /></Suspense>} />
        <Route path="/calendar" element={<Suspense fallback={null}><Calendar /></Suspense>} />
        <Route path="/toolbox" element={<Suspense fallback={null}><Toolbox /></Suspense>} />
        <Route path="/warroom" element={<Suspense fallback={null}><WarRoom /></Suspense>} />
        <Route path="/members" element={<Suspense fallback={null}><Members /></Suspense>} />
        <Route path="/profile" element={<Suspense fallback={null}><Profile /></Suspense>} />
        <Route path="/settings" element={<Suspense fallback={null}><Settings /></Suspense>} />
      </Route>
    </Routes>
  )
}

export default App
