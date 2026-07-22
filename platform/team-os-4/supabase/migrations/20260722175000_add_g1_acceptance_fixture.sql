-- G1 runtime fixtures: one immutable shared baseline plus removable per-run rows.
-- The shared financial row is anchored to the original bootstrap administrator,
-- never to one of the five disposable acceptance identities.

create table private.g1_acceptance_runs (
  run_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  sales_profile_id uuid not null,
  implementation_profile_id uuid not null,
  operations_profile_id uuid not null,
  finance_profile_id uuid not null,
  admin_profile_id uuid not null,
  work_item_ids uuid[] not null,
  opportunity_id uuid not null,
  fulfillment_unit_id uuid not null,
  service_assignment_ids uuid[] not null,
  status text not null default 'prepared',
  created_at timestamptz not null default now(),
  retained_at timestamptz,
  target_project_ref text,
  application_commit text,
  runtime_evidence jsonb,
  runtime_evidence_sha256 text,
  constraint g1_acceptance_runs_status check (status in ('prepared', 'retained')),
  constraint g1_acceptance_runs_retention_consistent check (
    (status = 'prepared' and retained_at is null)
    or (status = 'retained' and retained_at is not null)
  ),
  constraint g1_acceptance_runs_five_work_items check (cardinality(work_item_ids) = 5),
  constraint g1_acceptance_runs_two_service_assignments check (cardinality(service_assignment_ids) = 2),
  constraint g1_acceptance_runs_evidence_consistent check (
    (
      status = 'prepared'
      and target_project_ref is null and application_commit is null
      and runtime_evidence is null and runtime_evidence_sha256 is null
    )
    or (
      status = 'retained'
      and target_project_ref is not null
      and application_commit is not null
      and runtime_evidence is not null
      and runtime_evidence_sha256 is not null
      and target_project_ref ~ '^[a-z0-9]{20}$'
      and application_commit ~ '^[a-f0-9]{40}$'
      and jsonb_typeof(runtime_evidence) = 'object'
      and runtime_evidence_sha256 ~ '^[a-f0-9]{64}$'
    )
  )
);

create index g1_acceptance_runs_company_status_idx
  on private.g1_acceptance_runs(company_id, status);

alter table private.g1_acceptance_runs enable row level security;
revoke all on table private.g1_acceptance_runs from public, anon, authenticated;
grant select, insert, update, delete on table private.g1_acceptance_runs to service_role;

create table private.g1_acceptance_baselines (
  baseline_version integer primary key,
  company_id uuid not null unique references public.companies(id) on delete restrict,
  target_project_ref text not null,
  data_class text not null default 'acceptance-only',
  created_at timestamptz not null default now(),
  constraint g1_acceptance_baselines_version check (baseline_version = 1),
  constraint g1_acceptance_baselines_project_ref check (target_project_ref ~ '^[a-z0-9]{20}$'),
  constraint g1_acceptance_baselines_data_class check (data_class = 'acceptance-only')
);

alter table private.g1_acceptance_baselines enable row level security;
revoke all on table private.g1_acceptance_baselines from public, anon, authenticated;
grant select, insert on table private.g1_acceptance_baselines to service_role;

create or replace function public.preflight_g1_acceptance_v1(p_target_project_ref text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_open integer;
  v_retained integer;
begin
  if p_target_project_ref !~ '^[a-z0-9]{20}$' or not exists (
    select 1 from public.initialization_audit
    where event_type = 'started' and succeeded
      and details ->> 'target_project_ref' = p_target_project_ref
  ) then
    raise exception 'G1 target project ref does not match the sealed initialization audit'
      using errcode = '42501';
  end if;
  select count(*) filter (where status = 'prepared'),
         count(*) filter (where status = 'retained')
  into v_open, v_retained
  from private.g1_acceptance_runs;

  if v_open <> 0 then
    raise exception 'an unfinished G1 acceptance run already exists' using errcode = '55000';
  end if;
  if v_retained <> 0 then
    raise exception 'a retained G1 acceptance run already exists' using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'ready',
    'prepared_runs', v_open,
    'retained_runs', v_retained
  );
