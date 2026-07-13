-- Expose server-calculated risk indicators without allowing client-side recycling.
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
 case when l.owner_id is null or l.owner_id<>auth.uid()then false else public.crm_lead_recycle_paused(l.team_id,l.id,l.owner_id,now())end::boolean recycle_paused
from public.crm_leads l left join public.crm_stores s on s.id=l.store_id and s.team_id=l.team_id join public.sales_regions r on r.id=l.region_id and r.team_id=l.team_id
left join public.crm_lead_private lp on lp.lead_id=l.id and lp.team_id=l.team_id left join public.profiles p on p.id=l.owner_id and p.team_id=l.team_id
left join lateral(select o.id from public.crm_opportunities o where o.lead_id=l.id and o.qualification_superseded_at is null order by o.created_at desc limit 1)ao on true
left join lateral(select contact.name from public.crm_contacts contact where contact.team_id=l.team_id and(contact.store_id=l.store_id or(l.store_id is null and contact.brand_id=l.brand_id))order by contact.is_key_person desc,contact.created_at limit 1)c on true
where public.is_feature_enabled(l.team_id,'sales_os_v3')and public.crm_can_access_region(l.team_id,l.region_id,l.owner_id);
revoke all on public.crm_leads_visible from public,anon;
grant select on public.crm_leads_visible to authenticated;
notify pgrst,'reload schema';
