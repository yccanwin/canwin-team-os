import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  Eye,
  EyeOff,
  Globe2,
  LockKeyhole,
  LogIn,
  ServerCog,
  ShieldCheck,
  UserRound,
  Wifi,
} from 'lucide-react'
import MatrixRain from './MatrixRain'
import { loadCurrentProfile, signInWithPassword } from '@/services/profile'
import { useUserStore } from '@/stores/useUserStore'

const NETWORK_NODES = [
  [24, 31], [33, 22], [43, 30], [54, 19], [65, 28], [76, 39],
  [27, 52], [38, 44], [49, 55], [61, 46], [72, 59], [35, 68],
  [48, 76], [59, 67], [70, 74],
]

function DataGlobe() {
  return (
    <div className="data-globe" aria-hidden="true">
      <div className="globe-halo" />
      <div className="globe-orbit globe-orbit-a" />
      <div className="globe-orbit globe-orbit-b" />
      <div className="globe-sphere">
        <div className="globe-grid-lines" />
        <svg className="globe-network" viewBox="0 0 100 100" role="presentation">
          <path d="M24 31 L33 22 L43 30 L54 19 L65 28 L76 39 L72 59 L70 74 L59 67 L48 76 L35 68 L27 52 L24 31 M43 30 L38 44 L27 52 M38 44 L49 55 L35 68 M49 55 L61 46 L65 28 M61 46 L72 59 M49 55 L59 67" />
          <path className="globe-continent" d="M29 27l7-7 9 2 3 7-5 5-3 8-8-1-5-6zm25-4 9 1 8 8-1 7-9 2-6-5-6-4zm-9 27 10-5 11 5 4 10-7 13-8-3-3-10-8-3zm-20 7 8-6 6 6-2 12-8 3-5-8z" />
          {NETWORK_NODES.map(([cx, cy], index) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={index % 4 === 0 ? 1.35 : 0.8} />
          ))}
        </svg>
        <div className="globe-shine" />
      </div>
      <div className="globe-platform">
        <span />
        <span />
        <span />
      </div>
    </div>
  )
}

function HudPanel({ side }: { side: 'left' | 'right' }) {
  if (side === 'left') {
    return (
      <aside className="hud-stack hud-stack-left" aria-hidden="true">
        <div className="hud-card">
          <div className="hud-card-label"><ShieldCheck /> SYSTEM STATUS</div>
          <strong>SECURE</strong>
          <small>All systems operational</small>
        </div>
        <div className="hud-card">
          <div className="hud-card-label"><Wifi /> NETWORK NODES</div>
          <strong>42,986</strong>
          <small>Active connections</small>
        </div>
        <div className="hud-card hud-card-chart">
          <div className="hud-card-label"><Activity /> DATA STREAM</div>
          <div className="hud-bars">{Array.from({ length: 16 }, (_, i) => <i key={i} />)}</div>
          <small>1.32 PB/s throughput</small>
        </div>
      </aside>
    )
  }

  return (
    <aside className="hud-stack hud-stack-right" aria-hidden="true">
      <div className="hud-card">
        <div className="hud-card-label"><Globe2 /> GLOBAL COVERAGE</div>
        <strong>100+</strong>
        <small>Countries connected</small>
      </div>
      <div className="hud-card hud-card-uptime">
        <div className="hud-card-label"><ServerCog /> UPTIME</div>
        <div className="uptime-ring">99.99<sup>%</sup></div>
        <small>System uptime</small>
      </div>
      <div className="hud-card">
        <div className="hud-card-label"><Activity /> THREAT MONITOR</div>
        <strong>LOW RISK</strong>
        <small>All systems secure</small>
      </div>
    </aside>
  )
}

export default function AuthGate() {
  const setCurrentUser = useUserStore((state) => state.setCurrentUser)
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function restoreSession() {
      setLoading(true)
      try {
        const user = await loadCurrentProfile()
        if (!cancelled && user) setCurrentUser(user)
      } catch {
        if (!cancelled) setCurrentUser(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void restoreSession()
    return () => { cancelled = true }
  }, [setCurrentUser])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!login.trim() || !password) {
      setError('Account and password are required')
      return
    }

    setLoading(true)
    setError('')
    try {
      const user = await signInWithPassword(login, password)
      setCurrentUser(user)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="fanshon-login-shell">
      <MatrixRain />
      <div className="fanshon-vignette" aria-hidden="true" />
      <div className="fanshon-scanline" aria-hidden="true" />

      <header className="fanshon-brand">
        <div className="fanshon-brand-rule"><span /> <i /> <span /></div>
        <h1>FANSHON TEAM</h1>
        <p>CONNECTING DATA · EMPOWERING FUTURES</p>
      </header>

      <HudPanel side="left" />
      <HudPanel side="right" />

      <section className="fanshon-login-stage">
        <DataGlobe />

        <form className="fanshon-login-card" onSubmit={handleSubmit}>
          <div className="login-card-corners" aria-hidden="true" />
          <div className="login-card-heading">
            <span className="login-card-icon"><LockKeyhole /></span>
            <div>
              <h2>WELCOME BACK</h2>
              <p>Secure access to your command center</p>
            </div>
          </div>

          <label className="fanshon-field">
            <UserRound aria-hidden="true" />
            <span className="sr-only">Account</span>
            <input
              type="text"
              autoComplete="username"
              value={login}
              onChange={(event) => {
                setLogin(event.target.value)
                setError('')
              }}
              placeholder="Account ID or email"
              aria-label="Account"
            />
          </label>

          <label className="fanshon-field">
            <LockKeyhole aria-hidden="true" />
            <span className="sr-only">Password</span>
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setError('')
              }}
              placeholder="Password"
              aria-label="Password"
            />
            <button
              className="password-toggle"
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </button>
          </label>

          {error && <p className="fanshon-login-error" role="alert">{error}</p>}

          <button className="fanshon-submit" type="submit" disabled={loading}>
            <span>{loading ? 'ACCESSING CORE' : 'ENTER SYSTEM'}</span>
            <LogIn aria-hidden="true" />
          </button>

          <div className="login-security-note">
            <ShieldCheck aria-hidden="true" />
            <span>ENCRYPTED CONNECTION · AUTHORIZED ACCESS ONLY</span>
          </div>
        </form>
      </section>

      <footer className="fanshon-login-footer" aria-hidden="true">
        <span>SYS.01</span><i /><span>SECURE GATEWAY ONLINE</span><i /><span>FANSHON NETWORK</span>
      </footer>
    </main>
  )
}