end;
$function$;

create or replace function public.create_g1_acceptance_run_v1(
  p_run_id uuid,
  p_target_project_ref text,
  p_sales_profile_id uuid,
  p_implementation_profile_id uuid,
  p_operations_profile_id uuid,
  p_finance_profile_id uuid,
  p_admin_profile_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_company_id uuid;
  v_anchor_admin_id uuid;
  v_work_item_ids uuid[];
  v_opportunity_id uuid := gen_random_uuid();
  v_fulfillment_unit_id uuid := gen_random_uuid();
  v_implementation_assignment_id uuid := gen_random_uuid();
  v_operations_assignment_id uuid := gen_random_uuid();
  v_service_assignment_ids uuid[];
  v_customer_id constant uuid := '40000000-0000-4000-8000-000000000001';
  v_brand_id constant uuid := '40000000-0000-4000-8000-000000000002';
  v_store_id constant uuid := '40000000-0000-4000-8000-000000000003';
  v_product_id constant uuid := '40000000-0000-4000-8000-000000000004';
  v_quote_id constant uuid := '40000000-0000-4000-8000-000000000005';
  v_order_id constant uuid := '40000000-0000-4000-8000-000000000006';
  v_case_line_id constant uuid := '40000000-0000-4000-8000-000000000007';
  v_case_allocation_id constant uuid := '40000000-0000-4000-8000-000000000008';
  v_run_line_id constant uuid := '40000000-0000-4000-8000-000000000009';
  v_run_allocation_id constant uuid := '40000000-0000-4000-8000-00000000000a';
  v_warehouse_id constant uuid := '40000000-0000-4000-8000-00000000000b';
  v_case_fulfillment_id constant uuid := '40000000-0000-4000-8000-00000000000c';
  v_case_candidate_id constant uuid := '40000000-0000-4000-8000-00000000000d';
  v_stock_item_id constant uuid := '40000000-0000-4000-8000-00000000000e';
  v_case_id constant uuid := '40000000-0000-4000-8000-00000000000f';
begin
  if p_run_id is null then
    raise exception 'G1 run id is required' using errcode = '22023';
  end if;
  if p_target_project_ref !~ '^[a-z0-9]{20}$' then
    raise exception 'G1 target project ref is invalid' using errcode = '22023';
  end if;
  if p_target_project_ref <> 'jgcrhoabvaowxnqksvkq' then
    raise exception 'G1 fixtures are restricted to the Team OS 4.0 greenfield test project'
      using errcode = '42501';
  end if;
  if exists (select 1 from private.g1_acceptance_runs where run_id = p_run_id) then
    raise exception 'G1 run id already exists' using errcode = '23505';
  end if;

  select p.company_id into v_company_id
  from public.profiles as p
  join public.primary_roles as r
    on r.id = p.primary_role_id and r.company_id = p.company_id
  where p.id = p_sales_profile_id and p.is_active and r.is_active and r.role_key = 'sales';
  if v_company_id is null then
    raise exception 'G1 sales profile is invalid' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('team-os-4-g1:' || v_company_id::text, 0)
  );
  if exists (select 1 from private.g1_acceptance_runs) then
    raise exception 'a G1 acceptance run already exists' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.initialization_audit
    where company_id = v_company_id and event_type = 'started' and succeeded
      and details ->> 'target_project_ref' = p_target_project_ref
  ) then
    raise exception 'G1 target project ref does not match the sealed initialization audit'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.system_runtime_state
    where company_id = v_company_id and initialization_sealed
      and migration_mode and not business_writes_enabled
      and not background_jobs_enabled and not outbound_effects_enabled
  ) then
    raise exception 'G1 fixtures require the sealed isolated migration runtime'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from (
      values
        (p_sales_profile_id, 'sales'),
        (p_implementation_profile_id, 'implementation'),
        (p_operations_profile_id, 'operations'),
        (p_finance_profile_id, 'finance'),
        (p_admin_profile_id, 'admin')
    ) as expected(profile_id, role_key)
    join public.profiles as p on p.id = expected.profile_id
    join public.primary_roles as r
      on r.id = p.primary_role_id and r.company_id = p.company_id
    where p.company_id = v_company_id and p.is_active and r.is_active
      and r.role_key = expected.role_key
  ) <> 5 then
    raise exception 'G1 profiles do not match the five enabled roles' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profile_capabilities pc
    join public.capabilities c
      on c.id = pc.capability_id and c.company_id = pc.company_id
    where pc.profile_id = p_implementation_profile_id
      and pc.company_id = v_company_id and pc.revoked_at is null
      and c.capability_key = 'warehouse' and c.is_active
  ) then
    raise exception 'G1 implementation warehouse capability is missing' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.profile_capabilities pc
    join public.capabilities c
      on c.id = pc.capability_id and c.company_id = pc.company_id
    where pc.profile_id = p_admin_profile_id
      and pc.company_id = v_company_id and pc.revoked_at is null
      and c.capability_key = 'supervisor' and c.is_active
  ) then
    raise exception 'G1 administrator supervisor capability is missing' using errcode = '42501';
  end if;

  select audit.actor_user_id into v_anchor_admin_id
  from public.initialization_audit as audit
  join public.profiles as p on p.id = audit.actor_user_id and p.company_id = audit.company_id
  join public.primary_roles as r
    on r.id = p.primary_role_id and r.company_id = p.company_id
  where audit.company_id = v_company_id and audit.event_type = 'admin_created' and audit.succeeded
    and p.is_active and r.is_active and r.role_key = 'admin' and p.id <> p_admin_profile_id;
  if v_anchor_admin_id is null then
    raise exception 'the original bootstrap administrator is required as the G1 baseline anchor'
      using errcode = '55000';
  end if;

  insert into public.customers (
    id, company_id, sales_owner_id, name, region, external_source, external_key
  ) values (
    v_customer_id, v_company_id, v_anchor_admin_id, 'G1 persistent baseline customer',
    'Tokyo', 'team-os-4-g1', 'persistent-baseline-v1'
  ) on conflict (id) do nothing;
  insert into public.brands (
    id, company_id, customer_id, name, external_source, external_key
  ) values (
    v_brand_id, v_company_id, v_customer_id, 'G1 persistent baseline brand',
    'team-os-4-g1', 'persistent-baseline-v1'
  ) on conflict (id) do nothing;
  insert into public.stores (
    id, company_id, brand_id, name, address, store_type, external_source, external_key
  ) values (
    v_store_id, v_company_id, v_brand_id, 'G1 persistent baseline store',
    'G1 isolated greenfield project', 'new', 'team-os-4-g1', 'persistent-baseline-v1'
  ) on conflict (id) do nothing;
  insert into public.products (
    id, company_id, name, product_type, external_key, is_active
  ) values (
    v_product_id, v_company_id, 'G1 persistent baseline product', 'software',
    'g1-persistent-baseline-v1', true
  ) on conflict (id) do nothing;
  insert into public.quotes (
    id, company_id, customer_id, sales_owner_id, status, currency
  ) values (
    v_quote_id, v_company_id, v_customer_id, v_anchor_admin_id, 'accepted', 'CNY'
  ) on conflict (id) do nothing;
  insert into public.orders (
    id, company_id, quote_id, customer_id, sales_owner_id, status, frozen_quote_snapshot
  ) values (
    v_order_id, v_company_id, v_quote_id, v_customer_id, v_anchor_admin_id,
    'confirmed', '{"fixture":"g1-persistent-baseline-v1"}'::jsonb
  ) on conflict (id) do nothing;
  insert into public.order_lines (
    id, company_id, order_id, product_id, quantity,
    customer_sale_price, sales_internal_price, company_actual_cost, product_snapshot
  ) values
    (v_case_line_id, v_company_id, v_order_id, v_product_id, 1, 1, 1, 1,
      '{"fixture":"g1-case-baseline-v1"}'::jsonb),
    (v_run_line_id, v_company_id, v_order_id, v_product_id, 1, 1, 1, 1,
      '{"fixture":"g1-run-slot-v1"}'::jsonb)
  on conflict (id) do nothing;
  insert into public.order_line_store_allocations (
    id, company_id, order_line_id, store_id, quantity
  ) values
    (v_case_allocation_id, v_company_id, v_case_line_id, v_store_id, 1),
    (v_run_allocation_id, v_company_id, v_run_line_id, v_store_id, 1)
  on conflict (id) do nothing;
  insert into public.warehouses (id, company_id, name, external_key, is_active)
  values (
    v_warehouse_id, v_company_id, 'G1 persistent baseline warehouse',
    'g1-persistent-baseline-v1', true
  ) on conflict (id) do nothing;
  insert into public.stock_items (
    id, company_id, warehouse_id, product_id, on_hand_quantity, reserved_quantity
  ) values (
    v_stock_item_id, v_company_id, v_warehouse_id, v_product_id, 1, 0
  ) on conflict (id) do nothing;
  insert into public.fulfillment_units (
    id, company_id, store_id, order_line_id, status, assigned_to
  ) values (
    v_case_fulfillment_id, v_company_id, v_store_id, v_case_line_id,
    'completed', v_anchor_admin_id
  ) on conflict (id) do nothing;
  insert into public.case_candidates (
    id, company_id, fulfillment_unit_id, customer_id, display_authorization_valid
  ) values (
    v_case_candidate_id, v_company_id, v_case_fulfillment_id, v_customer_id, false
  ) on conflict (id) do nothing;
  insert into public.cases (
    id, company_id, candidate_id, title, summary, status, authorization_valid
  ) values (
    v_case_id, v_company_id, v_case_candidate_id,
    'G1 acceptance-only baseline case',
    'Acceptance-only data in the isolated Team OS 4.0 greenfield project.',
    'draft', false
  ) on conflict (id) do nothing;
  insert into public.payment_events (
    company_id, order_id, actor_user_id, event_type, payment_amount, idempotency_key
  ) values (
    v_company_id, v_order_id, v_anchor_admin_id, 'confirmed', 1,
    'g1-persistent-baseline-payment-v1'
  ) on conflict (company_id, idempotency_key) do nothing;

  if not exists (
    select 1
    from public.customers c
    join public.brands b on b.id = v_brand_id and b.company_id = c.company_id and b.customer_id = c.id
    join public.stores s on s.id = v_store_id and s.company_id = b.company_id and s.brand_id = b.id
    join public.quotes q on q.id = v_quote_id and q.company_id = c.company_id and q.customer_id = c.id
    join public.orders o on o.id = v_order_id and o.company_id = q.company_id and o.quote_id = q.id
    join public.products p on p.id = v_product_id and p.company_id = o.company_id
    join public.order_lines case_line
      on case_line.id = v_case_line_id and case_line.company_id = o.company_id
      and case_line.order_id = o.id and case_line.product_id = p.id
    join public.order_line_store_allocations case_allocation
      on case_allocation.id = v_case_allocation_id
      and case_allocation.company_id = case_line.company_id
      and case_allocation.order_line_id = case_line.id and case_allocation.store_id = s.id
    join public.order_lines run_line
      on run_line.id = v_run_line_id and run_line.company_id = o.company_id
      and run_line.order_id = o.id and run_line.product_id = p.id
    join public.order_line_store_allocations run_allocation
      on run_allocation.id = v_run_allocation_id
      and run_allocation.company_id = run_line.company_id
      and run_allocation.order_line_id = run_line.id and run_allocation.store_id = s.id
    join public.warehouses w on w.id = v_warehouse_id and w.company_id = o.company_id
    join public.stock_items stock
      on stock.id = v_stock_item_id and stock.company_id = w.company_id
      and stock.warehouse_id = w.id and stock.product_id = p.id
    join public.fulfillment_units f
      on f.id = v_case_fulfillment_id and f.company_id = o.company_id
      and f.store_id = s.id and f.order_line_id = case_line.id
    join public.case_candidates candidate
      on candidate.id = v_case_candidate_id and candidate.company_id = f.company_id
      and candidate.fulfillment_unit_id = f.id and candidate.customer_id = c.id
    join public.cases case_record
      on case_record.id = v_case_id and case_record.company_id = candidate.company_id
      and case_record.candidate_id = candidate.id
    join public.payment_events payment
      on payment.company_id = o.company_id and payment.order_id = o.id
      and payment.idempotency_key = 'g1-persistent-baseline-payment-v1'
    where c.id = v_customer_id and c.company_id = v_company_id
      and c.sales_owner_id = v_anchor_admin_id
      and c.external_source = 'team-os-4-g1' and c.external_key = 'persistent-baseline-v1'
      and b.external_source = 'team-os-4-g1' and b.external_key = 'persistent-baseline-v1'
      and s.external_source = 'team-os-4-g1' and s.external_key = 'persistent-baseline-v1'
      and p.external_key = 'g1-persistent-baseline-v1' and p.is_active
      and q.sales_owner_id = v_anchor_admin_id and q.status = 'accepted' and q.currency = 'CNY'
      and o.customer_id = c.id and o.sales_owner_id = v_anchor_admin_id and o.status = 'confirmed'
      and o.frozen_quote_snapshot ->> 'fixture' = 'g1-persistent-baseline-v1'
      and case_line.quantity = 1 and case_allocation.quantity = 1
      and run_line.quantity = 1 and run_allocation.quantity = 1
      and w.external_key = 'g1-persistent-baseline-v1' and w.is_active
      and stock.on_hand_quantity = 1 and stock.reserved_quantity = 0
      and f.assigned_to = v_anchor_admin_id and f.status = 'completed'
      and not candidate.display_authorization_valid
      and case_record.status = 'draft' and not case_record.authorization_valid
      and case_record.title = 'G1 acceptance-only baseline case'
      and payment.actor_user_id = v_anchor_admin_id and payment.event_type = 'confirmed'
      and payment.payment_amount = 1 and payment.reversal_of_id is null
  ) then
    raise exception 'G1 persistent baseline verification failed' using errcode = '55000';
  end if;

  insert into private.g1_acceptance_baselines (
    baseline_version, company_id, target_project_ref, data_class
  ) values (1, v_company_id, p_target_project_ref, 'acceptance-only')
  on conflict (baseline_version) do nothing;
  if not exists (
    select 1 from private.g1_acceptance_baselines
    where baseline_version = 1 and company_id = v_company_id
      and target_project_ref = p_target_project_ref and data_class = 'acceptance-only'
  ) then
    raise exception 'G1 acceptance-only baseline manifest mismatch' using errcode = '55000';
  end if;

  with inserted as (
    insert into public.work_items (
      company_id, assignee_id, role_type, kind, source_business, source_id,
      generation_rule, title, status, priority, next_step
    )
    select v_company_id, item.profile_id, item.role_key, 'reminder',
      'g1_acceptance', p_run_id, 'g1:' || p_run_id::text || ':' || item.role_key,
      'G1 ' || item.role_key || ' real remote acceptance', 'pending', 'normal',
      'Complete the current G1 remote acceptance check'
    from (
      values
        (p_sales_profile_id, 'sales'),
        (p_implementation_profile_id, 'implementation'),
        (p_operations_profile_id, 'operations'),
        (p_finance_profile_id, 'finance'),
        (p_admin_profile_id, 'admin')
    ) as item(profile_id, role_key)
    returning id
  )
  select array_agg(id order by id) into v_work_item_ids from inserted;
  if cardinality(v_work_item_ids) <> 5 then
    raise exception 'G1 five work-item fixtures were not created' using errcode = '55000';
  end if;

  insert into public.opportunities (
    id, company_id, customer_id, store_id, owner_id, name, stage, source_business, source_key
  ) values (
    v_opportunity_id, v_company_id, v_customer_id, v_store_id, p_sales_profile_id,
    'G1 real remote acceptance opportunity', 'discovery', 'g1_acceptance', p_run_id::text
  );
  insert into public.fulfillment_units (
    id, company_id, store_id, order_line_id, status, assigned_to
  ) values (
    v_fulfillment_unit_id, v_company_id, v_store_id, v_run_line_id,
    'in_progress', p_implementation_profile_id
  );
  insert into public.service_assignments (
    id, company_id, fulfillment_unit_id, assignee_id, service_type, status, scheduled_at
  ) values
    (
      v_implementation_assignment_id, v_company_id, v_fulfillment_unit_id,
      p_implementation_profile_id, 'installation', 'in_progress', pg_catalog.now()
    ),
    (
      v_operations_assignment_id, v_company_id, v_fulfillment_unit_id,
      p_operations_profile_id, 'operations_handoff', 'in_progress', pg_catalog.now()
    );
  v_service_assignment_ids := array[
    v_implementation_assignment_id, v_operations_assignment_id
  ]::uuid[];

  insert into private.g1_acceptance_runs (
    run_id, company_id, sales_profile_id, implementation_profile_id,
    operations_profile_id, finance_profile_id, admin_profile_id, work_item_ids,
    opportunity_id, fulfillment_unit_id, service_assignment_ids
  ) values (
    p_run_id, v_company_id, p_sales_profile_id, p_implementation_profile_id,
    p_operations_profile_id, p_finance_profile_id, p_admin_profile_id, v_work_item_ids,
    v_opportunity_id, v_fulfillment_unit_id, v_service_assignment_ids
  );

  return pg_catalog.jsonb_build_object(
    'status', 'prepared',
    'baseline_version', 1,
    'enabled_accounts', 5,
    'run_work_items', 5,
    'run_business_rows', 4,
    'persistent_baseline_ready', true
  );
