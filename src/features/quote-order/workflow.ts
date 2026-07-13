import type { DemoQuote, QuoteActionResult, QuoteChangeOrder, QuoteLine } from './types'

const DAY_MS = 86_400_000
export const calculateValidUntil = (issuedAt: string) => new Date(new Date(`${issuedAt}T00:00:00+08:00`).getTime() + 15 * DAY_MS).toISOString().slice(0, 10)
export const quoteTotal = (lines: QuoteLine[]) => lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
export const hasSpecialContent = (quote: DemoQuote) => quote.lines.some(line => Boolean(line.specialContent?.trim()))

const result = (ok: boolean, quote: DemoQuote, message: string): QuoteActionResult => ({ ok, quote, message })
const clone = (quote: DemoQuote): DemoQuote => structuredClone(quote)

export const submitQuote = (source: DemoQuote): QuoteActionResult => {
  if (source.status === 'frozen') return result(false, source, '报价已冻结，只能生成变更单')
  if (source.customerGrade === 'A' && !source.demonstrationCompleted) return result(false, source, 'A类客户未完成演示，禁止提交报价')
  const quote = clone(source)
  quote.status = hasSpecialContent(quote) && !quote.supervisorApproved ? 'pending_approval' : 'approved'
  return result(true, quote, quote.status === 'pending_approval' ? '特殊内容已提交主管审批' : '报价已批准，有效期15天')
}

export const approveSpecialContent = (source: DemoQuote): QuoteActionResult => {
  if (source.status !== 'pending_approval') return result(false, source, '当前报价不在主管审批状态')
  const quote = clone(source); quote.supervisorApproved = true; quote.status = 'approved'
  return result(true, quote, '主管已批准特殊内容')
}

export const completeDemonstration = (source: DemoQuote): QuoteActionResult => {
  const quote = clone(source); quote.demonstrationCompleted = true
  return result(true, quote, '演示已标记完成（本地演示）')
}

export const freezeAfterDepositConfirmation = (source: DemoQuote, now: string): QuoteActionResult => {
  if (source.status !== 'approved') return result(false, source, '报价未批准，不能确认定金并冻结')
  if (now.slice(0, 10) > source.validUntil) return result(false, source, '报价已超过15天有效期，不能冻结')
  const quote = clone(source); quote.status = 'frozen'
  quote.frozenSnapshot = { quoteId: quote.id, version: quote.version, lines: structuredClone(quote.lines), totalAmount: quoteTotal(quote.lines), frozenAt: now }
  return result(true, quote, '本地演示：定金确认，报价快照已冻结')
}

export const createChangeOrder = (source: DemoQuote, reason: string, now: string): QuoteActionResult => {
  if (source.status !== 'frozen') return result(false, source, '报价冻结后才使用变更单')
  if (!reason.trim()) return result(false, source, '请填写变更原因')
  const quote = clone(source)
  const change: QuoteChangeOrder = { id: `change-${quote.changeOrders.length + 1}`, quoteId: quote.id, reason: reason.trim(), createdAt: now, status: 'draft' }
  quote.changeOrders.push(change)
  return result(true, quote, '变更单草稿已生成，原冻结报价保持不变')
}
