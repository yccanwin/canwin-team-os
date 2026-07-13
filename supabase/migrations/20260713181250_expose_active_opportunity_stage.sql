-- Expose the active opportunity identity so the real UI can continue the chain.
create or replace view public.crm_leads_visible with(security_invoker=true)as
select l.id,case when l.owner_id=auth.uid()then'mine'::text else'region'::text end read_scope,
 coalesce(s.name,l.title)store_name,c.name contact_name,null::text masked_phone,r.name district_name,s.business_type,l.source,l.created_at,l.next_action_at,
 case when ao.id is not null then'opportunity' when l.status='qualified'then'qualified'when l.status='claimed'and l.last_effective_followup_at is not null then'contacted'else'new'end::text stage,
 coalesce((select array_agg(coalesce(f.new_business_fact,f.customer_commitment)order by f.occurred_at)from public.crm_followups f where f.lead_id=l.id and f.is_effective),array[]::text[])facts,
 l.status::text lead_status,p.name::text owner_display_name,(l.status='public'and l.owner_id is null)::boolean claimable,ao.id active_opportunity_id
from public.crm_leads l left join public.crm_stores s on s.id=l.store_id and s.team_id=l.team_id join public.sales_regions r on r.id=l.region_id and r.team_id=l.team_id
left join public.profiles p on p.id=l.owner_id and p.team_id=l.team_id
left join lateral(select o.id from public.crm_opportunities o where o.lead_id=l.id and o.qualification_superseded_at is null order by o.created_at desc limit 1)ao on true
left join lateral(select contact.name from public.crm_contacts contact where contact.team_id=l.team_id and(contact.store_id=l.store_id or(l.store_id is null and contact.brand_id=l.brand_id))order by contact.is_key_person desc,contact.created_at limit 1)c on true
where public.is_feature_enabled(l.team_id,'sales_os_v3')and public.crm_can_access_region(l.team_id,l.region_id,l.owner_id);
revoke all on public.crm_leads_visible from public,anon;grant select on public.crm_leads_visible to authenticated;notify pgrst,'reload schema';
