import { AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
  title?: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'info'
  loading?: boolean
}

const variantStyles = {
  danger: {
    icon: 'text-expense',
    button: 'bg-expense hover:bg-red-600 text-white',
  },
  warning: {
    icon: 'text-yellow-500',
    button: 'bg-yellow-500 hover:bg-yellow-600 text-white',
  },
  info: {
    icon: 'text-profit',
    button: 'bg-primary hover:bg-indigo-600 text-white',
  },
}

export default function ConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title = '确认操作',
  message = '确定要执行此操作吗？',
  confirmLabel = '确认',
  cancelLabel = '取消',
  variant = 'danger',
  loading = false,
}: ConfirmDialogProps) {
  if (!isOpen) return null

  const styles = variantStyles[variant]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
      />

      {/* 对话框 */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
        {/* 图标 */}
        <div className="flex justify-center mb-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${styles.icon} bg-opacity-10`}>
            <AlertTriangle className={`w-6 h-6 ${styles.icon}`} />
          </div>
        </div>

        {/* 标题 */}
        <h3 className="font-heading text-lg font-semibold text-brand-400 text-center mb-2">
          {title}
        </h3>

        {/* 消息 */}
        <p className="text-sm text-brand-300 text-center mb-6">
          {message}
        </p>

        {/* 按钮 */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-medium text-brand-400 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${styles.button} disabled:opacity-70 disabled:cursor-not-allowed`}
          >
            {loading ? '处理中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
