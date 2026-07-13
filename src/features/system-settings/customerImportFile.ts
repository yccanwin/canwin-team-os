import type { CustomerImportRowInput, ImportCell } from './customerImportTypes'

const headerMap: Record<string, string> = {
  品牌名称: 'brand_name', 门店名称: 'store_name', 区域编码: 'region_code', 负责人姓名: 'owner_name', 负责人ID: 'owner_profile_id',
  产品SKU: 'current_product_sku', 产品到期日: 'expires_on', 联系人: 'contact_name', 联系电话: 'contact_phone', 门店地址: 'address', 业态编码: 'business_type',
  brand_name: 'brand_name', store_name: 'store_name', region_code: 'region_code', owner_name: 'owner_name', owner_profile_id: 'owner_profile_id',
  current_product_sku: 'current_product_sku', expires_on: 'expires_on', contact_name: 'contact_name', contact_phone: 'contact_phone', address: 'address', business_type: 'business_type',
}
const templateHeaders = ['品牌名称', '门店名称', '区域编码', '负责人姓名', '负责人ID', '产品SKU', '产品到期日', '联系人', '联系电话', '门店地址', '业态编码']

function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted && char === '"' && text[index + 1] === '"') { cell += '"'; index += 1 }
    else if (char === '"') quoted = !quoted
    else if (!quoted && char === ',') { row.push(cell); cell = '' }
    else if (!quoted && (char === '\n' || char === '\r')) { if (char === '\r' && text[index + 1] === '\n') index += 1; row.push(cell); if (row.some((value) => value.trim())) rows.push(row); row = []; cell = '' }
    else cell += char
  }
  row.push(cell); if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

function normalizeCell(value: unknown): ImportCell {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return typeof value === 'string' ? value.trim() : value
  return value === null || value === undefined ? null : String(value)
}

function rowsToObjects(rows: unknown[][]): CustomerImportRowInput[] {
  if (rows.length < 2) throw new Error('文件只有表头，没有客户数据')
  const headers = rows[0].map((value) => headerMap[String(value).replace(/^\uFEFF/, '').trim()] ?? '')
  const required = ['brand_name', 'store_name', 'region_code', 'current_product_sku', 'expires_on']
  const missing = required.filter((field) => !headers.includes(field))
  if (missing.length) throw new Error(`模板字段缺失：${missing.join('、')}`)
  const result = rows.slice(1).filter((values) => values.some((value) => String(value ?? '').trim())).map((values) => {
    const item: CustomerImportRowInput = {}
    headers.forEach((header, index) => { if (header) item[header] = normalizeCell(values[index]) })
    return item
  })
  if (!result.length) throw new Error('文件没有可导入的数据行')
  if (result.length > 500) throw new Error('单批最多500行，请拆分文件')
  return result
}

export async function parseCustomerImportFile(file: File) {
  if (file.name.toLowerCase().endsWith('.csv')) return rowsToObjects(parseCsv(await file.text()))
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('仅支持 .xlsx 或 .csv 文件')
  const { default: readXlsxFile } = await import('read-excel-file')
  return rowsToObjects(await readXlsxFile(file))
}

export function downloadCustomerImportTemplate() {
  const blob = new Blob([`\uFEFF${templateHeaders.join(',')}\r\n`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob); const link = document.createElement('a')
  link.href = url; link.download = 'CanWin旧客户导入模板.csv'; link.click(); URL.revokeObjectURL(url)
}

export const customerImportFields = [
  ['品牌名称', '必填；同名品牌自动复用'], ['门店名称', '必填；同一区域同名门店自动识别'], ['区域编码', '必填；来自区域配置'],
  ['负责人姓名 / ID', '二选一；姓名重复时必须填写ID'], ['产品SKU', '必填；必须为已发布且启用的SKU'], ['产品到期日', '必填；YYYY-MM-DD'],
  ['联系人 / 电话', '选填；填写电话时联系人必填，电话会去重'], ['门店地址', '选填'], ['业态编码', '选填；使用系统标准编码'],
] as const
