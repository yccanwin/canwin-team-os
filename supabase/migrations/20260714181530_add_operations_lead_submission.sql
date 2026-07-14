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

-- Existing automation used lead creation time for the first-contact clock.
-- A public-pool lead may be claimed days later, so the 24/48-hour clock must
-- explicitly require claimed_at and start from that handoff timestamp.
do $repair_claim_clock$
declare function_sql text;
begin
  function_sql:=pg_catalog.pg_get_functiondef(
    'public.run_sales_automation_batch(text,timestamp with time zone)'::regprocedure
  );
  function_sql:=pg_catalog.replace(
    function_sql,
    'and(created_at at time zone ''Asia/Shanghai'')::date<=today_cn-1',
    'and claimed_at is not null and(claimed_at at time zone ''Asia/Shanghai'')::date<=today_cn-1'
  );
  function_sql:=pg_catalog.replace(
    function_sql,
    'and(created_at at time zone ''Asia/Shanghai'')::date<=today_cn-2',
    'and claimed_at is not null and(claimed_at at time zone ''Asia/Shanghai'')::date<=today_cn-2'
  );
  if position('and claimed_at is not null and(claimed_at at time zone ''Asia/Shanghai'')::date<=today_cn-1' in function_sql)=0
    or position('and claimed_at is not null and(claimed_at at time zone ''Asia/Shanghai'')::date<=today_cn-2' in function_sql)=0 then
    raise exception 'CLAIM_CLOCK_REPAIR_FAILED';
  end if;
  execute function_sql;
end
$repair_claim_clock$;

notify pgrst,'reload schema';
