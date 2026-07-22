import type { CaseData, CaseMedia, CaseRecord } from '../domain/case'
import { getGreenfieldSupabase } from './supabase'

const text = (row: Record<string, unknown>, key: string) => {
  const value = row[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`CASE_FIELD_INVALID:${key}`)
  return value
}
const optionalText = (row: Record<string, unknown>, key: string) => row[key] === null ? null : text(row, key)

const mapCase = (value: unknown): CaseRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CASE_ROW_INVALID')
  const row = value as Record<string, unknown>
  const status = text(row, 'status')
  const publishedAt = optionalText(row, 'published_at')
  if (!['draft', 'published', 'unpublished'].includes(status)) throw new Error('CASE_FIELD_INVALID:status')
  if (typeof row.authorization_valid !== 'boolean') throw new Error('CASE_FIELD_INVALID:authorization_valid')
  if (publishedAt && !Number.isFinite(Date.parse(publishedAt))) throw new Error('CASE_FIELD_INVALID:published_at')
  return Object.freeze({ id: text(row, 'id'), companyId: text(row, 'company_id'), title: text(row, 'title'), summary: text(row, 'summary'), status: status as CaseRecord['status'], authorizationValid: row.authorization_valid, publishedAt })
}

const mapMedia = (value: unknown): CaseMedia => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CASE_MEDIA_ROW_INVALID')
  const row = value as Record<string, unknown>
  const mediaType = text(row, 'media_type')
  const mimeType = text(row, 'mime_type')
  if (!['logo', 'display_code'].includes(mediaType)) throw new Error('CASE_MEDIA_FIELD_INVALID:media_type')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error('CASE_MEDIA_FIELD_INVALID:mime_type')
  if (!Number.isInteger(row.size_bytes) || (row.size_bytes as number) <= 0) throw new Error('CASE_MEDIA_FIELD_INVALID:size_bytes')
  return Object.freeze({ id: text(row, 'id'), companyId: text(row, 'company_id'), caseId: text(row, 'case_id'), mediaType: mediaType as CaseMedia['mediaType'], objectPath: text(row, 'object_path'), mimeType: mimeType as CaseMedia['mimeType'], sizeBytes: row.size_bytes as number })
}

export class SupabaseCaseReader {
  async load(companyId: string, signal?: AbortSignal): Promise<CaseData> {
    let casesQuery = getGreenfieldSupabase().from('cases').select('id,company_id,title,summary,status,authorization_valid,published_at').eq('company_id', companyId)
    let mediaQuery = getGreenfieldSupabase().from('case_media').select('id,company_id,case_id,media_type,object_path,mime_type,size_bytes').eq('company_id', companyId)
    if (signal) { casesQuery = casesQuery.abortSignal(signal); mediaQuery = mediaQuery.abortSignal(signal) }
    const [casesResult, mediaResult] = await Promise.all([casesQuery, mediaQuery])
    if (casesResult.error) throw new Error(`CASE_QUERY_FAILED:${casesResult.error.code ?? 'UNKNOWN'}`)
    if (mediaResult.error) throw new Error(`CASE_MEDIA_QUERY_FAILED:${mediaResult.error.code ?? 'UNKNOWN'}`)
    return Object.freeze({ cases: Object.freeze((casesResult.data ?? []).map(mapCase)), media: Object.freeze((mediaResult.data ?? []).map(mapMedia)) })
  }
}
