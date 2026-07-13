import type { BoardFilter, ManagementBoardItem } from './types'

const DAY_MS = 86_400_000

export const isClosingWithinSevenDays = (item: ManagementBoardItem, today: string) => {
  if (!item.quoteIssued || !item.decisionDate) return false
  const days = (new Date(`${item.decisionDate}T00:00:00+08:00`).getTime() - new Date(`${today}T00:00:00+08:00`).getTime()) / DAY_MS
  return days >= 0 && days <= 7
}

export const isSalesMeetingItem = (item: ManagementBoardItem, today: string) =>
  item.status === 'open' && (
    item.exceptionType === 'overdue' ||
    item.exceptionType === 'blocked' ||
    (item.exceptionType === 'closing_soon' && isClosingWithinSevenDays(item, today))
  )

export const filterBoardItems = (items: ManagementBoardItem[], filter: BoardFilter, today: string) => {
  if (filter === 'meeting') return items.filter(item => isSalesMeetingItem(item, today))
  if (filter === 'handled') return items.filter(item => item.status === 'handled')
  return items.filter(item => item.status === 'open' && item.exceptionType === filter)
}

export const handleLocally = (item: ManagementBoardItem, note: string): ManagementBoardItem => ({
  ...item,
  status: 'handled',
  handledNote: note,
})
