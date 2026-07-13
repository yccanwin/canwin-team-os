import type { CatalogItemDraft, CatalogSnapshot } from './catalogTypes'

export interface CatalogAdminDataSource {
  loadSnapshot(): Promise<CatalogSnapshot>
  saveItem(item: CatalogItemDraft): Promise<void>
}
