import type { SupabaseClient } from '@supabase/supabase-js'
import { SalesWorkbenchDataError, type LeadReadScope, type SalesWorkbenchDataSource } from './dataSource'
import type { CustomerBrandSummary, CustomerContactSummary, CustomerStoreSummary, FollowUpDraft, LeadStage, SalesAssessmentSummary, SalesLead } from './types'

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
  }
}

function firstRow(data: unknown): SalesLead {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') throw new SalesWorkbenchDataError('服务器未返回线索数据')
  return toLead(row as LeadRow)
}

export function createSupabaseSalesWorkbenchDataSource(client: SupabaseClient): SalesWorkbenchDataSource {
  return {
    async listLeads(scope: LeadReadScope) {
      const query = client.from('crm_leads_visible').select('id,read_scope,store_name,contact_name,masked_phone,district_name,business_type,source,created_at,next_action_at,stage,facts,lead_status,owner_display_name,claimable,active_opportunity_id').eq('read_scope', scope).order('created_at', { ascending: false })
      const { data, error } = await query
      if (error) throw new SalesWorkbenchDataError(`读取${scope === 'mine' ? '本人' : '区域'}线索失败：${error.message}`, error)
      return (data ?? []).map((row) => toLead(row as LeadRow))
    },
    async claimLead(leadId: string) {
      const { data, error } = await client.rpc('claim_crm_lead', { p_lead_id: leadId })
      if (error) throw new SalesWorkbenchDataError(`领取线索失败：${error.message}`, error)
      return firstRow(data)
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
    async listMyAssessments() {
      const { data: authData, error: authError } = await client.auth.getUser()
      if (authError || !authData.user) throw new SalesWorkbenchDataError(`读取当前用户失败：${authError?.message ?? '未登录'}`, authError)
      const { data, error } = await client.from('sales_assessments')
        .select('id,period_quarter,point_target,new_gmv_target,new_gmv_actual,renewal_gmv_target,renewal_gmv_actual')
        .contains('salesperson_ids', [authData.user.id])
        .order('period_quarter', { ascending: false })
      if (error) throw new SalesWorkbenchDataError(`读取我的目标失败：${error.message}`, error)
      return (data ?? []).map((row): SalesAssessmentSummary => ({
        id: String(row.id), periodQuarter: String(row.period_quarter), pointTarget: Number(row.point_target),
        newGmvTarget: Number(row.new_gmv_target), newGmvActual: Number(row.new_gmv_actual),
        renewalGmvTarget: Number(row.renewal_gmv_target), renewalGmvActual: Number(row.renewal_gmv_actual),
      }))
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
  }
}
