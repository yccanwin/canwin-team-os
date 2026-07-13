-- CanWin Team OS 3.0 access-control foundation.
-- Additive only: profiles.role remains unchanged for 2.0 compatibility.

create table if not exists public.access_roles (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,47}$'),
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, code)
);

create table if not exists public.access_permissions (
  code text primary key check (code ~ '^[a-z][a-z0-9_.]{2,95}$'),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.access_role_permissions (
  role_id uuid not null references public.access_roles(id) on delete cascade,
  permission_code text not null references public.access_permissions(code) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null,
  primary key (role_id, permission_code)
);

create table if not exists public.profile_access_roles (
  team_id text not null references public.teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.access_roles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  primary key (profile_id, role_id)
);

create table if not exists public.sales_regions (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  parent_id uuid references public.sales_regions(id) on delete restrict,
  code text not null,
  name text not null,
  region_level text not null default 'district'
    check (region_level in ('province', 'city', 'district', 'custom')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, code)
);

create table if not exists public.profile_sales_regions (
  team_id text not null references public.teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  region_id uuid not null references public.sales_regions(id) on delete cascade,
  is_primary boolean not null default false,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  primary key (profile_id, region_id)
);

create unique index if not exists profile_sales_regions_one_primary_idx
on public.profile_sales_regions (profile_id)
where is_primary;

create table if not exists public.access_delegations (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  delegator_id uuid not null references public.profiles(id) on delete cascade,
  delegate_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'expired')),
  created_by uuid not null references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (delegator_id <> delegate_id),
  check (ends_at > starts_at),
  check ((status = 'revoked') = (revoked_at is not null))
);

create index if not exists access_delegations_active_lookup_idx
on public.access_delegations (team_id, delegate_id, starts_at, ends_at)
where status = 'active';

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_.-]{2,95}$'),
  description text,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, key)
);

-- Definer helpers deliberately query only identity/access tables. They do not
-- trust caller-provided JWT role claims or the browser UI.
create or replace function public.has_access_role(
  target_team_id text,
  allowed_role_codes text[]
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.profiles p
    join public.profile_access_roles par
      on par.profile_id = p.id and par.team_id = p.team_id
    join public.access_roles ar
      on ar.id = par.role_id and ar.team_id = par.team_id
    where p.id = auth.uid()
      and p.team_id = target_team_id
      and p.status = 'active'
      and ar.code = any(allowed_role_codes)
  )
$$;

create or replace function public.has_permission(
  target_team_id text,
  target_permission_code text
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.profiles p
    join public.profile_access_roles par
      on par.profile_id = p.id and par.team_id = p.team_id
    join public.access_roles ar
      on ar.id = par.role_id and ar.team_id = par.team_id
    join public.access_role_permissions arp on arp.role_id = ar.id
    where p.id = auth.uid()
      and p.team_id = target_team_id
      and p.status = 'active'
      and arp.permission_code = target_permission_code
  )
$$;

