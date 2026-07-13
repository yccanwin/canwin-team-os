-- A7: one Beijing-natural-day queue. The browser only renders this result.

create or replace function public.get_sales_today_action_queue()
returns jsonb language plpgsql security definer stable set search_path='' as $$
declare v_profile public.profiles;v_now timestamptz:=now();v_today date:=(now()at time zone'Asia/Shanghai')::date;v_result jsonb;
begin
  select p.* into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';
  if v_profile.id is null or not public.is_feature_enabled(v_profile.team_id,'sales_os_v3')
    or not public.has_permission(v_profile.team_id,'customers.manage')then
    raise exception 'TODAY_QUEUE_FORBIDDEN' using errcode='42501';
  end if;
  with actions as(
    select 'lead_action:'||l.id::text id,l.id entity_id,'lead'::text entity_type,
      case when l.next_action_kind='appointment'and l.next_action_at<v_now then'overdue_appointment'
        when l.next_action_kind='appointment'then'upcoming_appointment'
        when l.next_action_at<v_now then'overdue_followup'else'today_followup'end action_type,
      case when l.next_action_kind='appointment'and l.next_action_at<v_now then 10 when l.next_action_kind='appointment'then 30 when l.next_action_at<v_now then 35 else 50 end priority,
      case when l.next_action_kind='appointment'and l.next_action_at<v_now then'critical'when l.next_action_kind='appointment'then'high'when l.next_action_at<v_now then'high'else'medium'end priority_tone,
      case when l.next_action_kind='appointment'and l.next_action_at<v_now then'预约逾期'when l.next_action_kind='appointment'then'临近预约'when l.next_action_at<v_now then'跟进逾期'else'今日跟进'end label,
      l.title,case when l.next_action_kind='appointment'then'客户预约时间已进入24小时行动窗口'else'有效跟进设定的下一步已到执行日期'end reason,
      l.next_action_at due_at,'#/sales-v3?lead='||l.id::text route,
      case when l.next_action_kind='appointment'then l.next_action_at<v_now else l.next_action_at<=v_now-interval'48 hours'end supervisor_exception
    from public.crm_leads l where l.team_id=v_profile.team_id and l.owner_id is not null
      and(l.owner_id=v_profile.id or public.can_act_for(l.team_id,l.owner_id)or public.has_permission(l.team_id,'customers.supervise'))
      and public.crm_can_access_region(l.team_id,l.region_id,l.owner_id)and l.next_action_at is not null
      and((l.next_action_kind='appointment'and l.next_action_at<=v_now+interval'24 hours')or(l.next_action_kind is distinct from'appointment'and(l.next_action_at at time zone'Asia/Shanghai')::date<=v_today))
    union all
    select 'lead_new:'||l.id::text,l.id,'lead','new_lead',70,'normal','新线索',l.title,'北京时间今天新增，尚未产生首次联系记录',l.created_at,'#/sales-v3?lead='||l.id::text,false
    from public.crm_leads l where l.team_id=v_profile.team_id and l.owner_id is not null and l.last_contact_attempt_at is null
      and(l.owner_id=v_profile.id or public.can_act_for(l.team_id,l.owner_id)or public.has_permission(l.team_id,'customers.supervise'))
      and public.crm_can_access_region(l.team_id,l.region_id,l.owner_id)and(l.created_at at time zone'Asia/Shanghai')::date=v_today
    union all
    select 'lead_recycle:'||l.id::text,l.id,'lead',case when(l.created_at at time zone'Asia/Shanghai')::date+2<=v_today then'recycle_48h'else'recycle_24h'end,
      case when(l.created_at at time zone'Asia/Shanghai')::date+2<=v_today then 15 else 40 end,
      case when(l.created_at at time zone'Asia/Shanghai')::date+2<=v_today then'critical'else'high'end,
      case when(l.created_at at time zone'Asia/Shanghai')::date+2<=v_today then'48小时回收风险'else'24小时未联系'end,l.title,
      case when(l.created_at at time zone'Asia/Shanghai')::date+2<=v_today then'北京时间自然日已达到48小时回收节点'else'北京时间自然日已达到24小时首次联系节点'end,
      ((((l.created_at at time zone'Asia/Shanghai')::date+case when(l.created_at at time zone'Asia/Shanghai')::date+2<=v_today then 2 else 1 end)::timestamp)at time zone'Asia/Shanghai'),'#/sales-v3?lead='||l.id::text,
      ((l.created_at at time zone'Asia/Shanghai')::date+4<=v_today)
    from public.crm_leads l where l.team_id=v_profile.team_id and l.owner_id is not null and l.last_contact_attempt_at is null
      and(l.owner_id=v_profile.id or public.can_act_for(l.team_id,l.owner_id)or public.has_permission(l.team_id,'customers.supervise'))
      and public.crm_can_access_region(l.team_id,l.region_id,l.owner_id)and(l.created_at at time zone'Asia/Shanghai')::date+1<=v_today
      and not public.crm_lead_recycle_paused(l.team_id,l.id,l.owner_id,v_now)
    union all
    select 'renewal:'||rm.id::text,rm.id,'renewal','renewal_'||rm.days_before,
      case rm.days_before when 15 then 18 when 30 then 20 else 22 end,case when rm.due_on<=v_today then'high'else'medium'end,
      rm.days_before||'天续费节点',s.name,'服务到期前'||rm.days_before||'天节点待处理',((rm.due_on::timestamp)at time zone'Asia/Shanghai'),'#/orders-v3?order='||o.id::text,rm.due_on<=v_today
    from public.fulfillment_renewal_milestones rm join public.fulfillment_deliveries d on d.id=rm.delivery_id and d.team_id=rm.team_id
      join public.deal_orders o on o.id=d.order_id and o.team_id=d.team_id join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id
      join public.crm_stores s on s.id=d.store_id and s.team_id=d.team_id
    where rm.team_id=v_profile.team_id and rm.status='pending'and rm.due_on<=v_today
      and(q.owner_id=v_profile.id or public.can_act_for(q.team_id,q.owner_id)or public.has_permission(q.team_id,'customers.supervise'))
      and public.crm_can_access_region(s.team_id,s.region_id,s.owner_id)
    union all
    select 'delivery:'||e.id::text,e.id,'delivery_exception',case when e.exception_type='stock_shortage'then'delivery_shortage'else'delivery_exception'end,
      case when e.exception_type='stock_shortage'then 5 else 25 end,case when e.exception_type='stock_shortage'then'critical'else'high'end,
      case when e.exception_type='stock_shortage'then'缺货异常'else'交付异常'end,s.name,e.details||case when e.expected_resolution_on is not null then'；预计解决：'||e.expected_resolution_on::text else''end,
      e.created_at,'#/orders-v3?order='||o.id::text,e.created_at<=v_now-interval'48 hours'
    from public.fulfillment_exceptions e join public.fulfillment_deliveries d on d.id=e.delivery_id and d.team_id=e.team_id
      join public.deal_orders o on o.id=d.order_id and o.team_id=d.team_id join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id
      join public.crm_stores s on s.id=d.store_id and s.team_id=d.team_id
    where e.team_id=v_profile.team_id and e.status='open'
      and(q.owner_id=v_profile.id or public.can_act_for(q.team_id,q.owner_id)or public.has_permission(q.team_id,'customers.supervise'))
      and public.crm_can_access_region(s.team_id,s.region_id,s.owner_id)
  )
  select coalesce(jsonb_agg(to_jsonb(a)order by a.priority,a.due_at,a.id),'[]'::jsonb)into v_result from actions a;
  return v_result;
end $$;

revoke all on function public.get_sales_today_action_queue()from public,anon;
grant execute on function public.get_sales_today_action_queue()to authenticated;
notify pgrst,'reload schema';
