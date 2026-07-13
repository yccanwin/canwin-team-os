-- P0 compensation: qualification evidence is immutable and revocation is a separate event.

alter table public.crm_qualification_evidence
  drop constraint if exists crm_qualification_evidence_lead_id_evidence_type_key;

create table public.crm_qualification_evidence_revocations (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  evidence_id uuid not null unique references public.crm_qualification_evidence(id) on delete restrict,
  reason text not null,
  revoked_by uuid not null references public.profiles(id) on delete restrict,
  revoked_at timestamptz not null default now()
);

alter table public.crm_qualification_evidence_revocations enable row level security;
create policy "sales os v3 server gate" on public.crm_qualification_evidence_revocations
as restrictive for all to authenticated
using(public.is_feature_enabled(crm_qualification_evidence_revocations.team_id,'sales_os_v3'))
with check(public.is_feature_enabled(crm_qualification_evidence_revocations.team_id,'sales_os_v3'));
create policy "qualification revocations scoped read" on public.crm_qualification_evidence_revocations
for select to authenticated using(exists(
  select 1 from public.crm_qualification_evidence e
  join public.crm_leads l on l.id=e.lead_id and l.team_id=e.team_id
  where e.id=crm_qualification_evidence_revocations.evidence_id
    and e.team_id=crm_qualification_evidence_revocations.team_id
    and public.crm_can_access_region(l.team_id,l.region_id,l.owner_id)
));
revoke all on public.crm_qualification_evidence_revocations from anon;
revoke insert,update,delete on public.crm_qualification_evidence_revocations from authenticated;
grant select on public.crm_qualification_evidence_revocations to authenticated;

create or replace function public.crm_reject_evidence_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'QUALIFICATION_EVIDENCE_APPEND_ONLY' using errcode='55000';
end $$;
drop trigger if exists crm_qualification_evidence_append_only on public.crm_qualification_evidence;
create trigger crm_qualification_evidence_append_only before update or delete
on public.crm_qualification_evidence for each row execute function public.crm_reject_evidence_mutation();
create trigger crm_qualification_revocation_append_only before update or delete
on public.crm_qualification_evidence_revocations for each row execute function public.crm_reject_evidence_mutation();

create or replace function public.crm_validate_evidence_revocation()
returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.crm_qualification_evidence e
      where e.id=new.evidence_id and e.team_id=new.team_id)
    or not exists(select 1 from public.profiles p
      where p.id=new.revoked_by and p.team_id=new.team_id) then
    raise exception 'QUALIFICATION_REVOCATION_CROSS_TEAM' using errcode='23514';
  end if;
  return new;
end $$;
create trigger crm_qualification_revocation_guard before insert
on public.crm_qualification_evidence_revocations for each row
execute function public.crm_validate_evidence_revocation();

