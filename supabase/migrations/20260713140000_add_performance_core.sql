-- CanWin Team OS 3.0 performance, reconciliation and profit reporting.
create unique index if not exists profiles_team_id_key on public.profiles(team_id,id);

create table public.performance_supervisor_assignments(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),supervisor_id uuid not null,subordinate_id uuid not null,
 starts_on date not null default current_date,ends_on date,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(team_id,id),foreign key(team_id,supervisor_id)references public.profiles(team_id,id),foreign key(team_id,subordinate_id)references public.profiles(team_id,id),
 check(supervisor_id<>subordinate_id),check(ends_on is null or ends_on>=starts_on)
);
create table public.performance_quarterly_targets(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),profile_id uuid not null,quarter_start date not null,
 points_target numeric(14,2)not null default 0 check(points_target>=0),estimated_points numeric(14,2)not null default 0 check(estimated_points>=0),official_points numeric(14,2)not null default 0 check(official_points>=0),
 new_gmv_target numeric(14,2)not null default 0 check(new_gmv_target>=0),new_gmv_actual numeric(14,2)not null default 0 check(new_gmv_actual>=0),
 renewal_gmv_target numeric(14,2)not null default 0 check(renewal_gmv_target>=0),renewal_gmv_actual numeric(14,2)not null default 0 check(renewal_gmv_actual>=0),
 updated_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(team_id,id),unique(team_id,profile_id,quarter_start),
 foreign key(team_id,profile_id)references public.profiles(team_id,id),check(extract(month from quarter_start)in(1,4,7,10)and quarter_start=date_trunc('quarter',quarter_start)::date)
);
create table public.performance_target_events(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),target_id uuid not null,event_type text not null check(event_type in('target_set','estimate_updated','official_reconciled')),
 snapshot jsonb not null,actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(team_id,id),foreign key(team_id,target_id)references public.performance_quarterly_targets(team_id,id)
);
create table public.official_reconciliation_batches(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),quarter_start date not null,source_ref text not null,status text not null default'draft'check(status in('draft','confirmed')),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),confirmed_by uuid references public.profiles(id),confirmed_at timestamptz,
 unique(team_id,id),unique(team_id,source_ref),check(extract(month from quarter_start)in(1,4,7,10))
);
create table public.official_reconciliation_lines(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),batch_id uuid not null,profile_id uuid not null,order_id uuid,
 official_points numeric(14,2)not null default 0 check(official_points>=0),gmv_type text not null check(gmv_type in('new','renewal')),gmv_amount numeric(14,2)not null default 0 check(gmv_amount>=0),
 created_at timestamptz not null default now(),unique(team_id,id),foreign key(team_id,batch_id)references public.official_reconciliation_batches(team_id,id),
 foreign key(team_id,profile_id)references public.profiles(team_id,id),foreign key(team_id,order_id)references public.deal_orders(team_id,id)
);
create table public.profit_adjustments(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),adjustment_type text not null check(adjustment_type in('quarterly_rebate','expense')),
 amount numeric(14,2)not null check(amount>0),effective_on date not null,reason text not null,idempotency_key uuid not null,confirmed_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(team_id,id),unique(team_id,idempotency_key)
);

create or replace function public.can_supervise_performance(p_team text,p_profile uuid,p_on date default current_date)
returns boolean language sql security definer stable set search_path='' as $function$
 select public.is_feature_enabled(p_team,'sales_os_v3')and exists(select 1 from public.performance_supervisor_assignments a where a.team_id=p_team and a.supervisor_id=auth.uid()and a.subordinate_id=p_profile and p_on>=a.starts_on and(a.ends_on is null or p_on<=a.ends_on))
$function$;

create or replace function public.get_order_sales_ledger(p_team text,p_order uuid)
returns table(net_customer_payments numeric,internal_settlement_due numeric,sales_expenses numeric,sales_margin numeric)
language plpgsql security definer stable set search_path='' as $function$ declare o public.deal_orders;q public.deal_quotes;paid numeric;reversed numeric;expenses numeric;begin
 select*into o from public.deal_orders where id=p_order and team_id=p_team;select*into q from public.deal_quotes where id=o.quote_id and team_id=o.team_id;
 if o.id is null or not public.is_feature_enabled(p_team,'sales_os_v3')or not(q.owner_id=auth.uid()or public.can_supervise_performance(p_team,q.owner_id,current_date)or public.has_access_role(p_team,array['owner'])or public.has_permission(p_team,'finance.read'))then return;end if;
 select coalesce(sum(amount),0)into paid from public.deal_payments where team_id=p_team and order_id=o.id;
 select coalesce(sum(r.amount),0)into reversed from public.deal_payment_reversals r join public.deal_payments p on p.id=r.payment_id and p.team_id=r.team_id where p.team_id=p_team and p.order_id=o.id;
 select coalesce(sum(amount),0)into expenses from public.deal_sales_expenses where team_id=p_team and order_id=o.id;
 net_customer_payments:=paid-reversed;internal_settlement_due:=o.internal_due;sales_expenses:=expenses;sales_margin:=net_customer_payments-internal_settlement_due-sales_expenses;return next;end $function$;

