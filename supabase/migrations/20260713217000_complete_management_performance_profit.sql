-- C7: sales meeting, quarterly targets, official reconciliation and dual-ledger profit.

alter table public.supervisor_exception_resolutions add column idempotency_key uuid;
create unique index supervisor_resolution_idempotency_key on public.supervisor_exception_resolutions(team_id,idempotency_key)where idempotency_key is not null;

create table public.performance_monthly_observations(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),profile_id uuid not null,month_start date not null,
 estimated_points numeric(14,2)not null default 0 check(estimated_points>=0),new_gmv numeric(14,2)not null default 0 check(new_gmv>=0),renewal_gmv numeric(14,2)not null default 0 check(renewal_gmv>=0),
 idempotency_key uuid not null,updated_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(team_id,id),unique(team_id,profile_id,month_start),unique(team_id,idempotency_key),foreign key(team_id,profile_id)references public.profiles(team_id,id),
 check(month_start=date_trunc('month',month_start)::date)
);
create table public.performance_monthly_observation_events(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),profile_id uuid not null,month_start date not null,payload jsonb not null,idempotency_key uuid not null,actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(team_id,id),unique(team_id,idempotency_key),foreign key(team_id,profile_id)references public.profiles(team_id,id)
);

alter table public.official_reconciliation_batches add column import_hash text;
alter table public.official_reconciliation_lines add column observed_month date;
update public.official_reconciliation_lines set observed_month=date_trunc('month',created_at)::date where observed_month is null;
alter table public.official_reconciliation_lines alter column observed_month set not null;
alter table public.official_reconciliation_lines add constraint official_line_observed_month_check check(observed_month=date_trunc('month',observed_month)::date);

drop function if exists public.resolve_supervisor_exception(text,uuid,uuid,timestamptz,text);
create function public.resolve_supervisor_exception(p_item_type text,p_entity_id uuid,p_owner_id uuid,p_resolution_due_at timestamptz,p_resolution_note text,p_idempotency_key uuid)
returns public.supervisor_exception_resolutions language plpgsql security definer set search_path='' as $function$
declare v_profile public.profiles;v_result public.supervisor_exception_resolutions;
begin
 if p_item_type not in('action_exception','closing_opportunity')or p_resolution_due_at<=now()or nullif(trim(p_resolution_note),'')is null or p_idempotency_key is null then raise exception'VALID_FUTURE_RESOLUTION_REQUIRED'using errcode='22023';end if;
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';
 if v_profile.id is null or not public.is_feature_enabled(v_profile.team_id,'sales_os_v3')or not public.has_permission(v_profile.team_id,'customers.supervise')then raise exception'SUPERVISOR_REQUIRED'using errcode='42501';end if;
 select r.*into v_result from public.supervisor_exception_resolutions r where r.team_id=v_profile.team_id and r.idempotency_key=p_idempotency_key;
 if v_result.id is not null then if v_result.item_type<>p_item_type or v_result.entity_id<>p_entity_id or v_result.owner_id<>p_owner_id or v_result.resolution_due_at<>p_resolution_due_at or v_result.resolution_note<>trim(p_resolution_note)then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return v_result;end if;
 if not exists(select 1 from public.crm_supervisor_board b where b.team_id=v_profile.team_id and b.item_type=p_item_type and b.entity_id=p_entity_id and b.owner_id=p_owner_id)then raise exception'SUPERVISOR_ITEM_NOT_FOUND'using errcode='P0002';end if;
 insert into public.supervisor_exception_resolutions(team_id,item_type,entity_id,owner_id,resolution_due_at,resolution_note,resolved_by,idempotency_key)values(v_profile.team_id,p_item_type,p_entity_id,p_owner_id,p_resolution_due_at,trim(p_resolution_note),v_profile.id,p_idempotency_key)returning*into v_result;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(v_profile.team_id,v_profile.id,'supervisor.meeting_resolution_added','supervisor_exception',v_result.id,to_jsonb(v_result));return v_result;
end
$function$;

