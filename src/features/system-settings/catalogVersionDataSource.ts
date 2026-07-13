import type { CatalogVersionSnapshot } from './catalogVersionTypes'
export interface CatalogVersionDataSource {
  loadSnapshot(): Promise<CatalogVersionSnapshot>
  createDraft(idempotencyKey: string): Promise<string>
  publishDraft(versionId: string, idempotencyKey: string): Promise<string>
}