create or replace function public.set_quarterly_performance_target(p_profile_id uuid,p_quarter_start date,p_points_target numeric,p_new_gmv_target numeric,p_renewal_gmv_target numeric)
returns public.performance_quarterly_targets language plpgsql security definer set search_path='' as $function$
declare r public.profiles;t public.performance_quarterly_targets;
begin if p_points_target<0 or p_new_gmv_target<0 or p_renewal_gmv_target<0 or p_quarter_start<>date_trunc('quarter',p_quarter_start)::date then raise exception'INVALID_TARGET'using errcode='22023';end if;
 select *into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')or not(public.can_supervise_performance(r.team_id,p_profile_id)or public.has_access_role(r.team_id,array['owner','admin']))then raise exception'TARGET_FORBIDDEN'using errcode='42501';end if;
 insert into public.performance_quarterly_targets(team_id,profile_id,quarter_start,points_target,new_gmv_target,renewal_gmv_target,updated_by)values(r.team_id,p_profile_id,p_quarter_start,p_points_target,p_new_gmv_target,p_renewal_gmv_target,r.id)
 on conflict(team_id,profile_id,quarter_start)do update set points_target=excluded.points_target,new_gmv_target=excluded.new_gmv_target,renewal_gmv_target=excluded.renewal_gmv_target,updated_by=r.id,updated_at=now()returning*into t;
 insert into public.performance_target_events(team_id,target_id,event_type,snapshot,actor_id)values(t.team_id,t.id,'target_set',to_jsonb(t),r.id);
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(t.team_id,r.id,'performance.target_set','performance_target',t.id,to_jsonb(t));return t;end $function$;

create or replace function public.update_estimated_points(p_quarter_start date,p_estimated_points numeric)
returns public.performance_quarterly_targets language plpgsql security definer set search_path='' as $function$ declare r public.profiles;t public.performance_quarterly_targets;begin
 if p_estimated_points<0 then raise exception'INVALID_ESTIMATE'using errcode='22023';end if;select*into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')then raise exception'ESTIMATE_FORBIDDEN'using errcode='42501';end if;
 update public.performance_quarterly_targets set estimated_points=p_estimated_points,updated_by=r.id,updated_at=now()where team_id=r.team_id and profile_id=r.id and quarter_start=p_quarter_start returning*into t;if t.id is null then raise exception'TARGET_NOT_FOUND'using errcode='P0002';end if;
 insert into public.performance_target_events(team_id,target_id,event_type,snapshot,actor_id)values(t.team_id,t.id,'estimate_updated',to_jsonb(t),r.id);return t;end $function$;

create or replace function public.create_official_reconciliation(p_quarter_start date,p_source_ref text,p_lines jsonb)
returns public.official_reconciliation_batches language plpgsql security definer set search_path='' as $function$ declare r public.profiles;b public.official_reconciliation_batches;line jsonb;begin
 select*into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')or not public.has_permission(r.team_id,'finance.manage')then raise exception'RECONCILIATION_FORBIDDEN'using errcode='42501';end if;
 if jsonb_typeof(p_lines)<>'array'or jsonb_array_length(p_lines)=0 then raise exception'RECONCILIATION_LINES_REQUIRED'using errcode='22023';end if;
 insert into public.official_reconciliation_batches(team_id,quarter_start,source_ref,created_by)values(r.team_id,p_quarter_start,p_source_ref,r.id)returning*into b;
 for line in select*from jsonb_array_elements(p_lines)loop insert into public.official_reconciliation_lines(team_id,batch_id,profile_id,order_id,official_points,gmv_type,gmv_amount)
  values(r.team_id,b.id,(line->>'profile_id')::uuid,nullif(line->>'order_id','')::uuid,coalesce((line->>'official_points')::numeric,0),line->>'gmv_type',coalesce((line->>'gmv_amount')::numeric,0));end loop;return b;end $function$;

