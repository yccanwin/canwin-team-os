export type LeadPasteField =
  | 'customerName'
  | 'contactName'
  | 'phone'
  | 'regionText'
  | 'address'
  | 'notes'

export type LeadPasteConfidence = 'high' | 'medium' | 'low' | 'none'

export interface LeadPasteResult {
  customerName: string
  contactName: string
  phone: string
  regionText: string
  address: string
  notes: string
  rawText: string
  confidenceHints: Record<LeadPasteField, LeadPasteConfidence>
}

const EMPTY_CONFIDENCE: Record<LeadPasteField, LeadPasteConfidence> = {
  customerName: 'none',
  contactName: 'none',
  phone: 'none',
  regionText: 'none',
  address: 'none',
  notes: 'none',
}

const LABELS: Record<LeadPasteField, RegExp> = {
  customerName: /^(?:客户|客户名称|门店|门店名称|店名|商户|商户名称|线索标题)\s*[：:]\s*(.+)$/i,
  contactName: /^(?:联系人|姓名|老板|负责人)\s*[：:]\s*(.+)$/i,
  phone: /^(?:电话|手机|手机号|联系电话|联系方式)\s*[：:]\s*(.+)$/i,
  regionText: /^(?:区域|区县|所在区域|地区)\s*[：:]\s*(.+)$/i,
  address: /^(?:地址|详细地址|门店地址)\s*[：:]\s*(.+)$/i,
  notes: /^(?:备注|需求|说明|情况|补充)\s*[：:]\s*(.+)$/i,
}

const cleanValue = (value: string) => value.trim().replace(/^[,，;；、\s]+|[,，;；、\s]+$/g, '')

const sanitizePhone = (value: string) => {
  const compact = value.replace(/[\s-]/g, '')
  const mobile = compact.match(/(?<!\d)(?:\+?86)?(1[3-9]\d{9})(?!\d)/)
  return mobile?.[1] ?? ''
}

const inferRegion = (text: string) => {
  const matches = text.match(/(?:[\u4e00-\u9fa5]{2,}(?:省|自治区))?(?:[\u4e00-\u9fa5]{2,}(?:市|州|盟))?([\u4e00-\u9fa5]{1,8}(?:区|县|旗))/)
  return cleanValue(matches?.[0] ?? '')
}

const inferAddress = (text: string, regionText: string) => {
  const addressPattern = /([\u4e00-\u9fa5\dA-Za-z-]{0,20}(?:街道|镇|乡|路|街|大道|巷|村|社区)[\u4e00-\u9fa5\dA-Za-z号栋幢室单元弄-]{0,30})/
  const match = text.match(addressPattern)?.[1] ?? ''
  const cleaned = cleanValue(match)
  if (!cleaned) return ''
  if (regionText && !cleaned.includes(regionText) && text.includes(`${regionText}${cleaned}`)) {
    return `${regionText}${cleaned}`
  }
  return cleaned
}

const inferContact = (text: string) => {
  const labeled = text.match(/(?:联系人|负责人|找)\s*[：:]?\s*([\u4e00-\u9fa5·]{2,6})/)
  if (labeled) return labeled[1]
  const titled = text.match(/([\u4e00-\u9fa5·]{1,4}(?:老板|经理|店长|总))(?:[，,、\s]|$)/)
  return titled?.[1] ?? ''
}

const inferCustomer = (text: string) => {
  const named = text.match(/(?:客户|门店|店名|商户|线索)\s*[：:]\s*([^，,；;\n\t]+)/)
  if (named) return cleanValue(named[1])
  const opening = text.match(/^([^，,；;。\n\t]{2,30}(?:店|馆|餐厅|饭店|酒楼|公司|中心|茶社|咖啡|烘焙|火锅|烧烤|食堂|民宿|酒店))/)
  return cleanValue(opening?.[1] ?? '')
}

const removeRecognized = (text: string, values: string[]) => {
  let remainder = text
  for (const value of values.filter(Boolean).sort((a, b) => b.length - a.length)) {
    remainder = remainder.split(value).join(' ')
  }
  remainder = remainder
    .replace(/(?:客户|客户名称|门店|门店名称|店名|商户|商户名称|线索标题|联系人|姓名|老板|负责人|电话|手机|手机号|联系电话|联系方式|区域|区县|所在区域|地区|地址|详细地址|门店地址|备注|需求|说明|情况|补充)\s*[：:]?/gi, ' ')
    .replace(/[\s，,；;、|/]+/g, ' ')
    .replace(/^(?:位于|在|是|为|叫)\s*/, '')
  return cleanValue(remainder)
}

/**
 * 将运维粘贴的中文自然句、键值文本或 Excel 单行拆成六个线索字段。
 * 仅使用确定性规则；无法可靠识别的字段保持为空。
 */
export function parseLeadPaste(input: unknown): LeadPasteResult {
  const rawText = typeof input === 'string' ? input.trim() : ''
  const result: LeadPasteResult = {
    customerName: '',
    contactName: '',
    phone: '',
    regionText: '',
    address: '',
    notes: '',
    rawText,
    confidenceHints: { ...EMPTY_CONFIDENCE },
  }
  if (!rawText) return result

  const lines = rawText.split(/\r?\n/).map(cleanValue).filter(Boolean)
  for (const line of lines) {
    for (const field of Object.keys(LABELS) as LeadPasteField[]) {
      const match = line.match(LABELS[field])
      if (!match || result[field]) continue
      const value = field === 'phone' ? sanitizePhone(match[1]) : cleanValue(match[1])
      if (value) {
        result[field] = value
        result.confidenceHints[field] = 'high'
      }
    }
  }

  // Excel/表格单行约定：客户、联系人、电话、区域、地址、备注。
  if (lines.length === 1 && rawText.includes('\t')) {
    const cells = rawText.split('\t').map(cleanValue)
    if (cells.length >= 3) {
      const fields: LeadPasteField[] = ['customerName', 'contactName', 'phone', 'regionText', 'address', 'notes']
      fields.forEach((field, index) => {
        if (result[field] || !cells[index]) return
        const value = field === 'phone' ? sanitizePhone(cells[index]) : cells[index]
        if (value) {
          result[field] = value
          result.confidenceHints[field] = 'high'
        }
      })
    }
  }

  const inlineText = lines.join('，')
  if (!result.phone) {
    result.phone = sanitizePhone(inlineText)
    if (result.phone) result.confidenceHints.phone = 'high'
  }
  if (!result.regionText) {
    result.regionText = inferRegion(inlineText)
    if (result.regionText) result.confidenceHints.regionText = 'medium'
  }
  if (!result.contactName) {
    result.contactName = inferContact(inlineText)
    if (result.contactName) result.confidenceHints.contactName = 'medium'
  }
  if (!result.customerName) {
    result.customerName = inferCustomer(inlineText)
    if (result.customerName) result.confidenceHints.customerName = 'medium'
  }
  if (!result.address) {
    result.address = inferAddress(inlineText, result.regionText)
    if (result.address) result.confidenceHints.address = 'medium'
  }
  if (!result.notes) {
    result.notes = removeRecognized(inlineText, [
      result.customerName,
      result.contactName,
      result.phone,
      result.regionText,
      result.address,
    ])
    if (result.notes) result.confidenceHints.notes = 'low'
  }

  return result
}
