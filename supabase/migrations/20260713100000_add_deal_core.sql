-- CanWin Team OS 3.0 minimal deal core. Additive and server-gated.

alter table public.crm_opportunities add column if not exists demo_completed_at timestamptz;
create unique index if not exists crm_opportunities_team_id_key on public.crm_opportunities(team_id,id);

create table public.deal_catalog_versions (
  id uuid primary key default gen_random_uuid(), team_id text not null references public.teams(id),
  version_no integer not null check(version_no>0), status text not null default 'draft' check(status in('draft','published','retired')),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), published_at timestamptz,
  unique(team_id,id), unique(team_id,version_no)
);
create table public.deal_catalog_items (
  id uuid primary key default gen_random_uuid(), team_id text not null references public.teams(id), catalog_version_id uuid not null,
  sku text not null, name text not null, item_type text not null check(item_type in('software','hardware','service')),
  customer_list_price numeric(14,2) not null check(customer_list_price>=0), procurement_cost numeric(14,2) not null check(procurement_cost>=0),
  points numeric(12,2) not null default 0 check(points>=0), created_at timestamptz not null default now(),
  unique(team_id,id), unique(team_id,catalog_version_id,sku),
  foreign key(team_id,catalog_version_id) references public.deal_catalog_versions(team_id,id)
);
create table public.deal_packages (
  id uuid primary key default gen_random_uuid(), team_id text not null references public.teams(id), catalog_version_id uuid not null,
  code text not null, name text not null, business_type text, created_at timestamptz not null default now(),
  unique(team_id,id), unique(team_id,catalog_version_id,code),
  foreign key(team_id,catalog_version_id) references public.deal_catalog_versions(team_id,id)
);
create table public.deal_package_items (
  id uuid primary key default gen_random_uuid(), team_id text not null references public.teams(id), package_id uuid not null,
  catalog_item_id uuid not null, quantity numeric(12,2) not null check(quantity>0), created_at timestamptz not null default now(),
  unique(team_id,id), foreign key(team_id,package_id) references public.deal_packages(team_id,id),
  foreign key(team_id,catalog_item_id) references public.deal_catalog_items(team_id,id), unique(package_id,catalog_item_id)
);
create table public.deal_quotes (
  id uuid primary key default gen_random_uuid(), team_id text not null references public.teams(id), opportunity_id uuid not null,
  owner_id uuid not null references public.profiles(id), version_no integer not null check(version_no>0),
  status text not null default 'draft' check(status in('draft','approval_pending','submitted','approved','rejected','frozen','cancelled')),
  has_special_content boolean not null default false, valid_until date not null default(current_date+15),
  customer_total numeric(14,2) not null default 0 check(customer_total>=0), internal_total numeric(14,2) not null default 0 check(internal_total>=0),
  submitted_at timestamptz, frozen_at timestamptz, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique(team_id,id), unique(team_id,opportunity_id,version_no),
  foreign key(team_id,opportunity_id) references public.crm_opportunities(team_id,id)
);
create table public.deal_quote_lines (
  id uuid primary key default gen_random_uuid(), team_id text not null references public.teams(id), quote_id uuid not null,
  source_item_id uuid, item_name_snapshot text not null, sku_snapshot text, item_type_snapshot text not null,
  quantity numeric(12,2) not null check(quantity>0), customer_unit_price numeric(14,2) not null check(customer_unit_price>=0),
  internal_unit_price numeric(14,2) not null check(internal_unit_price>=0), points_snapshot numeric(12,2) not null default 0 check(points_snapshot>=0),
  special_content text, created_at timestamptz not null default now(), unique(team_id,id),
  foreign key(team_id,quote_id) references public.deal_quotes(team_id,id) on delete restrict,
  foreign key(team_id,source_item_id) references public.deal_catalog_items(team_id,id)
);
create table public.deal_quote_approvals (
  id uuid primary key default gen_random_uuid(), team_id text not null references public.teams(id), quote_id uuid not null,
  status text not null default 'pending' check(status in('pending','approved','rejected')), note text,
  decided_by uuid references public.profiles(id), decided_at timestamptz, created_at timestamptz not null default now(), unique(team_id,id),
  foreign key(team_id,quote_id) references public.deal_quotes(team_id,id), unique(quote_id)
);
create table public.deal_orders (
  id uuid primary key default gen_random_uuid(), team_id text not null references public.teams(id), quote_id uuid not null,
  opportunity_id uuid not null, customer_total numeric(14,2) not null check(customer_total>=0), internal_due numeric(14,2) not null check(internal_due>=0),
  internal_paid numeric(14,2) not null default 0 check(internal_paid>=0), status text not null default 'deposit_confirmed'
    check(status in('deposit_confirmed','internal_paid','fulfilling','completed','cancelled')),
  fulfillment_allowed_at timestamptz, created_at timestamptz not null default now(), unique(team_id,id), unique(team_id,quote_id),
  foreign key(team_id,quote_id) references public.deal_quotes(team_id,id),
  foreign key(team_id,opportunity_id) references public.crm_opportunities(team_id,id)
);
create table public.deal_payments (
  id uuid primary key default gen_random_uuid(), team_id text not null references public.teams(id), order_id uuid not null,
  payment_type text not null check(payment_type in('deposit','balance','full')), amount numeric(14,2) not null check(amount>0),
  recipient_type text not null default 'company' check(recipient_type in('company','sales')),
  external_ref text, idempotency_key uuid not null, confirmed_by uuid not null references public.profiles(id), confirmed_at timestamptz not null default now(),
  unique(team_id,id), unique(team_id,idempotency_key), foreign key(team_id,order_id) references public.deal_orders(team_id,id)
);
create table public.deal_payment_reversals (
  id uuid primary key default gen_random_uuid(), team_id text not null references public.teams(id), payment_id uuid not null,
  amount numeric(14,2) not null check(amount>0), reason text not null, idempotency_key uuid not null,
  confirmed_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), unique(team_id,id),
  unique(team_id,idempotency_key), foreign key(team_id,payment_id) references public.deal_payments(team_id,id)
);
create table public.deal_internal_settlements (
  id uuid primary key default gen_random_uuid(), team_id text not null references public.teams(id), order_id uuid not null,
  amount numeric(14,2) not null check(amount>0),method text not null check(method in('cash_remitted','withheld_from_company_receipt')), external_ref text not null, idempotency_key uuid not null,
  confirmed_by uuid not null references public.profiles(id), confirmed_at timestamptz not null default now(), unique(team_id,id),
  unique(team_id,idempotency_key),unique(team_id,external_ref), foreign key(team_id,order_id) references public.deal_orders(team_id,id)
);
create table public.deal_procurement_cost_payments(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),order_id uuid not null,amount numeric(14,2)not null check(amount>0),
 external_ref text not null,idempotency_key uuid not null,confirmed_by uuid not null references public.profiles(id),confirmed_at timestamptz not null default now(),
 unique(team_id,id),unique(team_id,idempotency_key),unique(team_id,external_ref),foreign key(team_id,order_id)references public.deal_orders(team_id,id)
);
create table public.deal_sales_expenses(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),order_id uuid not null,salesperson_id uuid not null,
 amount numeric(14,2)not null check(amount>0),reason text not null,idempotency_key uuid not null,confirmed_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(team_id,id),unique(team_id,idempotency_key),foreign key(team_id,order_id)references public.deal_orders(team_id,id),foreign key(team_id,salesperson_id)references public.profiles(team_id,id)
);

