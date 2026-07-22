-- CanWin Team OS 4.0 clean foundation.
-- This migration is intentionally independent from every Team OS 3.0 migration.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
grant usage on schema private to authenticated;
grant usage on schema private to service_role;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  deployment_scope boolean not null default true unique,
  stable_key text not null unique,
  name text not null,
  timezone text not null default 'Asia/Shanghai',
  supervisor_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_single_deployment check (deployment_scope),
  constraint companies_stable_key_format check (stable_key ~ '^[a-z][a-z0-9_-]{2,62}$'),
  constraint companies_name_not_blank check (btrim(name) <> ''),
  constraint companies_timezone_team_os_4 check (timezone = 'Asia/Shanghai')
);

create table public.primary_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  role_key text not null,
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint primary_roles_company_identity unique (id, company_id),
  constraint primary_roles_company_key unique (company_id, role_key),
  constraint primary_roles_fixed_keys check (
    role_key in ('sales', 'implementation', 'operations', 'finance', 'admin')
  ),
  constraint primary_roles_label_not_blank check (btrim(label) <> '')
);

create table public.capabilities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  capability_key text not null,
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint capabilities_company_identity unique (id, company_id),
  constraint capabilities_company_key unique (company_id, capability_key),
  constraint capabilities_fixed_keys check (capability_key in ('warehouse', 'supervisor')),
  constraint capabilities_label_not_blank check (btrim(label) <> '')
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  primary_role_id uuid not null,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_company_identity unique (id, company_id),
  constraint profiles_primary_role_company_fk
    foreign key (primary_role_id, company_id)
    references public.primary_roles(id, company_id)
    on delete restrict,
  constraint profiles_display_name_not_blank check (btrim(display_name) <> '')
);

create table public.profile_capabilities (
  profile_id uuid not null,
  capability_id uuid not null,
  company_id uuid not null,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (profile_id, capability_id),
  constraint profile_capabilities_profile_company_fk
    foreign key (profile_id, company_id)
    references public.profiles(id, company_id)
    on delete restrict,
  constraint profile_capabilities_capability_company_fk
    foreign key (capability_id, company_id)
    references public.capabilities(id, company_id)
    on delete restrict,
  constraint profile_capabilities_revocation_order
    check (revoked_at is null or revoked_at >= granted_at)
);

create table public.system_runtime_state (
  company_id uuid primary key references public.companies(id) on delete restrict,
  initialization_sealed boolean not null default false,
  migration_mode boolean not null default true,
  business_writes_enabled boolean not null default false,
  background_jobs_enabled boolean not null default false,
  outbound_effects_enabled boolean not null default false,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint runtime_state_migration_is_closed check (
    not migration_mode
    or (
      not business_writes_enabled
      and not background_jobs_enabled
      and not outbound_effects_enabled
    )
  ),
  constraint runtime_state_writes_require_sealed_initialization check (
    not business_writes_enabled
    or (initialization_sealed and not migration_mode)
  ),
  constraint runtime_state_jobs_require_sealed_initialization check (
    not background_jobs_enabled
    or (initialization_sealed and not migration_mode)
  ),
  constraint runtime_state_outbound_requires_sealed_initialization check (
    not outbound_effects_enabled
    or (initialization_sealed and not migration_mode)
  )
);

create table public.initialization_audit (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies(id) on delete restrict,
  event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_label text not null,
  succeeded boolean not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint initialization_audit_event_type check (
    event_type in ('started', 'company_created', 'admin_created', 'sealed', 'failed')
  ),
  constraint initialization_audit_actor_not_blank check (btrim(actor_label) <> ''),
  constraint initialization_audit_details_object check (jsonb_typeof(details) = 'object')
);

create index profiles_company_id_idx on public.profiles(company_id);
create index profiles_primary_role_id_idx on public.profiles(primary_role_id);
create index profile_capabilities_company_id_idx on public.profile_capabilities(company_id);
create index profile_capabilities_capability_id_idx on public.profile_capabilities(capability_id);
create index initialization_audit_company_occurred_idx
  on public.initialization_audit(company_id, occurred_at desc);