create or replace function public.confirm_official_reconciliation(p_batch_id uuid)
returns public.official_reconciliation_batches language plpgsql security definer set search_path='' as $function$ declare r public.profiles;b public.official_reconciliation_batches;agg record;t public.performance_quarterly_targets;begin
 select*into r from public.profiles where id=auth.uid()and status='active';select*into b from public.official_reconciliation_batches where id=p_batch_id for update;
 if b.id is null or r.id is null or b.team_id<>r.team_id then raise exception'BATCH_NOT_FOUND'using errcode='P0002';end if;if not public.is_feature_enabled(b.team_id,'sales_os_v3')or not public.has_permission(b.team_id,'finance.manage')then raise exception'RECONCILIATION_FORBIDDEN'using errcode='42501';end if;
 if b.status='confirmed'then return b;end if;
 for agg in select profile_id,sum(official_points)points,sum(gmv_amount)filter(where gmv_type='new')new_gmv,sum(gmv_amount)filter(where gmv_type='renewal')renewal_gmv from public.official_reconciliation_lines where batch_id=b.id group by profile_id loop
  insert into public.performance_quarterly_targets(team_id,profile_id,quarter_start,official_points,new_gmv_actual,renewal_gmv_actual,updated_by)values(b.team_id,agg.profile_id,b.quarter_start,agg.points,coalesce(agg.new_gmv,0),coalesce(agg.renewal_gmv,0),r.id)
  on conflict(team_id,profile_id,quarter_start)do update set official_points=excluded.official_points,new_gmv_actual=excluded.new_gmv_actual,renewal_gmv_actual=excluded.renewal_gmv_actual,updated_by=r.id,updated_at=now()returning*into t;
  insert into public.performance_target_events(team_id,target_id,event_type,snapshot,actor_id)values(t.team_id,t.id,'official_reconciled',to_jsonb(t),r.id);end loop;
 update public.official_reconciliation_batches set status='confirmed',confirmed_by=r.id,confirmed_at=now()where id=b.id returning*into b;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(b.team_id,r.id,'reconciliation.confirmed','reconciliation_batch',b.id,to_jsonb(b));return b;end $function$;

create or replace function public.add_profit_adjustment(p_type text,p_amount numeric,p_effective_on date,p_reason text,p_idempotency_key uuid)
returns public.profit_adjustments language plpgsql security definer set search_path='' as $function$ declare r public.profiles;a public.profit_adjustments;begin
 if p_type not in('quarterly_rebate','expense')or p_amount<=0 or nullif(trim(p_reason),'')is null then raise exception'INVALID_PROFIT_ADJUSTMENT'using errcode='22023';end if;
 select*into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')or not public.has_permission(r.team_id,'finance.manage')then raise exception'PROFIT_ADJUSTMENT_FORBIDDEN'using errcode='42501';end if;
 insert into public.profit_adjustments(team_id,adjustment_type,amount,effective_on,reason,idempotency_key,confirmed_by)values(r.team_id,p_type,p_amount,p_effective_on,trim(p_reason),p_idempotency_key,r.id)
 on conflict(team_id,idempotency_key)do update set idempotency_key=excluded.idempotency_key returning*into a;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(a.team_id,r.id,'profit.adjustment_added','profit_adjustment',a.id,to_jsonb(a));return a;end $function$;

create or replace view public.company_profit_summary with(security_invoker=true)as
with ledger as(
 select s.team_id,date_trunc('quarter',s.confirmed_at)::date quarter_start,s.amount value from public.deal_internal_settlements s
 union all select c.team_id,date_trunc('quarter',c.confirmed_at)::date,-c.amount from public.deal_procurement_cost_payments c
 union all select a.team_id,date_trunc('quarter',a.effective_on)::date,case when a.adjustment_type='quarterly_rebate'then a.amount else-a.amount end from public.profit_adjustments a),actual as(select team_id,quarter_start,sum(value)actual_profit from ledger group by team_id,quarter_start),forecast as(select team_id,date_trunc('quarter',created_at)::date quarter_start,sum(internal_due-(internal_due/1.10))forecast_profit from public.deal_orders where status<>'cancelled'group by team_id,date_trunc('quarter',created_at)::date)
select coalesce(a.team_id,f.team_id)team_id,coalesce(a.quarter_start,f.quarter_start)quarter_start,coalesce(a.actual_profit,0)actual_profit,coalesce(f.forecast_profit,0)forecast_profit
from actual a full join forecast f using(team_id,quarter_start)where public.is_feature_enabled(coalesce(a.team_id,f.team_id),'sales_os_v3')and(public.has_access_role(coalesce(a.team_id,f.team_id),array['owner'])or public.has_permission(coalesce(a.team_id,f.team_id),'finance.read'));