create or replace function public.record_monthly_performance_observation(p_month_start date,p_estimated_points numeric,p_new_gmv numeric,p_renewal_gmv numeric,p_idempotency_key uuid)
returns public.performance_monthly_observations language plpgsql security definer set search_path='' as $function$
declare v_profile public.profiles;v_item public.performance_monthly_observations;v_before jsonb;v_event jsonb;
begin
 if p_month_start<>date_trunc('month',p_month_start)::date or p_estimated_points<0 or p_new_gmv<0 or p_renewal_gmv<0 or p_idempotency_key is null then raise exception'INVALID_MONTHLY_OBSERVATION'using errcode='22023';end if;
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';if v_profile.id is null or not public.is_feature_enabled(v_profile.team_id,'sales_os_v3')then raise exception'OBSERVATION_FORBIDDEN'using errcode='42501';end if;
 select e.payload into v_event from public.performance_monthly_observation_events e where e.team_id=v_profile.team_id and e.idempotency_key=p_idempotency_key;
 if v_event is not null then if (v_event->>'profile_id')::uuid<>v_profile.id or (v_event->>'month_start')::date<>p_month_start or (v_event->>'estimated_points')::numeric<>p_estimated_points or (v_event->>'new_gmv')::numeric<>p_new_gmv or (v_event->>'renewal_gmv')::numeric<>p_renewal_gmv then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;select o.*into v_item from public.performance_monthly_observations o where o.team_id=v_profile.team_id and o.profile_id=v_profile.id and o.month_start=p_month_start;return v_item;end if;
 select to_jsonb(o)into v_before from public.performance_monthly_observations o where o.team_id=v_profile.team_id and o.profile_id=v_profile.id and o.month_start=p_month_start;
 insert into public.performance_monthly_observations(team_id,profile_id,month_start,estimated_points,new_gmv,renewal_gmv,idempotency_key,updated_by)values(v_profile.team_id,v_profile.id,p_month_start,p_estimated_points,p_new_gmv,p_renewal_gmv,p_idempotency_key,v_profile.id)
 on conflict(team_id,profile_id,month_start)do update set estimated_points=excluded.estimated_points,new_gmv=excluded.new_gmv,renewal_gmv=excluded.renewal_gmv,idempotency_key=excluded.idempotency_key,updated_by=v_profile.id,updated_at=now()returning*into v_item;
 insert into public.performance_monthly_observation_events(team_id,profile_id,month_start,payload,idempotency_key,actor_id)values(v_item.team_id,v_item.profile_id,v_item.month_start,jsonb_build_object('profile_id',v_item.profile_id,'month_start',v_item.month_start,'estimated_points',v_item.estimated_points,'new_gmv',v_item.new_gmv,'renewal_gmv',v_item.renewal_gmv),p_idempotency_key,v_profile.id);
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(v_item.team_id,v_profile.id,'performance.monthly_observation_saved','performance_observation',v_item.id,coalesce(v_before,'{}'),to_jsonb(v_item));return v_item;
end
$function$;

