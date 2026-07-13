export type CatalogVersionStatus = 'draft' | 'published' | 'retired'
export interface CatalogVersionView {
  id: string
  versionNo: number
  status: CatalogVersionStatus
  creatorName: string
  createdAt: string
  publishedAt: string | null
  itemCount: number
  activeItemCount: number
  packageCount: number
}
export interface CatalogVersionSnapshot { versions: CatalogVersionView[] }