create or replace function public.submit_deal_quote(p_quote_id uuid)
returns public.deal_quotes language plpgsql security definer set search_path='' as $function$
declare q public.deal_quotes; o public.crm_opportunities; requester public.profiles; totals record;
begin
  select * into requester from public.profiles where id=auth.uid() and status='active';
  select * into q from public.deal_quotes where id=p_quote_id for update;
  if q.id is null or requester.id is null or q.team_id<>requester.team_id then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if not public.is_feature_enabled(q.team_id,'sales_os_v3') then raise exception 'SALES_OS_V3_DISABLED' using errcode='42501'; end if;
  if not(q.owner_id=requester.id or public.can_act_for(q.team_id,q.owner_id) or public.has_permission(q.team_id,'customers.supervise')) then raise exception 'QUOTE_FORBIDDEN' using errcode='42501'; end if;
  if q.status<>'draft' then raise exception 'QUOTE_NOT_DRAFT' using errcode='55000'; end if;
  select * into o from public.crm_opportunities where id=q.opportunity_id and team_id=q.team_id;
  if o.value_grade='A' and o.demo_completed_at is null then raise exception 'A_GRADE_DEMO_REQUIRED' using errcode='23514'; end if;
  select sum(quantity*customer_unit_price) customer_total,sum(quantity*internal_unit_price) internal_total into totals
    from public.deal_quote_lines where quote_id=q.id and team_id=q.team_id;
  if totals.customer_total is null then raise exception 'QUOTE_LINES_REQUIRED' using errcode='23514'; end if;
  update public.deal_quotes set customer_total=totals.customer_total,internal_total=totals.internal_total,
    status=case when has_special_content or exists(select 1 from public.deal_quote_lines where quote_id=q.id and special_content is not null) then 'approval_pending' else 'submitted' end,
    submitted_at=now(),updated_at=now() where id=q.id returning * into q;
  if q.status='approval_pending' then insert into public.deal_quote_approvals(team_id,quote_id) values(q.team_id,q.id) on conflict(quote_id) do nothing; end if;
  return q;
