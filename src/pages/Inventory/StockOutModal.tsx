import { useState } from 'react'
import Modal from '@/components/Modal'
import { useInventoryStore } from '@/stores/useInventoryStore'
import { useUserStore } from '@/stores/useUserStore'

interface StockOutModalProps {
  isOpen: boolean
  onClose: () => void
  itemId: string
}

export default function StockOutModal({
  isOpen,
  onClose,
  itemId,
}: StockOutModalProps) {
  const items = useInventoryStore((s) => s.items)
  const currentUser = useUserStore((s) => s.currentUser)
  const removeStock = useInventoryStore((s) => s.removeStock)

  // 找到当前商品
  const item = items.find((i) => i.id === itemId)

  // 两步流程
  const [step, setStep] = useState<'form' | 'income'>('form')

  // 第一步：出库信息
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')

  // 第二步：收入确认
  const [incomeAmount, setIncomeAmount] = useState('')
  const [incomeCategory, setIncomeCategory] = useState('销售收入')
  const [incomeDate, setIncomeDate] = useState(() => new Date().toISOString().slice(0, 10))

  // 错误状态
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [incomeError, setIncomeError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  // 表单重置
  const resetForm = () => {
    setQuantity('')
    setNote('')
    setIncomeAmount('')
    setIncomeCategory('销售收入')
    setIncomeDate(new Date().toISOString().slice(0, 10))
    setErrors({})
    setIncomeError('')
    setStep('form')
    setSuccessMessage('')
  }

  // 关闭
  const handleClose = () => {
    resetForm()
    onClose()
  }

  // 第一步验证
  const validateStep1 = (): boolean => {
    const newErrors: Record<string, string> = {}
    const qty = Number(quantity)

    if (!quantity || isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) {
      newErrors.quantity = '请输入正整数'
    } else if (item && qty > item.quantity) {
      newErrors.quantity = `出库数量不能超过当前库存（${item.quantity} ${item.unit}）`
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // 跳转到收入确认
  const handleGoToIncome = () => {
    if (!validateStep1()) return
    setStep('income')
  }

  // 第二步验证 + 提交
  const handleConfirm = () => {
    const amount = Number(incomeAmount)
    if (!incomeAmount || isNaN(amount) || amount <= 0) {
      setIncomeError('请输入有效的收入金额')
      return
    }
    setIncomeError('')
    setSubmitting(true)

    try {
      removeStock(itemId, Number(quantity), amount, currentUser.id, incomeCategory, incomeDate)
      setSuccessMessage(
        `成功出库：${item?.name ?? ''} × ${quantity}${item?.unit ?? ''}`
      )

      setTimeout(() => {
        handleClose()
      }, 1000)
    } catch (err) {
      setIncomeError(
        err instanceof Error ? err.message : '出库失败，请重试'
      )
    } finally {
      setSubmitting(false)
    }
  }

  // 取消第二步
  const handleCancelIncome = () => {
    setStep('form')
    setIncomeAmount('')
    setIncomeError('')
  }

  // 商品不存在
  if (!item) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} title="出库">
        <div className="flex flex-col items-center py-8">
          <p className="text-brand-300">未找到该商品</p>
        </div>
      </Modal>
    )
  }

  const itemValue = item.quantity * item.unitPrice

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={step === 'form' ? '商品出库' : '收入确认'}
      size="lg"
    >
      {successMessage ? (
        <div className="flex flex-col items-center justify-center py-8">
          <div className="w-16 h-16 rounded-full bg-income/10 flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-income"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <p className="text-lg font-semibold text-brand-400">出库成功</p>
          <p className="text-sm text-brand-300 mt-1">{successMessage}</p>
        </div>
      ) : step === 'form' ? (
        /* ── 第一步：出库信息表单 ── */
        <div className="space-y-4">
          {/* 商品信息摘要（只读） */}
          <div className="bg-brand-50 rounded-lg p-4 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-brand-300">出库商品</span>
              <span className="font-medium text-brand-400">{item.name}</span>
            </div>
            {item.sku && (
              <div className="flex justify-between text-sm">
                <span className="text-brand-300">SKU</span>
                <span className="text-brand-400">{item.sku}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-brand-300">当前库存</span>
              <span className="font-medium text-primary">
                {item.quantity} {item.unit}
              </span>
            </div>
            <div className="flex justify-between text-sm pt-1.5 border-t border-brand-100">
              <span className="text-brand-300">库存总值</span>
              <span className="font-semibold text-brand-400">
                ¥{itemValue.toLocaleString()}
              </span>
            </div>
          </div>

          {/* 出库数量 */}
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              出库数量 <span className="text-expense">*</span>
            </label>
            <div className="relative">
              <input
                type="number"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value)
                  // 即时校验
                  const qty = Number(e.target.value)
                  if (qty > item.quantity) {
                    setErrors((prev) => ({
                      ...prev,
                      quantity: `出库数量不能超过当前库存（${item.quantity} ${item.unit}）`,
                    }))
                  } else {
                    setErrors((prev) => {
                      const { quantity: _, ...rest } = prev
                      return rest
                    })
                  }
                }}
                placeholder="输入出库数量"
                min={1}
                max={item.quantity}
                step={1}
                autoFocus
                className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                  errors.quantity ? 'border-expense' : 'border-gray-300'
                }`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-brand-200">
                {item.unit}
              </span>
            </div>
            {errors.quantity ? (
              <p className="text-xs text-expense mt-1">{errors.quantity}</p>
            ) : (
              <p className="text-xs text-brand-200 mt-1">
                最大可出库量：{item.quantity} {item.unit}
              </p>
            )}
          </div>

          {/* 备注 */}
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              备注
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="选填"
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
            />
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-brand-400 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleGoToIncome}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-indigo-600 transition-colors"
            >
              确认出库
            </button>
          </div>
        </div>
      ) : (
        /* ── 第二步：收入确认 ── */
        <div className="space-y-4">
          {/* 出库摘要 */}
          <div className="bg-brand-50 rounded-lg p-4 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-brand-300">商品</span>
              <span className="font-medium text-brand-400">{item.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-brand-300">出库数量</span>
              <span className="font-medium text-expense">
                -{quantity} {item.unit}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-brand-300">剩余库存</span>
              <span className="font-medium text-brand-400">
                {item.quantity - Number(quantity)} {item.unit}
              </span>
            </div>
          </div>

          {/* 收入类别 + 日期 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-brand-400 mb-1">
                收入类别
              </label>
              <select
                value={incomeCategory}
                onChange={(e) => setIncomeCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="销售收入">销售收入</option>
                <option value="其他收入">其他收入</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-400 mb-1">
                日期
              </label>
              <input
                type="date"
                value={incomeDate}
                onChange={(e) => setIncomeDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          </div>

          {/* 收入金额输入 */}
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              请输入本次销售收入金额{' '}
              <span className="text-expense">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-200 text-sm">
                ¥
              </span>
              <input
                type="number"
                value={incomeAmount}
                onChange={(e) => {
                  setIncomeAmount(e.target.value)
                  setIncomeError('')
                }}
                placeholder="0"
                min={0}
                step="0.01"
                autoFocus
                className={`w-full pl-7 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                  incomeError ? 'border-expense' : 'border-gray-300'
                }`}
              />
            </div>
            {incomeError && (
              <p className="text-xs text-expense mt-1">{incomeError}</p>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleCancelIncome}
              disabled={submitting}
              className="flex-1 px-4 py-2 text-sm font-medium text-brand-400 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-50"
            >
              {submitting ? '处理中...' : '确认'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
