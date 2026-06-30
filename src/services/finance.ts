import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { FinanceRecord } from '@/types'

type FinanceRow = {
  id: string
  record_type: FinanceRecord['type']
  amount: number | string
  date: string
  category: string
  note: string | null
  created_by: string | null
}

type FinanceSummaryRow = {
  month: string
  record_type: FinanceRecord['type']
  category: string
  total_amount: number | string
}

function rowToRecord(row: FinanceRow): FinanceRecord {
  return {
    id: row.id,
    type: row.record_type,
    amount: Number(row.amount),
    date: row.date,
    category: row.category,
    note: row.note || undefined,
    createdBy: row.created_by || '',
  }
}

function recordToRow(record: Omit<FinanceRecord, 'id'> | Partial<FinanceRecord>) {
  return {
    record_type: record.type,
    amount: record.amount,
    date: record.date,
    category: record.category,
    note: record.note,
  }
}

const FINANCE_SELECT = 'id, record_type, amount, date, category, note, created_by'

export async function loadFinanceRecords(): Promise<FinanceRecord[]> {
  const { data, error } = await supabase
    .from('finance_records')
    .select(FINANCE_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => rowToRecord(row as FinanceRow))
}

export async function loadFinancePublicSummary(): Promise<FinanceRecord[]> {
  const { data, error } = await supabase
    .from('finance_public_summary')
    .select('month, record_type, category, total_amount')
    .eq('team_id', CANWIN_TEAM_ID)
    .order('month', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => {
    const summary = row as FinanceSummaryRow
    return {
      id: `summary-${summary.month}-${summary.record_type}-${summary.category}`,
      type: summary.record_type,
      amount: Number(summary.total_amount),
      date: summary.month,
      category: summary.category,
      note: '公开汇总',
      createdBy: '',
    }
  })
}

export async function createFinanceRecord(record: Omit<FinanceRecord, 'id'>): Promise<FinanceRecord> {
  const { data, error } = await supabase
    .from('finance_records')
    .insert({
      ...recordToRow(record),
      team_id: CANWIN_TEAM_ID,
      created_by: record.createdBy,
    })
    .select(FINANCE_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToRecord(data as FinanceRow)
}

export async function updateFinanceRecord(id: string, updates: Partial<FinanceRecord>): Promise<FinanceRecord> {
  const { data, error } = await supabase
    .from('finance_records')
    .update(recordToRow(updates))
    .eq('id', id)
    .select(FINANCE_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToRecord(data as FinanceRow)
}

export async function deleteFinanceRecord(id: string): Promise<void> {
  const { error } = await supabase.from('finance_records').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
