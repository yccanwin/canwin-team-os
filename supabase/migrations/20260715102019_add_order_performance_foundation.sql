-- A3/A4: immutable order performance snapshots and append-only qualification
-- events. Payment/reversal RPC integration is intentionally completed in A5/A6.

alter table public.deal_quotes
  add column if not exists sale_type text not null default 'new',
  add column if not exists renewal_source_order_id uuid,
  add column if not exists is_legacy_renewal boolean not null default false;

do $migration$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deal_quotes'::regclass
      and conname = 'deal_quotes_sale_type_check'
  ) then
    alter table public.deal_quotes
      add constraint deal_quotes_sale_type_check
      check (sale_type in ('new','renewal'));
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deal_quotes'::regclass
      and conname = 'deal_quotes_renewal_source_fkey'
  ) then
    alter table public.deal_quotes
      add constraint deal_quotes_renewal_source_fkey
      foreign key(team_id,renewal_source_order_id)
      references public.deal_orders(team_id,id);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deal_quotes'::regclass
      and conname = 'deal_quotes_renewal_context_check'
  ) then
    alter table public.deal_quotes
      add constraint deal_quotes_renewal_context_check check (
        (sale_type = 'new' and renewal_source_order_id is null and not is_legacy_renewal)
        or
        (sale_type = 'renewal' and ((renewal_source_order_id is not null) <> is_legacy_renewal))
      );
  end if;
end
$migration$;

create or replace function public.set_deal_quote_sale_context(
  p_quote_id uuid,
  p_sale_type text,
  p_renewal_source_order_id uuid default null,
  p_is_legacy_renewal boolean default false
) returns uuid
language plpgsql security definer set search_path = ''
as $set_deal_quote_sale_context$
declare
  actor public.profiles;
  quote_row public.deal_quotes;
  source_order public.deal_orders;
  source_store_id uuid;
  quote_store_id uuid;
  before_state jsonb;
begin
  select p.* into actor from public.profiles p
  where p.id = auth.uid() and p.status = 'active';
  select q.* into quote_row from public.deal_quotes q
  where q.id = p_quote_id for update;
  if actor.id is null or quote_row.id is null or actor.team_id <> quote_row.team_id
    or not public.is_feature_enabled(actor.team_id,'sales_os_v3')
    or not public.has_permission(actor.team_id,'customers.manage')
    or quote_row.status <> 'draft'
    or not (quote_row.owner_id = actor.id or public.can_act_for(actor.team_id,quote_row.owner_id)) then
    raise exception 'QUOTE_EDIT_FORBIDDEN' using errcode = '42501';
  end if;
  if p_sale_type not in ('new','renewal') then
    raise exception 'INVALID_SALE_TYPE' using errcode = '22023';
  end if;
  if p_sale_type = 'new' and (p_renewal_source_order_id is not null or p_is_legacy_renewal) then
    raise exception 'NEW_SALE_CANNOT_HAVE_RENEWAL_SOURCE' using errcode = '23514';
  end if;
  if p_sale_type = 'renewal'
    and ((p_renewal_source_order_id is not null) = coalesce(p_is_legacy_renewal,false)) then
    raise exception 'RENEWAL_SOURCE_OR_LEGACY_REQUIRED' using errcode = '23514';
  end if;
  if p_renewal_source_order_id is not null then
    select o.* into source_order from public.deal_orders o
    where o.id = p_renewal_source_order_id and o.team_id = actor.team_id;
    if source_order.id is null then raise exception 'RENEWAL_SOURCE_ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
    select op.store_id into source_store_id from public.crm_opportunities op
    where op.id = source_order.opportunity_id and op.team_id = source_order.team_id;
    select op.store_id into quote_store_id from public.crm_opportunities op
    where op.id = quote_row.opportunity_id and op.team_id = quote_row.team_id;
    if source_store_id is null or quote_store_id is null or source_store_id <> quote_store_id then
      raise exception 'RENEWAL_SOURCE_STORE_MISMATCH' using errcode = '23514';
    end if;
  end if;
  before_state := jsonb_build_object(
    'saleType',quote_row.sale_type,'renewalSourceOrderId',quote_row.renewal_source_order_id,
    'isLegacyRenewal',quote_row.is_legacy_renewal
  );
  update public.deal_quotes q set
    sale_type = p_sale_type,
    renewal_source_order_id = p_renewal_source_order_id,
    is_legacy_renewal = coalesce(p_is_legacy_renewal,false),
    updated_at = now()
  where q.id = quote_row.id;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
  values(quote_row.team_id,actor.id,'deal.quote_sale_context_set','deal_quote',quote_row.id,before_state,
    jsonb_build_object('saleType',p_sale_type,'renewalSourceOrderId',p_renewal_source_order_id,
      'isLegacyRenewal',coalesce(p_is_legacy_renewal,false)));
  return quote_row.id;
