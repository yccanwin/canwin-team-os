import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AccessAdminDataSource } from './dataSource'
import type { AccessAdminSnapshot } from './types'
import './access-admin-editor.css'

type Tab = 'members' | 'invite' | 'delegation' | 'handover'

export function AccessAdminEditor({ dataSource }: { dataSource: AccessAdminDataSource }) {
  const [snapshot, setSnapshot] = useState<AccessAdminSnapshot | null>(null)
  const [tab, setTab] = useState<Tab>('members')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [roleCodes, setRoleCodes] = useState<string[]>([])
  const [invite, setInvite] = useState({ email: '', displayName: '', roleCodes: ['sales'] })
  const [delegation, setDelegation] = useState({ delegatorId: '', delegateId: '', startsAt: '', endsAt: '', reason: '' })
  const [supervisorId, setSupervisorId] = useState('')
  const [subordinateIds, setSubordinateIds] = useState<string[]>([])
  const [handover, setHandover] = useState({ fromId: '', toId: '', reason: '离职客户交接' })

  const load = useCallback(async () => setSnapshot(await dataSource.loadSnapshot()), [dataSource])
  useEffect(() => {
    queueMicrotask(() => { void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '读取权限配置失败')) })
  }, [load])
  const activeMembers = useMemo(() => snapshot?.members.filter((member) => member.status === 'active') ?? [], [snapshot])
  const nameOf = (id: string) => snapshot?.members.find((member) => member.id === id)?.name ?? '未知成员'
  const toggle = (value: string, values: string[], setter: (next: string[]) => void) => setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  const run = async (action: () => Promise<void>, message: string) => {
    setBusy(true); setError(''); setNotice('')
    try { await action(); await load(); setNotice(message) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败') }
    finally { setBusy(false) }
  }
  const startRoleEdit = (id: string) => {
    const member = snapshot?.members.find((item) => item.id === id)
    setEditingId(id); setRoleCodes(member?.roles.map((role) => role.code) ?? [])
  }
  const startSupervisorEdit = (id: string) => {
    setSupervisorId(id)
    setSubordinateIds(snapshot?.supervisorAssignments.filter((item) => item.supervisorId === id).map((item) => item.subordinateId) ?? [])
  }

  if (!snapshot && error) return <div className="aae-error" role="alert">{error}</div>
  if (!snapshot) return <p className="aae-loading">正在读取权限配置…</p>
  return <section className="aae-shell">
    <header className="aae-header"><div><span className="aae-kicker">系统设置</span><h2>成员与权限</h2><p>角色可叠加；敏感数据由数据库校验，页面隐藏不是权限边界。</p></div><span className="aae-security">数据库强制隔离</span></header>
    <div className="aae-rules">{snapshot.sensitiveRules.map((rule) => <article key={rule.key}><strong>{rule.label}</strong><span>{rule.rule}</span></article>)}</div>
    <nav className="aae-tabs" aria-label="权限配置"><button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>成员角色</button><button className={tab === 'invite' ? 'active' : ''} onClick={() => setTab('invite')}>邀请成员</button><button className={tab === 'delegation' ? 'active' : ''} onClick={() => setTab('delegation')}>请假代理</button><button className={tab === 'handover' ? 'active' : ''} onClick={() => setTab('handover')}>离职交接</button></nav>
    {notice && <div className="aae-notice" role="status">{notice}</div>}{error && <div className="aae-error" role="alert">{error}</div>}

    {tab === 'members' && <div className="aae-grid">
      <div className="aae-panel"><div className="aae-panel-title"><h3>成员账号</h3><span>{activeMembers.length} 个启用</span></div><div className="aae-members">{snapshot.members.map((member) => <article key={member.id}><div className="aae-person"><span>{member.name.slice(0, 1)}</span><div><strong>{member.name}</strong><small>{member.position || '未填写职位'} · {member.status === 'active' ? '启用' : '已停用'}</small></div></div><div className="aae-chips">{member.roles.map((role) => <span key={role.code}>{role.name}</span>)}</div><div className="aae-row-actions"><button onClick={() => startRoleEdit(member.id)}>配置角色</button><button className={member.status === 'active' ? 'danger' : ''} disabled={busy} onClick={() => run(() => dataSource.setProfileStatus(member.id, member.status === 'active' ? 'disabled' : 'active'), member.status === 'active' ? '账号已停用' : '账号已启用')}>{member.status === 'active' ? '停用' : '启用'}</button></div></article>)}</div></div>
      <div className="aae-stack"><div className="aae-panel"><h3>角色组合</h3>{editingId ? <><p className="aae-hint">正在配置：{nameOf(editingId)}</p><div className="aae-options">{snapshot.roles.map((role) => <label key={role.code}><input type="checkbox" checked={roleCodes.includes(role.code)} onChange={() => toggle(role.code, roleCodes, setRoleCodes)} /><span><strong>{role.name}</strong><small>{role.description}</small></span></label>)}</div><button className="primary wide" disabled={busy || roleCodes.length === 0} onClick={() => run(() => dataSource.replaceRoles(editingId, roleCodes), '角色已保存')}>保存角色</button></> : <p className="aae-empty">从左侧选择一名成员。</p>}</div>
      <div className="aae-panel"><h3>主管与下属</h3><select value={supervisorId} onChange={(event) => startSupervisorEdit(event.target.value)}><option value="">选择主管</option>{activeMembers.filter((member) => member.roles.some((role) => role.code === 'supervisor')).map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select>{supervisorId && <><div className="aae-options compact">{activeMembers.filter((member) => member.id !== supervisorId).map((member) => <label key={member.id}><input type="checkbox" checked={subordinateIds.includes(member.id)} onChange={() => toggle(member.id, subordinateIds, setSubordinateIds)} /><span><strong>{member.name}</strong></span></label>)}</div><button className="primary wide" disabled={busy} onClick={() => run(() => dataSource.replaceSupervisorSubordinates(supervisorId, subordinateIds), '主管关系已保存')}>保存下属范围</button></>}</div></div>
    </div>}

    {tab === 'invite' && <div className="aae-grid two"><form className="aae-panel" onSubmit={(event) => { event.preventDefault(); void run(() => dataSource.createInvitation(invite.email, invite.displayName, invite.roleCodes), '邀请登记已创建') }}><h3>管理员邀请登记</h3><p className="aae-hint">系统不提供公开注册。登记后由管理员完成 Auth 邀请，角色在首次登录后绑定。</p><label className="aae-field">姓名<input required value={invite.displayName} onChange={(event) => setInvite({ ...invite, displayName: event.target.value })} /></label><label className="aae-field">邮箱<input required type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} /></label><fieldset><legend>预设角色</legend><div className="aae-options compact">{snapshot.roles.map((role) => <label key={role.code}><input type="checkbox" checked={invite.roleCodes.includes(role.code)} onChange={() => setInvite({ ...invite, roleCodes: invite.roleCodes.includes(role.code) ? invite.roleCodes.filter((code) => code !== role.code) : [...invite.roleCodes, role.code] })} /><span><strong>{role.name}</strong></span></label>)}</div></fieldset><button className="primary" disabled={busy || invite.roleCodes.length === 0}>创建邀请登记</button></form><div className="aae-panel"><h3>待处理邀请</h3>{snapshot.invitations.length ? snapshot.invitations.map((item) => <article className="aae-invite" key={item.id}><strong>{item.displayName}</strong><span>{item.email}</span><small>{item.roleCodes.join('、')} · {new Date(item.invitedAt).toLocaleDateString()}</small></article>) : <p className="aae-empty">暂无待处理邀请。</p>}</div></div>}

    {tab === 'delegation' && <div className="aae-grid two"><form className="aae-panel" onSubmit={(event) => { event.preventDefault(); void run(() => dataSource.createDelegation(delegation), '临时代理已生效') }}><h3>新建请假代理</h3><label className="aae-field">请假成员<select required value={delegation.delegatorId} onChange={(event) => setDelegation({ ...delegation, delegatorId: event.target.value })}><option value="">请选择</option>{activeMembers.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label><label className="aae-field">代理成员<select required value={delegation.delegateId} onChange={(event) => setDelegation({ ...delegation, delegateId: event.target.value })}><option value="">请选择</option>{activeMembers.filter((member) => member.id !== delegation.delegatorId).map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label><div className="aae-date-row"><label className="aae-field">开始<input required type="datetime-local" value={delegation.startsAt} onChange={(event) => setDelegation({ ...delegation, startsAt: event.target.value })} /></label><label className="aae-field">结束<input required type="datetime-local" value={delegation.endsAt} onChange={(event) => setDelegation({ ...delegation, endsAt: event.target.value })} /></label></div><label className="aae-field">原因<input required value={delegation.reason} onChange={(event) => setDelegation({ ...delegation, reason: event.target.value })} /></label><button className="primary" disabled={busy}>创建代理</button></form><div className="aae-panel"><h3>当前代理</h3>{snapshot.delegations.length ? snapshot.delegations.map((item) => <article className="aae-invite" key={item.id}><strong>{nameOf(item.delegatorId)} → {nameOf(item.delegateId)}</strong><span>{item.reason}</span><small>{new Date(item.startsAt).toLocaleString()} 至 {new Date(item.endsAt).toLocaleString()}</small></article>) : <p className="aae-empty">暂无生效中的代理。</p>}</div></div>}

    {tab === 'handover' && <div className="aae-grid two"><form className="aae-panel" onSubmit={(event) => { event.preventDefault(); void run(() => dataSource.reassignOwnership(handover.fromId, handover.toId, handover.reason), '客户负责人已批量转移') }}><h3>离职客户交接</h3><p className="aae-hint">先转移品牌、门店、联系人、线索和商机，再停用离职账号。系统保留负责人变更历史。</p><label className="aae-field">原负责人<select required value={handover.fromId} onChange={(event) => setHandover({ ...handover, fromId: event.target.value })}><option value="">请选择</option>{snapshot.members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label><label className="aae-field">新负责人<select required value={handover.toId} onChange={(event) => setHandover({ ...handover, toId: event.target.value })}><option value="">请选择</option>{activeMembers.filter((member) => member.id !== handover.fromId).map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label><label className="aae-field">交接原因<input required value={handover.reason} onChange={(event) => setHandover({ ...handover, reason: event.target.value })} /></label><button className="primary" disabled={busy}>批量转移客户</button></form><div className="aae-panel aae-warning"><h3>停用保护</h3><p>账号仍持有客户时，数据库会拒绝停用并返回“请先完成客户交接”。管理员不能停用自己，最后一名管理员也受数据库约束保护。</p></div></div>}
  </section>
}
