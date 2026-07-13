import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { SalesAssessment, SalesProduct, SalesScoreRecord } from '@/types'

type SalesProductRow = {
  id: string
  name: string
  points: number | string
  category: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
}

type SalesScoreRecordRow = {
  id: string
  salesperson_id: string
  product_id: string
  product_name: string
  quantity: number | string
  points: number | string
  sold_at: string
  note: string | null
  created_by: string | null
  created_at: string
}

type SalesAssessmentRow = {
  id: string
  period_quarter: string
  salesperson_ids: string[] | null
  point_target: number | string
  new_gmv_target: number | string
  new_gmv_actual: number | string
  renewal_gmv_target: number | string
  renewal_gmv_actual: number | string
  updated_by: string | null
  updated_at: string
}

const PRODUCT_SELECT = 'id, name, points, category, is_active, created_by, created_at'
const RECORD_SELECT =
  'id, salesperson_id, product_id, product_name, quantity, points, sold_at, note, created_by, created_at'
const ASSESSMENT_SELECT =
  'id, period_quarter, salesperson_ids, point_target, new_gmv_target, new_gmv_actual, renewal_gmv_target, renewal_gmv_actual, updated_by, updated_at'
const SALES_UNAVAILABLE_RE =
  /relation .*sales_|schema cache|permission denied|violates row-level security|does not exist|not found/i

export function isSalesCloudUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return SALES_UNAVAILABLE_RE.test(message)
}

function rowToProduct(row: SalesProductRow): SalesProduct {
  return {
    id: row.id,
    name: row.name,
    points: Number(row.points),
    category: row.category || undefined,
    isActive: row.is_active,
    createdBy: row.created_by || '',
    createdAt: row.created_at,
  }
}

function rowToRecord(row: SalesScoreRecordRow): SalesScoreRecord {
  return {
    id: row.id,
    salespersonId: row.salesperson_id,
    productId: row.product_id,
    productName: row.product_name,
    quantity: Number(row.quantity),
    points: Number(row.points),
    soldAt: row.sold_at,
    note: row.note || undefined,
    createdBy: row.created_by || '',
    createdAt: row.created_at,
  }
}

function rowToAssessment(row: SalesAssessmentRow): SalesAssessment {
  return {
    id: row.id,
    periodQuarter: row.period_quarter,
    salespersonIds: row.salesperson_ids ?? [],
    pointTarget: Number(row.point_target),
    newGmvTarget: Number(row.new_gmv_target),
    newGmvActual: Number(row.new_gmv_actual),
    renewalGmvTarget: Number(row.renewal_gmv_target),
    renewalGmvActual: Number(row.renewal_gmv_actual),
    updatedBy: row.updated_by || '',
    updatedAt: row.updated_at,
  }
}

export async function loadSalesProducts(): Promise<SalesProduct[] | null> {
  const { data, error } = await supabase
    .from('sales_products')
    .select(PRODUCT_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('created_at', { ascending: true })

  if (error) {
    console.warn('sales_products table is not available yet:', error.message)
    return null
  }

  return (data ?? []).map((row) => rowToProduct(row as SalesProductRow))
}

export async function loadSalesScoreRecords(): Promise<SalesScoreRecord[] | null> {
  const { data, error } = await supabase
    .from('sales_score_records')
    .select(RECORD_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('sold_at', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    console.warn('sales_score_records table is not available yet:', error.message)
    return null
  }

  return (data ?? []).map((row) => rowToRecord(row as SalesScoreRecordRow))
}

export async function loadSalesAssessments(): Promise<SalesAssessment[] | null> {
  const { data, error } = await supabase
    .from('sales_assessments')
    .select(ASSESSMENT_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('period_quarter', { ascending: false })

  if (error) {
    console.warn('sales_assessments table is not available yet:', error.message)
    return null
  }

  return (data ?? []).map((row) => rowToAssessment(row as SalesAssessmentRow))
}

export async function createSalesProductRecord(
  product: Omit<SalesProduct, 'id' | 'createdAt'>
): Promise<SalesProduct> {
  const { data, error } = await supabase
    .from('sales_products')
    .insert({
      team_id: CANWIN_TEAM_ID,
      name: product.name,
      points: product.points,
      category: product.category,
      is_active: product.isActive,
      created_by: product.createdBy,
    })
    .select(PRODUCT_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToProduct(data as SalesProductRow)
}

export async function updateSalesProductRecord(
  id: string,
  updates: Partial<Omit<SalesProduct, 'id' | 'createdAt' | 'createdBy'>>
): Promise<SalesProduct> {
  const { data, error } = await supabase
    .from('sales_products')
    .update({
      name: updates.name,
      points: updates.points,
      category: updates.category,
      is_active: updates.isActive,
    })
    .eq('id', id)
    .select(PRODUCT_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToProduct(data as SalesProductRow)
}

export async function createSalesScoreRecord(
  record: Omit<SalesScoreRecord, 'id' | 'createdAt'>
): Promise<SalesScoreRecord> {
  const { data, error } = await supabase
    .from('sales_score_records')
    .insert({
      team_id: CANWIN_TEAM_ID,
      salesperson_id: record.salespersonId,
      product_id: record.productId,
      product_name: record.productName,
      quantity: record.quantity,
      points: record.points,
      sold_at: record.soldAt,
      note: record.note,
      created_by: record.createdBy,
    })
    .select(RECORD_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToRecord(data as SalesScoreRecordRow)
}

export async function upsertSalesAssessmentRecord(
  assessment: Omit<SalesAssessment, 'id' | 'updatedAt'>
): Promise<SalesAssessment> {
  const { data, error } = await supabase
    .from('sales_assessments')
    .upsert(
      {
        team_id: CANWIN_TEAM_ID,
        period_quarter: assessment.periodQuarter,
        salesperson_ids: assessment.salespersonIds,
        point_target: assessment.pointTarget,
        new_gmv_target: assessment.newGmvTarget,
        new_gmv_actual: assessment.newGmvActual,
        renewal_gmv_target: assessment.renewalGmvTarget,
        renewal_gmv_actual: assessment.renewalGmvActual,
        updated_by: assessment.updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'team_id,period_quarter' }
    )
    .select(ASSESSMENT_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToAssessment(data as SalesAssessmentRow)
}
