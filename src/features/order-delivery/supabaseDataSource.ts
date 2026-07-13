import type { SupabaseClient } from '@supabase/supabase-js'
import { OrderDeliveryDataError, type OrderDeliveryDataSourceReal, type RealHardwareWorkspace, type RealOrderDelivery } from './dataSource'

type AnyRow = Record<string, unknown>
const first = (value: unknown): AnyRow | null => Array.isArray(value) ? (value[0] ?? null) : (value as AnyRow | null)
const rows = (value: unknown): AnyRow[] => Array.isArray(value) ? value as AnyRow[] : []
const fail = (error: { message: string; code?: string } | null, context: string): never => {
  throw new OrderDeliveryDataError(error ? `${context}：${error.message}` : `${context}：服务器未返回数据`, error?.code)
}

const mapOrder = (row: AnyRow): RealOrderDelivery => {
  const quote = first(row.deal_quotes); const opportunity = first(quote?.crm_opportunities); const store = first(opportunity?.crm_stores)
  const delivery = first(row.fulfillment_deliveries); const state = first(delivery?.fulfillment_states); const implementation = first(delivery?.fulfillment_implementation); const handoff = first(delivery?.fulfillment_handoffs); const afterSales = first(row.fulfillment_after_sales_tasks)
  return {
    orderId: String(row.id), orderNumber: String(row.order_number ?? row.id), orderStatus: String(row.status),
    fulfillmentAllowed: Boolean(row.fulfillment_allowed_at) && Number(row.internal_paid) >= Number(row.internal_due), internalDue: Number(row.internal_due), internalPaid: Number(row.internal_paid),
    storeId: String(store?.id ?? delivery?.store_id ?? ''), storeName: String(store?.name ?? '未命名门店'), brandName: first(store?.crm_brands)?.name ? String(first(store?.crm_brands)?.name) : undefined,
    serviceExpiresOn: delivery?.service_expires_on ? String(delivery.service_expires_on) : null, deliveryId: delivery?.id ? String(delivery.id) : null, deliveryStatus: delivery?.status ? String(delivery.status) : null,
    state: state ? { softwareStatus: String(state.software_status), hardwareStatus: String(state.hardware_status) } : null,
    installedAt: implementation?.installed_at ? String(implementation.installed_at) : null, trainedAt: implementation?.trained_at ? String(implementation.trained_at) : null, implementationCompletedAt: implementation?.completed_at ? String(implementation.completed_at) : null,
    afterSalesTask: afterSales ? { dueAt: String(afterSales.due_at), status: String(afterSales.status), groupCreatedAt: afterSales.group_created_at ? String(afterSales.group_created_at) : null, submittedAt: afterSales.submitted_at ? String(afterSales.submitted_at) : null, acceptedAt: afterSales.accepted_at ? String(afterSales.accepted_at) : null } : null,
    handoffId: handoff?.id ? String(handoff.id) : null, handoffStatus: handoff?.status ? String(handoff.status) : null,
    exceptions: rows(delivery?.fulfillment_exceptions).map(x => ({ type: String(x.exception_type), status: String(x.status), details: String(x.details), expectedResolutionOn: x.expected_resolution_on ? String(x.expected_resolution_on) : null })),
    renewals: rows(delivery?.fulfillment_renewal_milestones).map(x => ({ daysBefore: Number(x.days_before), dueOn: String(x.due_on), status: String(x.status) })),
  }
}

