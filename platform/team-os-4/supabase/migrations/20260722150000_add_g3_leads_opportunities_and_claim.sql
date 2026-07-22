-- G3 sales intake and opportunity foundation.

create table public.profile_regions (
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null,
  region text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, profile_id, region),
  constraint profile_regions_profile_company_fk foreign key (profile_id, company_id)
    references public.profiles(id, company_id) on delete cascade,
  constraint profile_regions_region_not_blank check (btrim(region) <> '')
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  owner_id uuid,
  name text not null,
  region text not null,
  phone text not null,
  pool_status text not null default 'public_pool',
  cleanup_due_at timestamptz,
  source_business text not null,
  source_key text not null,
  claim_idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_company_identity unique (id, company_id),
  constraint leads_owner_company_fk foreign key (owner_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint leads_source_identity unique (company_id, source_business, source_key),
  constraint leads_claim_identity unique (company_id, claim_idempotency_key),
  constraint leads_name_not_blank check (btrim(name) <> ''),
  constraint leads_region_not_blank check (btrim(region) <> ''),
  constraint leads_phone_not_blank check (btrim(phone) <> ''),
  constraint leads_source_business_not_blank check (btrim(source_business) <> ''),
  constraint leads_source_key_not_blank check (btrim(source_key) <> ''),
  constraint leads_pool_status check (pool_status in ('public_pool', 'claimed', 'converted', 'discarded')),
  constraint leads_owner_status_consistent check (
    (pool_status = 'public_pool' and owner_id is null)
    or (pool_status <> 'public_pool' and owner_id is not null)
  )
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_id uuid not null,
  store_id uuid not null,
  owner_id uuid not null,
  name text not null,
  stage text not null default 'discovery',
  source_business text not null,
  source_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opportunities_company_identity unique (id, company_id),
  constraint opportunities_customer_company_fk foreign key (customer_id, company_id)
    references public.customers(id, company_id) on delete restrict,
  constraint opportunities_store_company_fk foreign key (store_id, company_id)
    references public.stores(id, company_id) on delete restrict,
  constraint opportunities_owner_company_fk foreign key (owner_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint opportunities_source_identity unique (company_id, source_business, source_key),
  constraint opportunities_name_not_blank check (btrim(name) <> ''),
  constraint opportunities_stage check (
    stage in ('discovery', 'qualified', 'proposal', 'negotiation', 'won', 'lost')
  ),
  constraint opportunities_source_business_not_blank check (btrim(source_business) <> ''),
  constraint opportunities_source_key_not_blank check (btrim(source_key) <> '')
);

create index leads_pool_claim_priority_idx
  on public.leads(company_id, pool_status, cleanup_due_at, created_at);
create index leads_owner_idx on public.leads(company_id, owner_id);
create index opportunities_owner_stage_idx on public.opportunities(company_id, owner_id, stage);

create or replace function private.enforce_opportunity_store_customer()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if not exists (
    select 1 from public.stores as s
    join public.brands as b on b.id = s.brand_id and b.company_id = s.company_id
    where s.id = new.store_id and s.company_id = new.company_id
      and b.customer_id = new.customer_id
  ) then
    raise exception 'opportunity store does not belong to customer' using errcode = '23514';
  end if;
  return new;
end;
$function$;

create trigger opportunities_store_customer_guard
before insert or update of customer_id, store_id, company_id on public.opportunities
for each row execute function private.enforce_opportunity_store_customer();

alter table public.leads enable row level security;
alter table public.opportunities enable row level security;
alter table public.profile_regions enable row level security;
revoke all on table public.profile_regions from anon, authenticated;
revoke all on table public.leads from anon, authenticated;
revoke all on table public.opportunities from anon, authenticated;
grant select on table public.leads to authenticated;
grant select on table public.opportunities to authenticated;
grant all privileges on table public.leads to service_role;
grant all privileges on table public.opportunities to service_role;
grant select on table public.profile_regions to authenticated;
grant all privileges on table public.profile_regions to service_role;

create policy profile_regions_select_self_or_admin on public.profile_regions
for select to authenticated
using (profile_id = (select auth.uid()) or private.is_company_admin(company_id));

create policy leads_select_owner_or_admin on public.leads
for select to authenticated
using (
  (owner_id = (select auth.uid()) and private.is_active_company_member(company_id))
  or (
    pool_status = 'public_pool'
    and private.is_active_company_member(company_id)
    and exists (
      select 1 from public.profile_regions as pr
      where pr.company_id = leads.company_id
        and pr.profile_id = (select auth.uid())
        and pr.region = leads.region
        and pr.is_active
    )
  )
  or private.is_company_admin(company_id)
);

create policy opportunities_select_owner_or_admin on public.opportunities
for select to authenticated
using (
  (owner_id = (select auth.uid()) and private.is_active_company_member(company_id))
  or private.is_company_admin(company_id)
);

create or replace function public.claim_lead_v1(
  p_company_id uuid,
  p_claimant_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lead_id uuid;
begin
  if p_idempotency_key is null or pg_catalog.btrim(p_idempotency_key) = '' then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles as p
    join public.primary_roles as r
      on r.id = p.primary_role_id and r.company_id = p.company_id
    where p.id = p_claimant_user_id and p.company_id = p_company_id
      and p.is_active and r.is_active and r.role_key = 'sales'
  ) then
    raise exception 'claimant is not an active sales profile' using errcode = '42501';
  end if;

  select l.id into v_lead_id
  from public.leads as l
  where l.company_id = p_company_id
    and l.claim_idempotency_key = pg_catalog.btrim(p_idempotency_key);
  if v_lead_id is not null then
    return pg_catalog.jsonb_build_object('status', 'claimed', 'idempotent', true, 'lead_id', v_lead_id);
  end if;

  select l.id into v_lead_id
  from public.leads as l
  where l.company_id = p_company_id and l.pool_status = 'public_pool'
    and exists (
      select 1 from public.profile_regions as pr
      where pr.company_id = l.company_id
        and pr.profile_id = p_claimant_user_id
        and pr.region = l.region
        and pr.is_active
    )
  order by l.cleanup_due_at asc nulls last, l.created_at asc, l.id asc
  for update skip locked
  limit 1;
  if v_lead_id is null then
    raise exception 'no public-pool lead is available' using errcode = 'P0002';
  end if;

  update public.leads
  set owner_id = p_claimant_user_id,
      pool_status = 'claimed',
      cleanup_due_at = null,
      claim_idempotency_key = pg_catalog.btrim(p_idempotency_key),
      updated_at = pg_catalog.now()
  where id = v_lead_id and company_id = p_company_id;

  return pg_catalog.jsonb_build_object('status', 'claimed', 'idempotent', false, 'lead_id', v_lead_id);
end;
$function$;

revoke all on function public.claim_lead_v1(uuid, uuid, text) from public;
revoke all on function public.claim_lead_v1(uuid, uuid, text) from anon;
revoke all on function public.claim_lead_v1(uuid, uuid, text) from authenticated;
grant execute on function public.claim_lead_v1(uuid, uuid, text) to service_role;
