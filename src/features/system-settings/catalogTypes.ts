export type CatalogItemType = 'software' | 'hardware' | 'service'

export interface CatalogItem {
  id: string
  sku: string
  name: string
  itemType: CatalogItemType
  procurementCost: number
  customerListPrice: number
  points: number
  applicableBusinessTypes: string[]
  isActive: boolean
}

export interface CatalogSnapshot {
  draftVersionId: string | null
  draftVersionNo: number | null
  publishedVersionNo: number | null
  items: CatalogItem[]
}

export interface CatalogItemDraft extends Omit<CatalogItem, 'id'> { id?: string }
