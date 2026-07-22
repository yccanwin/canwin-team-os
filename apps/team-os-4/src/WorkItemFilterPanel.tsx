import { useState, type FormEvent } from 'react'
import {
  PRIMARY_ROLE_LABELS,
  PRIMARY_ROLES,
  WORK_ITEM_STATUSES,
  type PrimaryRole,
  type WorkItemStatus,
} from '../../../packages/team-os-4-domain/src/index'
import type { SavedWorkItemView, WorkItemFilterState } from './domain/work-item-view'

const STATUS_LABELS: Readonly<Record<WorkItemStatus, string>> = {
  pending: '待处理',
  in_progress: '处理中',
  waiting: '等待他人',
  completed: '已完成',
  cancelled: '已取消',
}

function toggle<T extends string>(values: readonly T[], value: T): readonly T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
}

export function WorkItemFilterPanel({
  draft,
  savedViews,
  busy,
  onDraftChange,
  onApply,
  onClear,
  onSave,
  onApplySaved,
  onDeleteSaved,
}: {
  draft: WorkItemFilterState
  savedViews: readonly SavedWorkItemView[]
  busy: boolean
  onDraftChange: (filters: WorkItemFilterState) => void
  onApply: () => void
  onClear: () => void
  onSave: (name: string) => void
  onApplySaved: (id: string) => void
  onDeleteSaved: (id: string) => void
}) {
  const [viewName, setViewName] = useState('')
  const [selectedViewId, setSelectedViewId] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); onApply() }
  const save = () => { const name = viewName.trim(); if (!name) return; onSave(name); setViewName('') }

  return (
    <section className="work-item-filters" data-testid="work-item-filters" aria-labelledby="work-item-filter-title">
      <div className="section-heading"><p className="eyebrow">筛选视图</p><h2 id="work-item-filter-title">快速找到要推进的事项</h2></div>
      <form onSubmit={submit}>
        <label className="work-item-search">关键词
          <input data-testid="work-item-search" type="search" value={draft.search} placeholder="客户、来源或下一步" onChange={(event) => onDraftChange({ ...draft, search: event.target.value })} />
        </label>
        <fieldset><legend>状态（可多选）</legend><div className="filter-options">
          {WORK_ITEM_STATUSES.map((status) => <label key={status}><input type="checkbox" checked={draft.statuses.includes(status)} onChange={() => onDraftChange({ ...draft, statuses: toggle(draft.statuses, status) })} />{STATUS_LABELS[status]}</label>)}
        </div></fieldset>
        <fieldset><legend>岗位（可多选）</legend><div className="filter-options">
          {PRIMARY_ROLES.map((role) => <label key={role}><input type="checkbox" checked={draft.roleTypes.includes(role)} onChange={() => onDraftChange({ ...draft, roleTypes: toggle<PrimaryRole>(draft.roleTypes, role) })} />{PRIMARY_ROLE_LABELS[role]}</label>)}
        </div></fieldset>
        <div className="filter-actions"><button className="ui-button auth-submit" data-testid="work-item-filter-apply" disabled={busy}>应用筛选</button><button className="ui-button ui-button--quiet" type="button" data-testid="work-item-filter-clear" disabled={busy} onClick={onClear}>清除筛选</button></div>
      </form>
      <div className="saved-view-controls">
        <label>保存当前筛选<input value={viewName} maxLength={40} placeholder="例如：今日待处理" onChange={(event) => setViewName(event.target.value)} /></label>
        <button className="ui-button ui-button--quiet" type="button" data-testid="work-item-filter-save" disabled={!viewName.trim()} onClick={save}>保存</button>
        <label>已保存视图<select value={selectedViewId} onChange={(event) => setSelectedViewId(event.target.value)}><option value="">请选择</option>{savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
        <button className="ui-button ui-button--quiet" type="button" disabled={!selectedViewId || busy} onClick={() => onApplySaved(selectedViewId)}>使用</button>
        <button className="ui-button ui-button--quiet" type="button" disabled={!selectedViewId} onClick={() => { onDeleteSaved(selectedViewId); setSelectedViewId('') }}>删除</button>
      </div>
    </section>
  )
}
