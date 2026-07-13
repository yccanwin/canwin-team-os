import type { SupabaseClient } from '@supabase/supabase-js'
import { ManagementBoardDataError, type ManagementBoardDataSource, type PerformanceRecord, type ProfitSummaryRecord, type ReconciliationBatchRecord, type SupervisorExceptionRecord, type SupervisorMarginRecord } from './dataSource'

type RawException = { entity_id: string; owner_id: string; item_type: 'action_exception' | 'closing_opportunity'; due_at: string; title: string; details: string }
type RawPerformance = { profile_id: string; profile_name: string; quarter_start: string; points_target: number | string; estimated_points: number | string; official_points: number | string; new_gmv_target: number | string; new_gmv_actual: number | string; renewal_gmv_target: number | string; renewal_gmv_actual: number | string; monthly_observations: Array<{ month_start: string; estimated_points: number | string; official_points: number | string; new_gmv: number | string; renewal_gmv: number | string }>; can_set_target: boolean }
type RawBatch = { batch_id: string; quarter_start: string; source_ref: string; status: string; line_count: number | string; created_at: string; confirmed_at: string | null }
type RawProfit = { quarter_start: string; forecast_profit: number | string; actual_profit: number | string; actual_receipts: number | string; refund_reversals: number | string; procurement_payments: number | string; sales_expenses: number | string; quarterly_rebates: number | string; company_expenses: number | string; can_view_details: boolean }
type RawMargin = { order_id: string; order_number: string; owner_name: string; sales_margin: number | string; created_at: string }

const fail = (error: { message: string; code?: string } | null, context: string): never => { throw new ManagementBoardDataError(error ? `${context}：${error.message}` : `${context}：服务器未返回数据`, error?.code) }
const mapPerformance = (row: RawPerformance): PerformanceRecord => ({ profileId: row.profile_id, profileName: row.profile_name, quarterStart: row.quarter_start, pointsTarget: Number(row.points_target), estimatedPoints: Number(row.estimated_points), officialPoints: Number(row.official_points), newGmvTarget: Number(row.new_gmv_target), newGmvActual: Number(row.new_gmv_actual), renewalGmvTarget: Number(row.renewal_gmv_target), renewalGmvActual: Number(row.renewal_gmv_actual), monthlyObservations: (row.monthly_observations ?? []).map(item => ({ monthStart: item.month_start, estimatedPoints: Number(item.estimated_points), officialPoints: Number(item.official_points), newGmv: Number(item.new_gmv), renewalGmv: Number(item.renewal_gmv) })), canSetTarget: row.can_set_target })

export const createSupabaseManagementBoardDataSource = (client: SupabaseClient): ManagementBoardDataSource => ({
  async listExceptions(): Promise<SupervisorExceptionRecord[]> {
    const { data, error } = await client.from('crm_supervisor_board').select('entity_id,owner_id,item_type,due_at,title,details').order('due_at', { ascending: true })
    if (error || !data) return fail(error, '读取主管异常失败')
    const rows = data as RawException[]
    const ownerIds = [...new Set(rows.map(row => row.owner_id))]
    const names = new Map<string, string>()
    if (ownerIds.length > 0) {
      const { data: profiles, error: profileError } = await client.from('profiles').select('id,name').in('id', ownerIds)
      if (profileError) throw new ManagementBoardDataError(`读取负责人失败：${profileError.message}`, profileError.code)
      for (const profile of profiles ?? []) names.set(String(profile.id), String(profile.name))
    }
    return rows.map(row => ({ entityId: row.entity_id, ownerId: row.owner_id, itemType: row.item_type, ownerName: names.get(row.owner_id) ?? '负责人名称不可见', entityType: row.item_type, actionType: row.details, dueAt: row.due_at, title: row.title, urgency: row.item_type === 'closing_opportunity' ? '7天内决策' : '异常' }))
  },
  async resolveException(input) {
    const { error } = await client.rpc('resolve_supervisor_exception', { p_item_type: input.itemType, p_entity_id: input.entityId, p_owner_id: input.ownerId, p_resolution_due_at: input.dueAt, p_resolution_note: input.note, p_idempotency_key: input.idempotencyKey })
    if (error) throw new ManagementBoardDataError(`提交处置失败：${error.message}`, error.code)
  },
  async listPerformance(quarterStart) { const { data, error } = await client.rpc('get_performance_management_dashboard', { p_quarter_start: quarterStart }); if (error || !data) return fail(error, '读取目标失败'); return (data as RawPerformance[]).map(mapPerformance) },
  async setQuarterTarget(input) { const { error } = await client.rpc('set_quarterly_performance_target', { p_profile_id: input.profileId, p_quarter_start: input.quarterStart, p_points_target: input.pointsTarget, p_new_gmv_target: input.newGmvTarget, p_renewal_gmv_target: input.renewalGmvTarget }); if (error) return fail(error, '保存季度目标失败') },
  async saveMonthlyObservation(input) { const { error } = await client.rpc('record_monthly_performance_observation', { p_month_start: input.monthStart, p_estimated_points: input.estimatedPoints, p_new_gmv: input.newGmv, p_renewal_gmv: input.renewalGmv, p_idempotency_key: input.idempotencyKey }); if (error) return fail(error, '保存月度观察失败') },
  async listReconciliations() { const { data, error } = await client.rpc('get_official_reconciliation_batches'); if (error || !data) return fail(error, '读取官方对账失败'); return (data as RawBatch[]).map((row): ReconciliationBatchRecord => ({ batchId: row.batch_id, quarterStart: row.quarter_start, sourceRef: row.source_ref, status: row.status, lineCount: Number(row.line_count), createdAt: row.created_at, confirmedAt: row.confirmed_at })) },
  async createReconciliation(input) { const { error } = await client.rpc('create_official_reconciliation', { p_quarter_start: input.quarterStart, p_source_ref: input.sourceRef, p_lines: input.lines }); if (error) return fail(error, '导入官方对账失败') },
  async confirmReconciliation(batchId) { const { error } = await client.rpc('confirm_official_reconciliation', { p_batch_id: batchId }); if (error) return fail(error, '确认官方对账失败') },
  async listProfitSummary() { const { data, error } = await client.rpc('get_management_profit_summary'); if (error || !data) return fail(error, '读取利润汇总失败'); return (data as RawProfit[]).map((row): ProfitSummaryRecord => ({ quarterStart: row.quarter_start, forecastProfit: Number(row.forecast_profit), actualProfit: Number(row.actual_profit), actualReceipts: Number(row.actual_receipts), refundReversals: Number(row.refund_reversals), procurementPayments: Number(row.procurement_payments), salesExpenses: Number(row.sales_expenses), quarterlyRebates: Number(row.quarterly_rebates), companyExpenses: Number(row.company_expenses), canViewDetails: row.can_view_details })) },
  async addProfitAdjustment(input) { const { error } = await client.rpc('add_profit_adjustment', { p_type: input.type, p_amount: input.amount, p_effective_on: input.effectiveOn, p_reason: input.reason, p_idempotency_key: input.idempotencyKey }); if (error) return fail(error, '追加利润调整失败') },
  async listSupervisorMargins() { const { data, error } = await client.rpc('get_supervisor_order_margins'); if (error) { if (error.code === '42501') return []; return fail(error, '读取下属订单价差失败') } return ((data ?? []) as RawMargin[]).map((row): SupervisorMarginRecord => ({ orderId: row.order_id, orderNumber: row.order_number, ownerName: row.owner_name, salesMargin: Number(row.sales_margin), createdAt: row.created_at })) },
})
