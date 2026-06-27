import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const sizeStyles: Record<string, string> = {
  sm: 'mx-4 max-w-full sm:max-w-sm',
  md: 'mx-4 max-w-full sm:max-w-md',
  lg: 'mx-4 max-w-full sm:max-w-lg',
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
}: ModalProps) {
  // ESC 关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEsc)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* 弹窗 */}
      <div
        className={`
          relative bg-white rounded-lg shadow-xl w-full
          ${sizeStyles[size]}
          max-h-[85vh] flex flex-col
        `}
      >
        {/* 标题栏 */}
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100">
            <h3 className="font-heading text-lg font-semibold text-brand-400">{title}</h3>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-gray-100 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-brand-200" />
            </button>
          </div>
        )}

        {/* 关闭按钮（无标题时） */}
        {!title && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1 rounded-md hover:bg-gray-100 transition-colors z-10"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-brand-200" />
          </button>
        )}

        {/* 内容 */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}
