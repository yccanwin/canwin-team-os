import type { ManagementBoardItem } from './types'

export const managementBoardDemoItems: ManagementBoardItem[] = [
  { id: 'mb-1', customerName: '北城小馆（演示）', opportunityName: '新店系统项目', ownerName: '销售甲', deadline: '2026-07-12', exceptionType: 'overdue', status: 'open', quoteIssued: false },
  { id: 'mb-2', customerName: '江畔火锅（演示）', opportunityName: '三店连锁升级', ownerName: '销售乙', deadline: '2026-07-14', exceptionType: 'blocked', status: 'open', blocker: '关键人尚未确认方案', quoteIssued: true, decisionDate: '2026-07-18' },
  { id: 'mb-3', customerName: '麦田烘焙（演示）', opportunityName: '年度续费', ownerName: '销售丙', deadline: '2026-07-16', exceptionType: 'closing_soon', status: 'open', quoteIssued: true, decisionDate: '2026-07-16' },
  { id: 'mb-4', customerName: '南湖茶饮（演示）', opportunityName: '收银设备加购', ownerName: '销售甲', deadline: '2026-07-30', exceptionType: 'closing_soon', status: 'open', quoteIssued: true, decisionDate: '2026-07-30' },
]
