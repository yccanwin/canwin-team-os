import type { CustomerBrandSummary, PersonalSalesWorkspace, SalesLead, WorkbenchSummary } from './types'

export const mockSummary: WorkbenchSummary = {
  appointments: 2,
  overdue: 1,
  newLeads: 6,
  recycleRisks: 2,
}

export const mockLeads: SalesLead[] = [
  {
    id: 'lead-001',
    storeName: '盐城湖畔宴会中心',
    contactName: '王经理',
    phone: '138****6621',
    district: '盐都区',
    businessType: '宴会',
    source: '老客户转介绍',
    createdAt: '今天 09:10',
    stage: 'new',
    facts: [],
  },
  {
    id: 'lead-002',
    storeName: '灶里巷中餐厅',
    contactName: '陈老板',
    phone: '159****1870',
    district: '亭湖区',
    businessType: '中餐',
    source: '销售新增',
    createdAt: '昨天 16:40',
    nextActionAt: '今天 15:30',
    stage: 'contacted',
    facts: ['新店预计下月18日开业'],
  },
]

export const mockCustomers: CustomerBrandSummary[] = [
  {
    id: 'brand-demo-1',
    name: '湖畔餐饮',
    stores: [
      { id: 'store-demo-1', name: '湖畔宴会中心', district: '盐都区', businessType: '宴会', contacts: [{ id: 'contact-demo-1', name: '王经理', role: '店长' }] },
      { id: 'store-demo-2', name: '湖畔中餐厅', district: '亭湖区', businessType: '中餐', contacts: [{ id: 'contact-demo-2', name: '李总', role: '负责人' }] },
    ],
  },
]

export const mockPersonalWorkspace: PersonalSalesWorkspace = {
  profileId: 'profile-demo-1', displayName: '销售演示账号', quarterStart: '2026-07-01', quarterEnd: '2026-09-30', quarterLabel: '2026 Q3',
  target: {
    id: 'target-demo-1', pointTarget: 3600, estimatedPoints: 2480, officialPoints: 2160,
    newGmvTarget: 300000, newGmvActual: 186000, renewalGmvTarget: 120000, renewalGmvActual: 74000, updatedAt: '2026-07-13T00:00:00Z',
  },
  monthlyObservations: [
    { monthStart: '2026-07-01', monthLabel: '2026-07', newGmv: 186000, renewalGmv: 74000, officialPoints: 2160 },
    { monthStart: '2026-08-01', monthLabel: '2026-08', newGmv: 0, renewalGmv: 0, officialPoints: 0 },
    { monthStart: '2026-09-01', monthLabel: '2026-09', newGmv: 0, renewalGmv: 0, officialPoints: 0 },
  ],
}
