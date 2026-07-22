-- G2 schedule view source. Work items remain the single task source.

create table public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  owner_id uuid not null,
  work_item_id uuid,
  event_type text not null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  notes text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_events_company_identity unique (id, company_id),
  constraint schedule_events_owner_company_fk
    foreign key (owner_id, company_id)
    references public.profiles(id, company_id)
    on delete restrict,
  constraint schedule_events_work_item_company_fk
    foreign key (work_item_id, company_id)
    references public.work_items(id, company_id)
    on delete restrict,
  constraint schedule_events_idempotency_identity
    unique (company_id, idempotency_key),
  constraint schedule_events_event_type check (
    event_type in ('meeting', 'visit', 'break', 'personal')
  ),
  constraint schedule_events_title_not_blank check (btrim(title) <> ''),
  constraint schedule_events_idempotency_key_not_blank check (btrim(idempotency_key) <> ''),
  constraint schedule_events_time_order check (ends_at > starts_at)
);

create index schedule_events_owner_starts_idx
  on public.schedule_events(company_id, owner_id, starts_at);
create index schedule_events_work_item_idx
  on public.schedule_events(work_item_id, company_id)
  where work_item_id is not null;

alter table public.schedule_events enable row level security;

revoke all on table public.schedule_events from anon, authenticated;
grant select on table public.schedule_events to authenticated;
grant all privileges on table public.schedule_events to service_role;

create policy schedule_events_select_owner_or_admin
on public.schedule_events
for select
to authenticated
using (
  (owner_id = (select auth.uid()) and private.is_active_company_member(company_id))
  or private.is_company_admin(company_id)
);

comment on table public.schedule_events is
  'Meetings, visits, breaks, and personal schedules. Optional work_item_id links to the single work-item source without creating a duplicate task. Customer linkage is deferred until a typed 4.0 customer table exists; untyped source_reference JSON is forbidden.';
comment on column public.schedule_events.work_item_id is
  'Optional view linkage only; inserting a schedule event never creates another work item.';
