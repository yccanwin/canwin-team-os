import { useEffect, useState } from 'react'
import type { AccessAdminDataSource } from './dataSource'
import type { AccessAdminSnapshot, AccessMemberView } from './types'
import './access-admin-editor.css'

export function AccessAdminEditor({ dataSource }: { dataSource: AccessAdminDataSource }) {
  const [snapshot, setSnapshot] = useState<AccessAdminSnapshot | null>(null)
  const [selected, setSelected] = useState<AccessMemberView | null>(null)
  const [roleCodes, setRoleCodes] = useState<string[]>([])
  const [regionIds, setRegionIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => setSnapshot(await dataSource.loadSnapshot())
  useEffect(() => { let active = true; dataSource.loadSnapshot().then((data) => { if (active) setSnapshot(data) }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '读取权限失败') }); return () => { active = false } }, [dataSource])
  const chooseMember = (member: AccessMemberView) => { setSelected(member); setRoleCodes(member.roles.map((role) => role.code)); setRegionIds(member.regions.map((region) => region.id)); setError('') }
  const toggle = (value: string, values: string[], setter: (next: string[]) => void) => setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  const save = async () => {
    if (!selected) return
    setSaving(true); setError('')
    try {
      await dataSource.manageProfileAccess(selected.id, roleCodes, regionIds)
      await load()
      setSelected(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存权限失败')
    } finally { setSaving(false) }
  }

  if (error && !snapshot) return <div className="aae-error" role="alert">{error}</div>
  if (!snapshot) return <p className="aae-loading">正在读取权限…</p>
  return <section className="aae-shell"><header><div><h2>成员权限配置</h2><p>{snapshot.currentUserIsAdmin ? '所有保存仅通过服务端授权 RPC。' : '当前账号仅可查看，不显示操作控件。'}</p></div></header>
    <div className="aae-members">{snapshot.members.map((member) => <article key={member.id} className={selected?.id === member.id ? 'is-selected' : ''}><div><strong>{member.name}</strong><small>{member.status}</small></div><p>{member.roles.map((role) => role.name).join('、') || '未分配角色'}</p><p>{member.regions.map((region) => region.name).join('、') || '未分配区域'}</p>{snapshot.currentUserIsAdmin && <button onClick={() => chooseMember(member)}>调整权限</button>}</article>)}</div>
    {snapshot.currentUserIsAdmin && selected && <div className="aae-form"><h3>{selected.name}</h3><p>允许空选择提交；管理员保护由服务端执行，错误会原样显示。</p><fieldset><legend>多角色</legend>{snapshot.roles.map((role) => <label key={role.id}><input type="checkbox" checked={roleCodes.includes(role.code)} onChange={() => toggle(role.code, roleCodes, setRoleCodes)} />{role.name}</label>)}</fieldset><fieldset><legend>销售区域</legend>{snapshot.regions.map((region) => <label key={region.id}><input type="checkbox" checked={regionIds.includes(region.id)} onChange={() => toggle(region.id, regionIds, setRegionIds)} />{region.name}</label>)}</fieldset>{error && <div className="aae-error" role="alert">{error}</div>}<div className="aae-actions"><button disabled={saving} onClick={() => setSelected(null)}>取消</button><button className="is-primary" disabled={saving} onClick={save}>{saving ? '正在保存…' : '保存权限'}</button></div></div>}
  </section>
}
