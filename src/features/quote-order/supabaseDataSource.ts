import type { SupabaseClient } from '@supabase/supabase-js'
import {
  QuoteOrderDataError,
  type DealOrderRecord,
  type DealQuoteApprovalRecord,
  type DealQuoteDraftLineRecord,
  type DealQuoteRecord,
  type InternalPaymentWorkbenchRecord,
  type QuoteOrderDataSource,
} from './dataSource'

type RawQuote = {
  id: string; opportunity_id: string; version_no: number; status: string; valid_until: string
  customer_total: number | string; internal_total: number | string; has_special_content: boolean; special_content: string | null
  submitted_at: string | null; frozen_at: string | null
  crm_opportunities?: {
    value_grade?: string; demo_completed_at?: string | null
    crm_stores?: { name: string } | null; crm_brands?: { name: string } | null
  } | null
}
type RawOrder = { id: string; order_number: string | null; quote_id: string; status: string; created_at: string; customer_total: number | string; internal_due: number | string; internal_paid: number | string }
type RawInternalPayment = { order_id: string; order_number: string; quote_id: string; store_name: string; owner_name: string; order_status: string; customer_total: number | string; customer_paid: number | string; customer_remaining: number | string; internal_due: number | string; internal_paid: number | string; internal_remaining: number | string; procurement_paid: number | string; estimated_margin: number | string | null; final_margin: number | string | null; margin_finalized: boolean; fulfillment_unlocked: boolean; can_manage: boolean; can_view_margin: boolean; lock_reason: string }
type RawDraftLine = { line_id: string; kind: 'package' | 'hardware' | 'addon'; source_id: string; item_name: string; quantity: number | string; customer_price: number | string }
type RawApproval = { status: DealQuoteApprovalRecord['status']; note: string | null; decided_at: string | null; can_decide: boolean }
type OptionRow = Record<string, unknown>

const related = (value: unknown): OptionRow | null => Array.isArray(value)
  ? (value[0] as OptionRow | undefined) ?? null
  : value && typeof value === 'object' ? value as OptionRow : null

const mapQuote = (row: RawQuote): DealQuoteRecord => ({
  id: row.id,
  opportunityId: row.opportunity_id,
  versionNo: row.version_no,
  status: row.status,
  validUntil: row.valid_until,
  customerTotal: Number(row.customer_total),
  internalTotal: Number(row.internal_total),
  hasSpecialContent: row.has_special_content,
  specialContent: row.special_content,
  submittedAt: row.submitted_at,
  frozenAt: row.frozen_at,
  storeName: row.crm_opportunities?.crm_stores?.name ?? '未命名门店',
  brandName: row.crm_opportunities?.crm_brands?.name ?? undefined,
  valueGrade: row.crm_opportunities?.value_grade ?? '',
  demoCompleted: Boolean(row.crm_opportunities?.demo_completed_at),
})
const mapOrder = (row: RawOrder): DealOrderRecord => ({ id: row.id, orderNumber: row.order_number ?? row.id, quoteId: row.quote_id, status: row.status, createdAt: row.created_at, customerTotal: Number(row.customer_total), internalDue: Number(row.internal_due), internalPaid: Number(row.internal_paid) })
const mapInternalPayment = (row: RawInternalPayment): InternalPaymentWorkbenchRecord => ({ orderId: row.order_id, orderNumber: row.order_number, quoteId: row.quote_id, storeName: row.store_name, ownerName: row.owner_name, orderStatus: row.order_status, customerTotal: Number(row.customer_total), customerPaid: Number(row.customer_paid), customerRemaining: Number(row.customer_remaining), internalDue: Number(row.internal_due), internalPaid: Number(row.internal_paid), internalRemaining: Number(row.internal_remaining), procurementPaid: Number(row.procurement_paid), estimatedMargin: row.estimated_margin === null ? null : Number(row.estimated_margin), finalMargin: row.final_margin === null ? null : Number(row.final_margin), marginFinalized: row.margin_finalized, fulfillmentUnlocked: row.fulfillment_unlocked, canManage: row.can_manage, canViewMargin: row.can_view_margin, lockReason: row.lock_reason })
const mapDraftLine = (row: RawDraftLine): DealQuoteDraftLineRecord => ({ lineId: row.line_id, kind: row.kind, sourceId: row.source_id, itemName: row.item_name, quantity: Number(row.quantity), customerPrice: Number(row.customer_price) })
const quoteSelection = 'id,opportunity_id,version_no,status,valid_until,customer_total,internal_total,has_special_content,special_content,submitted_at,frozen_at,crm_opportunities!inner(value_grade,demo_completed_at,crm_stores!inner(name),crm_brands(name))'

const fail = (error: { message: string; code?: string } | null, context: string): never => {
  throw new QuoteOrderDataError(error ? `${context}：${error.message}` : `${context}：服务器未返回数据`, error?.code)
}