create or replace function public.confirm_official_reconciliation(p_batch_id uuid)
returns public.official_reconciliation_batches language plpgsql security definer set search_path='' as $function$
declare v_profile public.profiles;v_batch public.official_reconciliation_batches;v_agg record;v_target public.performance_quarterly_targets;
begin
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';select b.*into v_batch from public.official_reconciliation_batches b where b.id=p_batch_id for update;
 if v_batch.id is null or v_profile.id is null or v_batch.team_id<>v_profile.team_id or not public.is_feature_enabled(v_batch.team_id,'sales_os_v3')or not public.has_permission(v_batch.team_id,'finance.manage')then raise exception'RECONCILIATION_FORBIDDEN'using errcode='42501';end if;
 if v_batch.status='confirmed'then return v_batch;end if;
 update public.official_reconciliation_batches set status='confirmed',confirmed_by=v_profile.id,confirmed_at=now()where id=v_batch.id returning*into v_batch;
 for v_agg in select l.profile_id,sum(l.official_points)points,coalesce(sum(l.gmv_amount)filter(where l.gmv_type='new'),0)new_gmv,coalesce(sum(l.gmv_amount)filter(where l.gmv_type='renewal'),0)renewal_gmv from public.official_reconciliation_lines l join public.official_reconciliation_batches b on b.id=l.batch_id and b.team_id=l.team_id and b.status='confirmed'where b.team_id=v_batch.team_id and b.quarter_start=v_batch.quarter_start group by l.profile_id loop
  insert into public.performance_quarterly_targets(team_id,profile_id,quarter_start,official_points,new_gmv_actual,renewal_gmv_actual,updated_by)values(v_batch.team_id,v_agg.profile_id,v_batch.quarter_start,v_agg.points,v_agg.new_gmv,v_agg.renewal_gmv,v_profile.id)
  on conflict(team_id,profile_id,quarter_start)do update set official_points=excluded.official_points,new_gmv_actual=excluded.new_gmv_actual,renewal_gmv_actual=excluded.renewal_gmv_actual,updated_by=v_profile.id,updated_at=now()returning*into v_target;
  insert into public.performance_target_events(team_id,target_id,event_type,snapshot,actor_id)values(v_target.team_id,v_target.id,'official_reconciled',to_jsonb(v_target),v_profile.id);
 end loop;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(v_batch.team_id,v_profile.id,'reconciliation.confirmed','reconciliation_batch',v_batch.id,to_jsonb(v_batch));return v_batch;
end
$function$;

create or replace function public.get_performance_management_dashboard(p_quarter_start date)
returns table(profile_id uuid,profile_name text,quarter_start date,points_target numeric,estimated_points numeric,official_points numeric,new_gmv_target numeric,new_gmv_actual numeric,renewal_gmv_target numeric,renewal_gmv_actual numeric,monthly_observations jsonb,can_set_target boolean)
language plpgsql security definer stable set search_path='' as $function$
declare v_profile public.profiles;
begin
 if p_quarter_start<>date_trunc('quarter',p_quarter_start)::date then raise exception'INVALID_QUARTER'using errcode='22023';end if;
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';if v_profile.id is null or not public.is_feature_enabled(v_profile.team_id,'sales_os_v3')then raise exception'PERFORMANCE_FORBIDDEN'using errcode='42501';end if;
 return query
 with people as(select p.id,p.name from public.profiles p where p.team_id=v_profile.team_id and p.status='active'and(p.id=v_profile.id or public.can_supervise_performance(v_profile.team_id,p.id,(now()at time zone'Asia/Shanghai')::date)or public.has_access_role(v_profile.team_id,array['owner','admin'])or public.has_permission(v_profile.team_id,'finance.read'))),months as(select generate_series(p_quarter_start,p_quarter_start+interval'2 months',interval'1 month')::date month_start)
 select p.id,p.name,p_quarter_start,coalesce(t.points_target,0),coalesce((select sum(o.estimated_points)from public.performance_monthly_observations o where o.team_id=v_profile.team_id and o.profile_id=p.id and o.month_start between p_quarter_start and p_quarter_start+interval'2 months'),t.estimated_points,0),coalesce(t.official_points,0),coalesce(t.new_gmv_target,0),coalesce(t.new_gmv_actual,0),coalesce(t.renewal_gmv_target,0),coalesce(t.renewal_gmv_actual,0),
  (select jsonb_agg(jsonb_build_object('month_start',m.month_start,'estimated_points',coalesce(o.estimated_points,0),'new_gmv',coalesce(o.new_gmv,0),'renewal_gmv',coalesce(o.renewal_gmv,0),'official_points',coalesce(x.official_points,0))order by m.month_start)from months m left join public.performance_monthly_observations o on o.team_id=v_profile.team_id and o.profile_id=p.id and o.month_start=m.month_start left join lateral(select sum(l.official_points)official_points from public.official_reconciliation_lines l join public.official_reconciliation_batches b on b.id=l.batch_id and b.team_id=l.team_id and b.status='confirmed'where l.team_id=v_profile.team_id and l.profile_id=p.id and l.observed_month=m.month_start)x on true),
  (public.can_supervise_performance(v_profile.team_id,p.id,(now()at time zone'Asia/Shanghai')::date)or public.has_access_role(v_profile.team_id,array['owner','admin']))
 from people p left join public.performance_quarterly_targets t on t.team_id=v_profile.team_id and t.profile_id=p.id and t.quarter_start=p_quarter_start order by p.name;
