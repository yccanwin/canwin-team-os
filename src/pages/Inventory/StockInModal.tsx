import { useState, useMemo } from 'react'
import Modal from '@/components/Modal'
import { useInventoryStore } from '@/stores/useInventoryStore'
import { useUserStore } from '@/stores/useUserStore'

interface StockInModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function StockInModal({ isOpen, onClose }: StockInModalProps) {
  const items = useInventoryStore((s) => s.items)
  const currentUser = useUserStore((s) => s.currentUser)
  const addStock = useInventoryStore((s) => s.addStock)

  // 两步流程
  const [step, setStep] = useState<'form' | 'cost'>('form')

  // 第一步：入库信息
  const [name, setName] = useState('')
  const [isDropdown, setIsDropdown] = useState(false)
  const [sku, setSku] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('个')
  const [unitPrice, setUnitPrice] = useState('')
  const [note, setNote] = useState('')

  // 第二步：成本确认
  const [costAmount, setCostAmount] = useState('')
  const [costCategory, setCostCategory] = useState('采购成本')
  const [costDate, setCostDate] = useState(() => new Date().toISOString().slice(0, 10))

  // 错误状态
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [costError, setCostError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  // 已有商品下拉列表（去重后按名称）
  const existingProducts = useMemo(() => {
    const unique = new Map<string, { name: string; unit: string; unitPrice: number; sku?: string }>()
    items.forEach((item) => {
      const key = `${item.name}|${item.unit}`
      if (!unique.has(key)) {
        unique.set(key, {
          name: item.name,
          unit: item.unit,
          unitPrice: item.unitPrice,
          sku: item.sku,
        })
      }
    })
    return Array.from(unique.values())
  }, [items])

  // 表单重置
  const resetForm = () => {
    setName('')
    setSku('')
    setQuantity('')
    setUnit('个')
    setUnitPrice('')
    setNote('')
    setCostAmount('')
    setCostCategory('采购成本')
    setCostDate(new Date().toISOString().slice(0, 10))
    setErrors({})
    setCostError('')
    setStep('form')
    setSuccessMessage('')
  }

  // 关闭
  const handleClose = () => {
    resetForm()
    onClose()
  }

  // 选择已有商品
  const handleSelectProduct = (product: (typeof existingProducts)[0]) => {
    setName(product.name)
    setUnit(product.unit)
    setUnitPrice(String(product.unitPrice))
    setSku(product.sku || '')
    setIsDropdown(false)
  }

  // 第一步验证
  const validateStep1 = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!name.trim()) newErrors.name = '商品名称不能为空'
    const qty = Number(quantity)
    if (!quantity || isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) {
      newErrors.quantity = '请输入正整数'
    }
    const price = Number(unitPrice)
    if (unitPrice === '' || isNaN(price) || price < 0) {
      newErrors.unitPrice = '单价不能小于0'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // 跳转到成本确认
  const handleGoToCost = () => {
    if (!validateStep1()) return
    // 预填成本 = 数量 × 单价
    const qty = Number(quantity)
    const price = Number(unitPrice)
    if (!costAmount && qty > 0 && price >= 0) {
      setCostAmount(String(qty * price))
    }
    setStep('cost')
  }

  // 第二步验证 + 提交
  const handleConfirm = () => {
    const cost = Number(costAmount)
    if (!costAmount || isNaN(cost) || cost <= 0) {
      setCostError('请输入有效的成本金额')
      return
    }
    setCostError('')
    setSubmitting(true)

    try {
      addStock(
        {
          name: name.trim(),
          sku: sku.trim() || undefined,
          quantity: Number(quantity),
          unit,
          unitPrice: Number(unitPrice),
        },
        cost,
        currentUser.id,
        costCategory,
        costDate
      )
      setSuccessMessage(`成功入库：${name.trim()} × ${quantity}${unit}`)

      // 延迟关闭，显示成功提示
      setTimeout(() => {
        handleClose()
      }, 1000)
    } catch {
      setCostError('入库失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  // 取消第二步，回到第一步
  const handleCancelCost = () => {
    setStep('form')
    setCostAmount('')
    setCostError('')
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={step === 'form' ? '商品入库' : '成本确认'}
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
          <p className="text-lg font-semibold text-brand-400">入库成功</p>
          <p className="text-sm text-brand-300 mt-1">{successMessage}</p>
        </div>
      ) : step === 'form' ? (
        /* ── 第一步：入库信息表单 ── */
        <div className="space-y-4">
          {/* 商品名称（输入框 + 下拉选择已有商品） */}
          <div className="relative">
            <label className="block text-sm font-medium text-brand-400 mb-1">
              商品名称 <span className="text-expense">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setIsDropdown(false)
              }}
              onFocus={() => {
                if (existingProducts.length > 0) setIsDropdown(true)
              }}
              placeholder="输入商品名称或选择已有商品"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                errors.name ? 'border-expense' : 'border-gray-300'
              }`}
            />
            {errors.name && (
              <p className="text-xs text-expense mt-1">{errors.name}</p>
            )}

            {/* 下拉选择已有商品 */}
            {isDropdown && existingProducts.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-brand-100 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {existingProducts
                  .filter(
                    (p) =>
                      !name ||
                      p.name.toLowerCase().includes(name.toLowerCase())
                  )
                  .map((p) => (
                    <button
                      key={`${p.name}|${p.unit}`}
                      type="button"
                      onClick={() => handleSelectProduct(p)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 border-b border-gray-100 last:border-0"
                    >
                      <span className="font-medium text-brand-400">
                        {p.name}
                      </span>
                      <span className="ml-2 text-brand-200">
                        {p.unitPrice > 0 ? `¥${p.unitPrice}/${p.unit}` : ''}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* SKU + 单位 同行 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-brand-400 mb-1">
                SKU/编号
              </label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="选填"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-400 mb-1">
                单位 <span className="text-expense">*</span>
              </label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="个">个</option>
                <option value="箱">箱</option>
                <option value="件">件</option>
                <option value="套">套</option>
                <option value="台">台</option>
              </select>
            </div>
          </div>

          {/* 入库数量 + 单价 同行 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-brand-400 mb-1">
                入库数量 <span className="text-expense">*</span>
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="正整数"
                min={1}
                step={1}
                className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                  errors.quantity ? 'border-expense' : 'border-gray-300'
                }`}
              />
              {errors.quantity && (
                <p className="text-xs text-expense mt-1">{errors.quantity}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-400 mb-1">
                单价 <span className="text-expense">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-200 text-sm">
                  ¥
                </span>
                <input
                  type="number"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  placeholder="0"
                  min={0}
                  step="0.01"
                  className={`w-full pl-7 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                    errors.unitPrice ? 'border-expense' : 'border-gray-300'
                  }`}
                />
              </div>
              {errors.unitPrice && (
                <p className="text-xs text-expense mt-1">
                  {errors.unitPrice}
                </p>
              )}
            </div>
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
              onClick={handleGoToCost}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-indigo-600 transition-colors"
            >
              确认入库
            </button>
          </div>
        </div>
      ) : (
        /* ── 第二步：成本确认 ── */
        <div className="space-y-4">
          {/* 入库摘要 */}
          <div className="bg-brand-50 rounded-lg p-4 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-brand-300">商品</span>
              <span className="font-medium text-brand-400">{name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-brand-300">数量</span>
              <span className="font-medium text-brand-400">
                {quantity} {unit}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-brand-300">单价</span>
              <span className="font-medium text-brand-400">
                ¥{Number(unitPrice).toLocaleString()}/{unit}
              </span>
            </div>
            <div className="flex justify-between text-sm pt-1.5 border-t border-brand-100">
              <span className="text-brand-300">库存总值</span>
              <span className="font-semibold text-brand-400">
                ¥
                {(Number(quantity) * Number(unitPrice)).toLocaleString()}
              </span>
            </div>
          </div>

          {/* 成本类别 + 日期 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-brand-400 mb-1">
                成本类别
              </label>
              <select
                value={costCategory}
                onChange={(e) => setCostCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="采购成本">采购成本</option>
                <option value="物流成本">物流成本</option>
                <option value="其他">其他</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-400 mb-1">
                日期
              </label>
              <input
                type="date"
                value={costDate}
                onChange={(e) => setCostDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          </div>

          {/* 成本金额输入 */}
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              请输入本次采购成本金额{' '}
              <span className="text-expense">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-200 text-sm">
                ¥
              </span>
              <input
                type="number"
                value={costAmount}
                onChange={(e) => {
                  setCostAmount(e.target.value)
                  setCostError('')
                }}
                placeholder="0"
                min={0}
                step="0.01"
                autoFocus
                className={`w-full pl-7 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                  costError ? 'border-expense' : 'border-gray-300'
                }`}
              />
            </div>
            {costError && (
              <p className="text-xs text-expense mt-1">{costError}</p>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleCancelCost}
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
