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
  type:
    | 'rest_day'
    | 'task_deadline'
    | 'personal_goal_deadline'
    | 'team_goal_deadline'
    | 'visit'
    | 'store_check'
    | 'inventory_check'
    | 'team_activity'
    | 'finance_day'
    | 'meeting'
    | 'schedule'
    | 'task'
    | 'other'
}