create or replace function private.is_active_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.company_id = p_company_id
      and p.is_active
  );
$function$;

create or replace function private.is_company_admin(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles as p
    join public.primary_roles as r
      on r.id = p.primary_role_id
     and r.company_id = p.company_id
    where p.id = (select auth.uid())
      and p.company_id = p_company_id
      and p.is_active
      and r.is_active
      and r.role_key = 'admin'
  );
$function$;

create or replace function private.prevent_initialization_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'initialization audit is append-only' using errcode = '55000';
end;
$function$;

revoke all on function private.is_active_company_member(uuid) from public;
revoke all on function private.is_company_admin(uuid) from public;
revoke all on function private.prevent_initialization_audit_mutation() from public;
grant execute on function private.is_active_company_member(uuid) to authenticated;
grant execute on function private.is_company_admin(uuid) to authenticated;

create trigger initialization_audit_append_only
before update or delete on public.initialization_audit
for each row execute function private.prevent_initialization_audit_mutation();

alter table public.companies enable row level security;
alter table public.primary_roles enable row level security;
alter table public.capabilities enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_capabilities enable row level security;
alter table public.system_runtime_state enable row level security;
alter table public.initialization_audit enable row level security;

revoke all on table public.companies from anon, authenticated;
revoke all on table public.primary_roles from anon, authenticated;
revoke all on table public.capabilities from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.profile_capabilities from anon, authenticated;
revoke all on table public.system_runtime_state from anon, authenticated;
revoke all on table public.initialization_audit from anon, authenticated;
revoke all on sequence public.initialization_audit_id_seq from anon, authenticated;

grant select on table public.companies to authenticated;
grant select on table public.primary_roles to authenticated;
grant select on table public.capabilities to authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;
grant select on table public.profile_capabilities to authenticated;
grant select on table public.system_runtime_state to authenticated;
grant select on table public.initialization_audit to authenticated;

grant all privileges on table public.companies to service_role;
grant all privileges on table public.primary_roles to service_role;
grant all privileges on table public.capabilities to service_role;
grant all privileges on table public.profiles to service_role;
grant all privileges on table public.profile_capabilities to service_role;
grant all privileges on table public.system_runtime_state to service_role;
grant select, insert on table public.initialization_audit to service_role;
grant usage, select on sequence public.initialization_audit_id_seq to service_role;

create policy companies_select_member
on public.companies
for select
to authenticated
using (private.is_active_company_member(id));

create policy primary_roles_select_member
on public.primary_roles
for select
to authenticated
using (private.is_active_company_member(company_id));

create policy capabilities_select_member
on public.capabilities
for select
to authenticated
using (private.is_active_company_member(company_id));

create policy profiles_select_self_or_admin
on public.profiles
for select
to authenticated
using (
  (id = (select auth.uid()) and is_active)
  or private.is_company_admin(company_id)
);

create policy profiles_update_own_display_name
on public.profiles
for update
to authenticated
using (id = (select auth.uid()) and is_active)
with check (id = (select auth.uid()) and is_active);

create policy profile_capabilities_select_self_or_admin
on public.profile_capabilities
for select
to authenticated
using (
  (
    profile_id = (select auth.uid())
    and private.is_active_company_member(company_id)
  )
  or private.is_company_admin(company_id)
);

create policy system_runtime_state_select_member
on public.system_runtime_state
for select
to authenticated
using (private.is_active_company_member(company_id));

create policy initialization_audit_select_admin
on public.initialization_audit
for select
to authenticated
using (private.is_company_admin(company_id));

comment on table public.companies is
  'Single-company deployment root; deployment_scope limits the database to one company row.';
comment on table public.primary_roles is
  'The five fixed primary positions for Team OS 4.0.';
comment on table public.capabilities is
  'Additive warehouse and supervisor capabilities; never a second primary position.';
comment on table public.system_runtime_state is
  'Fail-closed initialization and migration-mode state. Business writes and side effects remain off during migration.';
comment on table public.initialization_audit is
  'Append-only initialization evidence. Credential values and secrets are forbidden in details.';
