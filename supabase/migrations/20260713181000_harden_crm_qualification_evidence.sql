-- CRM qualification compensation: replace the forgeable 180000 mutations.
-- Additive facts/evidence are persisted; qualification no longer trusts UI grades or booleans.

alter table public.crm_stores
  add column if not exists is_landmark boolean not null default false,
  add column if not exists is_takeaway_only boolean not null default false;

alter table public.crm_opportunities
  add column if not exists qualification_superseded_at timestamptz;

-- Preserve pre-fix duplicates but allow only one active opportunity per lead afterwards.
with ranked as (
  select id, row_number() over (partition by lead_id order by created_at, id) as rn
  from public.crm_opportunities where lead_id is not null and qualification_superseded_at is null
)
update public.crm_opportunities o set qualification_superseded_at=now()
from ranked r where r.id=o.id and r.rn>1;

create unique index if not exists crm_opportunities_one_active_per_lead_idx
  on public.crm_opportunities(lead_id)
  where lead_id is not null and qualification_superseded_at is null;

create table if not exists public.crm_qualification_evidence (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  evidence_type text not null check (evidence_type in
    ('annual_fee_viable','key_person_contacted','key_person_meeting_scheduled')),
  contact_id uuid references public.crm_contacts(id) on delete restrict,
  detail text not null,
  meeting_at timestamptz,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id,evidence_type),
  check ((evidence_type='annual_fee_viable' and contact_id is null and meeting_at is null)
    or (evidence_type='key_person_contacted' and contact_id is not null and meeting_at is null)
    or (evidence_type='key_person_meeting_scheduled' and contact_id is not null and meeting_at is not null))
);