end;
$function$;

create or replace function public.decide_deal_quote(p_quote_id uuid,p_approved boolean,p_note text default null)
returns public.deal_quotes language plpgsql security definer set search_path='' as $function$
declare q public.deal_quotes; requester public.profiles;
begin
  select * into requester from public.profiles where id=auth.uid() and status='active'; select * into q from public.deal_quotes where id=p_quote_id for update;
  if q.id is null or requester.id is null or q.team_id<>requester.team_id then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if not public.is_feature_enabled(q.team_id,'sales_os_v3') or not public.has_permission(q.team_id,'customers.supervise') then raise exception 'APPROVAL_FORBIDDEN' using errcode='42501'; end if;
  if q.status<>'approval_pending' then raise exception 'QUOTE_NOT_PENDING' using errcode='55000'; end if;
  update public.deal_quote_approvals set status=case when p_approved then 'approved' else 'rejected' end,note=p_note,decided_by=requester.id,decided_at=now() where quote_id=q.id;
  update public.deal_quotes set status=case when p_approved then 'approved' else 'rejected' end,updated_at=now() where id=q.id returning * into q; return q;
end;
$function$;

create or replace function public.confirm_deal_deposit(p_quote_id uuid,p_amount numeric,p_external_ref text,p_idempotency_key uuid,p_recipient_type text default 'company')
returns public.deal_orders language plpgsql security definer set search_path='' as $function$
declare q public.deal_quotes; requester public.profiles; ord public.deal_orders;
begin
  if p_amount<=0 or p_recipient_type not in('company','sales') then raise exception 'VALID_DEPOSIT_REQUIRED' using errcode='22023'; end if;
  select * into requester from public.profiles where id=auth.uid() and status='active'; select * into q from public.deal_quotes where id=p_quote_id for update;
  if q.id is null or requester.id is null or q.team_id<>requester.team_id then raise exception 'QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  if not public.is_feature_enabled(q.team_id,'sales_os_v3') or not public.has_permission(q.team_id,'finance.manage') then raise exception 'FINANCE_FORBIDDEN' using errcode='42501'; end if;
  if current_date>q.valid_until then raise exception 'QUOTE_EXPIRED' using errcode='23514'; end if;
  if p_amount>q.customer_total then raise exception 'DEPOSIT_EXCEEDS_QUOTE_TOTAL' using errcode='23514'; end if;
  select * into ord from public.deal_orders where team_id=q.team_id and quote_id=q.id;
  if ord.id is not null then return ord; end if;
  if q.status not in('submitted','approved') then raise exception 'QUOTE_NOT_CONFIRMABLE' using errcode='55000'; end if;
  update public.deal_quotes set status='frozen',frozen_at=now(),updated_at=now() where id=q.id;
  insert into public.deal_orders(team_id,quote_id,opportunity_id,customer_total,internal_due)
    values(q.team_id,q.id,q.opportunity_id,q.customer_total,q.internal_total) returning * into ord;
  insert into public.deal_payments(team_id,order_id,payment_type,amount,recipient_type,external_ref,idempotency_key,confirmed_by)
    values(q.team_id,ord.id,'deposit',p_amount,p_recipient_type,p_external_ref,p_idempotency_key,requester.id);
  return ord;
end;
$function$;

