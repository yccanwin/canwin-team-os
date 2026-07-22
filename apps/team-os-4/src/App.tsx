import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import {
  PRIMARY_ROLES,
  PRIMARY_ROLE_LABELS,
  type PrimaryRole,
} from '../../../packages/team-os-4-domain/src/index'
import { hasGreenfieldEnvironment } from './lib/supabase'
import { KPICard, ProgressBar, StatusBadge } from './ui'

const ROLE_FOCUS: Readonly<Record<PrimaryRole, string>> = {
  sales: '客户、商机、报价、订单与续费',
  implementation: '排期、安装、培训、验收与交接',
  operations: '售后、异常、续费协作与服务交付',
  finance: '收付款、冲销、利润与收益结算',
  admin: '人员权限、经营配置、审批与审计',
}

const workspaces = PRIMARY_ROLES.map((role) => ({
  id: role,
  label: PRIMARY_ROLE_LABELS[role],
  focus: ROLE_FOCUS[role],
}))

function Workspace({ role, label, focus }: { role: PrimaryRole; label: string; focus: string }) {
  return (
    <section className="workspace" data-testid={`workspace-${role}`} aria-labelledby="workspace-title">
      <p className="eyebrow">4.0 独立岗位工作台</p>
      <h1 id="workspace-title">{label}工作台</h1>
      <p className="lead">{focus}</p>
      <div className="metric-grid">
        <KPICard label="今日推进" value={0} note="等待新系统接入数据" tone="success" />
        <KPICard label="待我处理" value={0} note="统一工作项尚未接入" tone="info" />
        <KPICard label="异常提醒" value={0} note="迁移模式下外发关闭" tone="warning" />
      </div>
      <div className="foundation-progress"><ProgressBar label="P0 绿色基础层" value={25} /></div>
      <div className="notice">
        <strong>绿色地基状态</strong>
        <p>当前页面来自全新应用根，不读取3.0页面、路由、RPC或迁移链。</p>
      </div>
    </section>
  )
}

export function App() {
  const environmentReady = hasGreenfieldEnvironment()

  return (
    <div className="app-shell">
      <aside>
        <div className="brand"><span>CW</span><div><strong>CanWin</strong><small>Team OS 4.0</small></div></div>
        <nav aria-label="岗位工作台">
          {workspaces.map((workspace) => (
            <NavLink key={workspace.id} to={`/workspace/${workspace.id}`}>{workspace.label}</NavLink>
          ))}
        </nav>
        <div className={`environment ${environmentReady ? 'ready' : ''}`} data-testid="environment-status">
          <span aria-hidden="true" />
          {environmentReady ? '独立测试环境已配置' : '等待独立测试环境'}
        </div>
      </aside>
      <main>
        <header>
          <div><b>全新 4.0</b><StatusBadge tone="success">独立绿色根</StatusBadge><span>3.0 保持只读</span></div>
          <div className="capabilities"><span>仓库职能：按需授予</span><span>主管体系：默认关闭</span></div>
        </header>
        <Routes>
          <Route path="/" element={<Navigate to="/workspace/sales" replace />} />
          {workspaces.map((workspace) => (
            <Route key={workspace.id} path={`/workspace/${workspace.id}`} element={<Workspace role={workspace.id} label={workspace.label} focus={workspace.focus} />} />
          ))}
          <Route path="*" element={<Navigate to="/workspace/sales" replace />} />
        </Routes>
      </main>
    </div>
  )
}