end
$function$;

create or replace function public.create_official_reconciliation(p_quarter_start date,p_source_ref text,p_lines jsonb)
returns public.official_reconciliation_batches language plpgsql security definer set search_path='' as $function$
declare v_profile public.profiles;v_batch public.official_reconciliation_batches;v_line jsonb;v_hash text:=md5(p_lines::text);v_month date;
begin
 if p_quarter_start<>date_trunc('quarter',p_quarter_start)::date or nullif(trim(p_source_ref),'')is null or jsonb_typeof(p_lines)<>'array'or jsonb_array_length(p_lines)=0 then raise exception'VALID_RECONCILIATION_REQUIRED'using errcode='22023';end if;
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';if v_profile.id is null or not public.is_feature_enabled(v_profile.team_id,'sales_os_v3')or not public.has_permission(v_profile.team_id,'finance.manage')then raise exception'RECONCILIATION_FORBIDDEN'using errcode='42501';end if;
 select b.*into v_batch from public.official_reconciliation_batches b where b.team_id=v_profile.team_id and b.source_ref=trim(p_source_ref);
 if v_batch.id is not null then if v_batch.quarter_start<>p_quarter_start or v_batch.import_hash is distinct from v_hash then raise exception'SOURCE_REFERENCE_CONFLICT'using errcode='23505';end if;return v_batch;end if;
 insert into public.official_reconciliation_batches(team_id,quarter_start,source_ref,import_hash,created_by)values(v_profile.team_id,p_quarter_start,trim(p_source_ref),v_hash,v_profile.id)returning*into v_batch;
 for v_line in select*from jsonb_array_elements(p_lines)loop
  v_month:=coalesce(nullif(v_line->>'observed_month','')::date,p_quarter_start);if v_month<>date_trunc('month',v_month)::date or v_month<p_quarter_start or v_month>p_quarter_start+interval'2 months'then raise exception'INVALID_OBSERVED_MONTH'using errcode='22023';end if;
  insert into public.official_reconciliation_lines(team_id,batch_id,profile_id,order_id,official_points,gmv_type,gmv_amount,observed_month)values(v_profile.team_id,v_batch.id,(v_line->>'profile_id')::uuid,nullif(v_line->>'order_id','')::uuid,coalesce((v_line->>'official_points')::numeric,0),v_line->>'gmv_type',coalesce((v_line->>'gmv_amount')::numeric,0),v_month);
 end loop;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(v_batch.team_id,v_profile.id,'reconciliation.imported','reconciliation_batch',v_batch.id,jsonb_build_object('source_ref',v_batch.source_ref,'line_count',jsonb_array_length(p_lines)));return v_batch;
end
$function$;

create or replace function public.get_official_reconciliation_batches()
returns table(batch_id uuid,quarter_start date,source_ref text,status text,line_count bigint,created_at timestamptz,confirmed_at timestamptz)
language plpgsql security definer stable set search_path='' as $function$
declare v_profile public.profiles;
begin select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';if v_profile.id is null or not public.is_feature_enabled(v_profile.team_id,'sales_os_v3')or not(public.has_permission(v_profile.team_id,'finance.read')or public.has_permission(v_profile.team_id,'finance.manage'))then raise exception'RECONCILIATION_FORBIDDEN'using errcode='42501';end if;
 return query select b.id,b.quarter_start,b.source_ref,b.status,count(l.id),b.created_at,b.confirmed_at from public.official_reconciliation_batches b left join public.official_reconciliation_lines l on l.batch_id=b.id and l.team_id=b.team_id where b.team_id=v_profile.team_id group by b.id order by b.created_at desc;
