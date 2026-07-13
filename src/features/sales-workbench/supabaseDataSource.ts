import type { SupabaseClient } from '@supabase/supabase-js'
import { SalesWorkbenchDataError, type LeadReadScope, type SalesTodayAction, type SalesWorkbenchDataSource } from './dataSource'
import type { CustomerBrandSummary, CustomerContactSummary, CustomerStoreSummary, FollowUpDraft, LeadStage, PersonalSalesWorkspace, SalesLead } from './types'

type LeadRow = Record<string, unknown>

function toLead(row: LeadRow): SalesLead {
  const stage = String(row.stage) as LeadStage
  return {
    id: String(row.id),
    opportunityId: row.active_opportunity_id ? String(row.active_opportunity_id) : undefined,
    storeName: String(row.store_name),
    contactName: row.contact_name === null ? '待补充' : String(row.contact_name),
    phone: row.masked_phone === null ? '未授权' : String(row.masked_phone),
    district: String(row.district_name),
    businessType: row.business_type === null ? '待判断' : String(row.business_type),
    source: row.source === null ? '未知来源' : String(row.source),
    createdAt: String(row.created_at),
    nextActionAt: row.next_action_at ? String(row.next_action_at) : undefined,
    stage: ['new', 'contacted', 'qualified', 'opportunity'].includes(stage) ? stage : 'new',
    facts: Array.isArray(row.facts) ? row.facts.map(String) : [],
    leadStatus: String(row.lead_status),
    ownerDisplayName: row.owner_display_name === null ? undefined : String(row.owner_display_name),
    claimable: row.claimable === true,
    recycleRisk: ['uncontacted_24h', 'uncontacted_48h', 'inactive_15d'].includes(String(row.recycle_risk)) ? String(row.recycle_risk) as SalesLead['recycleRisk'] : 'none',
    recycleDueAt: row.recycle_due_at ? String(row.recycle_due_at) : undefined,
    recyclePaused: row.recycle_paused === true,
  }
}

function firstRow(data: unknown): SalesLead {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') throw new SalesWorkbenchDataError('服务器未返回线索数据')
  return toLead(row as LeadRow)
}

