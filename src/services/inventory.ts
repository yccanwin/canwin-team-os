import { supabase } from '@/lib/supabase'
import { CANWIN_TEAM_ID } from '@/config/team'
import type { FinanceRecord, InventoryItem, InventoryLog } from '@/types'

type InventoryItemRow = {
  id: string
  name: string
  sku: string | null
  quantity: number | string
  unit: string
  unit_cost: number | string | null
  updated_at: string
}

type PublicInventoryItemRow = Omit<InventoryItemRow, 'unit_cost'> & {
  public_status: string | null
  low_stock_threshold: number | string | null
}

type InventoryLogRow = {
  id: string
  item_id: string
  item_name?: string | null
  operation: InventoryLog['operation'] | 'adjust'
  quantity_change: number | string
  operator_id: string | null
  finance_record_id: string | null
  created_at: string
  inventory_items?: { name: string | null } | { name: string | null }[] | null
}

type FinanceRow = {
  id: string
  record_type: FinanceRecord['type']
  amount: number | string
  date: string
  category: string
  note: string | null
  created_by: string | null
}

const ITEM_SELECT = 'id, name, sku, quantity, unit, unit_cost, updated_at'
const LOG_SELECT = 'id, item_id, operation, quantity_change, operator_id, finance_record_id, created_at, inventory_items(name)'
const FINANCE_SELECT = 'id, record_type, amount, date, category, note, created_by'

function rowToItem(row: InventoryItemRow): InventoryItem {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku || undefined,
    quantity: Number(row.quantity),
    unit: row.unit,
    unitPrice: Number(row.unit_cost ?? 0),
    lastUpdated: row.updated_at,
  }
}

function rowToPublicItem(row: PublicInventoryItemRow): InventoryItem {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku || undefined,
    quantity: Number(row.quantity),
    unit: row.unit,
    unitPrice: 0,
    lastUpdated: row.updated_at,
  }
}

function rowToLog(row: InventoryLogRow): InventoryLog {
  const joinedItem = Array.isArray(row.inventory_items)
    ? row.inventory_items[0]
    : row.inventory_items

  return {
    id: row.id,
    itemId: row.item_id,
    itemName: joinedItem?.name || row.item_name || '未知商品',
    operation: row.operation === 'adjust' ? 'in' : row.operation,
    quantityChange: Number(row.quantity_change),
    operatorId: row.operator_id || '',
    createdAt: row.created_at,
    financeId: row.finance_record_id || undefined,
  }
}

