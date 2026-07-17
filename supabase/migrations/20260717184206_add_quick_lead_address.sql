-- Persist the optional address captured by the sales quick-lead form.

alter table public.crm_leads
  add column if not exists address text;

create or replace function public.create_crm_lead_quick_v2(
  p_title text,
  p_phone text,
  p_source text,
  p_region_id uuid default null,
  p_address text default null
) returns uuid
language plpgsql security definer set search_path='' as $create_crm_lead_quick_v2$
declare
  actor public.profiles;
  selected_region uuid;
  region_count integer;
  lead_row public.crm_leads;
begin
  select p.* into actor
  from public.profiles p
  where p.id=auth.uid() and p.status='active';

  if actor.id is null
    or not public.is_feature_enabled(actor.team_id,'sales_os_v3')
    or not public.has_permission(actor.team_id,'customers.manage') then
    raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';
  end if;
  if nullif(trim(p_title),'') is null
    or nullif(trim(p_phone),'') is null
    or nullif(trim(p_source),'') is null then
    raise exception 'QUICK_LEAD_REQUIRED_FIELDS' using errcode='22023';
  end if;

  select count(*) into region_count
  from public.profile_sales_regions psr
  join public.sales_regions sr on sr.id=psr.region_id and sr.team_id=psr.team_id
  where psr.profile_id=actor.id and psr.team_id=actor.team_id and sr.is_active;

  if p_region_id is not null then
    select psr.region_id into selected_region
    from public.profile_sales_regions psr
    join public.sales_regions sr on sr.id=psr.region_id and sr.team_id=psr.team_id
    where psr.profile_id=actor.id and psr.team_id=actor.team_id and sr.is_active
      and psr.region_id=p_region_id
    order by psr.is_primary desc,sr.name,sr.id
    limit 1;
    if selected_region is null then
      raise exception 'LEAD_REGION_NOT_ASSIGNED' using errcode='22023';
    end if;
  else
    select psr.region_id into selected_region
    from public.profile_sales_regions psr
    join public.sales_regions sr on sr.id=psr.region_id and sr.team_id=psr.team_id
    where psr.profile_id=actor.id and psr.team_id=actor.team_id and sr.is_active
      and (psr.is_primary or region_count=1)
    order by psr.is_primary desc,sr.name,sr.id
    limit 1;
  end if;

  if selected_region is null then
    raise exception 'LEAD_REGION_SELECTION_REQUIRED' using errcode='22023';
  end if;

  insert into public.crm_leads(
    team_id,region_id,title,contact_name,source,status,owner_id,claimed_at,created_by,address
  ) values (
    actor.team_id,selected_region,trim(p_title),trim(p_title),trim(p_source),'claimed',
    actor.id,now(),actor.id,nullif(trim(p_address),'')
  ) returning * into lead_row;

  insert into public.crm_lead_private(lead_id,team_id,phone,updated_by)
  values(lead_row.id,actor.team_id,trim(p_phone),actor.id);
  return lead_row.id;
end
$create_crm_lead_quick_v2$;

revoke all on function public.create_crm_lead_quick_v2(text,text,text,uuid,text)
  from public,anon;
grant execute on function public.create_crm_lead_quick_v2(text,text,text,uuid,text)
  to authenticated;

create or replace view public.crm_leads_visible with(security_invoker=true) as
select l.id,case when l.owner_id=auth.uid()then'mine'::text else'region'::text end read_scope,
 case when l.owner_id is not null and l.owner_id<>auth.uid()then'已占用线索'else coalesce(s.name,l.title)end store_name,
 case when l.owner_id is not null and l.owner_id<>auth.uid()then null else coalesce(c.name,l.contact_name)end contact_name,
 case when l.owner_id=auth.uid()then lp.phone else null end masked_phone,
 case when l.owner_id is not null and l.owner_id<>auth.uid()then null else r.name end district_name,
 case when l.owner_id is not null and l.owner_id<>auth.uid()then null else s.business_type end business_type,
 case when l.owner_id is not null and l.owner_id<>auth.uid()then null else l.source end source,
 case when l.owner_id is not null and l.owner_id<>auth.uid()then null else l.created_at end created_at,
 case when l.owner_id is not null and l.owner_id<>auth.uid()then null else l.next_action_at end next_action_at,
 case when l.owner_id is not null and l.owner_id<>auth.uid()then'new'when ao.id is not null then'opportunity' when l.status='qualified'then'qualified'when l.status='claimed'and l.last_effective_followup_at is not null then'contacted'else'new'end::text stage,
 case when l.owner_id is not null and l.owner_id<>auth.uid()then array[]::text[]else coalesce((select array_agg(coalesce(f.new_business_fact,f.customer_commitment)order by f.occurred_at)from public.crm_followups f where f.lead_id=l.id and f.is_effective),array[]::text[])end facts,
 case when l.owner_id is not null and l.owner_id<>auth.uid()then'occupied'else l.status end::text lead_status,p.name::text owner_display_name,
 (l.status='public'and l.owner_id is null)::boolean claimable,case when l.owner_id=auth.uid()then ao.id else null end active_opportunity_id,
 case
  when l.owner_id is null or l.owner_id<>auth.uid()then'none'
  when l.last_contact_attempt_at is null and(l.created_at at time zone'Asia/Shanghai')::date<=(now()at time zone'Asia/Shanghai')::date-2 then'uncontacted_48h'
  when l.last_contact_attempt_at is null and(l.created_at at time zone'Asia/Shanghai')::date<=(now()at time zone'Asia/Shanghai')::date-1 then'uncontacted_24h'
  when l.status in('claimed','qualified')and(coalesce(l.last_effective_followup_at,l.claimed_at,l.created_at)at time zone'Asia/Shanghai')::date<=(now()at time zone'Asia/Shanghai')::date-15 then'inactive_15d'
  else'none'end::text recycle_risk,
 case when l.owner_id is null or l.owner_id<>auth.uid()then null when l.last_contact_attempt_at is null then(((l.created_at at time zone'Asia/Shanghai')::date+2)::timestamp at time zone'Asia/Shanghai')
  else(((coalesce(l.last_effective_followup_at,l.claimed_at,l.created_at)at time zone'Asia/Shanghai')::date+15)::timestamp at time zone'Asia/Shanghai')end recycle_due_at,
 case when l.owner_id is null or l.owner_id<>auth.uid()then false else public.crm_lead_recycle_paused(l.team_id,l.id,l.owner_id,now())end::boolean recycle_paused,
 case when l.owner_id is not null and l.owner_id<>auth.uid()then null else l.address end address
from public.crm_leads l left join public.crm_stores s on s.id=l.store_id and s.team_id=l.team_id join public.sales_regions r on r.id=l.region_id and r.team_id=l.team_id
left join public.crm_lead_private lp on lp.lead_id=l.id and lp.team_id=l.team_id left join public.profiles p on p.id=l.owner_id and p.team_id=l.team_id
left join lateral(select o.id from public.crm_opportunities o where o.lead_id=l.id and o.qualification_superseded_at is null order by o.created_at desc limit 1)ao on true
left join lateral(select contact.name from public.crm_contacts contact where contact.team_id=l.team_id and(contact.store_id=l.store_id or(l.store_id is null and contact.brand_id=l.brand_id))order by contact.is_key_person desc,contact.created_at limit 1)c on true
where public.is_feature_enabled(l.team_id,'sales_os_v3')and public.crm_can_access_region(l.team_id,l.region_id,l.owner_id);

revoke all on public.crm_leads_visible from public,anon;
grant select on public.crm_leads_visible to authenticated;
notify pgrst,'reload schema';
