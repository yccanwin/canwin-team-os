export type ExceptionType = 'overdue' | 'blocked' | 'closing_soon'
export type BoardItemStatus = 'open' | 'handled'

export interface ManagementBoardItem {
  id: string
  customerName: string
  opportunityName: string
  ownerName: string
  deadline: string
  exceptionType: ExceptionType
  status: BoardItemStatus
  blocker?: string
  quoteIssued: boolean
  decisionDate?: string
  handledNote?: string
}

export type BoardFilter = 'meeting' | ExceptionType | 'handled'
