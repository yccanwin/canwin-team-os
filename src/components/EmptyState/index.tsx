import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title?: string
  description?: string
  action?: ReactNode
}

export default function EmptyState({
  icon,
  title = '暂无数据',
  description = '这里还没有任何内容',
  action,
}: EmptyStateProps) {
  return (
    <div className="ui-empty-state" role="status">
      <div className="ui-empty-state__icon">
        {icon || <Inbox className="h-8 w-8" aria-hidden="true" />}
      </div>
      <h3 className="font-heading text-base font-semibold text-slate-800">{title}</h3>
      <p className="mt-1 max-w-sm text-center text-sm leading-6 text-slate-500">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

