-- One-minute lead capture. Additive and isolated from 2.0 finance/case data.
alter table public.crm_leads add column if not exists contact_name text;
create table if not exists public.crm_lead_private (
  lead_id uuid primary key references public.crm_leads(id) on delete cascade,
  team_id text not null references public.teams(id) on delete cascade,
  phone text not null check (nullif(trim(phone),'') is not null),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);
alter table public.crm_lead_private enable row level security;
create policy "lead private readable by owner or sensitive supervisor" on public.crm_lead_private
for select to authenticated using (exists(select 1 from public.crm_leads l where l.id=lead_id and l.team_id=team_id and (l.owner_id=auth.uid() or public.has_permission(team_id,'customers.read_sensitive'))));

create or replace function public.get_quick_lead_context() returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.profiles; region_count integer; default_region uuid; regions jsonb;
begin
  select * into r from public.profiles where id=auth.uid() and status='active';
  if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3') or not public.has_permission(r.team_id,'customers.manage') then raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501'; end if;
  select count(*),max(psr.region_id) filter(where psr.is_primary),coalesce(jsonb_agg(jsonb_build_object('id',sr.id,'name',sr.name) order by psr.is_primary desc,sr.name),'[]'::jsonb)
  into region_count,default_region,regions from public.profile_sales_regions psr join public.sales_regions sr on sr.id=psr.region_id and sr.team_id=psr.team_id
  where psr.profile_id=r.id and psr.team_id=r.team_id and sr.is_active;
  if region_count=1 and default_region is null then select psr.region_id into default_region from public.profile_sales_regions psr join public.sales_regions sr on sr.id=psr.region_id where psr.profile_id=r.id and psr.team_id=r.team_id and sr.is_active limit 1; end if;
  return jsonb_build_object('regions',regions,'default_region_id',default_region,'requires_region_selection',region_count>1 and default_region is null);
end $$;

create or replace function public.create_crm_lead_quick(p_title text,p_phone text,p_source text,p_region_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.profiles; selected_region uuid; region_count integer; l public.crm_leads;
begin
  select * into r from public.profiles where id=auth.uid() and status='active';
  if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3') or not public.has_permission(r.team_id,'customers.manage') then raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501'; end if;
  if nullif(trim(p_title),'') is null or nullif(trim(p_phone),'') is null or nullif(trim(p_source),'') is null then raise exception 'QUICK_LEAD_REQUIRED_FIELDS' using errcode='22023'; end if;
  select count(*),coalesce(max(psr.region_id) filter(where psr.is_primary),max(psr.region_id) filter(where p_region_id=psr.region_id)) into region_count,selected_region
  from public.profile_sales_regions psr join public.sales_regions sr on sr.id=psr.region_id and sr.team_id=psr.team_id where psr.profile_id=r.id and psr.team_id=r.team_id and sr.is_active;
  if selected_region is null and region_count=1 then select psr.region_id into selected_region from public.profile_sales_regions psr join public.sales_regions sr on sr.id=psr.region_id where psr.profile_id=r.id and psr.team_id=r.team_id and sr.is_active limit 1; end if;
  if selected_region is null then raise exception 'LEAD_REGION_SELECTION_REQUIRED' using errcode='22023'; end if;
  insert into public.crm_leads(team_id,region_id,title,contact_name,source,status,owner_id,claimed_at,created_by) values(r.team_id,selected_region,trim(p_title),trim(p_title),trim(p_source),'claimed',r.id,now(),r.id) returning * into l;
  insert into public.crm_lead_private(lead_id,team_id,phone,updated_by) values(l.id,r.team_id,trim(p_phone),r.id);
  return l.id;
end $$;

create or replace view public.crm_leads_visible with(security_invoker=true) as
select l.id,case when l.owner_id=auth.uid()then'mine'::text else'region'::text end read_scope,coalesce(s.name,l.title)store_name,coalesce(c.name,l.contact_name)contact_name,
case when l.owner_id=auth.uid() then lp.phone else null end masked_phone,r.name district_name,s.business_type,l.source,l.created_at,l.next_action_at,
case when ao.id is not null then'opportunity' when l.status='qualified'then'qualified'when l.status='claimed'and l.last_effective_followup_at is not null then'contacted'else'new'end::text stage,
coalesce((select array_agg(coalesce(f.new_business_fact,f.customer_commitment)order by f.occurred_at)from public.crm_followups f where f.lead_id=l.id and f.is_effective),array[]::text[])facts,
l.status::text lead_status,p.name::text owner_display_name,(l.status='public'and l.owner_id is null)::boolean claimable,ao.id active_opportunity_id
from public.crm_leads l left join public.crm_stores s on s.id=l.store_id and s.team_id=l.team_id join public.sales_regions r on r.id=l.region_id and r.team_id=l.team_id
left join public.crm_lead_private lp on lp.lead_id=l.id and lp.team_id=l.team_id left join public.profiles p on p.id=l.owner_id and p.team_id=l.team_id
left join lateral(select o.id from public.crm_opportunities o where o.lead_id=l.id and o.qualification_superseded_at is null order by o.created_at desc limit 1)ao on true
left join lateral(select contact.name from public.crm_contacts contact where contact.team_id=l.team_id and(contact.store_id=l.store_id or(l.store_id is null and contact.brand_id=l.brand_id))order by contact.is_key_person desc,contact.created_at limit 1)c on true
where public.is_feature_enabled(l.team_id,'sales_os_v3')and public.crm_can_access_region(l.team_id,l.region_id,l.owner_id);

revoke all on public.crm_lead_private from public,anon; grant select on public.crm_lead_private to authenticated;
revoke all on function public.get_quick_lead_context(),public.create_crm_lead_quick(text,text,text,uuid) from public;
grant execute on function public.get_quick_lead_context(),public.create_crm_lead_quick(text,text,text,uuid) to authenticated;
revoke all on public.crm_leads_visible from public,anon; grant select on public.crm_leads_visible to authenticated;
notify pgrst,'reload schema';