create or replace function public.confirm_deal_internal_payment(p_order_id uuid,p_amount numeric,p_external_ref text,p_idempotency_key uuid,p_method text default 'cash_remitted')
returns public.deal_orders language plpgsql security definer set search_path='' as $function$
declare ord public.deal_orders; requester public.profiles; paid numeric;
begin
  if p_amount<=0 or p_method not in('cash_remitted','withheld_from_company_receipt') or nullif(trim(p_external_ref),'')is null then raise exception 'VALID_INTERNAL_SETTLEMENT_REQUIRED' using errcode='22023'; end if;
  select * into requester from public.profiles where id=auth.uid() and status='active'; select * into ord from public.deal_orders where id=p_order_id for update;
  if ord.id is null or requester.id is null or ord.team_id<>requester.team_id then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
  if not public.is_feature_enabled(ord.team_id,'sales_os_v3') or not public.has_permission(ord.team_id,'finance.manage') then raise exception 'FINANCE_FORBIDDEN' using errcode='42501'; end if;
  if exists(select 1 from public.deal_internal_settlements where team_id=ord.team_id and idempotency_key=p_idempotency_key) then return ord; end if;
  select coalesce(sum(amount),0) into paid from public.deal_internal_settlements where team_id=ord.team_id and order_id=ord.id;
  if paid+p_amount>ord.internal_due then raise exception 'INTERNAL_PAYMENT_EXCEEDS_DUE' using errcode='23514'; end if;
  insert into public.deal_internal_settlements(team_id,order_id,amount,method,external_ref,idempotency_key,confirmed_by)
    values(ord.team_id,ord.id,p_amount,p_method,p_external_ref,p_idempotency_key,requester.id) on conflict(team_id,idempotency_key) do nothing;
  select coalesce(sum(amount),0) into ord.internal_paid from public.deal_internal_settlements where team_id=ord.team_id and order_id=ord.id;
  update public.deal_orders set internal_paid=ord.internal_paid,status=case when ord.internal_paid>=internal_due then 'internal_paid' else status end,
    fulfillment_allowed_at=case when ord.internal_paid>=internal_due then coalesce(fulfillment_allowed_at,now()) else null end where id=ord.id returning * into ord; return ord;
end;
$function$;

create or replace function public.record_deal_procurement_cost(p_order_id uuid,p_amount numeric,p_external_ref text,p_idempotency_key uuid)
returns public.deal_procurement_cost_payments language plpgsql security definer set search_path='' as $function$
declare
  o public.deal_orders;
  r public.profiles;
  c public.deal_procurement_cost_payments;
