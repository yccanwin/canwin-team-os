export type FulfillmentStatus = 'not_started' | 'in_progress' | 'blocked' | 'completed'

export type OrderStage =
  | 'deposit_pending'
  | 'internal_payment_pending'
  | 'fulfilling'
  | 'installing'
  | 'handover_pending'
  | 'active'
  | 'renewal_due'

export interface FulfillmentTrack {
  status: FulfillmentStatus
  completedAt?: string
  note?: string
}

export interface StockException {
  productName: string
  shortageQuantity: number
  expectedArrivalDate?: string
}

export interface DeliveryMilestones {
  depositConfirmed: boolean
  internalPaymentConfirmed: boolean
  software: FulfillmentTrack
  hardware: FulfillmentTrack
  installation: FulfillmentTrack
  training: FulfillmentTrack
  afterSalesHandover: FulfillmentTrack
  operationsAccepted: boolean
  renewalDate?: string
}

export type DemoOrderAction =
  | 'confirm_deposit'
  | 'confirm_internal_payment'
  | 'complete_software'
  | 'complete_hardware'
  | 'complete_installation'
  | 'complete_training'
  | 'complete_handover'
  | 'confirm_operations_acceptance'

export interface DemoTransitionResult {
  ok: boolean
  order: DeliveryOrder
  message: string
}

export interface DeliveryOrder {
  id: string
  orderNumber: string
  customerName: string
  storeName: string
  ownerName: string
  stage: OrderStage
  createdAt: string
  milestones: DeliveryMilestones
  stockExceptions: StockException[]
}

export interface OrderDeliveryDataSource {
  listOrders(): Promise<DeliveryOrder[]>
}
