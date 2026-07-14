-- Operations lead intake: narrow submission permission, deterministic regional
-- assignment, and an auditable record of the original pasted text.

insert into public.access_permissions(code,name,description)
values('leads.submit','线索报备 (Lead submission)','运维录入并提交线索，不包含客户、报价或订单管理权限')
on conflict(code) do update set name=excluded.name,description=excluded.description;

insert into public.access_role_permissions(role_id,permission_code)
select ar.id,'leads.submit'
from public.access_roles ar
where ar.code in('owner','admin','operations')
on conflict do nothing;

create table public.crm_lead_submissions(
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  customer_name text not null,
  contact_name text,
  phone_normalized text not null,
  region_text text,
  address text,
  notes text,
  raw_text text,
  assignment_type text not null check(assignment_type in('assigned','regional_pool','unmatched_pool','duplicate')),
  assigned_owner_id uuid references public.profiles(id) on delete restrict,
  matched_region_id uuid references public.sales_regions(id) on delete restrict,
  created_at timestamptz not null default now(),
  check(nullif(trim(customer_name),'')is not null),
  check(phone_normalized ~ '^[0-9]{6,20}$')
);

create index crm_lead_submissions_submitter_idx
on public.crm_lead_submissions(team_id,submitted_by,created_at desc);
create index crm_lead_submissions_assignment_idx
on public.crm_lead_submissions(team_id,matched_region_id,assigned_owner_id,created_at desc);
create index crm_lead_submissions_lead_idx
on public.crm_lead_submissions(team_id,lead_id,created_at desc);

alter table public.crm_lead_submissions enable row level security;
revoke all on public.crm_lead_submissions from public,anon;
grant select on public.crm_lead_submissions to authenticated;

create policy "submitters read own lead submissions"
on public.crm_lead_submissions for select to authenticated
using(
  submitted_by=(select auth.uid())
  or public.has_permission(team_id,'access.manage')
  or public.has_permission(team_id,'customers.supervise')
);

create or replace function public.get_operations_lead_intake_context(
  p_phone text default null,
  p_region_text text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $get_operations_lead_intake_context$
declare
  actor public.profiles;
  normalized_phone text;
  region_matches integer:=0;
  matched_region public.sales_regions;
  target_owner public.profiles;
  duplicate_lead public.crm_leads;
  assignment text;
  regions jsonb;
begin
  if auth.uid()is null then raise exception 'AUTH_REQUIRED'using errcode='28000';end if;
  select * into actor from public.profiles where id=auth.uid()and status='active';
  if actor.id is null or not public.is_feature_enabled(actor.team_id,'sales_os_v3')
    or not public.has_permission(actor.team_id,'leads.submit')then
    raise exception 'LEAD_SUBMIT_FORBIDDEN'using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',sr.id,'name',sr.name,'code',sr.code)
    order by sr.name,sr.id),'[]'::jsonb)into regions
  from public.sales_regions sr where sr.team_id=actor.team_id and sr.is_active
    and sr.code<>'UNMATCHED_LEAD_POOL';

  normalized_phone:=pg_catalog.regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  if normalized_phone<>''then
    select l.* into duplicate_lead from public.crm_lead_private lp
    join public.crm_leads l on l.id=lp.lead_id and l.team_id=lp.team_id
    where lp.team_id=actor.team_id
      and pg_catalog.regexp_replace(coalesce(lp.phone,''),'[^0-9]','','g')=normalized_phone
    order by l.created_at desc,l.id limit 1;
  end if;

  if nullif(trim(p_region_text),'')is not null then
    select count(*)into region_matches from public.sales_regions sr
    where sr.team_id=actor.team_id and sr.is_active and sr.code<>'UNMATCHED_LEAD_POOL'
      and(lower(trim(sr.name))=lower(trim(p_region_text))or lower(trim(sr.code))=lower(trim(p_region_text)));
    if region_matches=1 then
      select * into matched_region from public.sales_regions sr
      where sr.team_id=actor.team_id and sr.is_active and sr.code<>'UNMATCHED_LEAD_POOL'
        and(lower(trim(sr.name))=lower(trim(p_region_text))or lower(trim(sr.code))=lower(trim(p_region_text)))
      order by sr.id limit 1;
    end if;
  end if;

  if matched_region.id is null then assignment:='unmatched_pool';
  else
    select p.* into target_owner from public.profile_sales_regions psr
    join public.profiles p on p.id=psr.profile_id and p.team_id=psr.team_id and p.status='active'
    where psr.team_id=actor.team_id and psr.region_id=matched_region.id
      and exists(select 1 from public.profile_access_roles par join public.access_roles ar
        on ar.id=par.role_id and ar.team_id=par.team_id
        where par.team_id=psr.team_id and par.profile_id=psr.profile_id and ar.code='sales')
    order by(select count(*)from public.crm_lead_submissions s where s.team_id=actor.team_id
      and s.matched_region_id=matched_region.id and s.assigned_owner_id=p.id and s.assignment_type='assigned'),
      (select max(s.created_at)from public.crm_lead_submissions s where s.team_id=actor.team_id
      and s.matched_region_id=matched_region.id and s.assigned_owner_id=p.id and s.assignment_type='assigned')nulls first,p.id
    limit 1;
    assignment:=case when target_owner.id is null then'regional_pool'else'assigned'end;
  end if;

  return pg_catalog.jsonb_build_object(
    'regions',regions,
    'matchedRegion',case when matched_region.id is null then null else
      jsonb_build_object('id',matched_region.id,'name',matched_region.name,'code',matched_region.code)end,
    'assignmentType',case when duplicate_lead.id is null then assignment else'duplicate'end,
    'owner',coalesce(duplicate_lead.owner_id,target_owner.id),
    'ownerName',coalesce(
      (select p.name from public.profiles p where p.id=duplicate_lead.owner_id),
      target_owner.name
    ),
    'duplicate',duplicate_lead.id is not null,
    'duplicateLeadId',duplicate_lead.id
  );
