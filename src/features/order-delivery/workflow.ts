import type { DeliveryOrder, DemoOrderAction, DemoTransitionResult, FulfillmentStatus, OrderStage } from './types'

export const stageLabels: Record<OrderStage, string> = {
  deposit_pending: '待定金',
  internal_payment_pending: '待内部款',
  fulfilling: '履约中',
  installing: '安装培训',
  handover_pending: '待售后交接',
  active: '服务中',
  renewal_due: '待续费',
}

export const fulfillmentLabels: Record<FulfillmentStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  blocked: '异常',
  completed: '已完成',
}

export const getOrderAlerts = (order: DeliveryOrder): string[] => {
  const alerts: string[] = []
  if (order.stockExceptions.length > 0) alerts.push('存在缺货异常')
  if (order.stage === 'deposit_pending') alerts.push('财务尚未确认定金')
  if (order.stage === 'internal_payment_pending') alerts.push('内部采购款未结清，禁止开始履约')
  if (order.stage === 'renewal_due') alerts.push(`续费节点：${order.milestones.renewalDate ?? '日期待确认'}`)
  return alerts
}

const cloneOrder = (order: DeliveryOrder): DeliveryOrder => structuredClone(order)

export const applyDemoAction = (source: DeliveryOrder, action: DemoOrderAction): DemoTransitionResult => {
  const order = cloneOrder(source)
  const success = (message: string): DemoTransitionResult => ({ ok: true, order, message })
  const blocked = (message: string): DemoTransitionResult => ({ ok: false, order: source, message })
  const m = order.milestones

  if (action !== 'confirm_deposit' && !m.depositConfirmed) return blocked('请先由财务确认定金（当前仅为本地演示）')
  if (!['confirm_deposit', 'confirm_internal_payment'].includes(action) && !m.internalPaymentConfirmed) return blocked('内部款未确认，禁止开始履约')

  switch (action) {
    case 'confirm_deposit':
      m.depositConfirmed = true; order.stage = 'internal_payment_pending'; return success('演示：定金已标记确认')
    case 'confirm_internal_payment':
      m.internalPaymentConfirmed = true; order.stage = 'fulfilling'; return success('演示：内部款已标记确认，可以开始履约')
    case 'complete_software':
      m.software.status = 'completed'; return success('演示：软件履约完成')
    case 'complete_hardware':
      if (order.stockExceptions.length > 0) return blocked('存在缺货异常，硬件不能完成')
      m.hardware.status = 'completed'; return success('演示：硬件履约完成')
    case 'complete_installation':
      if (m.software.status !== 'completed' || m.hardware.status !== 'completed') return blocked('软件和硬件履约均完成后才能完成安装')
      m.installation.status = 'completed'; order.stage = 'installing'; return success('演示：安装完成')
    case 'complete_training':
      if (m.software.status !== 'completed' || m.hardware.status !== 'completed') return blocked('软件和硬件履约均完成后才能完成培训')
      m.training.status = 'completed'; order.stage = 'installing'; return success('演示：培训完成')
    case 'complete_handover':
      if (m.installation.status !== 'completed' || m.training.status !== 'completed') return blocked('安装和培训均完成后才能售后交接')
      m.afterSalesHandover.status = 'completed'; order.stage = 'handover_pending'; return success('演示：售后交接清单完成，等待运维确认')
    case 'confirm_operations_acceptance':
      if (m.afterSalesHandover.status !== 'completed') return blocked('售后交接未完成，运维不能确认接手')
      m.operationsAccepted = true; order.stage = 'active'; return success('演示：运维已确认接手，订单进入服务中')
  }
}
