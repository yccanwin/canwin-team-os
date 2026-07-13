-- Post-deployment-compatible dual-ledger upgrade. Safe after legacy 100000/140000.
-- Never invent classifications for rows written before these columns existed.
do $$begin
 if not exists(select 1 from information_schema.columns where table_schema='public'and table_name='deal_payments'and column_name='recipient_type')
   and exists(select 1 from public.deal_payments)then
   raise exception'HISTORICAL_PAYMENT_RECIPIENT_CLASSIFICATION_REQUIRED'using errcode='55000';
 end if;
 if not exists(select 1 from information_schema.columns where table_schema='public'and table_name='deal_internal_settlements'and column_name='method')
   and exists(select 1 from public.deal_internal_settlements)then
   raise exception'HISTORICAL_SETTLEMENT_METHOD_CLASSIFICATION_REQUIRED'using errcode='55000';
 end if;
 if exists(select 1 from public.deal_internal_settlements where external_ref is not null group by team_id,external_ref having count(*)>1)then
   raise exception'DUPLICATE_INTERNAL_SETTLEMENT_EXTERNAL_REF'using errcode='23505';
 end if;
end$$;
alter table public.deal_payments add column if not exists recipient_type text not null default'company';
alter table public.deal_internal_settlements add column if not exists method text not null default'cash_remitted';
do $$begin
 if exists(select 1 from public.deal_payments where recipient_type is null or recipient_type not in('company','sales'))then raise exception'UNKNOWN_PAYMENT_RECIPIENT_CLASSIFICATION'using errcode='55000';end if;
 if exists(select 1 from public.deal_internal_settlements where method is null or method not in('cash_remitted','withheld_from_company_receipt'))then raise exception'UNKNOWN_SETTLEMENT_METHOD_CLASSIFICATION'using errcode='55000';end if;
 if not exists(select 1 from pg_constraint where conrelid='public.deal_payments'::regclass and conname='deal_payments_recipient_type_check')then alter table public.deal_payments add constraint deal_payments_recipient_type_check check(recipient_type in('company','sales'));end if;
 if not exists(select 1 from pg_constraint where conrelid='public.deal_internal_settlements'::regclass and conname='deal_internal_settlements_method_check')then alter table public.deal_internal_settlements add constraint deal_internal_settlements_method_check check(method in('cash_remitted','withheld_from_company_receipt'));end if;
end$$;
create unique index if not exists deal_internal_settlements_external_ref_key on public.deal_internal_settlements(team_id,external_ref)where external_ref is not null;

create table if not exists public.deal_procurement_cost_payments(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),order_id uuid not null,amount numeric(14,2)not null check(amount>0),external_ref text,idempotency_key uuid not null,confirmed_by uuid not null references public.profiles(id),confirmed_at timestamptz not null default now(),
 unique(team_id,id),unique(team_id,idempotency_key),foreign key(team_id,order_id)references public.deal_orders(team_id,id)
);
do $$begin if exists(select 1 from public.deal_procurement_cost_payments where external_ref is not null group by team_id,external_ref having count(*)>1)then raise exception'DUPLICATE_PROCUREMENT_EXTERNAL_REF'using errcode='23505';end if;end$$;
create unique index if not exists deal_procurement_external_ref_key on public.deal_procurement_cost_payments(team_id,external_ref)where external_ref is not null;
create table if not exists public.deal_sales_expenses(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),order_id uuid not null,salesperson_id uuid not null,amount numeric(14,2)not null check(amount>0),reason text not null,idempotency_key uuid not null,confirmed_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(team_id,id),unique(team_id,idempotency_key),foreign key(team_id,order_id)references public.deal_orders(team_id,id),foreign key(team_id,salesperson_id)references public.profiles(team_id,id)
);
alter table public.deal_procurement_cost_payments enable row level security;alter table public.deal_sales_expenses enable row level security;
do $$begin
 if not exists(select 1 from pg_policies where schemaname='public'and tablename='deal_procurement_cost_payments'and policyname='sales os v3 server gate')then create policy"sales os v3 server gate"on public.deal_procurement_cost_payments as restrictive for all to authenticated using(public.is_feature_enabled(team_id,'sales_os_v3'))with check(public.is_feature_enabled(team_id,'sales_os_v3'));end if;
 if not exists(select 1 from pg_policies where schemaname='public'and tablename='deal_sales_expenses'and policyname='sales os v3 server gate')then create policy"sales os v3 server gate"on public.deal_sales_expenses as restrictive for all to authenticated using(public.is_feature_enabled(team_id,'sales_os_v3'))with check(public.is_feature_enabled(team_id,'sales_os_v3'));end if;
end$$;
create policy"finance reads procurement costs v2"on public.deal_procurement_cost_payments for select to authenticated using(public.has_permission(team_id,'finance.read')or public.has_permission(team_id,'finance.manage'));
create policy"finance reads sales expenses v2"on public.deal_sales_expenses for select to authenticated using(public.has_permission(team_id,'finance.read')or public.has_permission(team_id,'finance.manage'));