create or replace function public.can_act_for(
  target_team_id text,
  target_profile_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select auth.uid() = target_profile_id
    or exists (
      select 1
      from public.profiles delegator
      join public.profiles delegate
        on delegate.id = auth.uid() and delegate.team_id = delegator.team_id
      join public.access_delegations d
        on d.delegator_id = delegator.id
       and d.delegate_id = delegate.id
       and d.team_id = delegator.team_id
      where delegator.id = target_profile_id
        and delegator.team_id = target_team_id
        and delegator.status = 'active'
        and delegate.status = 'active'
        and d.status = 'active'
        and now() >= d.starts_at
        and now() < d.ends_at
    )
$$;

create or replace function public.is_feature_enabled(
  target_team_id text,
  target_key text
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce((
    select ff.enabled
    from public.feature_flags ff
    where ff.team_id = target_team_id and ff.key = target_key
  ), false)
$$;

revoke all on function public.has_access_role(text, text[]) from public;
revoke all on function public.has_permission(text, text) from public;
revoke all on function public.can_act_for(text, uuid) from public;
revoke all on function public.is_feature_enabled(text, text) from public;
grant execute on function public.has_access_role(text, text[]) to authenticated;
grant execute on function public.has_permission(text, text) to authenticated;
grant execute on function public.can_act_for(text, uuid) to authenticated;
grant execute on function public.is_feature_enabled(text, text) to authenticated;

insert into public.access_permissions (code, name, description) values
  ('access.manage', 'Manage access', 'Manage roles, permissions, regions and delegations'),
  ('customers.read_region', 'Read regional customers', 'Read customer data within assigned regions'),
  ('customers.manage', 'Manage customers', 'Create and update customer records'),
  ('finance.read', 'Read finance', 'Read protected financial records'),
  ('finance.manage', 'Manage finance', 'Confirm payments and reversals'),
  ('inventory.manage', 'Manage inventory', 'Manage inventory and fulfilment'),
  ('implementation.manage', 'Manage implementation', 'Manage installation and training'),
  ('operations.manage', 'Manage operations', 'Manage after-sales operations')
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description;

insert into public.access_roles (team_id, code, name, description, is_system)
select t.id, seed.code, seed.name, seed.description, true
from public.teams t
cross join (values
  ('owner', 'Owner', 'Full team authority'),
  ('admin', 'Administrator', 'Access and system administration'),
  ('supervisor', 'Sales supervisor', 'Sales team supervision'),
  ('sales', 'Sales', 'Sales execution'),
  ('finance', 'Finance', 'Finance confirmation and reporting'),
  ('warehouse', 'Warehouse', 'Inventory and hardware fulfilment'),
  ('implementation', 'Implementation', 'Installation and training'),
  ('operations', 'Operations', 'After-sales operations')
) as seed(code, name, description)
on conflict (team_id, code) do update set
  name = excluded.name,
  description = excluded.description,
  is_system = true;

-- Owner/admin permissions are explicit so future additions remain fail-closed.
insert into public.access_role_permissions (role_id, permission_code)
select ar.id, ap.code
from public.access_roles ar
cross join public.access_permissions ap
where ar.code in ('owner', 'admin')
on conflict do nothing;

insert into public.access_role_permissions (role_id, permission_code)
select ar.id, mapping.permission_code
from public.access_roles ar
join (values
  ('supervisor', 'customers.read_region'),
  ('supervisor', 'customers.manage'),
  ('sales', 'customers.read_region'),
  ('sales', 'customers.manage'),
  ('finance', 'finance.read'),
  ('finance', 'finance.manage'),
  ('warehouse', 'inventory.manage'),
  ('implementation', 'implementation.manage'),
  ('operations', 'operations.manage')
) as mapping(role_code, permission_code) on mapping.role_code = ar.code
on conflict do nothing;

-- Compatibility bootstrap: old roles continue to work while acquiring their
-- closest 3.0 role. No existing profile data is changed.
insert into public.profile_access_roles (team_id, profile_id, role_id)
select p.team_id, p.id, ar.id
from public.profiles p
join public.access_roles ar
  on ar.team_id = p.team_id
 and ar.code = case p.role
   when 'admin' then 'admin'
   when 'captain' then 'supervisor'
   when 'finance' then 'finance'
   when 'warehouse' then 'warehouse'
 end
where p.role in ('admin', 'captain', 'finance', 'warehouse')
on conflict do nothing;

insert into public.feature_flags (team_id, key, description, enabled)
select id, 'sales_os_v3', 'CanWin Team OS 3.0 sales workspace', false
from public.teams
on conflict (team_id, key) do nothing;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'access_roles', 'access_permissions', 'access_role_permissions',
    'profile_access_roles', 'sales_regions', 'profile_sales_regions',
    'access_delegations', 'feature_flags'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

-- Metadata is readable only to active team members; all writes require the
-- explicit access.manage permission. No anonymous policy is created.
create policy "members read access roles"
on public.access_roles for select to authenticated
using (public.is_team_member(team_id));
create policy "access managers manage roles"
on public.access_roles for all to authenticated
using (public.has_permission(team_id, 'access.manage'))
with check (public.has_permission(team_id, 'access.manage'));

create policy "members read permissions"
on public.access_permissions for select to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.status = 'active'
));

create policy "members read role permissions"
on public.access_role_permissions for select to authenticated
using (exists (
  select 1 from public.access_roles ar
  where ar.id = role_id and public.is_team_member(ar.team_id)
));
create policy "access managers manage role permissions"
on public.access_role_permissions for all to authenticated
using (exists (
  select 1 from public.access_roles ar
  where ar.id = role_id and public.has_permission(ar.team_id, 'access.manage')
))
with check (exists (
  select 1 from public.access_roles ar
  where ar.id = role_id and public.has_permission(ar.team_id, 'access.manage')
));

create policy "members read own role assignments"
on public.profile_access_roles for select to authenticated
using (profile_id = auth.uid() or public.has_permission(team_id, 'access.manage'));
create policy "access managers manage role assignments"
on public.profile_access_roles for all to authenticated
using (public.has_permission(team_id, 'access.manage'))
with check (
  public.has_permission(team_id, 'access.manage')
  and exists (select 1 from public.profiles p where p.id = profile_id and p.team_id = team_id)
  and exists (select 1 from public.access_roles ar where ar.id = role_id and ar.team_id = team_id)
);

create policy "members read regions"
on public.sales_regions for select to authenticated
using (public.is_team_member(team_id));
create policy "access managers manage regions"
on public.sales_regions for all to authenticated
using (public.has_permission(team_id, 'access.manage'))
with check (public.has_permission(team_id, 'access.manage'));

create policy "members read own region assignments"
on public.profile_sales_regions for select to authenticated
using (profile_id = auth.uid() or public.has_permission(team_id, 'access.manage'));
create policy "access managers manage region assignments"
on public.profile_sales_regions for all to authenticated
using (public.has_permission(team_id, 'access.manage'))
with check (
  public.has_permission(team_id, 'access.manage')
  and exists (select 1 from public.profiles p where p.id = profile_id and p.team_id = team_id)
  and exists (select 1 from public.sales_regions r where r.id = region_id and r.team_id = team_id)
);

