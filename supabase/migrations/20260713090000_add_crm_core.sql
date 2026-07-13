-- CanWin Team OS 3.0 minimal CRM core. Additive; 2.0 tables are untouched.

insert into public.access_permissions (code, name, description) values
  ('customers.supervise', 'Supervise customers', 'View and manage team regional CRM records'),
  ('customers.read_sensitive', 'Read sensitive contacts', 'Read protected customer contact details')
on conflict (code) do update set name = excluded.name, description = excluded.description;

insert into public.access_role_permissions (role_id, permission_code)
select ar.id, mapping.permission_code
from public.access_roles ar
join (values
  ('owner', 'customers.supervise'), ('owner', 'customers.read_sensitive'),
  ('admin', 'customers.supervise'), ('admin', 'customers.read_sensitive'),
  ('supervisor', 'customers.supervise'), ('supervisor', 'customers.read_sensitive')
) mapping(role_code, permission_code) on mapping.role_code = ar.code
on conflict do nothing;

create table public.crm_brands (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  name text not null,
  normalized_name text generated always as (lower(trim(name))) stored,
  business_mode text not null default 'independent'
    check (business_mode in ('independent', 'direct_chain', 'franchise_chain')),
  owner_id uuid references public.profiles(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, normalized_name)
);

create table public.crm_stores (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  brand_id uuid references public.crm_brands(id) on delete restrict,
  region_id uuid not null references public.sales_regions(id) on delete restrict,
  name text not null,
  normalized_name text generated always as (lower(trim(name))) stored,
  address text,
  business_type text check (business_type in
    ('fast_food','chinese','hotpot','barbecue','beverage','bakery','banquet','international')),
  area_sqm numeric(10,2) check (area_sqm is null or area_sqm >= 0),
  private_room_count integer check (private_room_count is null or private_room_count >= 0),
  store_status text not null default 'operating'
    check (store_status in ('planning','operating','closed')),
  owner_id uuid references public.profiles(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, region_id, normalized_name)
);

create table public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  brand_id uuid references public.crm_brands(id) on delete cascade,
  store_id uuid references public.crm_stores(id) on delete cascade,
  name text not null,
  title text,
  is_key_person boolean not null default false,
  owner_id uuid references public.profiles(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (brand_id is not null or store_id is not null)
);

-- Phone and messaging identifiers are isolated so broad contact SELECT never
-- leaks them. Only owner/delegate or sensitive-data supervisors can read.
create table public.crm_contact_private (
  contact_id uuid primary key references public.crm_contacts(id) on delete cascade,
  team_id text not null references public.teams(id) on delete cascade,
  phone text,
  wechat_id text,
  email text,
  notes text,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  check (phone is not null or wechat_id is not null or email is not null)
);

create table public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  region_id uuid not null references public.sales_regions(id) on delete restrict,
  brand_id uuid references public.crm_brands(id) on delete restrict,
  store_id uuid references public.crm_stores(id) on delete restrict,
  title text not null,
  source text,
  status text not null default 'public'
    check (status in ('public','claimed','qualified','nurturing','recycled','closed')),
  owner_id uuid references public.profiles(id) on delete restrict,
  claimed_at timestamptz,
  last_contact_attempt_at timestamptz,
  last_effective_followup_at timestamptz,
  next_action_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'public' and owner_id is null) or status <> 'public'),
  check ((owner_id is null and claimed_at is null) or owner_id is not null)
);

