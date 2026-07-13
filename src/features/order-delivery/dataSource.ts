export interface RealDeliveryState { softwareStatus: string; hardwareStatus: string }
export interface RealDeliveryException { type: string; status: string; details: string; expectedResolutionOn: string | null }
export interface RealRenewalMilestone { daysBefore: number; dueOn: string; status: string }
export interface RealAfterSalesTask { dueAt: string; status: string; groupCreatedAt: string | null; submittedAt: string | null; acceptedAt: string | null }
export interface RealInventoryStock { id: string; name: string; sku: string; quantity: number; reservedQuantity: number; availableQuantity: number }
export interface RealInventoryReservation { id: string; stockId: string; itemName: string; quantity: number; status: string }
export interface RealHardwareRequirement { catalogItemId: string; name: string; sku: string; requiredQuantity: number; allocatedQuantity: number }
export interface RealHardwareWorkspace { canManage: boolean; lockedReason: string | null; requirements: RealHardwareRequirement[]; stocks: RealInventoryStock[]; reservations: RealInventoryReservation[] }
export interface RealOrderDelivery {
  orderId: string; orderNumber: string; orderStatus: string; storeId: string; storeName: string; brandName?: string; serviceExpiresOn: string | null
  fulfillmentAllowed: boolean; internalDue: number; internalPaid: number
  deliveryId: string | null; deliveryStatus: string | null; state: RealDeliveryState | null
  installedAt: string | null; trainedAt: string | null; implementationCompletedAt: string | null; handoffId: string | null; handoffStatus: string | null
  afterSalesTask: RealAfterSalesTask | null
  exceptions: RealDeliveryException[]; renewals: RealRenewalMilestone[]
}

export interface OrderDeliveryDataSourceReal {
  listOrders(): Promise<RealOrderDelivery[]>
  createDelivery(orderId: string, storeId: string, serviceExpiresOn: string | null): Promise<void>
  activateSoftware(deliveryId: string): Promise<void>
  completeHardware(deliveryId: string): Promise<void>
  loadHardwareWorkspace(deliveryId: string): Promise<RealHardwareWorkspace>
  reserveStock(deliveryId: string, stockId: string, quantity: number, expectedOn: string, idempotencyKey: string): Promise<void>
  shipStock(reservationId: string): Promise<void>
  markImplementation(deliveryId: string, step: 'installation' | 'training', idempotencyKey: string): Promise<void>
  submitAfterSales(orderId: string, checklist: Record<string, boolean>, idempotencyKey: string): Promise<void>
  confirmAfterSales(orderId: string, idempotencyKey: string): Promise<void>
  setServiceExpiry(deliveryId: string, serviceExpiresOn: string, reason: string, idempotencyKey: string): Promise<void>
  createHandoff(deliveryId: string): Promise<void>
  confirmHandoff(handoffId: string): Promise<void>
}

export class OrderDeliveryDataError extends Error {
  constructor(message: string, readonly code?: string) { super(message); this.name = 'OrderDeliveryDataError' }
}
