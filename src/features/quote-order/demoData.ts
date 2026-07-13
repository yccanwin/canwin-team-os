import type { DemoQuote, VersionedCatalogItem } from './types'
import { calculateValidUntil } from './workflow'

export const demoCatalog: VersionedCatalogItem[] = [
  { id: 'product-pos', name: '餐饮年费产品', version: 3, kind: 'product', unitPrice: 6800 },
  { id: 'package-standard', name: '标准门店套餐', version: 2, kind: 'package', unitPrice: 3200 },
]

const issuedAt = '2026-07-13'
export const demoQuote: DemoQuote = {
  id: 'quote-demo-001', customerName: '示范宴会中心（演示）', customerGrade: 'A', demonstrationCompleted: false,
  status: 'draft', version: 1, issuedAt, validUntil: calculateValidUntil(issuedAt), supervisorApproved: false, changeOrders: [],
  lines: [
    { itemId: 'product-pos', itemNameSnapshot: '餐饮年费产品', catalogVersion: 3, quantity: 1, unitPrice: 6800 },
    { itemId: 'package-standard', itemNameSnapshot: '标准门店套餐', catalogVersion: 2, quantity: 1, unitPrice: 3200, specialContent: '增加一次驻店培训' },
  ],
}