alter table public.crm_qualification_evidence enable row level security;
create policy "sales os v3 server gate" on public.crm_qualification_evidence as restrictive
for all to authenticated using (public.is_feature_enabled(team_id,'sales_os_v3'))
with check (public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "qualification evidence scoped read" on public.crm_qualification_evidence
for select to authenticated using (exists (
  select 1 from public.crm_leads l where l.id=lead_id and l.team_id=team_id
    and public.crm_can_access_region(l.team_id,l.region_id,l.owner_id)
));
revoke insert,update,delete on public.crm_qualification_evidence from authenticated;
revoke all on public.crm_qualification_evidence from anon;
grant select on public.crm_qualification_evidence to authenticated;

create or replace function public.crm_validate_qualification_evidence()
returns trigger language plpgsql set search_path='' as $$
declare l public.crm_leads;c public.crm_contacts;
begin
  select * into l from public.crm_leads where id=new.lead_id;
  if l.id is null or l.team_id<>new.team_id or not exists(
    select 1 from public.profiles p where p.id=new.recorded_by and p.team_id=new.team_id
  ) then
    raise exception 'QUALIFICATION_EVIDENCE_CROSS_TEAM' using errcode='23514';
  end if;
  if new.contact_id is not null then
    select * into c from public.crm_contacts where id=new.contact_id;
    if c.id is null or c.team_id<>new.team_id or not c.is_key_person
      or not (c.store_id=l.store_id or (c.store_id is null and c.brand_id=l.brand_id)) then
      raise exception 'KEY_PERSON_EVIDENCE_MISMATCH' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists crm_qualification_evidence_guard on public.crm_qualification_evidence;
create trigger crm_qualification_evidence_guard before insert or update
on public.crm_qualification_evidence for each row execute function public.crm_validate_qualification_evidence();

create or replace function public.upsert_crm_brand(p_id uuid,p_name text,p_business_mode text default 'independent') returns uuid
language plpgsql security definer set search_path='' as $$declare r public.profiles;b public.crm_brands;begin
 select * into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')or not public.has_permission(r.team_id,'customers.manage')then raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';end if;
 if nullif(trim(p_name),'') is null or p_business_mode not in('independent','direct_chain','franchise_chain') then raise exception 'INVALID_BRAND' using errcode='22023';end if;
 if p_id is null then insert into public.crm_brands(team_id,name,business_mode,owner_id,created_by)values(r.team_id,trim(p_name),p_business_mode,r.id,r.id)returning * into b;
 else select * into b from public.crm_brands where id=p_id for update;if b.id is null or b.team_id<>r.team_id or not(b.owner_id=r.id or public.has_permission(r.team_id,'customers.supervise'))then raise exception 'BRAND_FORBIDDEN' using errcode='42501';end if;update public.crm_brands set name=trim(p_name),business_mode=p_business_mode,updated_at=now()where id=p_id returning * into b;end if;return b.id;end$$;

create or replace function public.upsert_crm_store(p_id uuid,p_brand_id uuid,p_region_id uuid,p_name text,p_business_type text,p_address text default null) returns uuid
language plpgsql security definer set search_path='' as $$declare r public.profiles;s public.crm_stores;b public.crm_brands;begin
 select * into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')or not public.has_permission(r.team_id,'customers.manage')then raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';end if;
 if not public.crm_can_access_region(r.team_id,p_region_id,r.id) then raise exception 'STORE_REGION_FORBIDDEN' using errcode='42501';end if;
 select * into b from public.crm_brands where id=p_brand_id and team_id=r.team_id;
 if b.id is null or nullif(trim(p_name),'')is null or p_business_type not in('fast_food','chinese','hotpot','barbecue','beverage','bakery','banquet','international')then raise exception 'INVALID_STORE' using errcode='22023';end if;
 if p_id is null then insert into public.crm_stores(team_id,brand_id,region_id,name,address,business_type,owner_id,created_by)values(r.team_id,b.id,p_region_id,trim(p_name),nullif(trim(p_address),''),p_business_type,r.id,r.id)returning * into s;
 else select * into s from public.crm_stores where id=p_id for update;if s.id is null or s.team_id<>r.team_id or not(s.owner_id=r.id or public.has_permission(r.team_id,'customers.supervise'))or not public.crm_can_access_region(s.team_id,s.region_id,s.owner_id)then raise exception 'STORE_FORBIDDEN' using errcode='42501';end if;update public.crm_stores set brand_id=b.id,region_id=p_region_id,name=trim(p_name),address=nullif(trim(p_address),''),business_type=p_business_type,updated_at=now()where id=p_id returning * into s;end if;return s.id;end$$;

create or replace function public.upsert_crm_contact(p_id uuid,p_brand_id uuid,p_store_id uuid,p_name text,p_title text,p_is_key_person boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$declare r public.profiles;c public.crm_contacts;s public.crm_stores;b public.crm_brands;begin
 select * into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')or not public.has_permission(r.team_id,'customers.manage')then raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';end if;if nullif(trim(p_name),'')is null or(p_brand_id is null and p_store_id is null)then raise exception 'INVALID_CONTACT' using errcode='22023';end if;
 if p_store_id is not null then select * into s from public.crm_stores where id=p_store_id and team_id=r.team_id;if s.id is null or not public.crm_can_access_region(s.team_id,s.region_id,s.owner_id)or(p_brand_id is not null and p_brand_id is distinct from s.brand_id)then raise exception 'CONTACT_STORE_MISMATCH' using errcode='22023';end if; b.id:=s.brand_id;
 else select * into b from public.crm_brands where id=p_brand_id and team_id=r.team_id;if b.id is null or not(b.owner_id=r.id or public.has_permission(r.team_id,'customers.supervise'))then raise exception 'CONTACT_BRAND_FORBIDDEN' using errcode='42501';end if;end if;
 if p_id is null then insert into public.crm_contacts(team_id,brand_id,store_id,name,title,is_key_person,owner_id,created_by)values(r.team_id,coalesce(p_brand_id,b.id),p_store_id,trim(p_name),nullif(trim(p_title),''),p_is_key_person,r.id,r.id)returning * into c;
 else select * into c from public.crm_contacts where id=p_id for update;if c.id is null or c.team_id<>r.team_id or not(c.owner_id=r.id or public.has_permission(r.team_id,'customers.supervise'))then raise exception 'CONTACT_FORBIDDEN' using errcode='42501';end if;update public.crm_contacts set brand_id=coalesce(p_brand_id,b.id),store_id=p_store_id,name=trim(p_name),title=nullif(trim(p_title),''),is_key_person=p_is_key_person,updated_at=now()where id=p_id returning * into c;end if;return c.id;end$$;

create or replace function public.upsert_crm_lead(p_id uuid,p_region_id uuid,p_brand_id uuid,p_store_id uuid,p_title text,p_source text default null) returns uuid
language plpgsql security definer set search_path='' as $$declare r public.profiles;l public.crm_leads;s public.crm_stores;b public.crm_brands;begin
 select * into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')or not public.has_permission(r.team_id,'customers.manage')then raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';end if;if not public.crm_can_access_region(r.team_id,p_region_id,r.id)then raise exception 'LEAD_REGION_FORBIDDEN' using errcode='42501';end if;if nullif(trim(p_title),'')is null then raise exception 'INVALID_LEAD' using errcode='22023';end if;
 if p_store_id is not null then select * into s from public.crm_stores where id=p_store_id and team_id=r.team_id;if s.id is null or s.region_id<>p_region_id or(p_brand_id is not null and p_brand_id is distinct from s.brand_id)then raise exception 'LEAD_STORE_REGION_MISMATCH' using errcode='22023';end if;b.id:=s.brand_id;
 elsif p_brand_id is not null then select * into b from public.crm_brands where id=p_brand_id and team_id=r.team_id;if b.id is null or not(b.owner_id=r.id or public.has_permission(r.team_id,'customers.supervise'))then raise exception 'LEAD_BRAND_FORBIDDEN' using errcode='42501';end if;end if;
 if p_id is null then insert into public.crm_leads(team_id,region_id,brand_id,store_id,title,source,status,owner_id,claimed_at,created_by)values(r.team_id,p_region_id,coalesce(p_brand_id,b.id),p_store_id,trim(p_title),nullif(trim(p_source),''),'claimed',r.id,now(),r.id)returning * into l;
 else select * into l from public.crm_leads where id=p_id for update;if l.id is null or l.team_id<>r.team_id or not(l.owner_id=r.id or public.has_permission(r.team_id,'customers.supervise'))or not public.crm_can_access_region(l.team_id,l.region_id,l.owner_id)then raise exception 'LEAD_FORBIDDEN' using errcode='42501';end if;update public.crm_leads set region_id=p_region_id,brand_id=coalesce(p_brand_id,b.id),store_id=p_store_id,title=trim(p_title),source=nullif(trim(p_source),''),updated_at=now()where id=p_id returning * into l;end if;return l.id;end$$;

create or replace function public.record_crm_store_qualification_facts(p_store_id uuid,p_area_sqm numeric,p_private_room_count integer,p_is_landmark boolean,p_is_takeaway_only boolean) returns uuid
language plpgsql security definer set search_path='' as $$declare r public.profiles;s public.crm_stores;begin
 select * into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')or not public.has_permission(r.team_id,'customers.manage')then raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';end if;select * into s from public.crm_stores where id=p_store_id for update;
 if s.id is null or s.team_id<>r.team_id or not(s.owner_id=r.id or public.has_permission(r.team_id,'customers.supervise'))or not public.crm_can_access_region(s.team_id,s.region_id,s.owner_id)then raise exception 'STORE_FACTS_FORBIDDEN' using errcode='42501';end if;
 if p_area_sqm is not null and p_area_sqm<0 or p_private_room_count is not null and p_private_room_count<0 then raise exception 'INVALID_STORE_FACTS' using errcode='22023';end if;
 update public.crm_stores set area_sqm=p_area_sqm,private_room_count=p_private_room_count,is_landmark=coalesce(p_is_landmark,false),is_takeaway_only=coalesce(p_is_takeaway_only,false),updated_at=now()where id=s.id;return s.id;end$$;

create or replace function public.record_crm_qualification_evidence(p_lead_id uuid,p_evidence_type text,p_detail text,p_contact_id uuid default null,p_meeting_at timestamptz default null) returns uuid
language plpgsql security definer set search_path='' as $$declare r public.profiles;l public.crm_leads;e public.crm_qualification_evidence;begin
 select * into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')or not public.has_permission(r.team_id,'customers.manage')then raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';end if;select * into l from public.crm_leads where id=p_lead_id for update;
 if l.id is null or l.team_id<>r.team_id or not(l.owner_id=r.id or public.can_act_for(r.team_id,l.owner_id)or public.has_permission(r.team_id,'customers.supervise'))or not public.crm_can_access_region(l.team_id,l.region_id,l.owner_id)then raise exception 'EVIDENCE_FORBIDDEN' using errcode='42501';end if;
 if p_evidence_type not in('annual_fee_viable','key_person_contacted','key_person_meeting_scheduled')or nullif(trim(p_detail),'')is null then raise exception 'INVALID_QUALIFICATION_EVIDENCE' using errcode='22023';end if;
 if p_evidence_type='annual_fee_viable' and(p_contact_id is not null or p_meeting_at is not null)or p_evidence_type='key_person_contacted' and(p_contact_id is null or p_meeting_at is not null)or p_evidence_type='key_person_meeting_scheduled' and(p_contact_id is null or p_meeting_at is null or p_meeting_at<=now())then raise exception 'INVALID_QUALIFICATION_EVIDENCE' using errcode='22023';end if;
 insert into public.crm_qualification_evidence(team_id,lead_id,evidence_type,contact_id,detail,meeting_at,recorded_by)
 values(l.team_id,l.id,p_evidence_type,p_contact_id,trim(p_detail),p_meeting_at,r.id)
 on conflict(lead_id,evidence_type)do update set contact_id=excluded.contact_id,detail=excluded.detail,meeting_at=excluded.meeting_at,recorded_by=excluded.recorded_by,recorded_at=now(),updated_at=now() returning * into e;return e.id;end$$;

create or replace function public.crm_calculate_value_grade(p_store_id uuid)
returns text language sql security definer set search_path='' stable as $$
 select case when s.is_takeaway_only then 'D'
   when b.business_mode in('direct_chain','franchise_chain')or s.business_type='banquet'or s.is_landmark then 'A'
   when coalesce(s.area_sqm,0)>=300 or coalesce(s.private_room_count,0)>=5 then 'B'
   else 'C' end
 from public.crm_stores s join public.crm_brands b on b.id=s.brand_id and b.team_id=s.team_id where s.id=p_store_id
$$;
revoke all on function public.crm_calculate_value_grade(uuid) from public;

-- Delete the unsafe 180000 endpoint; callers must use the evidence RPC then this UUID-only RPC.
revoke all on function public.qualify_crm_lead(uuid,text,boolean,boolean,timestamptz) from public;
drop function public.qualify_crm_lead(uuid,text,boolean,boolean,timestamptz);

create or replace function public.qualify_crm_lead(p_lead_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$declare r public.profiles;l public.crm_leads;s public.crm_stores;o public.crm_opportunities;g text;annual_ok boolean;contacted boolean;meeting_time timestamptz;begin
 select * into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')or not public.has_permission(r.team_id,'customers.manage')then raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';end if;select * into l from public.crm_leads where id=p_lead_id for update;
 if l.id is null or l.team_id<>r.team_id or not(l.owner_id=r.id or public.can_act_for(r.team_id,l.owner_id)or public.has_permission(r.team_id,'customers.supervise'))or not public.crm_can_access_region(l.team_id,l.region_id,l.owner_id)then raise exception 'QUALIFY_FORBIDDEN' using errcode='42501';end if;
 select * into o from public.crm_opportunities where lead_id=l.id and qualification_superseded_at is null;if o.id is not null then return o.id;end if;
 select * into s from public.crm_stores where id=l.store_id and team_id=l.team_id;if s.id is null or s.brand_id is null or s.region_id<>l.region_id or s.brand_id is distinct from l.brand_id or s.store_status='closed'then raise exception 'REAL_STORE_REQUIRED' using errcode='22023';end if;
 g:=public.crm_calculate_value_grade(s.id);if g='D'then raise exception 'D_GRADE_OUTSIDE_FUNNEL' using errcode='22023';end if;
 select exists(select 1 from public.crm_qualification_evidence e where e.lead_id=l.id and e.evidence_type='annual_fee_viable'),exists(select 1 from public.crm_qualification_evidence e where e.lead_id=l.id and e.evidence_type='key_person_contacted'),(select max(e.meeting_at)from public.crm_qualification_evidence e where e.lead_id=l.id and e.evidence_type='key_person_meeting_scheduled'and e.meeting_at>now())into annual_ok,contacted,meeting_time;
 if not annual_ok or not(contacted or meeting_time is not null)then raise exception 'OPPORTUNITY_QUALIFICATION_EVIDENCE_REQUIRED' using errcode='22023';end if;
 insert into public.crm_opportunities(team_id,lead_id,brand_id,store_id,region_id,owner_id,value_grade,annual_fee_viable,key_person_contacted,key_person_meeting_at,created_by)
 values(l.team_id,l.id,l.brand_id,l.store_id,l.region_id,l.owner_id,g,true,contacted,meeting_time,r.id)
 on conflict(lead_id)where lead_id is not null and qualification_superseded_at is null do nothing returning * into o;
 if o.id is null then select * into o from public.crm_opportunities where lead_id=l.id and qualification_superseded_at is null;end if;
 update public.crm_leads set status='qualified',updated_at=now()where id=l.id;return o.id;end$$;

revoke all on function public.upsert_crm_brand(uuid,text,text),public.upsert_crm_store(uuid,uuid,uuid,text,text,text),public.upsert_crm_contact(uuid,uuid,uuid,text,text,boolean),public.upsert_crm_lead(uuid,uuid,uuid,uuid,text,text),public.record_crm_store_qualification_facts(uuid,numeric,integer,boolean,boolean),public.record_crm_qualification_evidence(uuid,text,text,uuid,timestamptz),public.qualify_crm_lead(uuid) from public;
grant execute on function public.upsert_crm_brand(uuid,text,text),public.upsert_crm_store(uuid,uuid,uuid,text,text,text),public.upsert_crm_contact(uuid,uuid,uuid,text,text,boolean),public.upsert_crm_lead(uuid,uuid,uuid,uuid,text,text),public.record_crm_store_qualification_facts(uuid,numeric,integer,boolean,boolean),public.record_crm_qualification_evidence(uuid,text,text,uuid,timestamptz),public.qualify_crm_lead(uuid) to authenticated;

-- Opportunity writes are only legal through the server qualification RPC.
revoke insert,update,delete on public.crm_opportunities from authenticated;
notify pgrst,'reload schema';
