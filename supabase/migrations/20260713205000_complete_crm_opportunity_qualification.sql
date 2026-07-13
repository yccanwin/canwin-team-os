-- A6: expose server-derived qualification, keep promotion atomic, enforce the A-grade deposit gate.

create or replace function public.get_crm_lead_qualification_status(p_lead_id uuid)
returns jsonb language plpgsql security definer stable set search_path='' as $$
declare
  v_profile public.profiles;v_lead public.crm_leads;v_store public.crm_stores;v_brand public.crm_brands;
  v_grade text;v_grade_reason text;v_annual boolean;v_key_person boolean;v_real_store boolean;
  v_missing text[]:='{}';v_opportunity_id uuid;v_next_action text;
begin
  select p.* into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';
  select l.* into v_lead from public.crm_leads l where l.id=p_lead_id;
  if v_profile.id is null or v_lead.id is null or v_lead.team_id<>v_profile.team_id
    or not public.is_feature_enabled(v_profile.team_id,'sales_os_v3')
    or not public.has_permission(v_profile.team_id,'customers.manage')
    or not(v_lead.owner_id=v_profile.id or public.can_act_for(v_profile.team_id,v_lead.owner_id)
      or public.has_permission(v_profile.team_id,'customers.supervise'))
    or not public.crm_can_access_region(v_lead.team_id,v_lead.region_id,v_lead.owner_id)then
    raise exception 'QUALIFICATION_STATUS_FORBIDDEN' using errcode='42501';
  end if;
  select s.* into v_store from public.crm_stores s where s.id=v_lead.store_id and s.team_id=v_lead.team_id;
  if v_store.id is not null then select b.* into v_brand from public.crm_brands b where b.id=v_store.brand_id and b.team_id=v_store.team_id;end if;
  v_real_store:=v_store.id is not null and v_brand.id is not null and v_store.region_id=v_lead.region_id
    and v_store.brand_id is not distinct from v_lead.brand_id and v_store.store_status<>'closed';
  if v_real_store then
    v_grade:=public.crm_calculate_value_grade(v_store.id);
    v_grade_reason:=case when v_grade='D'then'纯外卖店退出有效漏斗'
      when v_grade='A'and v_brand.business_mode in('direct_chain','franchise_chain')then'连锁品牌自动判为 A'
      when v_grade='A'and v_store.business_type='banquet'then'宴会业态自动判为 A'
      when v_grade='A'and v_store.is_landmark then'标志性门店自动判为 A'
      when v_grade='B'and coalesce(v_store.area_sqm,0)>=300 then'面积达到 300㎡，自动判为 B'
      when v_grade='B'then'包厢达到 5 个，自动判为 B'
      else'未达到 A/B，年费证据通过后为 C'end;
  else v_grade_reason:='必须先关联营业中或筹备中的真实门店';end if;
  select
    exists(select 1 from public.crm_qualification_evidence e where e.lead_id=v_lead.id and e.evidence_type='annual_fee_viable'and not exists(select 1 from public.crm_qualification_evidence_revocations r where r.evidence_id=e.id)),
    exists(select 1 from public.crm_qualification_evidence e where e.lead_id=v_lead.id and(e.evidence_type='key_person_contacted'or(e.evidence_type='key_person_meeting_scheduled'and e.meeting_at>now()))and not exists(select 1 from public.crm_qualification_evidence_revocations r where r.evidence_id=e.id))
  into v_annual,v_key_person;
  select o.id into v_opportunity_id from public.crm_opportunities o where o.lead_id=v_lead.id and o.qualification_superseded_at is null order by o.created_at desc limit 1;
  if not v_real_store then v_missing:=array_append(v_missing,'真实门店');end if;
  if v_grade='D'then v_missing:=array_append(v_missing,'D级或纯外卖店退出漏斗');end if;
  if not coalesce(v_annual,false)then v_missing:=array_append(v_missing,'年费产品可以继续谈的事实');end if;
  if not coalesce(v_key_person,false)then v_missing:=array_append(v_missing,'已接触或明确约到关键人的证据');end if;
  v_next_action:=case when v_opportunity_id is not null then'进入报价流程'
    when not v_real_store then'先在线索中关联真实品牌、门店和区域'
    when v_grade='D'then'退出有效漏斗或由主管复核门店事实'
    when not coalesce(v_annual,false)then'补充年费产品可以继续谈的真实依据'
    when not coalesce(v_key_person,false)then'补充关键人已接触或预约证据'
    else'提交服务端判定并转为有效商机'end;
  return jsonb_build_object('lead_id',v_lead.id,'store_id',v_store.id,'store_name',v_store.name,
    'business_type',v_store.business_type,'business_type_label',case v_store.business_type when'fast_food'then'快餐'when'chinese'then'中餐'when'hotpot'then'火锅'when'barbecue'then'烧烤'when'beverage'then'饮品'when'bakery'then'烘焙'when'banquet'then'宴会'when'international'then'异国料理'else null end,
    'area_sqm',v_store.area_sqm,'private_room_count',v_store.private_room_count,'is_landmark',coalesce(v_store.is_landmark,false),'is_takeaway_only',coalesce(v_store.is_takeaway_only,false),
    'is_real_store',v_real_store,'calculated_grade',v_grade,'grade_reason',v_grade_reason,
    'annual_fee_viable',coalesce(v_annual,false),'key_person_ready',coalesce(v_key_person,false),
    'eligible',v_real_store and v_grade in('A','B','C')and v_annual and v_key_person,
    'missing_evidence',to_jsonb(v_missing),'next_action',v_next_action,'opportunity_id',v_opportunity_id,
    'demo_required_before_deposit',v_grade='A'and v_opportunity_id is null);
end $$;

create or replace function public.enforce_a_grade_demo_before_deposit()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_opportunity public.crm_opportunities;
begin
  select o.* into v_opportunity from public.crm_opportunities o where o.id=new.opportunity_id and o.team_id=new.team_id;
  if v_opportunity.id is null then raise exception 'ACTIVE_OPPORTUNITY_REQUIRED' using errcode='23514';end if;
  if v_opportunity.value_grade='A'and v_opportunity.demo_completed_at is null then
    raise exception 'A_GRADE_DEMO_REQUIRED_BEFORE_DEPOSIT' using errcode='23514';
  end if;
  return new;
end $$;
drop trigger if exists enforce_a_grade_demo_before_deposit on public.deal_orders;
create trigger enforce_a_grade_demo_before_deposit before insert on public.deal_orders
for each row execute function public.enforce_a_grade_demo_before_deposit();

revoke all on function public.get_crm_lead_qualification_status(uuid),public.enforce_a_grade_demo_before_deposit()from public,anon;
grant execute on function public.get_crm_lead_qualification_status(uuid)to authenticated;
notify pgrst,'reload schema';