create table public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete restrict,
  brand_id uuid references public.crm_brands(id) on delete restrict,
  store_id uuid not null references public.crm_stores(id) on delete restrict,
  region_id uuid not null references public.sales_regions(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  value_grade text not null check (value_grade in ('A','B','C','D')),
  annual_fee_viable boolean not null default false,
  key_person_contacted boolean not null default false,
  key_person_meeting_at timestamptz,
  qualification_valid boolean not null default false,
  qualification_reason text not null default '',
  stage text not null default 'discovery'
    check (stage in ('discovery','demo','proposal','deposit','won','lost')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_followups (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  opportunity_id uuid references public.crm_opportunities(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  channel text not null check (channel in ('call','visit','wechat','meeting','other')),
  outcome text not null,
  new_business_fact text,
  customer_commitment text,
  is_effective boolean generated always as (
    nullif(trim(coalesce(new_business_fact, '')), '') is not null
    or nullif(trim(coalesce(customer_commitment, '')), '') is not null
  ) stored,
  next_action_at timestamptz,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (lead_id is not null or opportunity_id is not null),
  check (
    (nullif(trim(coalesce(new_business_fact, '')), '') is null
     and nullif(trim(coalesce(customer_commitment, '')), '') is null)
    or next_action_at is not null
  )
);

create table public.crm_owner_history (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  entity_type text not null check (entity_type in ('brand','store','lead','opportunity')),
  entity_id uuid not null,
  previous_owner_id uuid references public.profiles(id) on delete restrict,
  new_owner_id uuid references public.profiles(id) on delete restrict,
  reason text not null,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now(),
  check (previous_owner_id is distinct from new_owner_id)
);

-- Enforce tenant consistency even for service-role/import callers that bypass RLS.
create or replace function public.crm_validate_team_references()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'crm_brands' and new.owner_id is not null
    and not exists (select 1 from public.profiles p where p.id=new.owner_id and p.team_id=new.team_id) then
    raise exception 'CRM_CROSS_TEAM_BRAND' using errcode='23514';
  elsif tg_table_name = 'crm_stores' and (
    not exists (select 1 from public.sales_regions r where r.id=new.region_id and r.team_id=new.team_id)
    or (new.brand_id is not null and not exists (select 1 from public.crm_brands b where b.id=new.brand_id and b.team_id=new.team_id))
    or (new.owner_id is not null and not exists (select 1 from public.profiles p where p.id=new.owner_id and p.team_id=new.team_id))) then
    raise exception 'CRM_CROSS_TEAM_STORE' using errcode='23514';
  elsif tg_table_name = 'crm_contacts' and (
    (new.brand_id is not null and not exists (select 1 from public.crm_brands b where b.id=new.brand_id and b.team_id=new.team_id))
    or (new.store_id is not null and not exists (select 1 from public.crm_stores s where s.id=new.store_id and s.team_id=new.team_id))
    or (new.owner_id is not null and not exists (select 1 from public.profiles p where p.id=new.owner_id and p.team_id=new.team_id))) then
    raise exception 'CRM_CROSS_TEAM_CONTACT' using errcode='23514';
  elsif tg_table_name = 'crm_contact_private'
    and not exists (select 1 from public.crm_contacts c where c.id=new.contact_id and c.team_id=new.team_id) then
    raise exception 'CRM_CROSS_TEAM_PRIVATE_CONTACT' using errcode='23514';
  elsif tg_table_name = 'crm_leads' and (
    not exists (select 1 from public.sales_regions r where r.id=new.region_id and r.team_id=new.team_id)
    or (new.brand_id is not null and not exists (select 1 from public.crm_brands b where b.id=new.brand_id and b.team_id=new.team_id))
    or (new.store_id is not null and not exists (select 1 from public.crm_stores s where s.id=new.store_id and s.team_id=new.team_id))
    or (new.owner_id is not null and not exists (select 1 from public.profiles p where p.id=new.owner_id and p.team_id=new.team_id))) then
    raise exception 'CRM_CROSS_TEAM_LEAD' using errcode='23514';
  elsif tg_table_name = 'crm_opportunities' and (
    not exists (select 1 from public.sales_regions r where r.id=new.region_id and r.team_id=new.team_id)
    or not exists (select 1 from public.crm_stores s where s.id=new.store_id and s.team_id=new.team_id)
    or not exists (select 1 from public.profiles p where p.id=new.owner_id and p.team_id=new.team_id)
    or (new.lead_id is not null and not exists (select 1 from public.crm_leads l where l.id=new.lead_id and l.team_id=new.team_id))
    or (new.brand_id is not null and not exists (select 1 from public.crm_brands b where b.id=new.brand_id and b.team_id=new.team_id))) then
    raise exception 'CRM_CROSS_TEAM_OPPORTUNITY' using errcode='23514';
  elsif tg_table_name = 'crm_followups' and (
    not exists (select 1 from public.profiles p where p.id=new.actor_id and p.team_id=new.team_id)
    or (new.lead_id is not null and not exists (select 1 from public.crm_leads l where l.id=new.lead_id and l.team_id=new.team_id))
    or (new.opportunity_id is not null and not exists (select 1 from public.crm_opportunities o where o.id=new.opportunity_id and o.team_id=new.team_id))) then
    raise exception 'CRM_CROSS_TEAM_FOLLOWUP' using errcode='23514';
  elsif tg_table_name = 'crm_owner_history' and (
    (new.previous_owner_id is not null and not exists (select 1 from public.profiles p where p.id=new.previous_owner_id and p.team_id=new.team_id))
    or (new.new_owner_id is not null and not exists (select 1 from public.profiles p where p.id=new.new_owner_id and p.team_id=new.team_id))
    or not exists (select 1 from public.profiles p where p.id=new.changed_by and p.team_id=new.team_id)) then
    raise exception 'CRM_CROSS_TEAM_HISTORY' using errcode='23514';
  end if;
  return new;
end $$;

create trigger crm_brands_team_guard before insert or update on public.crm_brands for each row execute function public.crm_validate_team_references();
create trigger crm_stores_team_guard before insert or update on public.crm_stores for each row execute function public.crm_validate_team_references();
create trigger crm_contacts_team_guard before insert or update on public.crm_contacts for each row execute function public.crm_validate_team_references();
create trigger crm_contact_private_team_guard before insert or update on public.crm_contact_private for each row execute function public.crm_validate_team_references();
create trigger crm_leads_team_guard before insert or update on public.crm_leads for each row execute function public.crm_validate_team_references();
create trigger crm_opportunities_team_guard before insert or update on public.crm_opportunities for each row execute function public.crm_validate_team_references();
create trigger crm_followups_team_guard before insert or update on public.crm_followups for each row execute function public.crm_validate_team_references();
create trigger crm_owner_history_team_guard before insert or update on public.crm_owner_history for each row execute function public.crm_validate_team_references();

create or replace function public.crm_can_access_region(
  target_team_id text, target_region_id uuid, target_owner_id uuid default null
)
returns boolean language sql security definer set search_path = '' stable as $$
  select public.is_feature_enabled(target_team_id, 'sales_os_v3') and (
    public.has_permission(target_team_id, 'customers.supervise')
    or target_owner_id = auth.uid()
    or (target_owner_id is not null and public.can_act_for(target_team_id, target_owner_id))
    or exists (
      select 1 from public.profile_sales_regions psr
      join public.profiles p on p.id = psr.profile_id and p.team_id = psr.team_id
      where psr.team_id = target_team_id and psr.region_id = target_region_id
        and psr.profile_id = auth.uid() and p.status = 'active'
    )
  )
$$;

create or replace function public.crm_is_valid_opportunity(
  target_grade text, target_annual_fee_viable boolean,
  target_key_person_contacted boolean, target_key_person_meeting_at timestamptz
)
returns boolean language sql immutable set search_path = '' as $$
  select target_grade in ('A','B','C')
    and coalesce(target_annual_fee_viable, false)
    and (coalesce(target_key_person_contacted, false) or target_key_person_meeting_at is not null)
$$;

create or replace function public.crm_apply_opportunity_qualification()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.qualification_valid := public.crm_is_valid_opportunity(
    new.value_grade, new.annual_fee_viable,
    new.key_person_contacted, new.key_person_meeting_at
  );
  new.qualification_reason := case
    when new.value_grade = 'D' then 'D grade is outside the effective funnel'
    when not new.annual_fee_viable then 'Annual-fee product is not viable'
    when not new.key_person_contacted and new.key_person_meeting_at is null
      then 'Key person has not been contacted or scheduled'
    else 'Qualified by current server rule'
  end;
  return new;
end $$;

create trigger crm_opportunities_qualification
before insert or update of value_grade, annual_fee_viable,
  key_person_contacted, key_person_meeting_at
on public.crm_opportunities for each row
execute function public.crm_apply_opportunity_qualification();

create or replace function public.claim_crm_lead(p_lead_id uuid)
returns public.crm_leads
language plpgsql security definer set search_path = '' as $$
declare
  requester public.profiles;
  claimed public.crm_leads;
begin
  select * into requester from public.profiles
  where id = auth.uid() and status = 'active';
  if requester.id is null then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = '42501'; end if;
  if not public.is_feature_enabled(requester.team_id, 'sales_os_v3') then
    raise exception 'SALES_OS_V3_DISABLED' using errcode = '42501';
  end if;
  if not public.has_permission(requester.team_id, 'customers.manage') then
    raise exception 'CUSTOMER_MANAGE_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  select * into claimed from public.crm_leads where id = p_lead_id for update;
  if claimed.id is null or claimed.team_id <> requester.team_id then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.crm_can_access_region(claimed.team_id, claimed.region_id, null) then
    raise exception 'REGION_ACCESS_REQUIRED' using errcode = '42501';
  end if;
  if claimed.status <> 'public' or claimed.owner_id is not null then
    raise exception 'LEAD_ALREADY_CLAIMED' using errcode = 'P0001';
  end if;

  update public.crm_leads set owner_id = requester.id, status = 'claimed',
    claimed_at = now(), updated_at = now()
  where id = claimed.id
  returning * into claimed;
  insert into public.crm_owner_history
    (team_id, entity_type, entity_id, previous_owner_id, new_owner_id, reason, changed_by)
  values (claimed.team_id, 'lead', claimed.id, null, requester.id, 'lead_claimed', requester.id);
  return claimed;
end $$;

revoke all on function public.crm_can_access_region(text, uuid, uuid) from public;
revoke all on function public.claim_crm_lead(uuid) from public;
grant execute on function public.crm_can_access_region(text, uuid, uuid) to authenticated;
grant execute on function public.claim_crm_lead(uuid) to authenticated;

do $$ declare t text; begin
  foreach t in array array['crm_brands','crm_stores','crm_contacts','crm_contact_private',
    'crm_leads','crm_opportunities','crm_followups','crm_owner_history'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Restrictive policies are ANDed with every command policy, making the server
-- feature flag authoritative for reads and writes across the whole CRM.
create policy "sales os v3 server gate" on public.crm_brands as restrictive for all to authenticated
using (public.is_feature_enabled(team_id,'sales_os_v3')) with check (public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "sales os v3 server gate" on public.crm_stores as restrictive for all to authenticated
using (public.is_feature_enabled(team_id,'sales_os_v3')) with check (public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "sales os v3 server gate" on public.crm_contacts as restrictive for all to authenticated
using (public.is_feature_enabled(team_id,'sales_os_v3')) with check (public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "sales os v3 server gate" on public.crm_contact_private as restrictive for all to authenticated
using (public.is_feature_enabled(team_id,'sales_os_v3')) with check (public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "sales os v3 server gate" on public.crm_leads as restrictive for all to authenticated
using (public.is_feature_enabled(team_id,'sales_os_v3')) with check (public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "sales os v3 server gate" on public.crm_opportunities as restrictive for all to authenticated
using (public.is_feature_enabled(team_id,'sales_os_v3')) with check (public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "sales os v3 server gate" on public.crm_followups as restrictive for all to authenticated
using (public.is_feature_enabled(team_id,'sales_os_v3')) with check (public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "sales os v3 server gate" on public.crm_owner_history as restrictive for all to authenticated
using (public.is_feature_enabled(team_id,'sales_os_v3')) with check (public.is_feature_enabled(team_id,'sales_os_v3'));

create policy "crm brand regional read" on public.crm_brands for select to authenticated
using (public.is_team_member(team_id) and (owner_id = auth.uid() or public.has_permission(team_id,'customers.supervise')
  or exists (select 1 from public.crm_stores s where s.brand_id = id and public.crm_can_access_region(team_id,s.region_id,owner_id))));
create policy "crm brand owner manage" on public.crm_brands for all to authenticated
using (owner_id = auth.uid() or public.has_permission(team_id,'customers.supervise'))
with check (created_by = auth.uid() and (owner_id = auth.uid() or public.has_permission(team_id,'customers.supervise')));

create policy "crm store regional read" on public.crm_stores for select to authenticated
using (public.crm_can_access_region(team_id,region_id,owner_id));
create policy "crm store regional manage" on public.crm_stores for all to authenticated
using (public.crm_can_access_region(team_id,region_id,owner_id) and public.has_permission(team_id,'customers.manage'))
with check (created_by = auth.uid() and public.crm_can_access_region(team_id,region_id,owner_id)
  and public.has_permission(team_id,'customers.manage'));

create policy "crm contact scoped read" on public.crm_contacts for select to authenticated
using (owner_id = auth.uid() or public.can_act_for(team_id,owner_id) or public.has_permission(team_id,'customers.supervise'));
create policy "crm contact scoped manage" on public.crm_contacts for all to authenticated
using ((owner_id = auth.uid() or public.has_permission(team_id,'customers.supervise')) and public.has_permission(team_id,'customers.manage'))
with check (created_by = auth.uid() and (owner_id = auth.uid() or public.has_permission(team_id,'customers.supervise'))
  and public.has_permission(team_id,'customers.manage'));

create policy "crm private owner read" on public.crm_contact_private for select to authenticated
using (exists (select 1 from public.crm_contacts c where c.id = contact_id and c.team_id = team_id
  and (c.owner_id = auth.uid() or public.can_act_for(team_id,c.owner_id)
    or public.has_permission(team_id,'customers.read_sensitive'))));
create policy "crm private owner manage" on public.crm_contact_private for all to authenticated
using (exists (select 1 from public.crm_contacts c where c.id = contact_id and c.team_id = team_id
  and (c.owner_id = auth.uid() or public.has_permission(team_id,'customers.read_sensitive'))))
with check (updated_by = auth.uid() and exists (select 1 from public.crm_contacts c where c.id = contact_id
  and c.team_id = team_id and (c.owner_id = auth.uid() or public.has_permission(team_id,'customers.read_sensitive'))));

create policy "crm lead regional read" on public.crm_leads for select to authenticated
using (public.crm_can_access_region(team_id,region_id,owner_id));
create policy "crm lead regional manage" on public.crm_leads for all to authenticated
using (owner_id = auth.uid() or public.has_permission(team_id,'customers.supervise'))
with check (created_by = auth.uid() and public.crm_can_access_region(team_id,region_id,owner_id)
  and public.has_permission(team_id,'customers.manage'));

create policy "crm opportunity scoped read" on public.crm_opportunities for select to authenticated
using (public.crm_can_access_region(team_id,region_id,owner_id));
create policy "crm opportunity scoped manage" on public.crm_opportunities for all to authenticated
using ((owner_id = auth.uid() or public.has_permission(team_id,'customers.supervise')) and public.has_permission(team_id,'customers.manage'))
with check (created_by = auth.uid() and public.crm_can_access_region(team_id,region_id,owner_id)
  and public.has_permission(team_id,'customers.manage'));

create policy "crm followup scoped read" on public.crm_followups for select to authenticated
using (actor_id = auth.uid() or public.can_act_for(team_id,actor_id) or public.has_permission(team_id,'customers.supervise'));
create policy "crm followup self insert" on public.crm_followups for insert to authenticated
with check (actor_id = auth.uid() and public.has_permission(team_id,'customers.manage'));

create policy "crm history scoped read" on public.crm_owner_history for select to authenticated
using (previous_owner_id = auth.uid() or new_owner_id = auth.uid() or public.has_permission(team_id,'customers.supervise'));

create index crm_stores_region_idx on public.crm_stores(team_id,region_id);
create index crm_leads_queue_idx on public.crm_leads(team_id,region_id,status,created_at);
create index crm_opportunities_owner_idx on public.crm_opportunities(team_id,owner_id,stage);
create index crm_followups_lead_idx on public.crm_followups(lead_id,occurred_at desc);
create index crm_followups_opportunity_idx on public.crm_followups(opportunity_id,occurred_at desc);
create index crm_owner_history_entity_idx on public.crm_owner_history(entity_type,entity_id,changed_at desc);

-- Frontend contract for SalesWorkbenchDataSource.listLeads(). The view is
-- security-invoker, contains no raw phone column, and emits a deliberately null
-- masked_phone until a separately authorised contact workflow is implemented.
create or replace view public.crm_leads_visible
with (security_invoker = true) as
select
  l.id,
  case when l.owner_id = auth.uid() then 'mine'::text else 'region'::text end as read_scope,
  coalesce(s.name, l.title) as store_name,
  c.name as contact_name,
  null::text as masked_phone,
  r.name as district_name,
  s.business_type,
  l.source,
  l.created_at,
  l.next_action_at,
  case
    when l.status = 'qualified' then 'qualified'
    when l.status = 'claimed' and l.last_effective_followup_at is not null then 'contacted'
    else 'new'
  end::text as stage,
  coalesce((
    select array_agg(coalesce(f.new_business_fact, f.customer_commitment) order by f.occurred_at)
    from public.crm_followups f
    where f.lead_id = l.id and f.is_effective
  ), array[]::text[]) as facts
from public.crm_leads l
left join public.crm_stores s on s.id = l.store_id and s.team_id = l.team_id
join public.sales_regions r on r.id = l.region_id and r.team_id = l.team_id
left join lateral (
  select contact.name
  from public.crm_contacts contact
  where contact.team_id = l.team_id
    and (contact.store_id = l.store_id or (l.store_id is null and contact.brand_id = l.brand_id))
  order by contact.is_key_person desc, contact.created_at
  limit 1
) c on true
where public.is_feature_enabled(l.team_id, 'sales_os_v3')
  and public.crm_can_access_region(l.team_id, l.region_id, l.owner_id);

revoke all on public.crm_leads_visible from public, anon;
grant select on public.crm_leads_visible to authenticated;

create or replace function public.record_crm_follow_up(
  p_lead_id uuid,
  p_business_fact text,
  p_customer_commitment text,
  p_next_action_at timestamptz
)
returns setof public.crm_leads_visible
language plpgsql security definer set search_path = '' as $$
declare
  requester public.profiles;
  target public.crm_leads;
  business_fact text := nullif(trim(p_business_fact), '');
  customer_commitment text := nullif(trim(p_customer_commitment), '');
begin
  select * into requester from public.profiles where id=auth.uid() and status='active';
  if requester.id is null then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
  if not public.is_feature_enabled(requester.team_id, 'sales_os_v3') then
    raise exception 'SALES_OS_V3_DISABLED' using errcode='42501';
  end if;
  if business_fact is null and customer_commitment is null then
    raise exception 'FOLLOW_UP_EVIDENCE_REQUIRED' using errcode='22023';
  end if;
  if p_next_action_at is null then
    raise exception 'NEXT_ACTION_REQUIRED' using errcode='22023';
  end if;

  select * into target from public.crm_leads where id=p_lead_id for update;
  if target.id is null or target.team_id <> requester.team_id then
    raise exception 'LEAD_NOT_FOUND' using errcode='P0002';
  end if;
  if not (target.owner_id=requester.id
    or public.can_act_for(target.team_id,target.owner_id)
    or public.has_permission(target.team_id,'customers.supervise')) then
    raise exception 'LEAD_FOLLOW_UP_FORBIDDEN' using errcode='42501';
  end if;

  insert into public.crm_followups
    (team_id,lead_id,actor_id,channel,outcome,new_business_fact,customer_commitment,next_action_at)
  values
    (target.team_id,target.id,requester.id,'other','workbench_follow_up',business_fact,customer_commitment,p_next_action_at);

  update public.crm_leads
  set last_effective_followup_at=now(), next_action_at=p_next_action_at,
      last_contact_attempt_at=now(), updated_at=now()
  where id=target.id;

  return query select v.* from public.crm_leads_visible v where v.id=target.id;
end $$;

revoke all on function public.record_crm_follow_up(uuid,text,text,timestamptz) from public;
grant execute on function public.record_crm_follow_up(uuid,text,text,timestamptz) to authenticated;

notify pgrst, 'reload schema';