end
$set_deal_quote_sale_context$;

alter table public.deal_orders
  add column if not exists sale_type_snapshot text,
  add column if not exists salesperson_id_snapshot uuid references public.profiles(id),
  add column if not exists renewal_source_order_id_snapshot uuid,
  add column if not exists is_legacy_renewal_snapshot boolean,
  add column if not exists performance_gmv_snapshot numeric(14,2),
  add column if not exists performance_points_snapshot numeric(14,2),
  add column if not exists performance_snapshot_frozen_at timestamptz;

update public.deal_orders o set
  sale_type_snapshot = coalesce(q.sale_type,'new'),
  salesperson_id_snapshot = q.owner_id,
  renewal_source_order_id_snapshot = q.renewal_source_order_id,
  is_legacy_renewal_snapshot = coalesce(q.is_legacy_renewal,false),
  performance_gmv_snapshot = o.customer_total,
  performance_points_snapshot = coalesce((
    select sum(ql.points_snapshot * ql.quantity)
    from public.deal_quote_lines ql
    where ql.team_id = o.team_id and ql.quote_id = o.quote_id
  ),0),
  performance_snapshot_frozen_at = coalesce(o.created_at,now())
from public.deal_quotes q
where q.id = o.quote_id and q.team_id = o.team_id
  and o.performance_snapshot_frozen_at is null;

alter table public.deal_orders
  alter column sale_type_snapshot set default 'new',
  alter column sale_type_snapshot set not null,
  alter column salesperson_id_snapshot set not null,
  alter column is_legacy_renewal_snapshot set default false,
  alter column is_legacy_renewal_snapshot set not null,
  alter column performance_gmv_snapshot set not null,
  alter column performance_points_snapshot set default 0,
  alter column performance_points_snapshot set not null,
  alter column performance_snapshot_frozen_at set not null;

