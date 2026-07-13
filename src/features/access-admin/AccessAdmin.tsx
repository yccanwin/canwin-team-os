import { useEffect, useState } from 'react'
import { Flag, MapPinned, ShieldCheck, UsersRound } from 'lucide-react'
import type { AccessAdminDataSource } from './dataSource'
import type { AccessAdminSnapshot } from './types'
import './access-admin.css'

export function AccessAdmin({ dataSource }: { dataSource: AccessAdminDataSource }) {
  const [snapshot, setSnapshot] = useState<AccessAdminSnapshot | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; dataSource.loadSnapshot().then((data) => { if (active) setSnapshot(data) }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '读取权限总览失败') }); return () => { active = false } }, [dataSource])
  if (error) return <main className="aa-shell"><div className="aa-error" role="alert">{error}</div></main>
  if (!snapshot) return <main className="aa-shell"><p className="aa-loading">正在读取权限总览…</p></main>
  return <main className="aa-shell"><header className="aa-header"><div><span>CANWIN TEAM OS 3.0</span><h1>人员权限与区域</h1><p>数据库权限只读总览，界面不直接修改任何授权记录。</p></div><ShieldCheck size={36} /></header>
    <section className="aa-summary"><div><UsersRound /><strong>{snapshot.members.length}</strong><span>成员</span></div><div><MapPinned /><strong>{snapshot.members.reduce((sum, member) => sum + member.regions.length, 0)}</strong><span>区域分配</span></div><div><Flag /><strong>{snapshot.featureFlags.filter((flag) => flag.enabled).length}</strong><span>已启用开关</span></div></section>
    <section className="aa-panel"><div className="aa-panel-title"><h2>人员授权</h2>{snapshot.currentUserIsAdmin && <button disabled>调整权限 · 等待服务端授权 RPC</button>}</div><div className="aa-member-list">{snapshot.members.map((member) => <article key={member.id}><div className="aa-member-name"><strong>{member.name}</strong><span className={member.status === 'active' ? 'is-active' : ''}>{member.status}</span></div><div><small>多角色</small><p>{member.roles.length ? member.roles.map((role) => <em key={role.id}>{role.name}</em>) : <span>未分配3.0角色</span>}</p></div><div><small>销售区域</small><p>{member.regions.length ? member.regions.map((region) => <em key={region.id}>{region.name}{region.primary ? ' · 主区域' : ''}</em>) : <span>未分配区域</span>}</p></div></article>)}</div></section>
    <section className="aa-panel"><div className="aa-panel-title"><h2>功能开关</h2>{snapshot.currentUserIsAdmin && <button disabled>调整开关 · 等待服务端授权 RPC</button>}</div><div className="aa-flags">{snapshot.featureFlags.map((flag) => <article key={flag.id}><div><strong>{flag.key}</strong><p>{flag.description || '暂无说明'}</p></div><span className={flag.enabled ? 'is-on' : ''}>{flag.enabled ? '已启用' : '未启用'}</span></article>)}</div></section>
  </main>
}
