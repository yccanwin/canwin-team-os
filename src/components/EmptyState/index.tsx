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
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="text-neutral-tertiary mb-4">
        {icon || <Inbox className="w-16 h-16" />}
      </div>
      <h3 className="font-heading text-lg font-medium text-brand-400 mb-1">{title}</h3>
      <p className="text-sm text-brand-200 mb-4 text-center max-w-xs">
        {description}
      </p>
      {action && <div>{action}</div>}
    </div>
  )
}
