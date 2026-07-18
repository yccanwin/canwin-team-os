do $$
declare
  snapshot_def text;
  snapshot_compact text;
  target_def text;
  target_compact text;
  dashboard_def text;
  dashboard_compact text;
  core_def text;
  core_compact text;
  state_rls boolean;
  event_rls boolean;
begin
  if to_regprocedure('public.get_performance_center_snapshot(date,text,uuid)') is null then
    raise exception 'Performance center snapshot RPC missing';
  end if;
  if to_regprocedure('public.set_quarterly_performance_target(uuid,date,numeric,numeric,numeric)') is null then
    raise exception 'Quarterly target RPC missing';
  end if;
  if to_regprocedure(
      'sales_os_private.refresh_order_performance_state_core(text,uuid,text,text,uuid,uuid)'
    ) is null then
    raise exception 'Private order performance transition core missing';
  end if;

  snapshot_def:=lower(pg_get_functiondef(
    'public.get_performance_center_snapshot(date,text,uuid)'::regprocedure
  ));
  target_def:=lower(pg_get_functiondef(
    'public.set_quarterly_performance_target(uuid,date,numeric,numeric,numeric)'::regprocedure
  ));
  dashboard_def:=lower(pg_get_functiondef(
    'public.get_performance_management_dashboard(date)'::regprocedure
  ));
  core_def:=lower(pg_get_functiondef(
    'sales_os_private.refresh_order_performance_state_core(text,uuid,text,text,uuid,uuid)'::regprocedure
  ));
  snapshot_compact:=replace(replace(replace(snapshot_def,' ',''),chr(10),''),chr(13),'');
  target_compact:=replace(replace(replace(target_def,' ',''),chr(10),''),chr(13),'');
  dashboard_compact:=replace(replace(replace(dashboard_def,' ',''),chr(10),''),chr(13),'');
  core_compact:=replace(replace(replace(core_def,' ',''),chr(10),''),chr(13),'');

  if position('security definer' in snapshot_def)=0
    or position("set search_path to ''" in snapshot_def)=0 then
    raise exception 'Snapshot RPC security boundary missing';
  end if;
  if position("v_scopenotin('personal','team')" in snapshot_compact)=0
    or position('team_performance_forbidden' in snapshot_def)=0
    or position('performance_profile_not_found' in snapshot_def)=0 then
    raise exception 'Snapshot scope authorization missing';
  end if;
  if position('p_profile_idisnullandnotv_actor_is_sales' in snapshot_compact)=0
    or position("v_effective_scope:='team'" in snapshot_compact)=0
    or position('ifv_can_read_allorv_has_active_subordinates' in snapshot_compact)=0
    or position("'effectivescope',v_effective_scope" in snapshot_compact)=0
    or position("'selectedprofileid',v_selected_profile_id" in snapshot_compact)=0 then
    raise exception 'Non-sales management landing fallback missing';
  end if;
  if position("s.status='qualified'" in snapshot_compact)=0
    or position("s.statusin('qualified','revoked')" in snapshot_compact)=0
    or position("e.event_type='restored'" in snapshot_compact)=0
    or position("then'reversed'" in snapshot_compact)=0 then
    raise exception 'Qualified/revoked/restored snapshot semantics missing';
  end if;
  if position('order_performance_events' in snapshot_def)=0
    or position('deal_quote_lines' in snapshot_def)=0
    or position("'members'" in snapshot_def)=0
    or position("'products'" in snapshot_def)=0
    or position("'orders'" in snapshot_def)=0 then
    raise exception 'Snapshot response contract incomplete';
  end if;

  if position("ar.code='sales'" in target_compact)=0
    or position("p.status='active'" in target_compact)=0
    or position('can_supervise_performance' in target_def)=0
    or position('has_access_role' in target_def)=0
    or position("'owner'" in target_def)=0
    or position("'admin'" in target_def)=0 then
    raise exception 'Target manager/active-sales restriction missing';
  end if;
  if position('performance_target_events' in target_def)=0
    or position("'before'" in target_def)=0
    or position("'after'" in target_def)=0
    or position('before_data' in target_def)=0
    or position('after_data' in target_def)=0 then
    raise exception 'Target event/audit history missing';
  end if;

  if position('order_performance_states' in dashboard_def)=0
    or position("s.status='qualified'" in dashboard_compact)=0 then
    raise exception 'Legacy dashboard is not order-backed';
  end if;

  if position('security definer' in core_def)=0
    or position("set search_path to ''" in core_def)=0
    or position('deal_payments' in core_def)=0
    or position('deal_payment_reversals' in core_def)=0
    or position('deal_order_cancellations' in core_def)=0
    or position("v_order.status='cancelled'" in core_compact)=0
    or position("v_event_type:='revoked'" in core_compact)=0
    or position("then'qualified'" in core_compact)=0
    or position("else'restored'" in core_compact)=0 then
    raise exception 'Private order transition semantics incomplete';
  end if;
  if position("'order-performance:'||p_trigger_type||':'||p_trigger_id::text" in core_compact)=0
    or position('performance_trigger_idempotency_conflict' in core_def)=0
    or position('order_performance_events' in core_def)=0
    or position('ifp_actor_idisnotnullthen' in core_compact)=0 then
    raise exception 'Private transition idempotency/event chain missing';
  end if;

  if not exists(
      select 1
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_proc p on p.oid=t.tgfoid
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where t.tgrelid='public.deal_payments'::regclass
        and t.tgname='refresh_performance_after_payment'
        and not t.tgisinternal
        and (t.tgtype&1)=1 and (t.tgtype&4)=4 and (t.tgtype&2)=0
        and n.nspname='sales_os_private'
    )
    or not exists(
      select 1
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_proc p on p.oid=t.tgfoid
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where t.tgrelid='public.deal_payment_reversals'::regclass
        and t.tgname='refresh_performance_after_reversal'
        and not t.tgisinternal
        and (t.tgtype&1)=1 and (t.tgtype&4)=4 and (t.tgtype&2)=0
        and n.nspname='sales_os_private'
    )
    or not exists(
      select 1
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_proc p on p.oid=t.tgfoid
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where t.tgrelid='public.deal_order_cancellations'::regclass
        and t.tgname='refresh_performance_after_cancellation'
        and not t.tgisinternal
        and (t.tgtype&1)=1 and (t.tgtype&4)=4 and (t.tgtype&2)=0
        and n.nspname='sales_os_private'
    ) then
    raise exception 'Payment/reversal/cancellation performance triggers missing';
  end if;

  if has_function_privilege(
      'anon','public.get_performance_center_snapshot(date,text,uuid)','execute'
    )
    or not has_function_privilege(
      'authenticated','public.get_performance_center_snapshot(date,text,uuid)','execute'
    ) then
    raise exception 'Snapshot RPC grants unsafe';
  end if;
  if has_function_privilege(
      'anon','public.set_quarterly_performance_target(uuid,date,numeric,numeric,numeric)','execute'
    )
    or not has_function_privilege(
      'authenticated','public.set_quarterly_performance_target(uuid,date,numeric,numeric,numeric)','execute'
    ) then
    raise exception 'Target RPC grants unsafe';
  end if;
  if has_schema_privilege('anon','sales_os_private','usage')
    or has_schema_privilege('authenticated','sales_os_private','usage')
    or has_function_privilege(
      'anon',
      'sales_os_private.refresh_order_performance_state_core(text,uuid,text,text,uuid,uuid)',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'sales_os_private.refresh_order_performance_state_core(text,uuid,text,text,uuid,uuid)',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.refresh_order_performance_state(uuid,text,text,uuid,uuid)',
      'execute'
    ) then
    raise exception 'Internal performance transition is client callable';
  end if;

  if has_table_privilege('anon','public.order_performance_states','select')
    or has_table_privilege('anon','public.order_performance_events','select')
    or has_table_privilege('authenticated','public.order_performance_states','insert')
    or has_table_privilege('authenticated','public.order_performance_states','update')
    or has_table_privilege('authenticated','public.order_performance_states','delete')
    or has_table_privilege('authenticated','public.order_performance_events','insert')
    or has_table_privilege('authenticated','public.order_performance_events','update')
    or has_table_privilege('authenticated','public.order_performance_events','delete') then
    raise exception 'Performance state/event table grants unsafe';
  end if;

  select c.relrowsecurity into state_rls
  from pg_class c
  where c.oid='public.order_performance_states'::regclass;
  select c.relrowsecurity into event_rls
  from pg_class c
  where c.oid='public.order_performance_events'::regclass;
  if not coalesce(state_rls,false) or not coalesce(event_rls,false) then
    raise exception 'Performance state/event RLS missing';
  end if;

  if to_regclass('public.order_performance_states_quarter_sales_qualified_idx') is null
    or to_regclass('public.order_performance_events_latest_order_idx') is null then
    raise exception 'Performance center indexes missing';
  end if;

  -- The migration-time backfill must leave every feature-enabled historical
  -- order represented. This query is also a safe no-op when there are no orders.
  if exists(
    select 1
    from public.deal_orders o
    left join public.order_performance_states s
      on s.team_id=o.team_id and s.order_id=o.id
    where public.is_feature_enabled(o.team_id,'sales_os_v3')
      and s.order_id is null
  ) then
    raise exception 'Historical order performance backfill incomplete';
  end if;
  if exists(
    select 1
    from public.order_performance_states s
    join public.deal_orders o
      on o.team_id=s.team_id and o.id=s.order_id
    left join lateral(
      select
        coalesce(sum(p.amount),0)-coalesce(sum(r.reversed_amount),0) net_paid
      from public.deal_payments p
      left join lateral(
        select coalesce(sum(pr.amount),0) reversed_amount
        from public.deal_payment_reversals pr
        where pr.team_id=p.team_id and pr.payment_id=p.id
      ) r on true
      where p.team_id=o.team_id and p.order_id=o.id
    ) ledger on true
    where public.is_feature_enabled(o.team_id,'sales_os_v3')
      and (
        (
          greatest(coalesce(ledger.net_paid,0),0)>=o.customer_total
          and o.status<>'cancelled'
          and not exists(
            select 1
            from public.deal_order_cancellations c
            where c.team_id=o.team_id and c.order_id=o.id
          )
          and s.status<>'qualified'
        )
        or (
          (
            greatest(coalesce(ledger.net_paid,0),0)<o.customer_total
            or o.status='cancelled'
            or exists(
              select 1
              from public.deal_order_cancellations c
              where c.team_id=o.team_id and c.order_id=o.id
            )
          )
          and s.status='qualified'
        )
      )
  ) then
    raise exception 'Order performance state disagrees with trusted ledgers';
  end if;
end
$$;