-- Explicit owner policies are required because security-invoker views retain
-- underlying RLS. They grant no access to supervisor or sales roles.
create policy"owner reads company internal settlements"on public.deal_internal_settlements for select to authenticated using(public.has_access_role(team_id,array['owner']));
create policy"owner reads company procurement costs"on public.deal_procurement_cost_payments for select to authenticated using(public.has_access_role(team_id,array['owner']));
create policy"owner reads company orders for forecast"on public.deal_orders for select to authenticated using(public.has_access_role(team_id,array['owner']));
create policy"owner reads company adjustments v2"on public.profit_adjustments for select to authenticated using(public.has_access_role(team_id,array['owner']));

create or replace function public.get_order_sales_ledger(p_team text,p_order uuid)
returns table(net_customer_payments numeric,internal_settlement_due numeric,sales_expenses numeric,sales_margin numeric)
language plpgsql security definer stable set search_path='' as $$declare o public.deal_orders;q public.deal_quotes;paid numeric;reversed numeric;expenses numeric;begin
 select*into o from public.deal_orders where id=p_order and team_id=p_team;select*into q from public.deal_quotes where id=o.quote_id and team_id=o.team_id;
 if o.id is null or not public.is_feature_enabled(p_team,'sales_os_v3')or not(q.owner_id=auth.uid()or public.can_supervise_performance(p_team,q.owner_id,current_date)or public.has_access_role(p_team,array['owner'])or public.has_permission(p_team,'finance.read'))then return;end if;
 select coalesce(sum(amount),0)into paid from public.deal_payments where team_id=p_team and order_id=o.id;select coalesce(sum(r.amount),0)into reversed from public.deal_payment_reversals r join public.deal_payments p on p.id=r.payment_id and p.team_id=r.team_id where p.team_id=p_team and p.order_id=o.id;
 select coalesce(sum(amount),0)into expenses from public.deal_sales_expenses where team_id=p_team and order_id=o.id;net_customer_payments:=paid-reversed;internal_settlement_due:=o.internal_due;sales_expenses:=expenses;sales_margin:=net_customer_payments-internal_settlement_due-sales_expenses;return next;end$$;

create or replace view public.company_profit_summary with(security_invoker=true)as
with ledger as(select s.team_id,date_trunc('quarter',s.confirmed_at)::date quarter_start,s.amount value from public.deal_internal_settlements s union all select c.team_id,date_trunc('quarter',c.confirmed_at)::date,-c.amount from public.deal_procurement_cost_payments c union all select a.team_id,date_trunc('quarter',a.effective_on)::date,case when a.adjustment_type='quarterly_rebate'then a.amount else-a.amount end from public.profit_adjustments a),actual as(select team_id,quarter_start,sum(value)actual_profit from ledger group by team_id,quarter_start),forecast as(select team_id,date_trunc('quarter',created_at)::date quarter_start,sum(internal_due-(internal_due/1.10))forecast_profit from public.deal_orders where status<>'cancelled'group by team_id,date_trunc('quarter',created_at)::date)
select coalesce(a.team_id,f.team_id)team_id,coalesce(a.quarter_start,f.quarter_start)quarter_start,coalesce(a.actual_profit,0)actual_profit,coalesce(f.forecast_profit,0)forecast_profit from actual a full join forecast f using(team_id,quarter_start)where public.is_feature_enabled(coalesce(a.team_id,f.team_id),'sales_os_v3')and(public.has_access_role(coalesce(a.team_id,f.team_id),array['owner'])or public.has_permission(coalesce(a.team_id,f.team_id),'finance.read'));
create or replace view public.supervisor_order_margin with(security_invoker=true)as select o.team_id,o.id order_id,q.owner_id salesperson_id,l.net_customer_payments,l.internal_settlement_due,l.sales_expenses,l.sales_margin,o.status,o.created_at from public.deal_orders o join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id join lateral public.get_order_sales_ledger(o.team_id,o.id)l on true where public.can_supervise_performance(o.team_id,q.owner_id,current_date);
create or replace view public.personal_sales_margin with(security_invoker=true)as select o.team_id,o.id order_id,q.owner_id salesperson_id,l.net_customer_payments,l.internal_settlement_due,l.sales_expenses,l.sales_margin,o.status,o.created_at from public.deal_orders o join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id join lateral public.get_order_sales_ledger(o.team_id,o.id)l on true where q.owner_id=auth.uid();
revoke all on public.company_profit_summary,public.supervisor_order_margin,public.personal_sales_margin from public,anon;grant select on public.company_profit_summary,public.supervisor_order_margin,public.personal_sales_margin to authenticated;
revoke all on function public.get_order_sales_ledger(text,uuid)from public;grant execute on function public.get_order_sales_ledger(text,uuid)to authenticated;
notify pgrst,'reload schema';
