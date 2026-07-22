import type { CaseCandidate, CaseData, CaseMedia, CaseRecord, PublicCaseRecord } from '../domain/case'
import { getGreenfieldSupabase } from './supabase'

type Row = Record<string, unknown>

const rowOf = (value: unknown, code: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code)
  return value as Row
}
const text = (row: Row, key: string) => {
  const value = row[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`CASE_FIELD_INVALID:${key}`)
  return value
}
const optionalText = (row: Row, key: string) => row[key] === null ? null : text(row, key)
const date = (row: Row, key: string) => {
  const value = optionalText(row, key)
  if (value && !Number.isFinite(Date.parse(value))) throw new Error(`CASE_FIELD_INVALID:${key}`)
  return value
}

const mapCase = (value: unknown): CaseRecord => {
  const row = rowOf(value, 'CASE_ROW_INVALID')
  const status = text(row, 'status')
  if (!['draft', 'published', 'unpublished', 'archived'].includes(status)) throw new Error('CASE_FIELD_INVALID:status')
  if (typeof row.authorization_valid !== 'boolean') throw new Error('CASE_FIELD_INVALID:authorization_valid')
  return Object.freeze({
    id: text(row, 'id'), companyId: text(row, 'company_id'), candidateId: text(row, 'candidate_id'),
    title: text(row, 'title'), summary: text(row, 'summary'), status: status as CaseRecord['status'],
    authorizationValid: row.authorization_valid, adminReviewedAt: date(row, 'admin_reviewed_at'),
    publishedAt: date(row, 'published_at'),
  })
}

const mapCandidate = (value: unknown): CaseCandidate => {
  const row = rowOf(value, 'CASE_CANDIDATE_ROW_INVALID')
  if (typeof row.display_authorization_valid !== 'boolean') throw new Error('CASE_CANDIDATE_FIELD_INVALID:display_authorization_valid')
  return Object.freeze({
    id: text(row, 'id'), companyId: text(row, 'company_id'),
    displayAuthorizationValid: row.display_authorization_valid,
    authorizationSource: optionalText(row, 'authorization_source'),
    authorizationScope: optionalText(row, 'authorization_scope'),
    authorizationEvidenceReference: optionalText(row, 'authorization_evidence_reference'),
    authorizationValidFrom: date(row, 'authorization_valid_from'),
    authorizationValidUntil: date(row, 'authorization_valid_until'),
    authorizationRecordedAt: date(row, 'authorization_recorded_at'),
    authorizationWithdrawnAt: date(row, 'authorization_withdrawn_at'),
    authorizationWithdrawalReason: optionalText(row, 'authorization_withdrawal_reason'),
  })
}

const mapPublicCase = (value: unknown): PublicCaseRecord => {
  const row = rowOf(value, 'PUBLIC_CASE_ROW_INVALID')
  const sortOrder = row.sort_order
  if (!Number.isInteger(sortOrder)) throw new Error('PUBLIC_CASE_FIELD_INVALID:sort_order')
  return Object.freeze({
    brandDisplayName: text(row, 'brand_display_name'),
    storeDisplayName: text(row, 'store_display_name'),
    industry: text(row, 'industry'),
    region: text(row, 'region'),
    storeKind: text(row, 'store_kind'),
    productsAndServices: text(row, 'products_and_services'),
    originalProblem: text(row, 'original_problem'),
    solution: text(row, 'solution'),
    launchResult: text(row, 'launch_result'),
    serviceTeamDisplay: text(row, 'service_team_display'),
    logoPublicPath: optionalText(row, 'logo_public_path'),
    displayCodePublicPath: optionalText(row, 'display_code_public_path'),
    sortOrder: sortOrder as number,
  })
}

const mapMedia = (value: unknown): CaseMedia => {
  const row = rowOf(value, 'CASE_MEDIA_ROW_INVALID')
  const mediaType = text(row, 'media_type')
  const mimeType = text(row, 'mime_type')
  if (!['logo', 'display_code'].includes(mediaType)) throw new Error('CASE_MEDIA_FIELD_INVALID:media_type')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error('CASE_MEDIA_FIELD_INVALID:mime_type')
  if (!Number.isInteger(row.size_bytes) || (row.size_bytes as number) <= 0) throw new Error('CASE_MEDIA_FIELD_INVALID:size_bytes')
  return Object.freeze({ id: text(row, 'id'), companyId: text(row, 'company_id'), caseId: text(row, 'case_id'), mediaType: mediaType as CaseMedia['mediaType'], objectPath: text(row, 'object_path'), mimeType: mimeType as CaseMedia['mimeType'], sizeBytes: row.size_bytes as number })
}

export class SupabaseCaseReader {
  async load(companyId: string, isAdmin: boolean, signal?: AbortSignal): Promise<CaseData> {
    const client = getGreenfieldSupabase()
    let casesQuery = client.from('cases').select('id,company_id,candidate_id,title,summary,status,authorization_valid,admin_reviewed_at,published_at').eq('company_id', companyId).order('updated_at', { ascending: false })
    let mediaQuery = client.from('case_media').select('id,company_id,case_id,media_type,object_path,mime_type,size_bytes').eq('company_id', companyId)
    let candidatesQuery = client.from('case_candidates').select('id,company_id,display_authorization_valid,authorization_source,authorization_scope,authorization_evidence_reference,authorization_valid_from,authorization_valid_until,authorization_recorded_at,authorization_withdrawn_at,authorization_withdrawal_reason').eq('company_id', companyId)
    let publicQuery = client.from('published_cases_public').select('brand_display_name,store_display_name,industry,region,store_kind,products_and_services,original_problem,solution,launch_result,service_team_display,logo_public_path,display_code_public_path,sort_order').order('sort_order', { ascending: true })
    if (signal) {
      casesQuery = casesQuery.abortSignal(signal)
      mediaQuery = mediaQuery.abortSignal(signal)
      candidatesQuery = candidatesQuery.abortSignal(signal)
      publicQuery = publicQuery.abortSignal(signal)
    }
    const noRows = Promise.resolve({ data: [], error: null })
    const [casesResult, mediaResult, candidatesResult, publicResult] = await Promise.all([
      isAdmin ? casesQuery : noRows,
      isAdmin ? mediaQuery : noRows,
      isAdmin ? candidatesQuery : Promise.resolve({ data: [], error: null }),
      publicQuery,
    ])
    if (casesResult.error) throw new Error(`CASE_QUERY_FAILED:${casesResult.error.code ?? 'UNKNOWN'}`)
    if (mediaResult.error) throw new Error(`CASE_MEDIA_QUERY_FAILED:${mediaResult.error.code ?? 'UNKNOWN'}`)
    if (candidatesResult.error) throw new Error(`CASE_CANDIDATE_QUERY_FAILED:${candidatesResult.error.code ?? 'UNKNOWN'}`)
    if (publicResult.error) throw new Error(`PUBLIC_CASE_QUERY_FAILED:${publicResult.error.code ?? 'UNKNOWN'}`)
    return Object.freeze({
      cases: Object.freeze((casesResult.data ?? []).map(mapCase)),
      candidates: Object.freeze((candidatesResult.data ?? []).map(mapCandidate)),
      media: Object.freeze((mediaResult.data ?? []).map(mapMedia)),
      publicCases: Object.freeze((publicResult.data ?? []).map(mapPublicCase)),
    })
  }
}
