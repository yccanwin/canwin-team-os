// ---------- 日历事件 ----------
export interface CalendarEvent {
  id: string
  title: string
  description?: string
  startDate: string        // YYYY-MM-DD
  endDate?: string         // YYYY-MM-DD，单日事件不填
  startTime?: string       // HH:mm，可选
  endTime?: string         // HH:mm，可选
  creatorId: string
  creatorName: string
  color?: string           // 事件颜色，预设或自定义
  createdAt: string
  type: 'schedule' | 'task' | 'meeting' | 'other'
}
