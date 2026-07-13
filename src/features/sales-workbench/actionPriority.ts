import type { SalesActionPriority, SalesLead } from './types'

export interface PrioritizedLead {
  lead: SalesLead
  priority: SalesActionPriority
  rank: number
  label: string
  ageHours?: number
}
const labels: Record<SalesActionPriority, string> = {
  overdue_appointment: '逾期预约',
  upcoming_appointment: '临近预约',
  today_followup: '今日跟进',
  new_lead: '新线索',
  recycle_risk: '48h 回收风险',
}

export function prioritizeLead(lead: SalesLead, now = new Date()): PrioritizedLead {
  const next = lead.nextActionAt ? new Date(lead.nextActionAt) : null
  const nextValid = next && !Number.isNaN(next.getTime()) ? next : null
  const created = new Date(lead.createdAt)
  const ageHours = Number.isNaN(created.getTime()) ? undefined : Math.max(0, (now.getTime() - created.getTime()) / 3_600_000)
  let priority: SalesActionPriority
  if (nextValid && nextValid.getTime() < now.getTime()) priority = 'overdue_appointment'
  else if (nextValid && nextValid.getTime() - now.getTime() <= 2 * 3_600_000) priority = 'upcoming_appointment'
  else if (nextValid && nextValid.toDateString() === now.toDateString()) priority = 'today_followup'
  else if (ageHours === undefined || ageHours < 48) priority = 'new_lead'
  else priority = 'recycle_risk'
  const rank = ['overdue_appointment', 'upcoming_appointment', 'today_followup', 'new_lead', 'recycle_risk'].indexOf(priority) + 1
  return { lead, priority, rank, label: labels[priority], ageHours }
}
