export type ImportCell = string | number | boolean | null
export type CustomerImportRowInput = Record<string, ImportCell>
export interface ImportValidationError { field?: string; code?: string; message?: string }
export interface CustomerImportBatchView { id: string; sourceName: string; status: string; rowCount: number; blockingErrorCount: number; report: Record<string, number> | null; createdAt: string; precheckedAt: string | null; committedAt: string | null }
export interface CustomerImportRowView { id: string; rowNumber: number; rawData: CustomerImportRowInput; normalizedData: Record<string, unknown> | null; validationErrors: Array<ImportValidationError | string>; plannedAction: string | null; resultStatus: string; resultData: Record<string, unknown> | null; errorMessage: string | null }
export interface CustomerImportSnapshot { batches: CustomerImportBatchView[]; selectedBatchId: string | null; rows: CustomerImportRowView[] }