export const createSupabaseOrderDeliveryDataSource = (client: SupabaseClient): OrderDeliveryDataSourceReal => {
  const rpc = async (name: string, args: Record<string, unknown>, context: string) => {
    const { error } = await client.rpc(name, args); if (error) fail(error, context)
  }
  return {
    async listOrders() {
      const selection = 'id,order_number,status,fulfillment_allowed_at,internal_due,internal_paid,fulfillment_after_sales_tasks(due_at,status,group_created_at,submitted_at,accepted_at),deal_quotes!inner(crm_opportunities!inner(crm_stores!inner(id,name,crm_brands(name)))),fulfillment_deliveries(id,store_id,status,service_expires_on,fulfillment_states(software_status,hardware_status),fulfillment_exceptions(exception_type,status,details,expected_resolution_on),fulfillment_implementation(installed_at,trained_at,completed_at),fulfillment_handoffs(id,status),fulfillment_renewal_milestones(days_before,due_on,status))'
      const { data, error } = await client.from('deal_orders').select(selection).order('created_at', { ascending: false })
      if (error || !data) return fail(error, '读取订单履约失败')
      return (data as unknown as AnyRow[]).map(mapOrder)
    },
    createDelivery: (orderId, storeId, serviceExpiresOn) => rpc('create_order_delivery', { p_order_id: orderId, p_store_id: storeId, p_service_expires_on: serviceExpiresOn }, '建立履约失败'),
    activateSoftware: deliveryId => rpc('set_delivery_software_active', { p_delivery_id: deliveryId }, '软件开通失败'),
    completeHardware: deliveryId => rpc('complete_delivery_hardware', { p_delivery_id: deliveryId }, '硬件完成失败'),
    async loadHardwareWorkspace(deliveryId) {
      const { data, error } = await client.rpc('get_delivery_hardware_workspace', { p_delivery_id: deliveryId })
      if (error || !data) return fail(error, '读取订单硬件工作区失败')
      const payload = data as AnyRow
      const workspace: RealHardwareWorkspace = {
        canManage: Boolean(payload.can_manage),
        lockedReason: payload.locked_reason ? String(payload.locked_reason) : null,
        requirements: rows(payload.requirements).map(row => ({ catalogItemId: String(row.catalog_item_id), name: String(row.name), sku: String(row.sku), requiredQuantity: Number(row.required_quantity), allocatedQuantity: Number(row.allocated_quantity) })),
        stocks: rows(payload.stocks).map(row => ({ id: String(row.id), name: String(row.name), sku: String(row.sku), quantity: Number(row.quantity), reservedQuantity: Number(row.reserved_quantity), availableQuantity: Number(row.available_quantity) })),
        reservations: rows(payload.reservations).map(row => ({ id: String(row.id), stockId: String(row.stock_id), itemName: String(row.item_name), quantity: Number(row.quantity), status: String(row.status) })),
      }
      return workspace
    },
    reserveStock: (deliveryId, stockId, quantity, expectedOn, idempotencyKey) => rpc('reserve_delivery_stock', { p_delivery_id: deliveryId, p_stock_id: stockId, p_quantity: quantity, p_expected_on: expectedOn, p_idempotency_key: idempotencyKey }, '准备硬件库存失败'),
    shipStock: reservationId => rpc('ship_delivery_stock', { p_reservation_id: reservationId }, '硬件出库失败'),
    markImplementation: (deliveryId, step, idempotencyKey) => rpc('mark_delivery_implementation', { p_delivery_id: deliveryId, p_step: step, p_idempotency_key: idempotencyKey }, step === 'installation' ? '安装确认失败' : '培训确认失败'),
    submitAfterSales: (orderId, checklist, idempotencyKey) => rpc('submit_after_sales_handoff', { p_order_id: orderId, p_checklist: checklist, p_idempotency_key: idempotencyKey }, '售后群与交接清单提交失败'),
    confirmAfterSales: (orderId, idempotencyKey) => rpc('confirm_after_sales_handoff', { p_order_id: orderId, p_idempotency_key: idempotencyKey }, '运维确认接手失败'),
    setServiceExpiry: (deliveryId, serviceExpiresOn, reason, idempotencyKey) => rpc('set_delivery_service_expiry', { p_delivery_id: deliveryId, p_service_expires_on: serviceExpiresOn, p_reason: reason, p_idempotency_key: idempotencyKey }, '服务到期日保存失败'),
    createHandoff: deliveryId => rpc('create_delivery_handoff', { p_delivery_id: deliveryId, p_checklist: { standard_handoff: true } }, '创建售后交接失败'),
    confirmHandoff: handoffId => rpc('confirm_delivery_handoff', { p_handoff_id: handoffId }, '运维确认接手失败'),
  }
}
