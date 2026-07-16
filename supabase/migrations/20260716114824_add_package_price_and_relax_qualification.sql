-- Packages have an independent standard selling price. Item totals remain a reference.
alter table public.deal_packages
  add column if not exists standard_price numeric(12,2) not null default 0
  check (standard_price >= 0);

create or replace function public.copy_package_price_into_catalog_draft()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.standard_price=0 then
    select p.standard_price into new.standard_price
    from public.deal_packages p
    join public.deal_catalog_versions v on v.id=p.catalog_version_id and v.team_id=p.team_id
    where p.team_id=new.team_id and p.code=new.code and v.status='published'
    order by v.version_no desc limit 1;
    new.standard_price:=coalesce(new.standard_price,0);
  end if;
  return new;
end $$;
drop trigger if exists copy_package_price_into_catalog_draft on public.deal_packages;
create trigger copy_package_price_into_catalog_draft before insert on public.deal_packages
for each row execute function public.copy_package_price_into_catalog_draft();

create or replace function public.manage_draft_package(
  p_package_id uuid,p_code text,p_name text,p_business_type text,p_standard_price numeric,
  p_is_active boolean,p_lines jsonb,p_idempotency_key uuid
)returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid;
begin
  if p_standard_price is null or p_standard_price<0 then
    raise exception 'PACKAGE_STANDARD_PRICE_INVALID' using errcode='22023';
  end if;
  result_id:=public.manage_draft_package(
    p_package_id,p_code,p_name,p_business_type,p_is_active,p_lines,p_idempotency_key
  );
  update public.deal_packages set standard_price=p_standard_price,updated_at=now() where id=result_id;
  return result_id;
end $$;

create or replace function public.get_package_admin_snapshot()
returns jsonb language plpgsql security definer stable set search_path='' as $$
declare actor public.profiles;current_version public.deal_catalog_versions;
begin
  select p.*into actor from public.profiles p where p.id=auth.uid()and p.status='active';
  if actor.id is null or not public.has_access_role(actor.team_id,array['owner','admin'])then raise exception'ADMIN_REQUIRED'using errcode='42501';end if;
  select v.*into current_version from public.deal_catalog_versions v where v.team_id=actor.team_id
    and v.status in('draft','published')order by case when v.status='draft'then 0 else 1 end,v.version_no desc limit 1;
  return jsonb_build_object('draftVersionId',current_version.id,'draftVersionNo',current_version.version_no,
    'currentVersionStatus',current_version.status,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'sku',i.sku,'name',i.name,'itemType',i.item_type,'listPrice',i.customer_list_price)
      order by i.item_type,i.name)from public.deal_catalog_items i where i.team_id=actor.team_id and i.catalog_version_id=current_version.id and i.is_active),'[]'::jsonb),
    'packages',coalesce((select jsonb_agg(jsonb_build_object('id',pkg.id,'code',pkg.code,'name',pkg.name,
      'businessType',pkg.business_type,'standardPrice',pkg.standard_price,
      'originalPrice',coalesce((select sum(i.customer_list_price*pi.quantity) from public.deal_package_items pi
        join public.deal_catalog_items i on i.id=pi.catalog_item_id and i.team_id=pi.team_id
        where pi.team_id=actor.team_id and pi.package_id=pkg.id),0),
      'isActive',pkg.is_active,'lines',coalesce((select jsonb_agg(jsonb_build_object(
        'catalogItemId',pi.catalog_item_id,'quantity',pi.quantity)order by i.name)from public.deal_package_items pi
        join public.deal_catalog_items i on i.id=pi.catalog_item_id and i.team_id=pi.team_id
        where pi.team_id=actor.team_id and pi.package_id=pkg.id),'[]'::jsonb))order by pkg.is_active desc,pkg.name)
      from public.deal_packages pkg where pkg.team_id=actor.team_id and pkg.catalog_version_id=current_version.id),'[]'::jsonb));
end $$;

revoke all on function public.copy_package_price_into_catalog_draft(),
  public.manage_draft_package(uuid,text,text,text,numeric,boolean,jsonb,uuid) from public,anon;
grant execute on function public.manage_draft_package(uuid,text,text,text,numeric,boolean,jsonb,uuid) to authenticated;

-- A confirmed phone is the only promotion gate. Other facts remain advisory.
create or replace function public.crm_is_valid_opportunity(
  target_grade text,target_annual_fee_viable boolean,
  target_key_person_contacted boolean,target_key_person_meeting_at timestamptz
)returns boolean language sql immutable set search_path='' as $$
  select target_grade in('A','B','C','D')