begin
  if p_amount<=0 or nullif(trim(p_external_ref),'') is null then
    raise exception 'VALID_PROCUREMENT_PAYMENT_REQUIRED' using errcode='22023';
  end if;
  select * into r from public.profiles where id=auth.uid() and status='active';
  select * into o from public.deal_orders where id=p_order_id for update;
  if o.id is null or r.id is null or o.team_id<>r.team_id
    or not public.is_feature_enabled(o.team_id,'sales_os_v3')
    or not public.has_permission(o.team_id,'finance.manage') then
    raise exception 'FINANCE_FORBIDDEN' using errcode='42501';
  end if;
  insert into public.deal_procurement_cost_payments(team_id,order_id,amount,external_ref,idempotency_key,confirmed_by)
    values(o.team_id,o.id,p_amount,p_external_ref,p_idempotency_key,r.id)
    on conflict(team_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into c;
  return c;
end;
$function$;

create or replace function public.record_deal_sales_expense(p_order_id uuid,p_amount numeric,p_reason text,p_idempotency_key uuid)
returns public.deal_sales_expenses language plpgsql security definer set search_path='' as $function$
declare
  o public.deal_orders;
  q public.deal_quotes;
  r public.profiles;
  e public.deal_sales_expenses;
begin
  if p_amount<=0 or nullif(trim(p_reason),'') is null then
    raise exception 'VALID_SALES_EXPENSE_REQUIRED' using errcode='22023';
  end if;
  select * into r from public.profiles where id=auth.uid() and status='active';
  select * into o from public.deal_orders where id=p_order_id for update;
  select * into q from public.deal_quotes where id=o.quote_id;
  if o.id is null or r.id is null or o.team_id<>r.team_id
    or not public.is_feature_enabled(o.team_id,'sales_os_v3')
    or not public.has_permission(o.team_id,'finance.manage') then
    raise exception 'FINANCE_FORBIDDEN' using errcode='42501';
  end if;
  insert into public.deal_sales_expenses(team_id,order_id,salesperson_id,amount,reason,idempotency_key,confirmed_by)
    values(o.team_id,o.id,q.owner_id,p_amount,trim(p_reason),p_idempotency_key,r.id)
    on conflict(team_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into e;
  return e;
end;
$function$;

create or replace function public.reverse_deal_payment(p_payment_id uuid,p_amount numeric,p_reason text,p_idempotency_key uuid)
returns public.deal_payment_reversals language plpgsql security definer set search_path='' as $function$
declare pay public.deal_payments; requester public.profiles; rev public.deal_payment_reversals; reversed numeric;
begin
  if p_amount<=0 or nullif(trim(p_reason),'') is null then raise exception 'REVERSAL_INPUT_REQUIRED' using errcode='22023'; end if;
  select * into requester from public.profiles where id=auth.uid() and status='active'; select * into pay from public.deal_payments where id=p_payment_id for update;
  if pay.id is null or requester.id is null or pay.team_id<>requester.team_id then raise exception 'PAYMENT_NOT_FOUND' using errcode='P0002'; end if;
  if not public.is_feature_enabled(pay.team_id,'sales_os_v3') or not public.has_permission(pay.team_id,'finance.manage') then raise exception 'FINANCE_FORBIDDEN' using errcode='42501'; end if;
  select coalesce(sum(amount),0) into reversed from public.deal_payment_reversals where payment_id=pay.id;
  if reversed+p_amount>pay.amount then raise exception 'REVERSAL_EXCEEDS_PAYMENT' using errcode='23514'; end if;
  insert into public.deal_payment_reversals(team_id,payment_id,amount,reason,idempotency_key,confirmed_by)
    values(pay.team_id,pay.id,p_amount,trim(p_reason),p_idempotency_key,requester.id)
    on conflict(team_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into rev; return rev;
end;
$function$;

do $migration$
declare t text;
begin
foreach t in array array['deal_catalog_versions','deal_catalog_items','deal_packages','deal_package_items','deal_quotes','deal_quote_lines','deal_quote_approvals','deal_orders','deal_payments','deal_payment_reversals','deal_internal_settlements','deal_procurement_cost_payments','deal_sales_expenses'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy "sales os v3 server gate" on public.%I as restrictive for all to authenticated using (public.is_feature_enabled(team_id,''sales_os_v3'')) with check (public.is_feature_enabled(team_id,''sales_os_v3''))',t);
end loop;
end;
$migration$;

create policy "team reads catalog versions" on public.deal_catalog_versions for select to authenticated using(public.is_team_member(team_id));
create policy "team reads catalog items" on public.deal_catalog_items for select to authenticated using(public.is_team_member(team_id));
create policy "team reads packages" on public.deal_packages for select to authenticated using(public.is_team_member(team_id));
create policy "team reads package items" on public.deal_package_items for select to authenticated using(public.is_team_member(team_id));

create policy "scoped quote read" on public.deal_quotes for select to authenticated using(
  owner_id=auth.uid() or public.can_act_for(team_id,owner_id) or public.has_permission(team_id,'customers.supervise')
  or public.has_permission(team_id,'finance.read') or public.has_permission(team_id,'finance.manage'));
create policy "scoped quote line read" on public.deal_quote_lines for select to authenticated using(exists(
  select 1 from public.deal_quotes q where q.id=quote_id and q.team_id=team_id
    and (q.owner_id=auth.uid() or public.can_act_for(team_id,q.owner_id) or public.has_permission(team_id,'customers.supervise')
      or public.has_permission(team_id,'finance.read') or public.has_permission(team_id,'finance.manage'))));
create policy "scoped approval read" on public.deal_quote_approvals for select to authenticated using(exists(
  select 1 from public.deal_quotes q where q.id=quote_id and q.team_id=team_id
    and (q.owner_id=auth.uid() or public.can_act_for(team_id,q.owner_id) or public.has_permission(team_id,'customers.supervise')
      or public.has_permission(team_id,'finance.read') or public.has_permission(team_id,'finance.manage'))));
create policy "scoped order read" on public.deal_orders for select to authenticated using(exists(
  select 1 from public.deal_quotes q where q.id=quote_id and q.team_id=team_id
    and (q.owner_id=auth.uid() or public.can_act_for(team_id,q.owner_id) or public.has_permission(team_id,'customers.supervise')
      or public.has_permission(team_id,'finance.read') or public.has_permission(team_id,'finance.manage'))));
create policy "finance reads payments" on public.deal_payments for select to authenticated using(public.has_permission(team_id,'finance.read') or public.has_permission(team_id,'finance.manage'));
create policy "finance reads reversals" on public.deal_payment_reversals for select to authenticated using(public.has_permission(team_id,'finance.read') or public.has_permission(team_id,'finance.manage'));
create policy "finance reads internal settlements" on public.deal_internal_settlements for select to authenticated using(public.has_permission(team_id,'finance.read') or public.has_permission(team_id,'finance.manage'));
create policy "finance reads procurement costs" on public.deal_procurement_cost_payments for select to authenticated using(public.has_permission(team_id,'finance.read')or public.has_permission(team_id,'finance.manage'));
create policy "finance reads sales expenses" on public.deal_sales_expenses for select to authenticated using(public.has_permission(team_id,'finance.read')or public.has_permission(team_id,'finance.manage'));

create policy "access managers create catalog versions" on public.deal_catalog_versions for insert to authenticated with check(created_by=auth.uid() and public.has_permission(team_id,'access.manage'));
create policy "access managers create catalog items" on public.deal_catalog_items for insert to authenticated with check(public.has_permission(team_id,'access.manage'));
create policy "access managers create packages" on public.deal_packages for insert to authenticated with check(public.has_permission(team_id,'access.manage'));
create policy "access managers create package items" on public.deal_package_items for insert to authenticated with check(public.has_permission(team_id,'access.manage'));
create policy "sales create quote drafts" on public.deal_quotes for insert to authenticated with check(status='draft' and owner_id=auth.uid() and created_by=auth.uid() and public.has_permission(team_id,'customers.manage'));
create policy "sales edit own quote drafts" on public.deal_quotes for update to authenticated using(status='draft' and owner_id=auth.uid()) with check(status='draft' and owner_id=auth.uid() and created_by=auth.uid());
create policy "sales create draft quote lines" on public.deal_quote_lines for insert to authenticated with check(exists(select 1 from public.deal_quotes q where q.id=quote_id and q.team_id=team_id and q.status='draft' and q.owner_id=auth.uid()));
create policy "sales edit draft quote lines" on public.deal_quote_lines for update to authenticated using(exists(select 1 from public.deal_quotes q where q.id=quote_id and q.team_id=team_id and q.status='draft' and q.owner_id=auth.uid())) with check(exists(select 1 from public.deal_quotes q where q.id=quote_id and q.team_id=team_id and q.status='draft' and q.owner_id=auth.uid()));
create policy "sales delete draft quote lines" on public.deal_quote_lines for delete to authenticated using(exists(select 1 from public.deal_quotes q where q.id=quote_id and q.team_id=team_id and q.status='draft' and q.owner_id=auth.uid()));

revoke all on function public.submit_deal_quote(uuid) from public;
revoke all on function public.decide_deal_quote(uuid,boolean,text) from public;
revoke all on function public.confirm_deal_deposit(uuid,numeric,text,uuid,text) from public;
revoke all on function public.confirm_deal_internal_payment(uuid,numeric,text,uuid,text) from public;
revoke all on function public.reverse_deal_payment(uuid,numeric,text,uuid) from public;
revoke all on function public.record_deal_procurement_cost(uuid,numeric,text,uuid),public.record_deal_sales_expense(uuid,numeric,text,uuid)from public;
grant execute on function public.submit_deal_quote(uuid),public.decide_deal_quote(uuid,boolean,text),public.confirm_deal_deposit(uuid,numeric,text,uuid,text),public.confirm_deal_internal_payment(uuid,numeric,text,uuid,text),public.reverse_deal_payment(uuid,numeric,text,uuid),public.record_deal_procurement_cost(uuid,numeric,text,uuid),public.record_deal_sales_expense(uuid,numeric,text,uuid) to authenticated;
notify pgrst,'reload schema';