end
$function$;

create or replace function public.get_management_profit_summary()
returns table(quarter_start date,forecast_profit numeric,actual_profit numeric,actual_receipts numeric,refund_reversals numeric,procurement_payments numeric,sales_expenses numeric,quarterly_rebates numeric,company_expenses numeric,can_view_details boolean)
language plpgsql security definer stable set search_path='' as $function$
declare v_profile public.profiles;v_finance boolean;
begin
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';v_finance:=public.has_permission(v_profile.team_id,'finance.read')or public.has_permission(v_profile.team_id,'finance.manage');
 if v_profile.id is null or not public.is_feature_enabled(v_profile.team_id,'sales_os_v3')or not(v_finance or public.has_access_role(v_profile.team_id,array['owner']))then raise exception'PROFIT_SUMMARY_FORBIDDEN'using errcode='42501';end if;
 return query with quarters as(select distinct date_trunc('quarter',d)::date q from(select created_at d from public.deal_orders where team_id=v_profile.team_id union all select confirmed_at from public.deal_payments where team_id=v_profile.team_id union all select created_at from public.deal_payment_reversals where team_id=v_profile.team_id union all select confirmed_at from public.deal_procurement_cost_payments where team_id=v_profile.team_id union all select created_at from public.deal_sales_expenses where team_id=v_profile.team_id union all select effective_on::timestamptz from public.profit_adjustments where team_id=v_profile.team_id)x where d is not null),calc as(select q.q,
  coalesce((select sum(o.internal_due-(o.internal_due/1.10))from public.deal_orders o where o.team_id=v_profile.team_id and date_trunc('quarter',o.created_at)::date=q.q),0)forecast,
  coalesce((select sum(p.amount)from public.deal_payments p where p.team_id=v_profile.team_id and date_trunc('quarter',p.confirmed_at)::date=q.q),0)receipts,
  coalesce((select sum(r.amount)from public.deal_payment_reversals r join public.deal_payments p on p.id=r.payment_id and p.team_id=r.team_id where r.team_id=v_profile.team_id and date_trunc('quarter',r.created_at)::date=q.q),0)refunds,
  coalesce((select sum(c.amount)from public.deal_procurement_cost_payments c where c.team_id=v_profile.team_id and date_trunc('quarter',c.confirmed_at)::date=q.q),0)procurement,
  coalesce((select sum(e.amount)from public.deal_sales_expenses e where e.team_id=v_profile.team_id and date_trunc('quarter',e.created_at)::date=q.q),0)sales_costs,
  coalesce((select sum(a.amount)from public.profit_adjustments a where a.team_id=v_profile.team_id and a.adjustment_type='quarterly_rebate'and date_trunc('quarter',a.effective_on)::date=q.q),0)rebates,
  coalesce((select sum(a.amount)from public.profit_adjustments a where a.team_id=v_profile.team_id and a.adjustment_type='expense'and date_trunc('quarter',a.effective_on)::date=q.q),0)expenses from quarters q)
 select c.q,c.forecast,c.receipts-c.refunds-c.procurement-c.sales_costs+c.rebates-c.expenses,case when v_finance then c.receipts end,case when v_finance then c.refunds end,case when v_finance then c.procurement end,case when v_finance then c.sales_costs end,case when v_finance then c.rebates end,case when v_finance then c.expenses end,v_finance from calc c order by c.q desc;
end
$function$;

