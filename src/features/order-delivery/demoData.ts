import type { DeliveryOrder, OrderDeliveryDataSource } from './types'

export const demoOrders: DeliveryOrder[] = [
  {
    id: 'demo-001', orderNumber: '演示单-CW3001', customerName: '东街餐饮（演示）', storeName: '中心店', ownerName: '销售甲', stage: 'deposit_pending', createdAt: '2026-07-13', stockExceptions: [],
    milestones: { depositConfirmed: false, internalPaymentConfirmed: false, software: { status: 'not_started' }, hardware: { status: 'not_started' }, installation: { status: 'not_started' }, training: { status: 'not_started' }, afterSalesHandover: { status: 'not_started' }, operationsAccepted: false },
  },
  {
    id: 'demo-002', orderNumber: '演示单-CW3002', customerName: '麦香烘焙（演示）', storeName: '湖滨店', ownerName: '销售乙', stage: 'internal_payment_pending', createdAt: '2026-07-12', stockExceptions: [],
    milestones: { depositConfirmed: true, internalPaymentConfirmed: false, software: { status: 'not_started' }, hardware: { status: 'not_started' }, installation: { status: 'not_started' }, training: { status: 'not_started' }, afterSalesHandover: { status: 'not_started' }, operationsAccepted: false },
  },
  {
    id: 'demo-003', orderNumber: '演示单-CW3003', customerName: '川味小馆（演示）', storeName: '旗舰店', ownerName: '销售甲', stage: 'fulfilling', createdAt: '2026-07-10',
    stockExceptions: [{ productName: '前台打印机', shortageQuantity: 1, expectedArrivalDate: '2026-07-18' }],
    milestones: { depositConfirmed: true, internalPaymentConfirmed: true, software: { status: 'completed', completedAt: '2026-07-12' }, hardware: { status: 'blocked', note: '打印机缺货' }, installation: { status: 'not_started' }, training: { status: 'not_started' }, afterSalesHandover: { status: 'not_started' }, operationsAccepted: false },
  },
  {
    id: 'demo-004', orderNumber: '演示单-CW3004', customerName: '海湾火锅（演示）', storeName: '新城店', ownerName: '销售丙', stage: 'installing', createdAt: '2026-07-08', stockExceptions: [],
    milestones: { depositConfirmed: true, internalPaymentConfirmed: true, software: { status: 'completed' }, hardware: { status: 'completed' }, installation: { status: 'completed' }, training: { status: 'in_progress', note: '店长培训待完成' }, afterSalesHandover: { status: 'not_started' }, operationsAccepted: false },
  },
  {
    id: 'demo-005', orderNumber: '演示单-CW3005', customerName: '青禾茶饮（演示）', storeName: '大学城店', ownerName: '销售乙', stage: 'handover_pending', createdAt: '2026-07-05', stockExceptions: [],
    milestones: { depositConfirmed: true, internalPaymentConfirmed: true, software: { status: 'completed' }, hardware: { status: 'completed' }, installation: { status: 'completed' }, training: { status: 'completed' }, afterSalesHandover: { status: 'in_progress', note: '等待运维确认接手' }, operationsAccepted: false },
  },
  {
    id: 'demo-006', orderNumber: '演示单-CW3006', customerName: '南山宴会中心（演示）', storeName: '总店', ownerName: '销售甲', stage: 'renewal_due', createdAt: '2025-08-01', stockExceptions: [],
    milestones: { depositConfirmed: true, internalPaymentConfirmed: true, software: { status: 'completed' }, hardware: { status: 'completed' }, installation: { status: 'completed' }, training: { status: 'completed' }, afterSalesHandover: { status: 'completed' }, operationsAccepted: true, renewalDate: '2026-08-01' },
  },
]

export const demoOrderDeliveryDataSource: OrderDeliveryDataSource = {
  async listOrders() { return demoOrders },
}