export const createSupabaseQuoteOrderDataSource = (client: SupabaseClient): QuoteOrderDataSource => ({
  async loadDraftOptions() {
    const [opportunities, packages, items] = await Promise.all([
      client.from('crm_opportunities').select('id,value_grade,demo_completed_at,crm_stores!inner(name),crm_brands(name)').is('qualification_superseded_at', null).order('created_at', { ascending: false }),
      client.from('deal_packages').select('id,name,deal_catalog_versions!inner(status)').eq('is_active', true).eq('deal_catalog_versions.status', 'published').order('name'),
      client.from('deal_catalog_items').select('id,name,item_type,customer_list_price,deal_catalog_versions!inner(status)').eq('is_active', true).eq('deal_catalog_versions.status', 'published').order('name'),
    ])
    const error = opportunities.error ?? packages.error ?? items.error
    if (error) return fail(error, '读取报价选项失败')
    return {
      opportunities: ((opportunities.data ?? []) as OptionRow[]).map(x => {
        const brand = related(x.crm_brands); const store = related(x.crm_stores)
        return { id: String(x.id), label: `${brand?.name ? `${String(brand.name)} · ` : ''}${store?.name ? String(store.name) : '门店'}`, valueGrade: String(x.value_grade), demoCompleted: Boolean(x.demo_completed_at) }
      }),
      packages: ((packages.data ?? []) as OptionRow[]).map(x => ({ id: String(x.id), name: String(x.name) })),
      items: ((items.data ?? []) as OptionRow[]).map(x => ({ id: String(x.id), name: String(x.name), itemType: String(x.item_type), listPrice: Number(x.customer_list_price) })),
    }
  },
  async completeOpportunityDemo(opportunityId) {
    const { error } = await client.rpc('complete_opportunity_demo', { p_opportunity_id: opportunityId })
    if (error) return fail(error, '确认A类演示完成失败')
  },
  async createDraft(opportunityId) {
    const { data, error } = await client.rpc('create_deal_quote_draft', { p_opportunity_id: opportunityId })
    if (error || !data) return fail(error, '创建报价草稿失败')
    return this.getQuote(String(data))
  },
  async getDraftLines(quoteId) {
    const { data, error } = await client.rpc('get_deal_quote_draft_lines', { p_quote_id: quoteId })
    if (error || !data) return fail(error, '读取已保存报价明细失败')
    return (data as RawDraftLine[]).map(mapDraftLine)
  },
  async replaceDraftLines(quoteId, lines) {
    const { data, error } = await client.rpc('replace_deal_quote_lines', { p_quote_id: quoteId, p_lines: lines.map(x => ({ kind: x.kind, source_id: x.sourceId, quantity: x.quantity, customer_price: x.customerPrice })) })
    if (error || !data) return fail(error, '保存报价明细失败')
    return this.getQuote(String(data))
  },
  async setSpecialContent(quoteId, specialContent) {
    const { data, error } = await client.rpc('set_deal_quote_special_content', { p_quote_id: quoteId, p_special_content: specialContent })
    if (error || !data) return fail(error, '保存特殊内容失败')
    return this.getQuote(String(data))
  },
  async listQuotes() {
    const { data, error } = await client.from('deal_quotes').select(quoteSelection).order('updated_at', { ascending: false })
    if (error || !data) return fail(error, '读取报价列表失败')
    return (data as unknown as RawQuote[]).map(mapQuote)
  },
  async getQuote(quoteId) {
    const { data, error } = await client.from('deal_quotes').select(quoteSelection).eq('id', quoteId).single()
    if (error || !data) return fail(error, '读取报价失败')
    return mapQuote(data as unknown as RawQuote)
  },
  async submitQuote(quoteId) {
    const { data, error } = await client.rpc('submit_deal_quote', { p_quote_id: quoteId })
    if (error || !data) return fail(error, '提交报价失败')
    return this.getQuote(String((data as { id: string }).id))
  },
  async decideQuote(quoteId, approved, note) {
    const { data, error } = await client.rpc('decide_deal_quote', { p_quote_id: quoteId, p_approved: approved, p_note: note ?? null })
    if (error || !data) return fail(error, '审批报价失败')
    return this.getQuote(String((data as { id: string }).id))
  },
  async getApproval(quoteId) {
    const { data, error } = await client.rpc('get_deal_quote_approval_state', { p_quote_id: quoteId }).single()
    if (error || !data) return fail(error, '读取审批状态失败')
    const row = data as RawApproval
    return { status: row.status, note: row.note, decidedAt: row.decided_at, canDecide: row.can_decide }
  },
  async confirmDeposit(input) {
    const { data, error } = await client.rpc('confirm_deal_deposit', { p_quote_id: input.quoteId, p_amount: input.amount, p_external_ref: input.externalRef, p_idempotency_key: input.idempotencyKey, p_recipient_type: input.recipientType })
    if (error || !data) return fail(error, '确认定金失败')
    return mapOrder(data as RawOrder)
  },
  async listInternalPayments() {
    const { data, error } = await client.rpc('get_internal_payment_workbench')
    if (error || !data) return fail(error, '读取内部采购款失败')
    return (data as RawInternalPayment[]).map(mapInternalPayment)
  },
  async confirmInternalPayment(input) {
    const { data, error } = await client.rpc('confirm_deal_internal_payment', { p_order_id: input.orderId, p_amount: input.amount, p_method: input.method, p_external_ref: input.externalRef, p_idempotency_key: input.idempotencyKey })
    if (error || !data) return fail(error, '确认内部采购款失败')
    return mapOrder(data as RawOrder)
  },
  async confirmCustomerPayment(input) {
    const { error } = await client.rpc('confirm_order_customer_payment', { p_order_id: input.orderId, p_amount: input.amount, p_recipient_type: input.recipientType, p_external_ref: input.externalRef, p_idempotency_key: input.idempotencyKey })
    if (error) return fail(error, '确认客户款失败')
  },
  async recordProcurementPayment(input) {
    const { error } = await client.rpc('record_deal_procurement_cost', { p_order_id: input.orderId, p_amount: input.amount, p_external_ref: input.externalRef, p_idempotency_key: input.idempotencyKey })
    if (error) return fail(error, '记录内部采购款失败')
  },
  async finalizeSalesMargin(orderId) {
    const { error } = await client.rpc('finalize_order_sales_margin', { p_order_id: orderId })
    if (error) return fail(error, '确认最终价差失败')
  },
})
