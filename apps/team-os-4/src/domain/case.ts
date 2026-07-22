export interface CaseRecord {
  readonly id: string
  readonly companyId: string
  readonly candidateId: string
  readonly title: string
  readonly summary: string
  readonly status: 'draft' | 'published' | 'unpublished' | 'archived'
  readonly authorizationValid: boolean
  readonly adminReviewedAt: string | null
  readonly publishedAt: string | null
}

export interface CaseCandidate {
  readonly id: string
  readonly companyId: string
  readonly displayAuthorizationValid: boolean
  readonly authorizationSource: string | null
  readonly authorizationScope: string | null
  readonly authorizationEvidenceReference: string | null
  readonly authorizationValidFrom: string | null
  readonly authorizationValidUntil: string | null
  readonly authorizationRecordedAt: string | null
  readonly authorizationWithdrawnAt: string | null
  readonly authorizationWithdrawalReason: string | null
}

export interface PublicCaseRecord {
  readonly brandDisplayName: string
  readonly storeDisplayName: string
  readonly industry: string
  readonly region: string
  readonly storeKind: string
  readonly productsAndServices: string
  readonly originalProblem: string
  readonly solution: string
  readonly launchResult: string
  readonly serviceTeamDisplay: string
  readonly logoPublicPath: string | null
  readonly displayCodePublicPath: string | null
  readonly sortOrder: number
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
  readonly candidates: readonly CaseCandidate[]
  readonly media: readonly CaseMedia[]
  readonly publicCases: readonly PublicCaseRecord[]
}