create or replace view public.supervisor_order_margin with(security_invoker=true)as select o.team_id,o.id order_id,q.owner_id salesperson_id,l.net_customer_payments,l.internal_settlement_due,l.sales_expenses,l.sales_margin,o.status,o.created_at
from public.deal_orders o join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id join lateral public.get_order_sales_ledger(o.team_id,o.id)l on true where public.can_supervise_performance(o.team_id,q.owner_id,current_date);
create or replace view public.personal_sales_margin with(security_invoker=true)as select o.team_id,o.id order_id,q.owner_id salesperson_id,l.net_customer_payments,l.internal_settlement_due,l.sales_expenses,l.sales_margin,o.status,o.created_at
from public.deal_orders o join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id join lateral public.get_order_sales_ledger(o.team_id,o.id)l on true where q.owner_id=auth.uid();
create or replace view public.personal_performance_summary with(security_invoker=true)as select t.*from public.performance_quarterly_targets t where t.profile_id=auth.uid()or public.can_supervise_performance(t.team_id,t.profile_id,current_date)or public.has_access_role(t.team_id,array['owner'])or public.has_permission(t.team_id,'finance.read');

do $migration$ declare t text;begin foreach t in array array['performance_supervisor_assignments','performance_quarterly_targets','performance_target_events','official_reconciliation_batches','official_reconciliation_lines','profit_adjustments']loop execute format('alter table public.%I enable row level security',t);execute format('create policy"sales os v3 server gate"on public.%I as restrictive for all to authenticated using(public.is_feature_enabled(team_id,''sales_os_v3''))with check(public.is_feature_enabled(team_id,''sales_os_v3''))',t);end loop;end $migration$;
create policy"assignment participants read"on public.performance_supervisor_assignments for select to authenticated using(supervisor_id=auth.uid()or subordinate_id=auth.uid()or public.has_access_role(team_id,array['owner','admin']));
create policy"access managers assign supervisors"on public.performance_supervisor_assignments for all to authenticated using(public.has_permission(team_id,'access.manage'))with check(public.has_permission(team_id,'access.manage')and created_by=auth.uid());
create policy"scoped targets read"on public.performance_quarterly_targets for select to authenticated using(profile_id=auth.uid()or public.can_supervise_performance(team_id,profile_id)or public.has_access_role(team_id,array['owner'])or public.has_permission(team_id,'finance.read'));
create policy"scoped target events read"on public.performance_target_events for select to authenticated using(exists(select 1 from public.performance_quarterly_targets t where t.id=target_id and t.team_id=team_id and(t.profile_id=auth.uid()or public.can_supervise_performance(team_id,t.profile_id)or public.has_access_role(team_id,array['owner'])or public.has_permission(team_id,'finance.read'))));
create policy"finance reads reconciliation batches"on public.official_reconciliation_batches for select to authenticated using(public.has_permission(team_id,'finance.read')or public.has_permission(team_id,'finance.manage'));
create policy"finance reads reconciliation lines"on public.official_reconciliation_lines for select to authenticated using(public.has_permission(team_id,'finance.read')or public.has_permission(team_id,'finance.manage'));
create policy"owner finance reads adjustments"on public.profit_adjustments for select to authenticated using(public.has_access_role(team_id,array['owner'])or public.has_permission(team_id,'finance.read'));
revoke all on public.company_profit_summary,public.supervisor_order_margin,public.personal_sales_margin,public.personal_performance_summary from public,anon;grant select on public.company_profit_summary,public.supervisor_order_margin,public.personal_sales_margin,public.personal_performance_summary to authenticated;
revoke all on function public.can_supervise_performance(text,uuid,date),public.set_quarterly_performance_target(uuid,date,numeric,numeric,numeric),public.update_estimated_points(date,numeric),public.create_official_reconciliation(date,text,jsonb),public.confirm_official_reconciliation(uuid),public.add_profit_adjustment(text,numeric,date,text,uuid)from public;
revoke all on function public.get_order_sales_ledger(text,uuid)from public;grant execute on function public.get_order_sales_ledger(text,uuid)to authenticated;
grant execute on function public.can_supervise_performance(text,uuid,date),public.set_quarterly_performance_target(uuid,date,numeric,numeric,numeric),public.update_estimated_points(date,numeric),public.create_official_reconciliation(date,text,jsonb),public.confirm_official_reconciliation(uuid),public.add_profit_adjustment(text,numeric,date,text,uuid)to authenticated;
notify pgrst,'reload schema';