end;
$function$;

create or replace function private.prevent_g1_acceptance_case_baseline_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if (tg_table_name = 'case_candidates'
      and old.id = '40000000-0000-4000-8000-00000000000d'::uuid)
    or (tg_table_name = 'cases'
      and old.id = '40000000-0000-4000-8000-00000000000f'::uuid) then
    raise exception 'G1 acceptance-only case baseline is immutable' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function private.prevent_g1_acceptance_case_baseline_mutation() from public, anon, authenticated;
create trigger g1_acceptance_case_candidate_baseline_immutable
before update or delete on public.case_candidates
for each row execute function private.prevent_g1_acceptance_case_baseline_mutation();
create trigger g1_acceptance_case_baseline_immutable
before update or delete on public.cases
for each row execute function private.prevent_g1_acceptance_case_baseline_mutation();

create or replace function public.cleanup_g1_acceptance_run_v1(p_run_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_run private.g1_acceptance_runs%rowtype;
begin
  if p_run_id is null then
    raise exception 'G1 cleanup requires one run id' using errcode = '22023';
  end if;

  select * into v_run
  from private.g1_acceptance_runs
  where run_id = p_run_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'status', 'not-found',
      'persistent_baseline_retained', true
    );
  end if;
  if v_run.status = 'retained' then
    raise exception 'a retained G1 run cannot be cleaned by failure compensation' using errcode = '55000';
  end if;

  delete from public.service_assignments where id = any(v_run.service_assignment_ids);
  delete from public.fulfillment_units where id = v_run.fulfillment_unit_id;
  delete from public.opportunities where id = v_run.opportunity_id;
  delete from public.work_items where id = any(v_run.work_item_ids);

  if exists (select 1 from public.service_assignments where id = any(v_run.service_assignment_ids))
    or exists (select 1 from public.fulfillment_units where id = v_run.fulfillment_unit_id)
    or exists (select 1 from public.opportunities where id = v_run.opportunity_id)
    or exists (
      select 1 from public.work_items
      where source_business = 'g1_acceptance' and source_id = p_run_id
    ) then
    raise exception 'G1 database cleanup verification failed' using errcode = '55000';
  end if;

  delete from private.g1_acceptance_runs where run_id = p_run_id;
  if exists (select 1 from private.g1_acceptance_runs where run_id = p_run_id) then
    raise exception 'G1 run manifest cleanup verification failed' using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'confirmed-cleaned',
    'persistent_baseline_retained', true
  );