$$;

create or replace function public.crm_apply_opportunity_qualification()
returns trigger language plpgsql set search_path='' as $$
begin
  new.qualification_valid:=public.crm_is_valid_opportunity(new.value_grade,new.annual_fee_viable,new.key_person_contacted,new.key_person_meeting_at);
  new.qualification_reason:=case
    when not new.annual_fee_viable or(not new.key_person_contacted and new.key_person_meeting_at is null)
      then'Contact confirmed; auxiliary qualification facts can be completed later'
    else'Contact confirmed and auxiliary facts recorded'end;
  return new;
end $$;

create or replace function public.qualify_crm_lead(p_lead_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.profiles;lead_row public.crm_leads;store_row public.crm_stores;opportunity_row public.crm_opportunities;
  grade text:='C';annual_ok boolean:=false;contacted boolean:=false;meeting_time timestamptz;
begin
  select p.*into actor from public.profiles p where p.id=auth.uid()and p.status='active';
  if actor.id is null or not public.is_feature_enabled(actor.team_id,'sales_os_v3')
    or not public.has_permission(actor.team_id,'customers.manage')then raise exception'CRM_MANAGE_FORBIDDEN'using errcode='42501';end if;
  select l.*into lead_row from public.crm_leads l where l.id=p_lead_id for update;
  if lead_row.id is null or lead_row.team_id<>actor.team_id
    or not(lead_row.owner_id=actor.id or public.can_act_for(actor.team_id,lead_row.owner_id)or public.has_permission(actor.team_id,'customers.supervise'))
    or not public.crm_can_access_region(lead_row.team_id,lead_row.region_id,lead_row.owner_id)then raise exception'QUALIFY_FORBIDDEN'using errcode='42501';end if;
  select o.*into opportunity_row from public.crm_opportunities o where o.lead_id=lead_row.id and o.qualification_superseded_at is null;
  if opportunity_row.id is not null then return opportunity_row.id;end if;
  if lead_row.contactability_status<>'ready'or not exists(select 1 from public.crm_lead_private p where p.lead_id=lead_row.id and p.team_id=lead_row.team_id and nullif(trim(p.phone),'')is not null)
    then raise exception'LEAD_CONTACT_REQUIRED'using errcode='22023';end if;
  select s.*into store_row from public.crm_stores s where s.id=lead_row.store_id and s.team_id=lead_row.team_id;
  if store_row.id is not null then grade:=public.crm_calculate_value_grade(store_row.id);end if;
  select
    exists(select 1 from public.crm_qualification_evidence e where e.lead_id=lead_row.id and e.evidence_type='annual_fee_viable'and not exists(select 1 from public.crm_qualification_evidence_revocations v where v.evidence_id=e.id)),
    exists(select 1 from public.crm_qualification_evidence e where e.lead_id=lead_row.id and e.evidence_type='key_person_contacted'and not exists(select 1 from public.crm_qualification_evidence_revocations v where v.evidence_id=e.id)),
    (select max(e.meeting_at)from public.crm_qualification_evidence e where e.lead_id=lead_row.id and e.evidence_type='key_person_meeting_scheduled'and e.meeting_at>now()and not exists(select 1 from public.crm_qualification_evidence_revocations v where v.evidence_id=e.id))
  into annual_ok,contacted,meeting_time;
  insert into public.crm_opportunities(team_id,lead_id,brand_id,store_id,region_id,owner_id,value_grade,annual_fee_viable,key_person_contacted,key_person_meeting_at,created_by)
  values(lead_row.team_id,lead_row.id,lead_row.brand_id,lead_row.store_id,lead_row.region_id,lead_row.owner_id,grade,annual_ok,contacted,meeting_time,actor.id)
  on conflict(lead_id)where lead_id is not null and qualification_superseded_at is null do nothing returning *into opportunity_row;
  if opportunity_row.id is null then select o.*into opportunity_row from public.crm_opportunities o where o.lead_id=lead_row.id and o.qualification_superseded_at is null;end if;
  update public.crm_leads set status='qualified',updated_at=now()where id=lead_row.id;
  return opportunity_row.id;
end $$;

create or replace function public.get_crm_lead_qualification_status(p_lead_id uuid)
returns jsonb language plpgsql security definer stable set search_path='' as $$
declare actor public.profiles;lead_row public.crm_leads;store_row public.crm_stores;brand_row public.crm_brands;
  grade text:='C';grade_reason text;annual_ok boolean;key_person_ok boolean;contact_ready boolean;missing text[]:='{}';opportunity_id uuid;
begin
  select p.*into actor from public.profiles p where p.id=auth.uid()and p.status='active';
  select l.*into lead_row from public.crm_leads l where l.id=p_lead_id;
  if actor.id is null or lead_row.id is null or lead_row.team_id<>actor.team_id or not public.has_permission(actor.team_id,'customers.manage')
    or not(lead_row.owner_id=actor.id or public.can_act_for(actor.team_id,lead_row.owner_id)or public.has_permission(actor.team_id,'customers.supervise'))
    or not public.crm_can_access_region(lead_row.team_id,lead_row.region_id,lead_row.owner_id)then raise exception'QUALIFICATION_STATUS_FORBIDDEN'using errcode='42501';end if;
  select s.*into store_row from public.crm_stores s where s.id=lead_row.store_id and s.team_id=lead_row.team_id;
  if store_row.id is not null then select b.*into brand_row from public.crm_brands b where b.id=store_row.brand_id and b.team_id=store_row.team_id;grade:=public.crm_calculate_value_grade(store_row.id);end if;
  grade_reason:=case when store_row.id is null then'门店资料待补，暂按 C 级跟进'when grade='A'then'符合 A 类门店特征'when grade='B'then'符合 B 类门店特征'when grade='D'then'系统识别为 D 类，仍可先建立商机跟进'else'当前按 C 类跟进'end;
  contact_ready:=lead_row.contactability_status='ready'and exists(select 1 from public.crm_lead_private p where p.lead_id=lead_row.id and p.team_id=lead_row.team_id and nullif(trim(p.phone),'')is not null);
  select exists(select 1 from public.crm_qualification_evidence e where e.lead_id=lead_row.id and e.evidence_type='annual_fee_viable'and not exists(select 1 from public.crm_qualification_evidence_revocations r where r.evidence_id=e.id)),
    exists(select 1 from public.crm_qualification_evidence e where e.lead_id=lead_row.id and(e.evidence_type='key_person_contacted'or(e.evidence_type='key_person_meeting_scheduled'and e.meeting_at>now()))and not exists(select 1 from public.crm_qualification_evidence_revocations r where r.evidence_id=e.id))
  into annual_ok,key_person_ok;
  if store_row.id is null then missing:=array_append(missing,'门店资料');end if;if not annual_ok then missing:=array_append(missing,'年费沟通事实');end if;if not key_person_ok then missing:=array_append(missing,'关键人信息');end if;
  select o.id into opportunity_id from public.crm_opportunities o where o.lead_id=lead_row.id and o.qualification_superseded_at is null order by o.created_at desc limit 1;
  return jsonb_build_object('lead_id',lead_row.id,'contact_name',lead_row.contact_name,'contactability_ready',contact_ready,
    'store_id',store_row.id,'store_name',store_row.name,'business_type',store_row.business_type,
    'business_type_label',case store_row.business_type when'fast_food'then'快餐'when'chinese'then'中餐'when'hotpot'then'火锅'when'barbecue'then'烧烤'when'beverage'then'饮品'when'bakery'then'烘焙'when'banquet'then'宴会'when'international'then'异国料理'else null end,
    'area_sqm',store_row.area_sqm,'private_room_count',store_row.private_room_count,'is_landmark',coalesce(store_row.is_landmark,false),'is_takeaway_only',coalesce(store_row.is_takeaway_only,false),
    'is_real_store',store_row.id is not null,'calculated_grade',grade,'grade_reason',grade_reason,'annual_fee_viable',coalesce(annual_ok,false),'key_person_ready',coalesce(key_person_ok,false),
    'eligible',contact_ready,'missing_evidence',to_jsonb(missing),'next_action',case when opportunity_id is not null then'进入报价流程'when contact_ready then'可立即转为商机'else'填写联系电话后即可转商机'end,
    'opportunity_id',opportunity_id,'demo_required_before_deposit',grade='A'and opportunity_id is null);
end $$;

revoke all on function public.crm_apply_opportunity_qualification(),public.qualify_crm_lead(uuid),public.get_crm_lead_qualification_status(uuid)from public,anon;
grant execute on function public.qualify_crm_lead(uuid),public.get_crm_lead_qualification_status(uuid)to authenticated;
notify pgrst,'reload schema';