export function createSupabaseSalesWorkbenchDataSource(client: SupabaseClient): SalesWorkbenchDataSource {
  return {
    async listTodayActions() {
      const { data, error } = await client.rpc('get_sales_today_action_queue')
      if (error) throw new SalesWorkbenchDataError(`读取今日行动队列失败：${error.message}`, error)
      const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : []
      return rows.map((row): SalesTodayAction => ({
        id: String(row.id), entityId: String(row.entity_id), entityType: String(row.entity_type) as SalesTodayAction['entityType'],
        actionType: String(row.action_type), priority: Number(row.priority),
        priorityTone: ['critical', 'high', 'medium', 'normal'].includes(String(row.priority_tone)) ? String(row.priority_tone) as SalesTodayAction['priorityTone'] : 'normal',
        label: String(row.label), title: String(row.title), reason: String(row.reason),
        dueAt: row.due_at ? String(row.due_at) : undefined, route: String(row.route), supervisorException: row.supervisor_exception === true,
      }))
    },
    async listLeads(scope: LeadReadScope) {
      const query = client.from('crm_leads_visible').select('id,read_scope,store_name,contact_name,masked_phone,district_name,business_type,source,created_at,next_action_at,stage,facts,lead_status,owner_display_name,claimable,active_opportunity_id,recycle_risk,recycle_due_at,recycle_paused').eq('read_scope', scope).order('created_at', { ascending: false })
      const { data, error } = await query
      if (error) throw new SalesWorkbenchDataError(`读取${scope === 'mine' ? '本人' : '区域'}线索失败：${error.message}`, error)
      return (data ?? []).map((row) => toLead(row as LeadRow))
    },
    async claimLead(leadId: string) {
      const { error } = await client.rpc('claim_crm_lead', { p_lead_id: leadId })
      if (error) throw new SalesWorkbenchDataError(`领取线索失败：${error.message}`, error)
      const result = await client.from('crm_leads_visible').select('id,read_scope,store_name,contact_name,masked_phone,district_name,business_type,source,created_at,next_action_at,stage,facts,lead_status,owner_display_name,claimable,active_opportunity_id,recycle_risk,recycle_due_at,recycle_paused').eq('id', leadId).eq('read_scope', 'mine').single()
      if (result.error) throw new SalesWorkbenchDataError(`领取成功但刷新线索失败：${result.error.message}`, result.error)
      return toLead(result.data as LeadRow)
    },
    async createFollowUp(leadId: string, followUp: FollowUpDraft) {
      const { data, error } = await client.rpc('record_crm_follow_up', {
        p_lead_id: leadId,
        p_business_fact: followUp.fact.trim() || null,
        p_customer_commitment: followUp.commitment.trim() || null,
        p_next_action_at: followUp.nextActionAt,
      })
      if (error) throw new SalesWorkbenchDataError(`保存跟进失败：${error.message}`, error)
      return firstRow(data)
    },
    async recordContactAttempt(leadId, result, note) {
      const response = await client.rpc('record_crm_contact_attempt', { p_lead_id: leadId, p_result: result, p_note: note?.trim() || null, p_occurred_at: new Date().toISOString() })
      if (response.error) throw new SalesWorkbenchDataError(`记录联系尝试失败：${response.error.message}`, response.error)
    },
    async getLeadFollowupContext(leadId) {
      const { data, error } = await client.rpc('get_crm_lead_followup_context', { p_lead_id: leadId })
      if (error) throw new SalesWorkbenchDataError(`读取跟进历史失败：${error.message}`, error)
      const value = data as { lead_status?: string; nurture_until?: string | null; unreachable_days?: number; activities?: Array<Record<string, unknown>> } | null
      return {
        leadStatus: String(value?.lead_status ?? ''), nurtureUntil: value?.nurture_until ? String(value.nurture_until) : undefined,
        unreachableDays: Number(value?.unreachable_days ?? 0),
        activities: (value?.activities ?? []).map((item) => ({
          id: String(item.id), activityType: item.activity_type === 'effective_followup' ? 'effective_followup' : 'attempt',
          occurredAt: String(item.occurred_at), outcome: String(item.outcome ?? ''),
          businessFact: item.business_fact ? String(item.business_fact) : undefined,
          customerCommitment: item.customer_commitment ? String(item.customer_commitment) : undefined,
          nextActionAt: item.next_action_at ? String(item.next_action_at) : undefined,
        })),
      }
    },
    async listCustomers() {
      const [brandsResult, storesResult, contactsResult, regionsResult] = await Promise.all([
        client.from('crm_brands').select('id,name').order('name'),
        client.from('crm_stores').select('id,brand_id,region_id,name,business_type').order('name'),
        client.from('crm_contacts').select('id,store_id,name,title').order('name'),
        client.from('sales_regions').select('id,name').order('name'),
      ])
      const error = brandsResult.error ?? storesResult.error ?? contactsResult.error ?? regionsResult.error
      if (error) throw new SalesWorkbenchDataError(`读取客户档案失败：${error.message}`, error)

      const regionNames = new Map((regionsResult.data ?? []).map((row) => [String(row.id), String(row.name)]))
      const contactsByStore = new Map<string, CustomerContactSummary[]>()
      for (const row of contactsResult.data ?? []) {
        if (!row.store_id) continue
        const storeId = String(row.store_id)
        const current = contactsByStore.get(storeId) ?? []
        current.push({ id: String(row.id), name: String(row.name), role: row.title === null ? '未设置职务' : String(row.title) })
        contactsByStore.set(storeId, current)
      }
      const storesByBrand = new Map<string, CustomerStoreSummary[]>()
      for (const row of storesResult.data ?? []) {
        if (!row.brand_id) continue
        const brandId = String(row.brand_id)
        const current = storesByBrand.get(brandId) ?? []
        current.push({
          id: String(row.id),
          name: String(row.name),
          district: regionNames.get(String(row.region_id)) ?? '地区记录不可见',
          businessType: row.business_type === null ? '未设置业态' : String(row.business_type),
          contacts: contactsByStore.get(String(row.id)) ?? [],
        })
        storesByBrand.set(brandId, current)
      }
      return (brandsResult.data ?? []).map((row): CustomerBrandSummary => ({
        id: String(row.id),
        name: String(row.name),
        stores: storesByBrand.get(String(row.id)) ?? [],
      }))
    },
    async getMySalesWorkspace() {
      const { data, error } = await client.rpc('get_my_sales_performance_workspace')
      if (error) throw new SalesWorkbenchDataError(`读取我的销售工作台失败：${error.message}`, error)
      const row = (data ?? {}) as Record<string, unknown>
      const target = row.target && typeof row.target === 'object' ? row.target as Record<string, unknown> : undefined
      const monthly = Array.isArray(row.monthly_observations) ? row.monthly_observations : []
      return {
        profileId: String(row.profile_id ?? ''), displayName: String(row.display_name ?? ''),
        quarterStart: String(row.quarter_start ?? ''), quarterEnd: String(row.quarter_end ?? ''), quarterLabel: String(row.quarter_label ?? ''),
        target: target ? {
          id: String(target.id), pointTarget: Number(target.points_target), estimatedPoints: Number(target.estimated_points), officialPoints: Number(target.official_points),
          newGmvTarget: Number(target.new_gmv_target), newGmvActual: Number(target.new_gmv_actual), renewalGmvTarget: Number(target.renewal_gmv_target), renewalGmvActual: Number(target.renewal_gmv_actual), updatedAt: String(target.updated_at),
        } : undefined,
        monthlyObservations: monthly.map((item) => {
          const month = item as Record<string, unknown>
          return { monthStart: String(month.month_start), monthLabel: String(month.month_label), newGmv: Number(month.new_gmv), renewalGmv: Number(month.renewal_gmv), officialPoints: Number(month.official_points) }
        }),
      } satisfies PersonalSalesWorkspace
    },
    async qualifyLead(leadId) {
      const { data, error } = await client.rpc('qualify_crm_lead', { p_lead_id: leadId })
      if (error) throw new SalesWorkbenchDataError(`转有效商机失败：${error.message}`, error)
      return String(data)
    },
    async recordStoreQualificationFacts(x){const{data,error}=await client.rpc('record_crm_store_qualification_facts',{p_store_id:x.storeId,p_area_sqm:x.areaSqm??null,p_private_room_count:x.privateRoomCount??null,p_is_landmark:x.isLandmark,p_is_takeaway_only:x.isTakeawayOnly});if(error)throw new SalesWorkbenchDataError(`保存门店资格事实失败：${error.message}`,error);return String(data)},
    async recordQualificationEvidence(x){const{data,error}=await client.rpc('record_crm_qualification_evidence',{p_lead_id:x.leadId,p_evidence_type:x.evidenceType,p_detail:x.detail,p_contact_id:x.contactId??null,p_meeting_at:x.meetingAt??null});if(error)throw new SalesWorkbenchDataError(`保存资格证据失败：${error.message}`,error);return String(data)},
    async loadCrmEditorOptions() {
      const [brands, regions, stores, contacts, leads] = await Promise.all([
        client.from('crm_brands').select('id,name,business_mode').order('name'), client.from('sales_regions').select('id,name').order('name'),
        client.from('crm_stores').select('id,brand_id,region_id,name,business_type,address').order('name'), client.from('crm_contacts').select('id,brand_id,store_id,name,title,is_key_person').order('name'),
        client.from('crm_leads').select('id,region_id,brand_id,store_id,title,source').order('created_at', { ascending: false }),
      ])
      const error = brands.error ?? regions.error ?? stores.error ?? contacts.error ?? leads.error
      if (error) throw new SalesWorkbenchDataError(`读取编辑数据失败：${error.message}`, error)
      return {
        brands: (brands.data ?? []).map(x => ({ id:String(x.id),name:String(x.name),businessMode:String(x.business_mode) })), regions:(regions.data??[]).map(x=>({id:String(x.id),name:String(x.name)})),
        stores:(stores.data??[]).map(x=>({id:String(x.id),brandId:x.brand_id?String(x.brand_id):undefined,regionId:String(x.region_id),name:String(x.name),businessType:String(x.business_type??''),address:String(x.address??'')})),
        contacts:(contacts.data??[]).map(x=>({id:String(x.id),brandId:x.brand_id?String(x.brand_id):undefined,storeId:x.store_id?String(x.store_id):undefined,name:String(x.name),title:String(x.title??''),isKeyPerson:x.is_key_person===true})),
        leads:(leads.data??[]).map(x=>({id:String(x.id),regionId:String(x.region_id),brandId:x.brand_id?String(x.brand_id):undefined,storeId:x.store_id?String(x.store_id):undefined,title:String(x.title),source:String(x.source??'')})),
      }
    },
    async upsertBrand(x){const{data,error}=await client.rpc('upsert_crm_brand',{p_id:x.id??null,p_name:x.name,p_business_mode:x.businessMode});if(error)throw new SalesWorkbenchDataError(`保存品牌失败：${error.message}`,error);return String(data)},
    async upsertStore(x){const{data,error}=await client.rpc('upsert_crm_store',{p_id:x.id??null,p_brand_id:x.brandId,p_region_id:x.regionId,p_name:x.name,p_business_type:x.businessType,p_address:x.address||null});if(error)throw new SalesWorkbenchDataError(`保存门店失败：${error.message}`,error);return String(data)},
    async upsertContact(x){const{data,error}=await client.rpc('upsert_crm_contact',{p_id:x.id??null,p_brand_id:x.brandId??null,p_store_id:x.storeId??null,p_name:x.name,p_title:x.title||null,p_is_key_person:x.isKeyPerson});if(error)throw new SalesWorkbenchDataError(`保存联系人失败：${error.message}`,error);return String(data)},
    async upsertLead(x){const{data,error}=await client.rpc('upsert_crm_lead',{p_id:x.id??null,p_region_id:x.regionId,p_brand_id:x.brandId??null,p_store_id:x.storeId??null,p_title:x.title,p_source:x.source||null});if(error)throw new SalesWorkbenchDataError(`保存线索失败：${error.message}`,error);return String(data)},
    async loadQuickLeadContext() {
      const { data, error } = await client.rpc('get_quick_lead_context')
      if (error) throw new SalesWorkbenchDataError(`读取线索区域失败：${error.message}`, error)
      const value = data as { regions?: Array<{ id: string; name: string }>; default_region_id?: string | null; requires_region_selection?: boolean } | null
      return { regions: (value?.regions ?? []).map((region) => ({ id: String(region.id), name: String(region.name) })), defaultRegionId: value?.default_region_id ? String(value.default_region_id) : undefined, requiresRegionSelection: value?.requires_region_selection === true }
    },
    async createQuickLead(input) {
      const { data, error } = await client.rpc('create_crm_lead_quick', { p_title: input.title.trim(), p_phone: input.phone.trim(), p_source: input.source.trim(), p_region_id: input.regionId ?? null })
      if (error) throw new SalesWorkbenchDataError(`新增线索失败：${error.message}`, error)
      return String(data)
    },
    async getQualificationStatus(leadId) {
      const { data, error } = await client.rpc('get_crm_lead_qualification_status', { p_lead_id: leadId })
      if (error) throw new SalesWorkbenchDataError(`读取资格状态失败：${error.message}`, error)
      const value = data as Record<string, unknown>
      return {
        leadId: String(value.lead_id), storeId: value.store_id ? String(value.store_id) : undefined,
        storeName: value.store_name ? String(value.store_name) : undefined,
        businessType: value.business_type ? String(value.business_type) : undefined,
        businessTypeLabel: value.business_type_label ? String(value.business_type_label) : undefined,
        areaSqm: value.area_sqm == null ? undefined : Number(value.area_sqm),
        privateRoomCount: value.private_room_count == null ? undefined : Number(value.private_room_count),
        isLandmark: value.is_landmark === true, isTakeawayOnly: value.is_takeaway_only === true,
        isRealStore: value.is_real_store === true,
        calculatedGrade: value.calculated_grade ? String(value.calculated_grade) as 'A'|'B'|'C'|'D' : undefined,
        gradeReason: String(value.grade_reason ?? ''), annualFeeViable: value.annual_fee_viable === true,
        keyPersonReady: value.key_person_ready === true, eligible: value.eligible === true,
        missingEvidence: Array.isArray(value.missing_evidence) ? value.missing_evidence.map(String) : [],
        nextAction: String(value.next_action ?? ''), opportunityId: value.opportunity_id ? String(value.opportunity_id) : undefined,
        demoRequiredBeforeDeposit: value.demo_required_before_deposit === true,
      }
    },
    async precheckLeadConversion(input) {
      const { data, error } = await client.rpc('precheck_crm_lead_conversion', { p_lead_id: input.leadId, p_brand_name: input.brandName.trim(), p_store_name: input.storeName.trim() })
      if (error) throw new SalesWorkbenchDataError(`客户去重预检失败：${error.message}`, error)
      const value = data as { brand_matches?: Array<Record<string, unknown>>; store_matches?: Array<Record<string, unknown>>; contact_matches?: Array<Record<string, unknown>> } | null
      const map = (items: Array<Record<string, unknown>> = []) => items.map((item) => ({ id: String(item.id), name: String(item.name), brandId: item.brand_id ? String(item.brand_id) : undefined, storeId: item.store_id ? String(item.store_id) : undefined, businessMode: item.business_mode ? String(item.business_mode) : undefined }))
      return { brands: map(value?.brand_matches), stores: map(value?.store_matches), contacts: map(value?.contact_matches) }
    },
    async convertLeadToCustomer(input) {
      const { data, error } = await client.rpc('convert_crm_lead_to_customer', {
        p_lead_id: input.leadId, p_brand_id: input.brandId ?? null, p_brand_name: input.brandName.trim(), p_business_mode: input.businessMode,
        p_store_id: input.storeId ?? null, p_store_name: input.storeName.trim(), p_business_type: input.businessType, p_address: input.address.trim() || null,
        p_contact_id: input.contactId ?? null, p_contact_name: input.contactName.trim(), p_contact_title: input.contactTitle.trim() || null, p_is_key_person: input.isKeyPerson,
      })
      if (error) throw new SalesWorkbenchDataError(`转客户失败：${error.message}`, error)
      const value = data as { brand_id: string; store_id: string; contact_id: string; idempotent?: boolean }
      return { brandId: String(value.brand_id), storeId: String(value.store_id), contactId: String(value.contact_id), idempotent: value.idempotent === true }
    },
  }
}
