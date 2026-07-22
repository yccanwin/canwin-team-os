export interface CaseRecord {
  readonly id: string
  readonly companyId: string
  readonly title: string
  readonly summary: string
  readonly status: 'draft' | 'published' | 'unpublished'
  readonly authorizationValid: boolean
  readonly publishedAt: string | null
}

export interface CaseMedia {
  readonly id: string
  readonly companyId: string
  readonly caseId: string
  readonly mediaType: 'logo' | 'display_code'
  readonly objectPath: string
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  readonly sizeBytes: number
}

export interface CaseData {
  readonly cases: readonly CaseRecord[]
  readonly media: readonly CaseMedia[]
}
