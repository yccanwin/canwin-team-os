import type { SupabaseClient } from '@supabase/supabase-js'
import { OrderDeliveryDataError, type OrderDeliveryDataSourceReal, type RealHardwareWorkspace, type RealOrderDelivery } from './dataSource'

type AnyRow = Record<string, unknown>
const first = (value: unknown): AnyRow | null => Array.isArray(value) ? (value[0] ?? null) : (value as AnyRow | null)
const rows = (value: unknown): AnyRow[] => Array.isArray(value) ? value as AnyRow[] : []
const fail = (error: { message: string; code?: string } | null, context: string): never => { throw new OrderDeliveryDataError(error ? `${context}：${error.message}` : `${context}：服务器未返回数据`, error?.code) }

const mapOrder = (row: AnyRow): RealOrderDelivery => {
  const quote = first(row.deal_quotes); const opportunity = first(quote?.crm_opportunities); const store = first(opportunity?.crm_stores)
  const delivery = first(row.fulfillment_deliveries); const state = first(delivery?.fulfillment_states); const implementation = first(delivery?.fulfillment_implementation); const handoff = first(delivery?.fulfillment_handoffs)
  return {
    orderId: String(row.id), orderStatus: String(row.status), storeId: String(store?.id ?? delivery?.store_id ?? ''), storeName: String(store?.name ?? '门店名称不可见'), brandName: first(store?.crm_brands)?.name ? String(first(store?.crm_brands)?.name) : undefined,
    serviceExpiresOn: delivery?.service_expires_on ? String(delivery.service_expires_on) : null, deliveryId: delivery?.id ? String(delivery.id) : null, deliveryStatus: delivery?.status ? String(delivery.status) : null,
    state: state ? { softwareStatus: String(state.software_status), hardwareStatus: String(state.hardware_status) } : null,
    installedAt: implementation?.installed_at ? String(implementation.installed_at) : null, trainedAt: implementation?.trained_at ? String(implementation.trained_at) : null, handoffId: handoff?.id ? String(handoff.id) : null, handoffStatus: handoff?.status ? String(handoff.status) : null,
    exceptions: rows(delivery?.fulfillment_exceptions).map(x => ({ type: String(x.exception_type), status: String(x.status), details: String(x.details), expectedResolutionOn: x.expected_resolution_on ? String(x.expected_resolution_on) : null })),
    renewals: rows(delivery?.fulfillment_renewal_milestones).map(x => ({ daysBefore: Number(x.days_before), dueOn: String(x.due_on), status: String(x.status) })),
  }
}

export const createSupabaseOrderDeliveryDataSource = (client: SupabaseClient): OrderDeliveryDataSourceReal => {
  const rpc = async (name: string, args: Record<string, unknown>, context: string) => { const { error } = await client.rpc(name, args); if (error) fail(error, context) }
  return {
    async listOrders() {
      const selection = 'id,status,deal_quotes!inner(crm_opportunities!inner(crm_stores!inner(id,name,crm_brands(name)))),fulfillment_deliveries(id,store_id,status,service_expires_on,fulfillment_states(software_status,hardware_status),fulfillment_exceptions(exception_type,status,details,expected_resolution_on),fulfillment_implementation(installed_at,trained_at),fulfillment_handoffs(id,status),fulfillment_renewal_milestones(days_before,due_on,status))'
      const { data, error } = await client.from('deal_orders').select(selection).order('created_at', { ascending: false })
      if (error || !data) return fail(error, '读取订单履约失败')
      return (data as unknown as AnyRow[]).map(mapOrder)
    },
    createDelivery: (orderId, storeId, serviceExpiresOn) => rpc('create_order_delivery', { p_order_id: orderId, p_store_id: storeId, p_service_expires_on: serviceExpiresOn }, '创建交付失败'),
    activateSoftware: deliveryId => rpc('set_delivery_software_active', { p_delivery_id: deliveryId }, '软件开通失败'),
    completeHardware: deliveryId => rpc('complete_delivery_hardware', { p_delivery_id: deliveryId }, '硬件完成失败'),
    async loadHardwareWorkspace(deliveryId) {
      const [{ data: access, error: accessError }, { data: stocks, error: stockError }, { data: reservations, error: reservationError }] = await Promise.all([
        client.rpc('can_manage_delivery_hardware'),
        client.from('fulfillment_inventory_stock').select('id,quantity,reserved_quantity,deal_catalog_items(name,sku)').order('updated_at', { ascending: false }),
        client.from('fulfillment_inventory_reservations').select('id,stock_id,quantity,status,fulfillment_inventory_stock(deal_catalog_items(name,sku))').eq('delivery_id', deliveryId).order('created_at', { ascending: false }),
      ])
      if (accessError) fail(accessError, '读取硬件操作权限失败')
      const canManage = access === true
      if (canManage && stockError) fail(stockError, '读取真实库存失败')
      if (canManage && reservationError) fail(reservationError, '读取库存预留失败')
      const workspace: RealHardwareWorkspace = {
        canManage,
        stocks: canManage ? (stocks ?? []).map((row: AnyRow) => { const item = first(row.deal_catalog_items); const quantity = Number(row.quantity); const reservedQuantity = Number(row.reserved_quantity); return { id: String(row.id), name: String(item?.name ?? '未命名硬件'), sku: String(item?.sku ?? '-'), quantity, reservedQuantity, availableQuantity: quantity - reservedQuantity } }) : [],
        reservations: canManage ? (reservations ?? []).map((row: AnyRow) => { const stock = first(row.fulfillment_inventory_stock); const item = first(stock?.deal_catalog_items); return { id: String(row.id), stockId: String(row.stock_id), itemName: String(item?.name ?? '硬件'), quantity: Number(row.quantity), status: String(row.status) } }) : [],
      }
      return workspace
    },
    reserveStock: (deliveryId, stockId, quantity, expectedOn) => rpc('reserve_delivery_stock', { p_delivery_id: deliveryId, p_stock_id: stockId, p_quantity: quantity, p_expected_on: expectedOn }, '库存预留失败'),
    shipStock: reservationId => rpc('ship_delivery_stock', { p_reservation_id: reservationId }, '硬件出库失败'),
    markImplementation: (deliveryId, step) => rpc('mark_delivery_implementation', { p_delivery_id: deliveryId, p_step: step }, step === 'installation' ? '安装确认失败' : '培训确认失败'),
    createHandoff: deliveryId => rpc('create_delivery_handoff', { p_delivery_id: deliveryId, p_checklist: { standard_handoff: true } }, '创建售后交接失败'),
    confirmHandoff: handoffId => rpc('confirm_delivery_handoff', { p_handoff_id: handoffId }, '运维确认接手失败'),
  }
}