end
$get_operations_lead_intake_context$;

create or replace function public.submit_operations_lead(
  p_customer_name text,
  p_contact_name text,
  p_phone text,
  p_region_text text,
  p_address text default null,
  p_notes text default null,
  p_raw_text text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $submit_operations_lead$
declare
  actor public.profiles;
  normalized_phone text;
  matched_region public.sales_regions;
  fallback_region public.sales_regions;
  region_matches integer:=0;
  target_owner public.profiles;
  candidate_count integer:=0;
  lead_row public.crm_leads;
  duplicate_lead public.crm_leads;
  assignment text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode='28000';
  end if;

  select * into actor from public.profiles
  where id=auth.uid() and status='active';
  if actor.id is null
    or not public.is_feature_enabled(actor.team_id,'sales_os_v3')
    or not public.has_permission(actor.team_id,'leads.submit') then
    raise exception 'LEAD_SUBMIT_FORBIDDEN' using errcode='42501';
  end if;

  normalized_phone:=pg_catalog.regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  if nullif(trim(p_customer_name),'')is null
    or char_length(normalized_phone)<6
    or char_length(normalized_phone)>20 then
    raise exception 'LEAD_SUBMISSION_REQUIRED_FIELDS' using errcode='22023';
  end if;

  -- Serialize one phone per team, preventing concurrent duplicate intake.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor.team_id||':lead-phone:'||normalized_phone,0)
  );

  select l.* into duplicate_lead
  from public.crm_lead_private lp
  join public.crm_leads l on l.id=lp.lead_id and l.team_id=lp.team_id
  where lp.team_id=actor.team_id
    and pg_catalog.regexp_replace(coalesce(lp.phone,''),'[^0-9]','','g')=normalized_phone
  order by l.created_at desc,l.id
  limit 1;

  if duplicate_lead.id is not null then
    insert into public.crm_lead_submissions(
      team_id,lead_id,submitted_by,customer_name,contact_name,phone_normalized,
      region_text,address,notes,raw_text,assignment_type,assigned_owner_id,matched_region_id
    ) values(
      actor.team_id,duplicate_lead.id,actor.id,trim(p_customer_name),nullif(trim(p_contact_name),''),
      normalized_phone,nullif(trim(p_region_text),''),nullif(trim(p_address),''),
      nullif(trim(p_notes),''),nullif(trim(p_raw_text),''),'duplicate',
      duplicate_lead.owner_id,duplicate_lead.region_id
    );
    return pg_catalog.jsonb_build_object(
      'leadId',duplicate_lead.id,
      'assignmentType','duplicate',
      'owner',duplicate_lead.owner_id,
      'ownerName',(select p.name from public.profiles p where p.id=duplicate_lead.owner_id),
      'region',duplicate_lead.region_id,
      'regionName',(select sr.name from public.sales_regions sr where sr.id=duplicate_lead.region_id),
      'duplicate',true
    );
  end if;

  if nullif(trim(p_region_text),'')is not null then
    select count(*) into region_matches
    from public.sales_regions sr
    where sr.team_id=actor.team_id and sr.is_active and sr.code<>'UNMATCHED_LEAD_POOL'
      and (
        lower(trim(sr.name))=lower(trim(p_region_text))
        or lower(trim(sr.code))=lower(trim(p_region_text))
      );

    if region_matches=1 then
      select * into matched_region from public.sales_regions sr
      where sr.team_id=actor.team_id and sr.is_active and sr.code<>'UNMATCHED_LEAD_POOL'
        and (lower(trim(sr.name))=lower(trim(p_region_text))or lower(trim(sr.code))=lower(trim(p_region_text)))
      order by sr.id limit 1;
    end if;
  end if;

  -- crm_leads requires a region. Unrecognized/ambiguous input is routed to a
  -- dedicated team pool and remains unclaimed until manually distributed.
  if matched_region.id is null then
    insert into public.sales_regions(team_id,code,name,region_level,is_active)
    values(actor.team_id,'UNMATCHED_LEAD_POOL','待分区公海','custom',true)
    on conflict(team_id,code)do update set name=excluded.name,is_active=true
    returning * into fallback_region;
    matched_region:=fallback_region;
    assignment:='unmatched_pool';
  else
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(actor.team_id||':lead-region:'||matched_region.id::text,0)
    );

    select count(*) into candidate_count
    from public.profile_sales_regions psr
    join public.profiles p on p.id=psr.profile_id and p.team_id=psr.team_id and p.status='active'
    where psr.team_id=actor.team_id and psr.region_id=matched_region.id
      and exists(
        select 1 from public.profile_access_roles par
        join public.access_roles ar on ar.id=par.role_id and ar.team_id=par.team_id
        where par.team_id=psr.team_id and par.profile_id=psr.profile_id and ar.code='sales'
      );

    if candidate_count>0 then
      select p.* into target_owner
      from public.profile_sales_regions psr
      join public.profiles p on p.id=psr.profile_id and p.team_id=psr.team_id and p.status='active'
      where psr.team_id=actor.team_id and psr.region_id=matched_region.id
        and exists(
          select 1 from public.profile_access_roles par
          join public.access_roles ar on ar.id=par.role_id and ar.team_id=par.team_id
          where par.team_id=psr.team_id and par.profile_id=psr.profile_id and ar.code='sales'
        )
      order by
        (select count(*) from public.crm_lead_submissions s
         where s.team_id=actor.team_id and s.matched_region_id=matched_region.id
           and s.assigned_owner_id=p.id and s.assignment_type='assigned'),
        (select max(s.created_at) from public.crm_lead_submissions s
         where s.team_id=actor.team_id and s.matched_region_id=matched_region.id
           and s.assigned_owner_id=p.id and s.assignment_type='assigned') nulls first,
        p.id
      limit 1;
      assignment:='assigned';
    else
      assignment:='regional_pool';
    end if;
  end if;

  insert into public.crm_leads(
    team_id,region_id,title,contact_name,source,status,owner_id,claimed_at,created_by
  ) values(
    actor.team_id,matched_region.id,trim(p_customer_name),nullif(trim(p_contact_name),''),
    '运维转交',case when target_owner.id is null then'public'else'claimed'end,
    target_owner.id,case when target_owner.id is null then null else now()end,actor.id
  ) returning * into lead_row;

  insert into public.crm_lead_private(lead_id,team_id,phone,updated_by)
  values(lead_row.id,actor.team_id,trim(p_phone),actor.id);

  insert into public.crm_lead_submissions(
    team_id,lead_id,submitted_by,customer_name,contact_name,phone_normalized,
    region_text,address,notes,raw_text,assignment_type,assigned_owner_id,matched_region_id
  ) values(
    actor.team_id,lead_row.id,actor.id,trim(p_customer_name),nullif(trim(p_contact_name),''),
    normalized_phone,nullif(trim(p_region_text),''),nullif(trim(p_address),''),
    nullif(trim(p_notes),''),nullif(trim(p_raw_text),''),assignment,target_owner.id,matched_region.id
  );

  return pg_catalog.jsonb_build_object(
    'leadId',lead_row.id,
    'assignmentType',assignment,
    'owner',target_owner.id,
    'ownerName',target_owner.name,
    'region',matched_region.id,
    'regionName',matched_region.name,
    'duplicate',false
  );
