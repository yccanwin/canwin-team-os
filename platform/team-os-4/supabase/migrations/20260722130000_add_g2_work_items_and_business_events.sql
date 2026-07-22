-- G2 foundation: one work-item source and its immutable business event stream.

create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  assignee_id uuid not null,
  role_type text not null,
  kind text not null,
  source_business text not null,
  source_id uuid not null,
  generation_rule text not null,
  title text not null,
  status text not null default 'pending',
  priority text not null default 'normal',
  planned_at timestamptz,
  due_at timestamptz,
  next_step text,
  blocked_reason text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_items_company_identity unique (id, company_id),
  constraint work_items_assignee_company_fk
    foreign key (assignee_id, company_id)
    references public.profiles(id, company_id)
    on delete restrict,
  constraint work_items_generation_identity
    unique (company_id, source_business, source_id, generation_rule),
  constraint work_items_role_type check (
    role_type in ('sales', 'implementation', 'operations', 'finance', 'admin')
  ),
  constraint work_items_kind check (kind in ('reminder', 'business_action')),
  constraint work_items_source_business_not_blank check (btrim(source_business) <> ''),
  constraint work_items_generation_rule_not_blank check (btrim(generation_rule) <> ''),
  constraint work_items_title_not_blank check (btrim(title) <> ''),
  constraint work_items_status check (
    status in ('pending', 'in_progress', 'waiting', 'completed', 'cancelled')
  ),
  constraint work_items_priority check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint work_items_completion_consistent check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create table public.business_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  work_item_id uuid not null,
  event_type text not null,
  actor_user_id uuid,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint business_events_work_item_company_fk
    foreign key (work_item_id, company_id)
    references public.work_items(id, company_id)
    on delete restrict,
  constraint business_events_actor_company_fk
    foreign key (actor_user_id, company_id)
    references public.profiles(id, company_id)
    on delete restrict,
  constraint business_events_idempotency_identity
    unique (company_id, idempotency_key),
  constraint business_events_event_type check (
    event_type in ('created', 'assigned', 'started', 'waiting', 'completed', 'cancelled')
  ),
  constraint business_events_idempotency_key_not_blank check (btrim(idempotency_key) <> ''),
  constraint business_events_payload_object check (jsonb_typeof(payload) = 'object')
);

create index work_items_assignee_status_due_idx
  on public.work_items(company_id, assignee_id, status, due_at);
create index business_events_work_item_occurred_idx
  on public.business_events(company_id, work_item_id, occurred_at desc);
create index business_events_actor_company_idx
  on public.business_events(actor_user_id, company_id);

alter table public.work_items enable row level security;
alter table public.business_events enable row level security;

revoke all on table public.work_items from anon, authenticated;
revoke all on table public.business_events from anon, authenticated;
revoke all on sequence public.business_events_id_seq from anon, authenticated;

grant select on table public.work_items to authenticated;
grant select on table public.business_events to authenticated;
grant all privileges on table public.work_items to service_role;
grant all privileges on table public.business_events to service_role;
grant usage, select on sequence public.business_events_id_seq to service_role;

create policy work_items_select_assignee_or_admin
on public.work_items
for select
to authenticated
using (
  (assignee_id = (select auth.uid()) and private.is_active_company_member(company_id))
  or private.is_company_admin(company_id)
);

create policy business_events_select_assignee_or_admin
on public.business_events
for select
to authenticated
using (
  exists (
    select 1
    from public.work_items as w
    where w.id = business_events.work_item_id
      and w.company_id = business_events.company_id
      and w.assignee_id = (select auth.uid())
      and private.is_active_company_member(business_events.company_id)
  )
  or private.is_company_admin(business_events.company_id)
);

comment on table public.work_items is
  'Unified G2 work queue. A business source can generate each work item once per generation key.';
comment on table public.business_events is
  'Append-oriented G2 business events; mutation functions are intentionally deferred.';