create or replace function public.add_profit_adjustment(p_type text,p_amount numeric,p_effective_on date,p_reason text,p_idempotency_key uuid)
returns public.profit_adjustments language plpgsql security definer set search_path='' as $function$
declare v_profile public.profiles;v_item public.profit_adjustments;
begin
 if p_type not in('quarterly_rebate','expense')or p_amount<=0 or p_effective_on is null or nullif(trim(p_reason),'')is null or p_idempotency_key is null then raise exception'INVALID_PROFIT_ADJUSTMENT'using errcode='22023';end if;
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';if v_profile.id is null or not public.is_feature_enabled(v_profile.team_id,'sales_os_v3')or not public.has_permission(v_profile.team_id,'finance.manage')then raise exception'PROFIT_ADJUSTMENT_FORBIDDEN'using errcode='42501';end if;
 select a.*into v_item from public.profit_adjustments a where a.team_id=v_profile.team_id and a.idempotency_key=p_idempotency_key;
 if v_item.id is not null then if v_item.adjustment_type<>p_type or v_item.amount<>p_amount or v_item.effective_on<>p_effective_on or v_item.reason<>trim(p_reason)then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return v_item;end if;
 insert into public.profit_adjustments(team_id,adjustment_type,amount,effective_on,reason,idempotency_key,confirmed_by)values(v_profile.team_id,p_type,p_amount,p_effective_on,trim(p_reason),p_idempotency_key,v_profile.id)returning*into v_item;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(v_item.team_id,v_profile.id,'profit.adjustment_added','profit_adjustment',v_item.id,to_jsonb(v_item));return v_item;
end
$function$;

create or replace function public.get_supervisor_order_margins()
returns table(order_id uuid,order_number text,owner_name text,sales_margin numeric,created_at timestamptz)
language plpgsql security definer stable set search_path='' as $function$
declare v_profile public.profiles;
begin select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';if v_profile.id is null or not public.is_feature_enabled(v_profile.team_id,'sales_os_v3')or not public.has_permission(v_profile.team_id,'customers.supervise')then raise exception'SUPERVISOR_REQUIRED'using errcode='42501';end if;
 return query select o.id,o.order_number,p.name,l.sales_margin,o.created_at from public.deal_orders o join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id join public.profiles p on p.id=q.owner_id and p.team_id=q.team_id join lateral public.get_order_sales_ledger(o.team_id,o.id)l on true where o.team_id=v_profile.team_id and public.can_supervise_performance(o.team_id,q.owner_id,(now()at time zone'Asia/Shanghai')::date)order by o.created_at desc;
end
$function$;

alter table public.performance_monthly_observations enable row level security;
alter table public.performance_monthly_observation_events enable row level security;
create policy "monthly observation feature gate"on public.performance_monthly_observations as restrictive for all to authenticated using(public.is_feature_enabled(team_id,'sales_os_v3'))with check(public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "monthly observation scoped read"on public.performance_monthly_observations for select to authenticated using(profile_id=auth.uid()or public.can_supervise_performance(team_id,profile_id,(now()at time zone'Asia/Shanghai')::date)or public.has_access_role(team_id,array['owner','admin'])or public.has_permission(team_id,'finance.read'));
create policy "monthly event feature gate"on public.performance_monthly_observation_events as restrictive for all to authenticated using(public.is_feature_enabled(team_id,'sales_os_v3'))with check(public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "monthly event scoped read"on public.performance_monthly_observation_events for select to authenticated using(profile_id=auth.uid()or public.can_supervise_performance(team_id,profile_id,(now()at time zone'Asia/Shanghai')::date)or public.has_access_role(team_id,array['owner','admin'])or public.has_permission(team_id,'finance.read'));

revoke all on function public.resolve_supervisor_exception(text,uuid,uuid,timestamptz,text,uuid),public.record_monthly_performance_observation(date,numeric,numeric,numeric,uuid),public.get_performance_management_dashboard(date),public.create_official_reconciliation(date,text,jsonb),public.get_official_reconciliation_batches(),public.get_management_profit_summary(),public.get_supervisor_order_margins()from public,anon;
grant execute on function public.resolve_supervisor_exception(text,uuid,uuid,timestamptz,text,uuid),public.record_monthly_performance_observation(date,numeric,numeric,numeric,uuid),public.get_performance_management_dashboard(date),public.create_official_reconciliation(date,text,jsonb),public.get_official_reconciliation_batches(),public.get_management_profit_summary(),public.get_supervisor_order_margins()to authenticated;
notify pgrst,'reload schema';
