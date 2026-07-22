import { useEffect, type ReactNode } from 'react'

export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral'

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const percentage = Math.max(0, Math.min(100, value))
  return (
    <div className="ui-progress">
      <div className="ui-progress__label"><span>{label}</span><strong>{Math.round(percentage)}%</strong></div>
      <div className="ui-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}>
        <span style={{ width: `${percentage}%` }} />
      </div>
    </div>
  )
}

export function KPICard({ label, value, note, tone = 'neutral' }: {
  label: string
  value: string | number
  note?: string
  tone?: StatusTone
}) {
  return <article className={`ui-kpi ui-kpi--${tone}`}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>
}

export function EmptyState({ title = '暂无内容', description, action }: { title?: string; description?: string; action?: ReactNode }) {
  return (
    <section className="ui-empty" role="status">
      <span className="ui-empty__mark" aria-hidden="true">CW</span>
      <h2>{title}</h2>{description && <p>{description}</p>}{action && <div>{action}</div>}
    </section>
  )
}

export function Modal({ open, title, onClose, children, footer }: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="ui-modal" role="presentation">
      <button className="ui-modal__backdrop" aria-label="关闭弹窗" onClick={onClose} />
      <section className="ui-modal__panel" role="dialog" aria-modal="true" aria-labelledby="ui-modal-title">
        <header><h2 id="ui-modal-title">{title}</h2><button className="ui-icon-button" onClick={onClose} aria-label="关闭">×</button></header>
        <div className="ui-modal__content">{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = '确认', pending = false, onConfirm, onCancel }: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel} footer={
      <div className="ui-actions"><button className="ui-button ui-button--quiet" onClick={onCancel} disabled={pending}>取消</button><button className="ui-button ui-button--danger" onClick={onConfirm} disabled={pending}>{pending ? '处理中…' : confirmLabel}</button></div>
    }><p className="ui-dialog-message">{message}</p></Modal>
  )
}