create or replace function public.record_crm_qualification_evidence(
  p_lead_id uuid,p_evidence_type text,p_detail text,
  p_contact_id uuid default null,p_meeting_at timestamptz default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.profiles;l public.crm_leads;e public.crm_qualification_evidence;
begin
  select p.* into r from public.profiles p where p.id=auth.uid()and p.status='active';
  if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')
    or not public.has_permission(r.team_id,'customers.manage') then
    raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';
  end if;
  select lead.* into l from public.crm_leads lead where lead.id=p_lead_id for update;
  if l.id is null or l.team_id<>r.team_id
    or not(l.owner_id=r.id or public.can_act_for(r.team_id,l.owner_id)
      or public.has_permission(r.team_id,'customers.supervise'))
    or not public.crm_can_access_region(l.team_id,l.region_id,l.owner_id) then
    raise exception 'EVIDENCE_FORBIDDEN' using errcode='42501';
  end if;
  if p_evidence_type not in('annual_fee_viable','key_person_contacted','key_person_meeting_scheduled')
    or nullif(trim(p_detail),'')is null then
    raise exception 'INVALID_QUALIFICATION_EVIDENCE' using errcode='22023';
  end if;
  if p_evidence_type='annual_fee_viable' and(p_contact_id is not null or p_meeting_at is not null)
    or p_evidence_type='key_person_contacted' and(p_contact_id is null or p_meeting_at is not null)
    or p_evidence_type='key_person_meeting_scheduled'
      and(p_contact_id is null or p_meeting_at is null or p_meeting_at<=now()) then
    raise exception 'INVALID_QUALIFICATION_EVIDENCE' using errcode='22023';
  end if;
  insert into public.crm_qualification_evidence
    (team_id,lead_id,evidence_type,contact_id,detail,meeting_at,recorded_by)
  values(l.team_id,l.id,p_evidence_type,p_contact_id,trim(p_detail),p_meeting_at,r.id)
  returning * into e;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
  values(e.team_id,r.id,'crm.qualification_evidence_recorded','crm_qualification_evidence',e.id,
    null,to_jsonb(e));
  return e.id;
end $$;

create or replace function public.revoke_crm_qualification_evidence(
  p_evidence_id uuid,p_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.profiles;e public.crm_qualification_evidence;l public.crm_leads;v public.crm_qualification_evidence_revocations;
begin
  select p.* into r from public.profiles p where p.id=auth.uid()and p.status='active';
  if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')
    or not public.has_permission(r.team_id,'customers.manage') then
    raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';
  end if;
  select evidence.* into e from public.crm_qualification_evidence evidence where evidence.id=p_evidence_id;
  select lead.* into l from public.crm_leads lead where lead.id=e.lead_id for update;
  if e.id is null or l.id is null or e.team_id<>r.team_id or l.team_id<>r.team_id
    or not(l.owner_id=r.id or public.can_act_for(r.team_id,l.owner_id)
      or public.has_permission(r.team_id,'customers.supervise'))
    or not public.crm_can_access_region(l.team_id,l.region_id,l.owner_id) then
    raise exception 'EVIDENCE_FORBIDDEN' using errcode='42501';
  end if;
  if nullif(trim(p_reason),'')is null then
    raise exception 'REVOCATION_REASON_REQUIRED' using errcode='22023';
  end if;
  insert into public.crm_qualification_evidence_revocations
    (team_id,evidence_id,reason,revoked_by)
  values(e.team_id,e.id,trim(p_reason),r.id) returning * into v;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
  values(e.team_id,r.id,'crm.qualification_evidence_revoked','crm_qualification_evidence',e.id,
    to_jsonb(e),jsonb_build_object('revocation',to_jsonb(v)));
  return v.id;
end $$;

create or replace function public.record_crm_store_qualification_facts(
  p_store_id uuid,p_area_sqm numeric,p_private_room_count integer,
  p_is_landmark boolean,p_is_takeaway_only boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.profiles;s public.crm_stores;before_state jsonb;after_state jsonb;
begin
  select p.* into r from public.profiles p where p.id=auth.uid()and p.status='active';
  if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')
    or not public.has_permission(r.team_id,'customers.manage') then
    raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';
  end if;
  select store.* into s from public.crm_stores store where store.id=p_store_id for update;
  if s.id is null or s.team_id<>r.team_id
    or not(s.owner_id=r.id or public.has_permission(r.team_id,'customers.supervise'))
    or not public.crm_can_access_region(s.team_id,s.region_id,s.owner_id) then
    raise exception 'STORE_FACTS_FORBIDDEN' using errcode='42501';
  end if;
  if p_area_sqm is not null and p_area_sqm<0
    or p_private_room_count is not null and p_private_room_count<0 then
    raise exception 'INVALID_STORE_FACTS' using errcode='22023';
  end if;
  before_state:=jsonb_build_object('area_sqm',s.area_sqm,'private_room_count',s.private_room_count,
    'is_landmark',s.is_landmark,'is_takeaway_only',s.is_takeaway_only);
  update public.crm_stores as store set area_sqm=p_area_sqm,private_room_count=p_private_room_count,
    is_landmark=coalesce(p_is_landmark,false),is_takeaway_only=coalesce(p_is_takeaway_only,false),updated_at=now()
  where store.id=s.id returning store.* into s;
  after_state:=jsonb_build_object('area_sqm',s.area_sqm,'private_room_count',s.private_room_count,
    'is_landmark',s.is_landmark,'is_takeaway_only',s.is_takeaway_only);
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
  values(s.team_id,r.id,'crm.store_qualification_facts_changed','crm_store',s.id,before_state,after_state);
  return s.id;
end $$;

create or replace function public.upsert_crm_contact(
  p_id uuid,p_brand_id uuid,p_store_id uuid,p_name text,p_title text,
  p_is_key_person boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.profiles;c public.crm_contacts;s public.crm_stores;b public.crm_brands;before_key boolean;
begin
  select p.* into r from public.profiles p where p.id=auth.uid()and p.status='active';
  if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')
    or not public.has_permission(r.team_id,'customers.manage') then
    raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';
  end if;
  if nullif(trim(p_name),'')is null or(p_brand_id is null and p_store_id is null)then
    raise exception 'INVALID_CONTACT' using errcode='22023';
  end if;
  if p_store_id is not null then
    select store.* into s from public.crm_stores store
    where store.id=p_store_id and store.team_id=r.team_id;
    if s.id is null or not public.crm_can_access_region(s.team_id,s.region_id,s.owner_id)
      or(p_brand_id is not null and p_brand_id is distinct from s.brand_id)then
      raise exception 'CONTACT_STORE_MISMATCH' using errcode='22023';
    end if;b.id:=s.brand_id;
  else
    select brand.* into b from public.crm_brands brand
    where brand.id=p_brand_id and brand.team_id=r.team_id;
    if b.id is null or not(b.owner_id=r.id or public.has_permission(r.team_id,'customers.supervise'))then
      raise exception 'CONTACT_BRAND_FORBIDDEN' using errcode='42501';
    end if;
  end if;
  if p_id is null then
    insert into public.crm_contacts(team_id,brand_id,store_id,name,title,is_key_person,owner_id,created_by)
    values(r.team_id,coalesce(p_brand_id,b.id),p_store_id,trim(p_name),nullif(trim(p_title),''),
      coalesce(p_is_key_person,false),r.id,r.id) returning * into c;
    if c.is_key_person then
      insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
      values(c.team_id,r.id,'crm.contact_key_person_changed','crm_contact',c.id,
        jsonb_build_object('is_key_person',null),jsonb_build_object('is_key_person',true));
    end if;
  else
    select contact.* into c from public.crm_contacts contact where contact.id=p_id for update;
    if c.id is null or c.team_id<>r.team_id
      or not(c.owner_id=r.id or public.has_permission(r.team_id,'customers.supervise'))then
      raise exception 'CONTACT_FORBIDDEN' using errcode='42501';
    end if;
    before_key:=c.is_key_person;
    update public.crm_contacts as contact set brand_id=coalesce(p_brand_id,b.id),store_id=p_store_id,
      name=trim(p_name),title=nullif(trim(p_title),''),is_key_person=coalesce(p_is_key_person,false),updated_at=now()
    where contact.id=p_id returning contact.* into c;
    if before_key is distinct from c.is_key_person then
      insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
      values(c.team_id,r.id,'crm.contact_key_person_changed','crm_contact',c.id,
        jsonb_build_object('is_key_person',before_key),jsonb_build_object('is_key_person',c.is_key_person));
    end if;
  end if;
  return c.id;
end $$;

create or replace function public.qualify_crm_lead(p_lead_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.profiles;l public.crm_leads;s public.crm_stores;o public.crm_opportunities;
  g text;annual_ok boolean;contacted boolean;meeting_time timestamptz;
begin
  select p.* into r from public.profiles p where p.id=auth.uid()and p.status='active';
  if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')
    or not public.has_permission(r.team_id,'customers.manage')then
    raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';
  end if;
  select lead.* into l from public.crm_leads lead where lead.id=p_lead_id for update;
  if l.id is null or l.team_id<>r.team_id
    or not(l.owner_id=r.id or public.can_act_for(r.team_id,l.owner_id)
      or public.has_permission(r.team_id,'customers.supervise'))
    or not public.crm_can_access_region(l.team_id,l.region_id,l.owner_id)then
    raise exception 'QUALIFY_FORBIDDEN' using errcode='42501';
  end if;
  select opportunity.* into o from public.crm_opportunities opportunity
    where opportunity.lead_id=l.id and opportunity.qualification_superseded_at is null;
  if o.id is not null then return o.id;end if;
  select store.* into s from public.crm_stores store
    where store.id=l.store_id and store.team_id=l.team_id;
  if s.id is null or s.brand_id is null or s.region_id<>l.region_id
    or s.brand_id is distinct from l.brand_id or s.store_status='closed'then
    raise exception 'REAL_STORE_REQUIRED' using errcode='22023';
  end if;
  g:=public.crm_calculate_value_grade(s.id);
  if g='D'then raise exception 'D_GRADE_OUTSIDE_FUNNEL' using errcode='22023';end if;
  select
    exists(select 1 from public.crm_qualification_evidence e
      where e.lead_id=l.id and e.evidence_type='annual_fee_viable'
        and not exists(select 1 from public.crm_qualification_evidence_revocations v where v.evidence_id=e.id)),
    exists(select 1 from public.crm_qualification_evidence e
      where e.lead_id=l.id and e.evidence_type='key_person_contacted'
        and not exists(select 1 from public.crm_qualification_evidence_revocations v where v.evidence_id=e.id)),
    (select max(e.meeting_at) from public.crm_qualification_evidence e
      where e.lead_id=l.id and e.evidence_type='key_person_meeting_scheduled' and e.meeting_at>now()
        and not exists(select 1 from public.crm_qualification_evidence_revocations v where v.evidence_id=e.id))
  into annual_ok,contacted,meeting_time;
  if not annual_ok or not(contacted or meeting_time is not null)then
    raise exception 'OPPORTUNITY_QUALIFICATION_EVIDENCE_REQUIRED' using errcode='22023';
  end if;
  insert into public.crm_opportunities(team_id,lead_id,brand_id,store_id,region_id,owner_id,
    value_grade,annual_fee_viable,key_person_contacted,key_person_meeting_at,created_by)
  values(l.team_id,l.id,l.brand_id,l.store_id,l.region_id,l.owner_id,g,true,contacted,meeting_time,r.id)
  on conflict(lead_id)where lead_id is not null and qualification_superseded_at is null
  do nothing returning * into o;
  if o.id is null then select opportunity.* into o from public.crm_opportunities opportunity
    where opportunity.lead_id=l.id and opportunity.qualification_superseded_at is null;end if;
  update public.crm_leads as lead set status='qualified',updated_at=now()where lead.id=l.id;
  return o.id;
end $$;

revoke all on function public.crm_reject_evidence_mutation(),
  public.crm_validate_evidence_revocation() from public;
revoke all on function public.record_crm_qualification_evidence(uuid,text,text,uuid,timestamptz),
  public.revoke_crm_qualification_evidence(uuid,text),
  public.record_crm_store_qualification_facts(uuid,numeric,integer,boolean,boolean),
  public.upsert_crm_contact(uuid,uuid,uuid,text,text,boolean),public.qualify_crm_lead(uuid) from public;
grant execute on function public.record_crm_qualification_evidence(uuid,text,text,uuid,timestamptz),
  public.revoke_crm_qualification_evidence(uuid,text),
  public.record_crm_store_qualification_facts(uuid,numeric,integer,boolean,boolean),
  public.upsert_crm_contact(uuid,uuid,uuid,text,text,boolean),public.qualify_crm_lead(uuid) to authenticated;
notify pgrst,'reload schema';