create policy "delegation participants read delegations"
on public.access_delegations for select to authenticated
using (
  delegator_id = auth.uid()
  or delegate_id = auth.uid()
  or public.has_permission(team_id, 'access.manage')
);
create policy "access managers manage delegations"
on public.access_delegations for all to authenticated
using (public.has_permission(team_id, 'access.manage'))
with check (
  public.has_permission(team_id, 'access.manage')
  and created_by = auth.uid()
  and exists (select 1 from public.profiles p where p.id = delegator_id and p.team_id = team_id)
  and exists (select 1 from public.profiles p where p.id = delegate_id and p.team_id = team_id)
);

create policy "members read feature flags"
on public.feature_flags for select to authenticated
using (public.is_team_member(team_id));
create policy "access managers manage feature flags"
on public.feature_flags for all to authenticated
using (public.has_permission(team_id, 'access.manage'))
with check (public.has_permission(team_id, 'access.manage') and updated_by = auth.uid());

create index if not exists profile_access_roles_team_profile_idx
on public.profile_access_roles (team_id, profile_id);
create index if not exists profile_sales_regions_team_profile_idx
on public.profile_sales_regions (team_id, profile_id);
create index if not exists sales_regions_team_parent_idx
on public.sales_regions (team_id, parent_id);
create unique index if not exists profiles_team_id_key on public.profiles(team_id,id);

create or replace function public.protect_last_team_admin()
returns trigger language plpgsql security definer set search_path=''as$$
declare affected_team text:=old.team_id;
begin if not exists(select 1 from public.profile_access_roles par join public.access_roles ar on ar.id=par.role_id and ar.team_id=par.team_id join public.profiles p on p.id=par.profile_id and p.team_id=par.team_id where par.team_id=affected_team and ar.code='admin'and p.status='active')then raise exception'LAST_ADMIN_REQUIRED'using errcode='23514';end if;return null;end$$;
create constraint trigger profile_access_roles_last_admin after delete or update on public.profile_access_roles deferrable initially deferred for each row execute function public.protect_last_team_admin();

create or replace function public.manage_profile_access(p_profile_id uuid,p_role_codes text[],p_region_ids uuid[])
returns jsonb language plpgsql security definer set search_path=''as$$
declare actor public.profiles;target public.profiles;roles text[]:=coalesce(p_role_codes,array[]::text[]);regions uuid[]:=coalesce(p_region_ids,array[]::uuid[]);before_state jsonb;after_state jsonb;
begin select*into actor from public.profiles where id=auth.uid()and status='active';select*into target from public.profiles where id=p_profile_id;
 if actor.id is null or target.id is null or actor.team_id<>target.team_id then raise exception'PROFILE_NOT_FOUND'using errcode='P0002';end if;
 if not public.has_access_role(actor.team_id,array['owner','admin'])then raise exception'ADMIN_REQUIRED'using errcode='42501';end if;
 if(select count(distinct ar.code)from public.access_roles ar where ar.team_id=actor.team_id and ar.code=any(roles))<>(select count(distinct x)from unnest(roles)x)then raise exception'INVALID_ROLE_FOR_TEAM'using errcode='23514';end if;
 if(select count(distinct sr.id)from public.sales_regions sr where sr.team_id=actor.team_id and sr.is_active and sr.id=any(regions))<>(select count(distinct x)from unnest(regions)x)then raise exception'INVALID_REGION_FOR_TEAM'using errcode='23514';end if;
 select jsonb_build_object('roles',coalesce(jsonb_agg(distinct ar.code)filter(where ar.code is not null),'[]'),'regions',coalesce(jsonb_agg(distinct psr.region_id)filter(where psr.region_id is not null),'[]'))into before_state
 from public.profile_access_roles par full join public.profile_sales_regions psr on psr.profile_id=par.profile_id and psr.team_id=par.team_id left join public.access_roles ar on ar.id=par.role_id where coalesce(par.profile_id,psr.profile_id)=target.id;
 delete from public.profile_access_roles where profile_id=target.id and team_id=target.team_id;
 insert into public.profile_access_roles(team_id,profile_id,role_id,assigned_by)select target.team_id,target.id,ar.id,actor.id from public.access_roles ar where ar.team_id=target.team_id and ar.code in(select distinct unnest(roles));
 delete from public.profile_sales_regions where profile_id=target.id and team_id=target.team_id;
 insert into public.profile_sales_regions(team_id,profile_id,region_id,assigned_by,is_primary)select target.team_id,target.id,selected.region_id,actor.id,row_number()over(order by selected.region_id)=1 from(select distinct unnest(regions)as region_id)selected;
 select jsonb_build_object('roles',to_jsonb(roles),'regions',to_jsonb(regions))into after_state;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(target.team_id,actor.id,'profile.access_replaced','profile',target.id,before_state,after_state);
 return after_state;end$$;
revoke all on function public.manage_profile_access(uuid,text[],uuid[])from public;grant execute on function public.manage_profile_access(uuid,text[],uuid[])to authenticated;

notify pgrst, 'reload schema';
