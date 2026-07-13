import { memo } from 'react'

type BadgeVariant = 'success' | 'info' | 'warning' | 'error' | 'neutral'

interface StatusBadgeProps {
  label: string
  variant?: BadgeVariant
}

const variantStyles: Record<BadgeVariant, string> = {
  success: 'bg-green-50 text-green-700 border-green-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  warning: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  neutral: 'bg-brand-50 text-brand-400 border-brand-100',
}

const StatusBadge = memo(function StatusBadge({
  label,
  variant = 'neutral',
}: StatusBadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center px-2.5 py-0.5 rounded-full
        text-xs font-medium border
        ${variantStyles[variant]}
      `}
    >
      {label}
    </span>
  )
})

export default StatusBadge
