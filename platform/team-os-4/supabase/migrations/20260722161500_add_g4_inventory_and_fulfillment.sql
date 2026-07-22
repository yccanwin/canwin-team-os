-- G4 inventory and fulfillment structure. Reservation is intentionally deferred
-- until an immutable internal-payment event source exists.

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  name text not null,
  external_key text not null,
  is_active boolean not null default true,
  constraint warehouses_company_identity unique (id, company_id),
  constraint warehouses_external_identity unique (company_id, external_key),
  constraint warehouses_name_not_blank check (btrim(name) <> ''),
  constraint warehouses_external_key_not_blank check (btrim(external_key) <> '')
);

create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  warehouse_id uuid not null,
  product_id uuid not null,
  on_hand_quantity numeric(14,3) not null default 0,
  reserved_quantity numeric(14,3) not null default 0,
  constraint stock_items_company_identity unique (id, company_id),
  constraint stock_items_warehouse_product unique (warehouse_id, product_id),
  constraint stock_items_warehouse_company_fk foreign key (warehouse_id, company_id)
    references public.warehouses(id, company_id) on delete restrict,
  constraint stock_items_product_company_fk foreign key (product_id, company_id)
    references public.products(id, company_id) on delete restrict,
  constraint stock_items_quantities_nonnegative check (
    on_hand_quantity >= 0 and reserved_quantity >= 0 and reserved_quantity <= on_hand_quantity
  )
);

create table public.inventory_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  stock_item_id uuid not null,
  event_type text not null,
  quantity_delta numeric(14,3) not null,
  idempotency_key text not null,
  source_type text not null,
  source_id uuid not null,
  occurred_at timestamptz not null default now(),
  constraint inventory_events_stock_company_fk foreign key (stock_item_id, company_id)
    references public.stock_items(id, company_id) on delete restrict,
  constraint inventory_events_idempotency unique (company_id, idempotency_key),
  constraint inventory_events_type check (
    event_type in ('received', 'reserved', 'reservation_released', 'dispatched', 'adjusted')
  ),
  constraint inventory_events_delta_nonzero check (quantity_delta <> 0),
  constraint inventory_events_idempotency_not_blank check (btrim(idempotency_key) <> ''),
  constraint inventory_events_source_not_blank check (btrim(source_type) <> '')
);

create table public.fulfillment_units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  store_id uuid not null,
  order_line_id uuid not null,
  status text not null default 'pending',
  assigned_to uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fulfillment_units_company_identity unique (id, company_id),
  constraint fulfillment_units_store_line unique (company_id, store_id, order_line_id),
  constraint fulfillment_units_store_company_fk foreign key (store_id, company_id)
    references public.stores(id, company_id) on delete restrict,
  constraint fulfillment_units_order_line_company_fk foreign key (order_line_id, company_id)
    references public.order_lines(id, company_id) on delete restrict,
  constraint fulfillment_units_assignee_company_fk foreign key (assigned_to, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint fulfillment_units_status check (
    status in ('pending', 'reserved', 'scheduled', 'in_progress', 'completed', 'cancelled')
  )
);

create table public.service_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  fulfillment_unit_id uuid not null,
  assignee_id uuid not null,
  service_type text not null,
  status text not null default 'assigned',
  scheduled_at timestamptz,
  completed_at timestamptz,
  constraint service_assignments_unit_assignee unique (fulfillment_unit_id, assignee_id, service_type),
  constraint service_assignments_unit_company_fk foreign key (fulfillment_unit_id, company_id)
    references public.fulfillment_units(id, company_id) on delete restrict,
  constraint service_assignments_assignee_company_fk foreign key (assignee_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint service_assignments_type check (service_type in ('installation', 'training', 'acceptance', 'operations_handoff')),
  constraint service_assignments_status check (status in ('assigned', 'in_progress', 'completed', 'cancelled')),
  constraint service_assignments_completion_consistent check (
    (status = 'completed' and completed_at is not null) or (status <> 'completed' and completed_at is null)
  )
);

create table public.fulfillment_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  fulfillment_unit_id uuid not null,
  event_type text not null,
  actor_user_id uuid,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint fulfillment_events_unit_company_fk foreign key (fulfillment_unit_id, company_id)
    references public.fulfillment_units(id, company_id) on delete restrict,
  constraint fulfillment_events_actor_company_fk foreign key (actor_user_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint fulfillment_events_idempotency unique (company_id, idempotency_key),
  constraint fulfillment_events_type check (event_type in ('created', 'reserved', 'scheduled', 'started', 'completed', 'cancelled')),
  constraint fulfillment_events_payload_object check (jsonb_typeof(payload) = 'object')
);

create or replace function private.prevent_inventory_event_mutation()
returns trigger language plpgsql set search_path = '' as $function$
begin raise exception 'inventory events are immutable' using errcode = '55000'; end;
$function$;
revoke all on function private.prevent_inventory_event_mutation() from public;
create trigger inventory_events_immutable
before update or delete on public.inventory_events
for each row execute function private.prevent_inventory_event_mutation();
create trigger fulfillment_events_immutable
before update or delete on public.fulfillment_events
for each row execute function private.prevent_inventory_event_mutation();

alter table public.warehouses enable row level security;
alter table public.stock_items enable row level security;
alter table public.inventory_events enable row level security;
alter table public.fulfillment_units enable row level security;
alter table public.service_assignments enable row level security;
alter table public.fulfillment_events enable row level security;
revoke all on table public.warehouses, public.stock_items, public.inventory_events,
  public.fulfillment_units, public.service_assignments, public.fulfillment_events from anon, authenticated;
grant select on table public.warehouses, public.stock_items, public.inventory_events,
  public.fulfillment_units, public.service_assignments, public.fulfillment_events to authenticated;
grant all privileges on table public.warehouses, public.stock_items, public.fulfillment_units,
  public.service_assignments to service_role;
grant select, insert on table public.inventory_events to service_role;
grant usage, select on sequence public.inventory_events_id_seq to service_role;
grant select, insert on table public.fulfillment_events to service_role;
grant usage, select on sequence public.fulfillment_events_id_seq to service_role;

create policy warehouses_select_admin on public.warehouses for select to authenticated
using (private.is_company_admin(company_id));
create policy stock_items_select_admin on public.stock_items for select to authenticated
using (private.is_company_admin(company_id));
create policy inventory_events_select_admin on public.inventory_events for select to authenticated
using (private.is_company_admin(company_id));
create policy fulfillment_units_select_assignee_or_admin on public.fulfillment_units for select to authenticated
using ((assigned_to = (select auth.uid()) and private.is_active_company_member(company_id)) or private.is_company_admin(company_id));
create policy service_assignments_select_assignee_or_admin on public.service_assignments for select to authenticated
using ((assignee_id = (select auth.uid()) and private.is_active_company_member(company_id)) or private.is_company_admin(company_id));
create policy fulfillment_events_select_assignee_or_admin on public.fulfillment_events for select to authenticated
using (exists (select 1 from public.fulfillment_units f where f.id = fulfillment_events.fulfillment_unit_id and f.company_id = fulfillment_events.company_id and (f.assigned_to = (select auth.uid()) or private.is_company_admin(f.company_id))));

comment on table public.inventory_events is
  'Immutable inventory ledger. Quote creation has no path to this table.';
comment on table public.fulfillment_units is
  'One store and one order-line fulfillment unit. Inventory reservation remains unavailable until trusted internal-payment events exist.';
