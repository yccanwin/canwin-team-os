export interface SupervisorExceptionRecord {
  entityId: string
  ownerId: string
  itemType: 'action_exception' | 'closing_opportunity'
  ownerName: string
  entityType: string
  actionType: string
  dueAt: string
  title: string
  urgency: string
}

export interface ManagementBoardDataSource {
  listExceptions(): Promise<SupervisorExceptionRecord[]>
  resolveException(input: { itemType: SupervisorExceptionRecord['itemType']; entityId: string; ownerId: string; dueAt: string; note: string }): Promise<void>
}

export class ManagementBoardDataError extends Error {
  constructor(message: string, readonly code?: string) { super(message); this.name = 'ManagementBoardDataError' }
}