end;
$function$;

create or replace function public.retain_g1_acceptance_run_v1(
  p_run_id uuid,
  p_target_project_ref text,
  p_application_commit text,
  p_runtime_evidence jsonb,
  p_runtime_evidence_sha256 text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_run_id is null
    or p_target_project_ref is distinct from 'jgcrhoabvaowxnqksvkq'
    or p_application_commit is null or p_application_commit !~ '^[a-f0-9]{40}$'
    or p_runtime_evidence is null or jsonb_typeof(p_runtime_evidence) is distinct from 'object'
    or p_runtime_evidence_sha256 is null or p_runtime_evidence_sha256 !~ '^[a-f0-9]{64}$'
    or (p_runtime_evidence ->> 'run_id') is distinct from p_run_id::text
    or (p_runtime_evidence ->> 'target_project_ref') is distinct from p_target_project_ref
    or (p_runtime_evidence ->> 'application_commit') is distinct from p_application_commit
    or (p_runtime_evidence ->> 'evidence_sha256') is distinct from p_runtime_evidence_sha256
    or (p_runtime_evidence ->> 'status') is distinct from 'passed'
    or jsonb_typeof(p_runtime_evidence -> 'current_run_counts' -> 'total') is distinct from 'number'
    or (p_runtime_evidence -> 'current_run_counts' ->> 'total')::integer is distinct from 82 then
    raise exception 'sealed G1 runtime evidence is invalid for retention' using errcode = '22023';
  end if;

  update private.g1_acceptance_runs
  set status = 'retained', retained_at = pg_catalog.now(),
      target_project_ref = p_target_project_ref,
      application_commit = p_application_commit,
      runtime_evidence = p_runtime_evidence,
      runtime_evidence_sha256 = p_runtime_evidence_sha256
  where run_id = p_run_id and status = 'prepared';
  if not found then
    raise exception 'prepared G1 run was not found for retention' using errcode = '55000';
  end if;
  return pg_catalog.jsonb_build_object('status', 'retained', 'run_id', p_run_id);
end;
$function$;

revoke all on function public.preflight_g1_acceptance_v1(text) from public, anon, authenticated;
revoke all on function public.create_g1_acceptance_run_v1(uuid, text, uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.cleanup_g1_acceptance_run_v1(uuid) from public, anon, authenticated;
revoke all on function public.retain_g1_acceptance_run_v1(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.preflight_g1_acceptance_v1(text) to service_role;
grant execute on function public.create_g1_acceptance_run_v1(uuid, text, uuid, uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.cleanup_g1_acceptance_run_v1(uuid) to service_role;
grant execute on function public.retain_g1_acceptance_run_v1(uuid, text, text, jsonb, text) to service_role;

comment on table private.g1_acceptance_runs is
  'Private manifest for exactly five enabled G1 accounts and their removable real remote fixtures.';
comment on table private.g1_acceptance_baselines is
  'Marks persistent business rows as acceptance-only data in the isolated Team OS 4.0 project.';
comment on function public.create_g1_acceptance_run_v1(uuid, text, uuid, uuid, uuid, uuid, uuid) is
  'Service-role-only atomic G1 fixture creation. Persistent financial facts never reference disposable acceptance accounts.';