do $migration$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.deal_orders'::regclass and conname='deal_orders_sale_type_snapshot_check') then
    alter table public.deal_orders add constraint deal_orders_sale_type_snapshot_check
      check(sale_type_snapshot in('new','renewal'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.deal_orders'::regclass and conname='deal_orders_performance_snapshot_values_check') then
    alter table public.deal_orders add constraint deal_orders_performance_snapshot_values_check
      check(performance_gmv_snapshot>=0 and performance_points_snapshot>=0);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.deal_orders'::regclass and conname='deal_orders_renewal_source_snapshot_fkey') then
    alter table public.deal_orders add constraint deal_orders_renewal_source_snapshot_fkey
      foreign key(team_id,renewal_source_order_id_snapshot) references public.deal_orders(team_id,id);
  end if;
end
$migration$;

create or replace function public.freeze_order_performance_snapshot()
returns trigger language plpgsql set search_path = ''
as $freeze_order_performance_snapshot$
declare quote_row public.deal_quotes;
begin
  select q.* into quote_row from public.deal_quotes q
  where q.id = new.quote_id and q.team_id = new.team_id;
  if quote_row.id is null then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  new.sale_type_snapshot := quote_row.sale_type;
  new.salesperson_id_snapshot := quote_row.owner_id;
  new.renewal_source_order_id_snapshot := quote_row.renewal_source_order_id;
  new.is_legacy_renewal_snapshot := quote_row.is_legacy_renewal;
  new.performance_gmv_snapshot := new.customer_total;
  select coalesce(sum(ql.points_snapshot * ql.quantity),0)
    into new.performance_points_snapshot
  from public.deal_quote_lines ql
  where ql.team_id = new.team_id and ql.quote_id = new.quote_id;
  new.performance_snapshot_frozen_at := now();
  return new;
end
$freeze_order_performance_snapshot$;

create or replace function public.protect_order_performance_snapshot()
returns trigger language plpgsql set search_path = ''
as $protect_order_performance_snapshot$
begin
  if row(
    new.sale_type_snapshot,new.salesperson_id_snapshot,new.renewal_source_order_id_snapshot,
    new.is_legacy_renewal_snapshot,new.performance_gmv_snapshot,
    new.performance_points_snapshot,new.performance_snapshot_frozen_at
  ) is distinct from row(
    old.sale_type_snapshot,old.salesperson_id_snapshot,old.renewal_source_order_id_snapshot,
    old.is_legacy_renewal_snapshot,old.performance_gmv_snapshot,
    old.performance_points_snapshot,old.performance_snapshot_frozen_at
  ) then raise exception 'ORDER_PERFORMANCE_SNAPSHOT_IMMUTABLE' using errcode='55000'; end if;
  return new;
end
$protect_order_performance_snapshot$;

drop trigger if exists freeze_order_performance_snapshot on public.deal_orders;
create trigger freeze_order_performance_snapshot before insert on public.deal_orders
for each row execute function public.freeze_order_performance_snapshot();
drop trigger if exists protect_order_performance_snapshot on public.deal_orders;
create trigger protect_order_performance_snapshot before update on public.deal_orders
for each row execute function public.protect_order_performance_snapshot();

create table if not exists public.order_performance_states(
  team_id text not null references public.teams(id),
  order_id uuid not null,
  status text not null default 'pending' check(status in('pending','qualified','revoked')),
  salesperson_id uuid not null references public.profiles(id),
  sale_type text not null check(sale_type in('new','renewal')),
  attribution_quarter_start date,
  gmv_snapshot numeric(14,2) not null check(gmv_snapshot>=0),
  points_snapshot numeric(14,2) not null check(points_snapshot>=0),
  net_customer_paid numeric(14,2) not null default 0 check(net_customer_paid>=0),
  first_qualified_at timestamptz,
  last_qualified_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(team_id,order_id),
  foreign key(team_id,order_id) references public.deal_orders(team_id,id)
);

create table if not exists public.order_performance_events(
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id),
  order_id uuid not null,
  event_type text not null check(event_type in('qualified','revoked','restored')),
  attribution_quarter_start date not null,
  reason text not null,
  trigger_type text not null check(trigger_type in('payment','reversal','order','backfill')),
  trigger_id uuid,
  idempotency_key uuid not null,
  salesperson_id uuid not null references public.profiles(id),
  sale_type text not null check(sale_type in('new','renewal')),
  gmv_snapshot numeric(14,2) not null check(gmv_snapshot>=0),
  points_snapshot numeric(14,2) not null check(points_snapshot>=0),
  net_customer_paid numeric(14,2) not null check(net_customer_paid>=0),
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(team_id,id),
  unique(team_id,idempotency_key),
  foreign key(team_id,order_id) references public.deal_orders(team_id,id)
);
create index if not exists order_performance_events_quarter_sales_idx
  on public.order_performance_events(team_id,attribution_quarter_start,salesperson_id,created_at);

alter table public.order_performance_states enable row level security;
alter table public.order_performance_events enable row level security;

create policy "performance state feature gate" on public.order_performance_states
  as restrictive for all to authenticated
  using(public.is_feature_enabled(team_id,'sales_os_v3'))
  with check(public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "scoped performance state read" on public.order_performance_states
  for select to authenticated using(
    salesperson_id=auth.uid()
    or public.can_supervise_performance(team_id,salesperson_id,(now() at time zone 'Asia/Shanghai')::date)
    or public.has_access_role(team_id,array['owner','admin'])
  );
create policy "performance event feature gate" on public.order_performance_events
  as restrictive for all to authenticated
  using(public.is_feature_enabled(team_id,'sales_os_v3'))
  with check(public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "scoped performance event read" on public.order_performance_events
  for select to authenticated using(
    salesperson_id=auth.uid()
    or public.can_supervise_performance(team_id,salesperson_id,(now() at time zone 'Asia/Shanghai')::date)
    or public.has_access_role(team_id,array['owner','admin'])
  );

create or replace function public.refresh_order_performance_state(
  p_order_id uuid,p_reason text,p_trigger_type text,p_trigger_id uuid,p_idempotency_key uuid
) returns public.order_performance_states
language plpgsql security definer set search_path = ''
as $refresh_order_performance_state$
declare
  actor public.profiles;
  order_row public.deal_orders;
  state_row public.order_performance_states;
  prior_event public.order_performance_events;
  event_kind text;
  net_paid numeric;
  quarter_start date;
begin
  if nullif(trim(p_reason),'') is null or p_trigger_type not in('payment','reversal','order','backfill')
    or p_idempotency_key is null then raise exception 'PERFORMANCE_REFRESH_INPUT_REQUIRED' using errcode='22023'; end if;
  select p.* into actor from public.profiles p where p.id=auth.uid() and p.status='active';
  select o.* into order_row from public.deal_orders o where o.id=p_order_id for update;
  if actor.id is null or order_row.id is null or actor.team_id<>order_row.team_id then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;
  if not public.is_feature_enabled(order_row.team_id,'sales_os_v3')
    or not public.has_permission(order_row.team_id,'finance.manage') then
    raise exception 'FINANCE_FORBIDDEN' using errcode='42501';
  end if;
  select e.* into prior_event from public.order_performance_events e
  where e.team_id=order_row.team_id and e.idempotency_key=p_idempotency_key;
  if prior_event.id is not null then
    if prior_event.order_id<>order_row.id or prior_event.reason<>trim(p_reason)
      or prior_event.trigger_type<>p_trigger_type or prior_event.trigger_id is distinct from p_trigger_id then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode='23505';
    end if;
    select s.* into state_row from public.order_performance_states s
    where s.team_id=order_row.team_id and s.order_id=order_row.id;
    return state_row;
  end if;
  select greatest(coalesce(sum(p.amount),0)-coalesce((
    select sum(r.amount) from public.deal_payment_reversals r
    join public.deal_payments rp on rp.id=r.payment_id and rp.team_id=r.team_id
    where rp.team_id=order_row.team_id and rp.order_id=order_row.id
  ),0),0) into net_paid
  from public.deal_payments p where p.team_id=order_row.team_id and p.order_id=order_row.id;
  select s.* into state_row from public.order_performance_states s
  where s.team_id=order_row.team_id and s.order_id=order_row.id for update;
  if state_row.order_id is null then
    insert into public.order_performance_states(
      team_id,order_id,salesperson_id,sale_type,gmv_snapshot,points_snapshot,net_customer_paid
    ) values(
      order_row.team_id,order_row.id,order_row.salesperson_id_snapshot,order_row.sale_type_snapshot,
      order_row.performance_gmv_snapshot,order_row.performance_points_snapshot,net_paid
    ) returning * into state_row;
  end if;
  if net_paid>=order_row.customer_total and order_row.status<>'cancelled' and state_row.status<>'qualified' then
    event_kind:=case when state_row.first_qualified_at is null then'qualified'else'restored'end;
    quarter_start:=coalesce(state_row.attribution_quarter_start,
      date_trunc('quarter',(now() at time zone 'Asia/Shanghai'))::date);
    update public.order_performance_states s set status='qualified',attribution_quarter_start=quarter_start,
      net_customer_paid=net_paid,first_qualified_at=coalesce(s.first_qualified_at,now()),last_qualified_at=now(),
      revoked_at=null,updated_at=now() where s.team_id=order_row.team_id and s.order_id=order_row.id returning*into state_row;
  elsif (net_paid<order_row.customer_total or order_row.status='cancelled') and state_row.status='qualified' then
    event_kind:='revoked';quarter_start:=state_row.attribution_quarter_start;
    update public.order_performance_states s set status='revoked',net_customer_paid=net_paid,revoked_at=now(),updated_at=now()
    where s.team_id=order_row.team_id and s.order_id=order_row.id returning*into state_row;
  else
    update public.order_performance_states s set net_customer_paid=net_paid,updated_at=now()
    where s.team_id=order_row.team_id and s.order_id=order_row.id returning*into state_row;
    return state_row;
  end if;
  insert into public.order_performance_events(
    team_id,order_id,event_type,attribution_quarter_start,reason,trigger_type,trigger_id,idempotency_key,
    salesperson_id,sale_type,gmv_snapshot,points_snapshot,net_customer_paid,actor_id
  ) values(
    order_row.team_id,order_row.id,event_kind,quarter_start,trim(p_reason),p_trigger_type,p_trigger_id,p_idempotency_key,
    order_row.salesperson_id_snapshot,order_row.sale_type_snapshot,order_row.performance_gmv_snapshot,
    order_row.performance_points_snapshot,net_paid,actor.id
  );
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
  values(order_row.team_id,actor.id,'performance.order_'||event_kind,'deal_order',order_row.id,'{}',
    jsonb_build_object('status',state_row.status,'quarterStart',state_row.attribution_quarter_start,
      'gmv',state_row.gmv_snapshot,'points',state_row.points_snapshot,'netCustomerPaid',net_paid,
      'triggerType',p_trigger_type,'triggerId',p_trigger_id));
  return state_row;
end
$refresh_order_performance_state$;

revoke all on table public.order_performance_states,public.order_performance_events from public,anon;
revoke insert,update,delete on table public.order_performance_states,public.order_performance_events from authenticated;
grant select on table public.order_performance_states,public.order_performance_events to authenticated;
revoke all on function public.set_deal_quote_sale_context(uuid,text,uuid,boolean),
  public.refresh_order_performance_state(uuid,text,text,uuid,uuid),
  public.freeze_order_performance_snapshot(),public.protect_order_performance_snapshot()
from public,anon;
grant execute on function public.set_deal_quote_sale_context(uuid,text,uuid,boolean),
  public.refresh_order_performance_state(uuid,text,text,uuid,uuid)
to authenticated;
notify pgrst,'reload schema';
