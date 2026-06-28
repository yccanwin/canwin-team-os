import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import AuthGate from './components/AuthGate'
import SupabaseSyncProvider from './components/SupabaseSyncProvider'
import { useUserStore } from './stores/useUserStore'

// 懒加载页面
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Tasks = lazy(() => import('./pages/Tasks'))
const Goals = lazy(() => import('./pages/Goals'))
const Votes = lazy(() => import('./pages/Votes'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Timeline = lazy(() => import('./pages/Timeline'))
const Achievements = lazy(() => import('./pages/Achievements'))
const Photos = lazy(() => import('./pages/Photos'))
const Assets = lazy(() => import('./pages/Assets'))
const Profile = lazy(() => import('./pages/Profile'))
const Calendar = lazy(() => import('./pages/Calendar'))
const Toolbox = lazy(() => import('./pages/Toolbox'))
const WarRoom = lazy(() => import('./pages/WarRoom'))
const Settings = lazy(() => import('./pages/Settings'))

function App() {
  const currentUser = useUserStore((s) => s.currentUser)

  if (!currentUser) {
    return <AuthGate />
  }

  return (
    <>
      <SupabaseSyncProvider />
      <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Suspense fallback={null}><Dashboard /></Suspense>} />
        <Route path="/dashboard" element={<Suspense fallback={null}><Dashboard /></Suspense>} />
        <Route path="/tasks" element={<Suspense fallback={null}><Tasks /></Suspense>} />
        <Route path="/goals" element={<Suspense fallback={null}><Goals /></Suspense>} />
        <Route path="/votes" element={<Suspense fallback={null}><Votes /></Suspense>} />
        <Route path="/inventory" element={<Suspense fallback={null}><Inventory /></Suspense>} />
        <Route path="/timeline" element={<Suspense fallback={null}><Timeline /></Suspense>} />
        <Route path="/achievements" element={<Suspense fallback={null}><Achievements /></Suspense>} />
        <Route path="/photos" element={<Suspense fallback={null}><Photos /></Suspense>} />
        <Route path="/assets" element={<Suspense fallback={null}><Assets /></Suspense>} />
        <Route path="/calendar" element={<Suspense fallback={null}><Calendar /></Suspense>} />
        <Route path="/toolbox" element={<Suspense fallback={null}><Toolbox /></Suspense>} />
        <Route path="/warroom" element={<Suspense fallback={null}><WarRoom /></Suspense>} />
        <Route path="/profile" element={<Suspense fallback={null}><Profile /></Suspense>} />
        <Route path="/settings" element={<Suspense fallback={null}><Settings /></Suspense>} />
      </Route>
    </Routes>
    </>
  )
}

export default App