function rowToFinance(row: FinanceRow): FinanceRecord {
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

function itemToRow(item: Omit<InventoryItem, 'id' | 'lastUpdated'> | Partial<InventoryItem>) {
  return {
    name: item.name,
    sku: item.sku,
    quantity: item.quantity,
    unit: item.unit,
    unit_cost: item.unitPrice,
  }
}

async function createFinanceRecord(record: Omit<FinanceRecord, 'id'>): Promise<FinanceRecord> {
  const { data, error } = await supabase
    .from('finance_records')
    .insert({
      team_id: CANWIN_TEAM_ID,
      record_type: record.type,
      amount: record.amount,
      date: record.date,
      category: record.category,
      note: record.note,
      created_by: record.createdBy,
    })
    .select(FINANCE_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToFinance(data as FinanceRow)
}

export async function loadInventory(): Promise<{ items: InventoryItem[]; logs: InventoryLog[] }> {
  const [itemsResult, logsResult] = await Promise.all([
    supabase
      .from('inventory_items')
      .select(ITEM_SELECT)
      .eq('team_id', CANWIN_TEAM_ID)
      .order('updated_at', { ascending: false }),
    supabase
      .from('inventory_logs')
      .select(LOG_SELECT)
      .eq('team_id', CANWIN_TEAM_ID)
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  if (itemsResult.error) throw new Error(itemsResult.error.message)
  if (logsResult.error) throw new Error(logsResult.error.message)

  return {
    items: (itemsResult.data ?? []).map((row) => rowToItem(row as InventoryItemRow)),
    logs: (logsResult.data ?? []).map((row) => rowToLog(row as InventoryLogRow)),
  }
}

export async function loadInventoryPublic(): Promise<{ items: InventoryItem[]; logs: InventoryLog[] }> {
  const { data, error } = await supabase
    .from('inventory_public_items')
    .select('id, name, sku, quantity, unit, public_status, low_stock_threshold, updated_at')
    .eq('team_id', CANWIN_TEAM_ID)
    .order('updated_at', { ascending: false })

  if (error) throw new Error(error.message)
  return {
    items: (data ?? []).map((row) => rowToPublicItem(row as PublicInventoryItemRow)),
    logs: [],
  }
}

export async function createInventoryItem(item: Omit<InventoryItem, 'id'>): Promise<InventoryItem> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)

  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      ...itemToRow(item),
      team_id: CANWIN_TEAM_ID,
      created_by: userData.user.id,
    })
    .select(ITEM_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToItem(data as InventoryItemRow)
}

export async function updateInventoryItem(id: string, updates: Partial<InventoryItem>): Promise<InventoryItem> {
  const { data, error } = await supabase
    .from('inventory_items')
    .update(itemToRow(updates))
    .eq('id', id)
    .select(ITEM_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToItem(data as InventoryItemRow)
}

export async function deleteInventoryItem(id: string): Promise<void> {
  const { error } = await supabase.from('inventory_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

async function createInventoryLog(log: Omit<InventoryLog, 'id' | 'createdAt'>): Promise<InventoryLog> {
  const { data, error } = await supabase
    .from('inventory_logs')
    .insert({
      team_id: CANWIN_TEAM_ID,
      item_id: log.itemId,
      operation: log.operation,
      quantity_change: log.quantityChange,
      operator_id: log.operatorId,
      finance_record_id: log.financeId,
    })
    .select(LOG_SELECT)
    .single()

  if (error) throw new Error(error.message)
  return rowToLog(data as InventoryLogRow)
}

export async function recordStockIn(
  item: Omit<InventoryItem, 'id' | 'lastUpdated'>,
  costAmount: number,
  operatorId: string,
  costCategory = '采购成本',
  costDate?: string
): Promise<{ item: InventoryItem; log: InventoryLog; financeRecord: FinanceRecord }> {
  const { data: existing, error: existingError } = await supabase
    .from('inventory_items')
    .select(ITEM_SELECT)
    .eq('team_id', CANWIN_TEAM_ID)
    .eq('name', item.name)
    .eq('unit', item.unit)
    .maybeSingle()

  if (existingError) throw new Error(existingError.message)

  const savedItem = existing
    ? await updateInventoryItem(existing.id, {
        quantity: Number(existing.quantity) + item.quantity,
        unitPrice: item.unitPrice,
        sku: item.sku || existing.sku || undefined,
      })
    : await createInventoryItem({ ...item, lastUpdated: new Date().toISOString() })

  const financeRecord = await createFinanceRecord({
    type: 'expense',
    amount: costAmount,
    date: costDate ?? new Date().toISOString().slice(0, 10),
    category: costCategory,
    note: `入库：${item.name} × ${item.quantity}${item.unit}`,
    createdBy: operatorId,
  })

  const log = await createInventoryLog({
    itemId: savedItem.id,
    itemName: savedItem.name,
    operation: 'in',
    quantityChange: item.quantity,
    operatorId,
    financeId: financeRecord.id,
  })

  return { item: savedItem, log, financeRecord }
}

export async function recordStockOut(
  item: InventoryItem,
  quantity: number,
  incomeAmount: number,
  operatorId: string,
  incomeCategory = '销售收入',
  incomeDate?: string
): Promise<{ item: InventoryItem; log: InventoryLog; financeRecord: FinanceRecord }> {
  const savedItem = await updateInventoryItem(item.id, {
    quantity: item.quantity - quantity,
    unitPrice: item.unitPrice,
  })

  const financeRecord = await createFinanceRecord({
    type: 'income',
    amount: incomeAmount,
    date: incomeDate ?? new Date().toISOString().slice(0, 10),
    category: incomeCategory,
    note: `出库：${item.name} × ${quantity}${item.unit}`,
    createdBy: operatorId,
  })

  const log = await createInventoryLog({
    itemId: item.id,
    itemName: item.name,
    operation: 'out',
    quantityChange: quantity,
    operatorId,
    financeId: financeRecord.id,
  })

  return { item: savedItem, log, financeRecord }
}

export async function deleteInventoryLogWithRevert(log: InventoryLog): Promise<void> {
  const { data: itemRow, error: itemError } = await supabase
    .from('inventory_items')
    .select(ITEM_SELECT)
    .eq('id', log.itemId)
    .maybeSingle()

  if (itemError) throw new Error(itemError.message)

  if (itemRow) {
    const item = rowToItem(itemRow as InventoryItemRow)
    await updateInventoryItem(item.id, {
      quantity: log.operation === 'in'
        ? Math.max(0, item.quantity - log.quantityChange)
        : item.quantity + log.quantityChange,
      unitPrice: item.unitPrice,
    })
  }

  if (log.financeId) {
    const { error: financeError } = await supabase
      .from('finance_records')
      .delete()
      .eq('id', log.financeId)
    if (financeError) throw new Error(financeError.message)
  }

  const { error } = await supabase.from('inventory_logs').delete().eq('id', log.id)
  if (error) throw new Error(error.message)
}