end
$submit_operations_lead$;

create or replace function public.get_my_lead_submissions(p_limit integer default 100)
returns table(
  submission_id uuid,
  lead_id uuid,
  customer_name text,
  contact_name text,
  region_text text,
  address text,
  notes text,
  raw_text text,
  assignment_type text,
  owner_id uuid,
  owner_name text,
  region_id uuid,
  region_name text,
  lead_status text,
  claimed_at timestamptz,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $get_my_lead_submissions$
declare actor public.profiles;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='28000';end if;
  select * into actor from public.profiles where id=auth.uid()and status='active';
  if actor.id is null or not public.has_permission(actor.team_id,'leads.submit')then
    raise exception 'LEAD_SUBMIT_FORBIDDEN' using errcode='42501';
  end if;
  if p_limit<1 or p_limit>500 then raise exception 'INVALID_LIMIT' using errcode='22023';end if;

  return query
  select s.id,s.lead_id,s.customer_name,s.contact_name,s.region_text,s.address,s.notes,s.raw_text,s.assignment_type,
    l.owner_id,p.name,l.region_id,r.name,l.status,l.claimed_at,s.created_at
  from public.crm_lead_submissions s
  join public.crm_leads l on l.id=s.lead_id and l.team_id=s.team_id
  join public.sales_regions r on r.id=l.region_id and r.team_id=l.team_id
  left join public.profiles p on p.id=l.owner_id and p.team_id=l.team_id
  where s.team_id=actor.team_id and s.submitted_by=actor.id
  order by s.created_at desc,s.id
  limit p_limit;
end
$get_my_lead_submissions$;

revoke all on function public.submit_operations_lead(text,text,text,text,text,text,text) from public;
revoke all on function public.get_operations_lead_intake_context(text,text) from public;
revoke all on function public.get_my_lead_submissions(integer) from public;
grant execute on function public.submit_operations_lead(text,text,text,text,text,text,text) to authenticated;
grant execute on function public.get_operations_lead_intake_context(text,text) to authenticated;
grant execute on function public.get_my_lead_submissions(integer) to authenticated;

-- Public-pool leads start their first-contact clock only when claimed. This is
-- the complete prior definition; only the 24/48-hour predicates use claimed_at.
create or replace function public.run_sales_automation_batch(p_team_id text,p_now timestamptz default now())
returns table(marked_24h integer,recycled_48h integer,recycled_15d integer,nurtured_30d integer,review_pending integer,recycled_round2 integer)
language plpgsql security definer set search_path='' as $function$
declare l public.crm_leads;today_cn date:=(p_now at time zone 'Asia/Shanghai')::date;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';end if;
 if not public.is_feature_enabled(p_team_id,'sales_os_v3') then raise exception 'SALES_OS_V3_DISABLED' using errcode='42501';end if;
 marked_24h:=0;recycled_48h:=0;recycled_15d:=0;nurtured_30d:=0;review_pending:=0;recycled_round2:=0;
 for l in select * from public.crm_leads where team_id=p_team_id and owner_id is not null and status='nurturing'and nurture_round=1 and nurture_until<=today_cn for update skip locked loop
  update public.crm_leads set status='supervisor_review',nurture_until=null,updated_at=p_now where id=l.id;review_pending:=review_pending+1;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(l.team_id,l.owner_id,'lead.nurture_round1_review','crm_lead',l.id,to_jsonb(l),jsonb_build_object('status','supervisor_review'));
 end loop;
 for l in select * from public.crm_leads where team_id=p_team_id and owner_id is not null and status='nurturing'and nurture_round=2 and nurture_until<=today_cn for update skip locked loop
  insert into public.crm_owner_history(team_id,entity_type,entity_id,previous_owner_id,new_owner_id,reason,changed_by)values(l.team_id,'lead',l.id,l.owner_id,null,'nurture_round2_expired',l.owner_id);
  update public.crm_leads set owner_id=null,status='public',claimed_at=null,nurture_until=null,updated_at=p_now where id=l.id;recycled_round2:=recycled_round2+1;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(l.team_id,l.owner_id,'lead.nurture_round2_expired','crm_lead',l.id,to_jsonb(l),jsonb_build_object('status','public'));
 end loop;
 update public.crm_leads set attention_status='uncontacted_24h',updated_at=p_now where team_id=p_team_id and owner_id is not null and claimed_at is not null and last_contact_attempt_at is null
  and(claimed_at at time zone 'Asia/Shanghai')::date<=today_cn-1 and attention_status<>'uncontacted_24h';get diagnostics marked_24h=row_count;
 for l in select * from public.crm_leads where team_id=p_team_id and owner_id is not null and claimed_at is not null and last_contact_attempt_at is null
   and(claimed_at at time zone 'Asia/Shanghai')::date<=today_cn-2 and not public.crm_lead_recycle_paused(team_id,id,owner_id,p_now) for update skip locked loop
  insert into public.crm_owner_history(team_id,entity_type,entity_id,previous_owner_id,new_owner_id,reason,changed_by)values(l.team_id,'lead',l.id,l.owner_id,null,'auto_recycle_48h',l.owner_id);
  update public.crm_leads set owner_id=null,status='public',claimed_at=null,attention_status='normal',updated_at=p_now where id=l.id;recycled_48h:=recycled_48h+1;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(l.team_id,l.owner_id,'lead.auto_recycled_48h','crm_lead',l.id,to_jsonb(l),jsonb_build_object('status','public'));
 end loop;
 for l in select * from public.crm_leads where team_id=p_team_id and owner_id is not null and status in('claimed','qualified')
   and(coalesce(last_effective_followup_at,claimed_at,created_at) at time zone 'Asia/Shanghai')::date<=today_cn-15
   and(select count(distinct(a.occurred_at at time zone 'Asia/Shanghai')::date)from public.crm_contact_attempts a where a.lead_id=crm_leads.id and a.team_id=crm_leads.team_id and a.result in('unreachable','no_answer'))<3
   and not public.crm_lead_recycle_paused(team_id,id,owner_id,p_now) for update skip locked loop
  insert into public.crm_owner_history(team_id,entity_type,entity_id,previous_owner_id,new_owner_id,reason,changed_by)values(l.team_id,'lead',l.id,l.owner_id,null,'auto_recycle_15d',l.owner_id);
  update public.crm_leads set owner_id=null,status='public',claimed_at=null,attention_status='normal',updated_at=p_now where id=l.id;recycled_15d:=recycled_15d+1;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(l.team_id,l.owner_id,'lead.auto_recycled_15d','crm_lead',l.id,to_jsonb(l),jsonb_build_object('status','public'));
 end loop;
 for l in select * from public.crm_leads where team_id=p_team_id and owner_id is not null and status not in('nurturing','supervisor_review','closed')and nurture_round<1
  and(select count(distinct(a.occurred_at at time zone 'Asia/Shanghai')::date)from public.crm_contact_attempts a where a.lead_id=crm_leads.id and a.team_id=crm_leads.team_id and a.result in('unreachable','no_answer'))>=3
  and not public.crm_lead_recycle_paused(team_id,id,owner_id,p_now) for update skip locked loop
  update public.crm_leads set status='nurturing',nurture_round=nurture_round+1,nurture_until=today_cn+30,updated_at=p_now where id=l.id;nurtured_30d:=nurtured_30d+1;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(l.team_id,l.owner_id,'lead.auto_nurtured_30d','crm_lead',l.id,to_jsonb(l),jsonb_build_object('nurture_until',today_cn+30));
 end loop;return next;end $function$;

revoke all on function public.run_sales_automation_batch(text,timestamptz)from public,anon,authenticated;
grant execute on function public.run_sales_automation_batch(text,timestamptz)to service_role;

create or replace view public.crm_today_actions with(security_invoker=true)as
select l.team_id,l.owner_id,l.id entity_id,'lead'::text entity_type,
 case when l.next_action_kind='appointment'then'appointment'else'follow_up'end action_type,l.next_action_at due_at,l.title,
 case when l.next_action_at<now()then'overdue'else'today'end urgency
from public.crm_leads l where public.is_feature_enabled(l.team_id,'sales_os_v3')and l.owner_id is not null and(l.owner_id=auth.uid()or public.can_act_for(l.team_id,l.owner_id)or public.has_permission(l.team_id,'customers.supervise'))
 and l.next_action_at is not null and(l.next_action_at at time zone'Asia/Shanghai')::date<=(now()at time zone'Asia/Shanghai')::date
union all select l.team_id,l.owner_id,l.id,'lead',case when l.attention_status='uncontacted_24h'then'uncontacted_24h'else'new_lead'end,
 l.claimed_at,l.title,case when l.attention_status='uncontacted_24h'then'overdue'else'today'end
from public.crm_leads l where public.is_feature_enabled(l.team_id,'sales_os_v3')and l.owner_id is not null and l.claimed_at is not null and(l.owner_id=auth.uid()or public.can_act_for(l.team_id,l.owner_id)or public.has_permission(l.team_id,'customers.supervise'))
 and l.last_contact_attempt_at is null and((l.claimed_at at time zone'Asia/Shanghai')::date=(now()at time zone'Asia/Shanghai')::date or l.attention_status='uncontacted_24h')
union all select l.team_id,l.owner_id,l.id,'lead','recycle_risk',
 (case when l.last_contact_attempt_at is null then((l.claimed_at at time zone'Asia/Shanghai')::date+2)else((coalesce(l.last_effective_followup_at,l.claimed_at,l.created_at)at time zone'Asia/Shanghai')::date+15)end::timestamp at time zone'Asia/Shanghai'),l.title,'today'
from public.crm_leads l where public.is_feature_enabled(l.team_id,'sales_os_v3')and l.owner_id is not null and l.claimed_at is not null and(l.owner_id=auth.uid()or public.can_act_for(l.team_id,l.owner_id)or public.has_permission(l.team_id,'customers.supervise'))
 and not public.crm_lead_recycle_paused(l.team_id,l.id,l.owner_id,now())and(case when l.last_contact_attempt_at is null then(l.claimed_at at time zone'Asia/Shanghai')::date+2 else(coalesce(l.last_effective_followup_at,l.claimed_at,l.created_at)at time zone'Asia/Shanghai')::date+15 end)<=(now()at time zone'Asia/Shanghai')::date+1
union all select e.team_id,q.owner_id,e.id,'delivery_exception','delivery_exception',e.created_at,e.details,'overdue'
from public.fulfillment_exceptions e join public.fulfillment_deliveries d on d.id=e.delivery_id and d.team_id=e.team_id join public.deal_orders o on o.id=d.order_id and o.team_id=d.team_id join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id
where e.status='open'and(q.owner_id=auth.uid()or public.can_act_for(e.team_id,q.owner_id)or public.has_permission(e.team_id,'customers.supervise'))
union all select rm.team_id,q.owner_id,rm.id,'renewal','renewal_'||rm.days_before,(rm.due_on::timestamp at time zone'Asia/Shanghai'),s.name,
 case when rm.due_on<(now()at time zone'Asia/Shanghai')::date then'overdue'else'today'end
from public.fulfillment_renewal_milestones rm join public.fulfillment_deliveries d on d.id=rm.delivery_id and d.team_id=rm.team_id join public.deal_orders o on o.id=d.order_id and o.team_id=d.team_id join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id join public.crm_stores s on s.id=d.store_id and s.team_id=d.team_id
where rm.status='pending'and rm.due_on<=(now()at time zone'Asia/Shanghai')::date and(q.owner_id=auth.uid()or public.can_act_for(rm.team_id,q.owner_id)or public.has_permission(rm.team_id,'customers.supervise'));

revoke all on public.crm_today_actions from public,anon;
grant select on public.crm_today_actions to authenticated;

notify pgrst,'reload schema';
