-- C5: formal-order-only inventory operations and independent software/hardware fulfillment.
-- Quotes, drafts and deposits have no inventory read/write path.

create table if not exists public.fulfillment_inventory_operations(
  id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),
  delivery_id uuid not null,stock_id uuid not null,operation_type text not null check(operation_type in('reserve')),
  quantity numeric(12,2)not null check(quantity>0),expected_on date,idempotency_key uuid not null,
  result_status text not null check(result_status in('reserved','shortage')),reservation_id uuid,
  created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
  unique(team_id,id),unique(team_id,idempotency_key),
  foreign key(team_id,delivery_id)references public.fulfillment_deliveries(team_id,id),
  foreign key(team_id,stock_id)references public.fulfillment_inventory_stock(team_id,id),
  foreign key(team_id,reservation_id)references public.fulfillment_inventory_reservations(team_id,id)
);
alter table public.fulfillment_inventory_operations enable row level security;
create policy "inventory operations server gate"on public.fulfillment_inventory_operations as restrictive for all to authenticated
using(public.is_feature_enabled(team_id,'sales_os_v3'))with check(public.is_feature_enabled(team_id,'sales_os_v3'));
revoke all on public.fulfillment_inventory_operations from public,anon,authenticated;

-- Inventory quantities are exposed to the browser only through the paid-order workspace RPC.
revoke select on public.fulfillment_inventory_stock,public.fulfillment_inventory_reservations,public.fulfillment_inventory_movements from authenticated;

create or replace function public.get_delivery_hardware_workspace(p_delivery_id uuid)returns jsonb
language plpgsql security definer stable set search_path=''as$$
declare v_profile public.profiles;v_delivery public.fulfillment_deliveries;v_order public.deal_orders;v_quote public.deal_quotes;v_can_manage boolean;
begin
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';
 select d.*into v_delivery from public.fulfillment_deliveries d where d.id=p_delivery_id;
 select o.*into v_order from public.deal_orders o where o.id=v_delivery.order_id and o.team_id=v_delivery.team_id;
 select q.*into v_quote from public.deal_quotes q where q.id=v_order.quote_id and q.team_id=v_order.team_id;
 if v_profile.id is null or v_delivery.id is null or v_order.id is null or v_quote.id is null or v_profile.team_id<>v_delivery.team_id or not public.is_feature_enabled(v_delivery.team_id,'sales_os_v3')then raise exception'DELIVERY_NOT_FOUND'using errcode='P0002';end if;
 if not(v_quote.owner_id=v_profile.id or public.can_act_for(v_delivery.team_id,v_quote.owner_id)or public.has_permission(v_delivery.team_id,'customers.supervise')or public.has_permission(v_delivery.team_id,'finance.read')or public.has_permission(v_delivery.team_id,'finance.manage')or public.fulfillment_authorized(v_delivery.team_id,'inventory.manage'))then raise exception'DELIVERY_FORBIDDEN'using errcode='42501';end if;
 v_can_manage:=public.fulfillment_authorized(v_delivery.team_id,'inventory.manage');
 if v_order.fulfillment_allowed_at is null or v_order.internal_paid<v_order.internal_due then
  return jsonb_build_object('can_manage',v_can_manage,'locked_reason','内部应付未结清，库存数据与操作均保持锁定','requirements','[]'::jsonb,'stocks','[]'::jsonb,'reservations','[]'::jsonb);
 end if;
 return jsonb_build_object(
  'can_manage',v_can_manage,'locked_reason',null,
  'requirements',coalesce((select jsonb_agg(jsonb_build_object('catalog_item_id',r.catalog_item_id,'name',r.name,'sku',r.sku,'required_quantity',r.required_quantity,'allocated_quantity',coalesce(a.allocated_quantity,0))order by r.name)from(
    select ql.source_item_id catalog_item_id,max(ql.item_name_snapshot)name,max(coalesce(ql.sku_snapshot,'-'))sku,sum(ql.quantity)required_quantity from public.deal_quote_lines ql where ql.team_id=v_order.team_id and ql.quote_id=v_order.quote_id and ql.item_type_snapshot='hardware'group by ql.source_item_id
  )r left join lateral(select sum(x.quantity)allocated_quantity from public.fulfillment_inventory_reservations x join public.fulfillment_inventory_stock st on st.id=x.stock_id and st.team_id=x.team_id where x.team_id=v_order.team_id and x.delivery_id=v_delivery.id and st.catalog_item_id=r.catalog_item_id and x.status in('reserved','shipped'))a on true),'[]'::jsonb),
  'stocks',case when v_can_manage then coalesce((select jsonb_agg(jsonb_build_object('id',st.id,'catalog_item_id',st.catalog_item_id,'name',i.name,'sku',i.sku,'quantity',st.quantity,'reserved_quantity',st.reserved_quantity,'available_quantity',st.quantity-st.reserved_quantity)order by i.name)from public.fulfillment_inventory_stock st join public.deal_catalog_items i on i.id=st.catalog_item_id and i.team_id=st.team_id where st.team_id=v_order.team_id and exists(select 1 from public.deal_quote_lines ql where ql.team_id=v_order.team_id and ql.quote_id=v_order.quote_id and ql.item_type_snapshot='hardware'and ql.source_item_id=st.catalog_item_id)),'[]'::jsonb)else'[]'::jsonb end,
  'reservations',case when v_can_manage then coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'stock_id',x.stock_id,'item_name',i.name,'quantity',x.quantity,'status',x.status)order by x.created_at desc)from public.fulfillment_inventory_reservations x join public.fulfillment_inventory_stock st on st.id=x.stock_id and st.team_id=x.team_id join public.deal_catalog_items i on i.id=st.catalog_item_id and i.team_id=st.team_id where x.team_id=v_order.team_id and x.delivery_id=v_delivery.id),'[]'::jsonb)else'[]'::jsonb end
 );
end$$;

create or replace function public.reserve_delivery_stock(p_delivery_id uuid,p_stock_id uuid,p_quantity numeric,p_expected_on date,p_idempotency_key uuid)
returns public.fulfillment_inventory_reservations language plpgsql security definer set search_path=''as$$
declare v_delivery public.fulfillment_deliveries;v_stock public.fulfillment_inventory_stock;v_profile public.profiles;v_order public.deal_orders;v_existing public.fulfillment_inventory_operations;v_reservation public.fulfillment_inventory_reservations;v_available numeric;v_name text;v_required numeric;v_allocated numeric;
begin
 if p_quantity is null or p_quantity<=0 or p_expected_on is null or p_expected_on<current_date or p_idempotency_key is null then raise exception'VALID_STOCK_REQUEST_REQUIRED'using errcode='22023';end if;
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';select d.*into v_delivery from public.fulfillment_deliveries d where d.id=p_delivery_id;select s.*into v_stock from public.fulfillment_inventory_stock s where s.id=p_stock_id for update;
 if v_delivery.id is null or v_stock.id is null or v_profile.id is null or v_delivery.team_id<>v_stock.team_id or v_delivery.team_id<>v_profile.team_id or not public.fulfillment_authorized(v_delivery.team_id,'inventory.manage')then raise exception'INVENTORY_FORBIDDEN'using errcode='42501';end if;
 select o.*into v_order from public.deal_orders o where o.id=v_delivery.order_id and o.team_id=v_delivery.team_id for update;
 if v_order.id is null then raise exception'FORMAL_ORDER_REQUIRED'using errcode='23514';end if;
 if v_order.fulfillment_allowed_at is null or v_order.internal_paid<v_order.internal_due then raise exception'INTERNAL_PAYMENT_REQUIRED'using errcode='23514';end if;
 select op.*into v_existing from public.fulfillment_inventory_operations op where op.team_id=v_order.team_id and op.idempotency_key=p_idempotency_key;
 if v_existing.id is not null then
  if v_existing.delivery_id is distinct from p_delivery_id or v_existing.stock_id is distinct from p_stock_id or v_existing.quantity is distinct from p_quantity or v_existing.expected_on is distinct from p_expected_on then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;
  if v_existing.reservation_id is not null then select x.*into v_reservation from public.fulfillment_inventory_reservations x where x.id=v_existing.reservation_id;end if;return v_reservation;
 end if;
 select coalesce(sum(ql.quantity),0)into v_required from public.deal_quote_lines ql where ql.team_id=v_order.team_id and ql.quote_id=v_order.quote_id and ql.item_type_snapshot='hardware'and ql.source_item_id=v_stock.catalog_item_id;
 if v_required<=0 then raise exception'HARDWARE_NOT_IN_ORDER'using errcode='23514';end if;
 select coalesce(sum(x.quantity),0)into v_allocated from public.fulfillment_inventory_reservations x join public.fulfillment_inventory_stock st on st.id=x.stock_id and st.team_id=x.team_id where x.delivery_id=v_delivery.id and x.team_id=v_delivery.team_id and st.catalog_item_id=v_stock.catalog_item_id and x.status in('reserved','shipped');
 if v_allocated+p_quantity>v_required then raise exception'ORDER_HARDWARE_QUANTITY_EXCEEDED'using errcode='23514';end if;
 v_available:=v_stock.quantity-v_stock.reserved_quantity;
 if v_available<p_quantity then
  select i.name into v_name from public.deal_catalog_items i where i.id=v_stock.catalog_item_id and i.team_id=v_stock.team_id;
  insert into public.fulfillment_exceptions(team_id,delivery_id,exception_type,details,expected_resolution_on,stock_id,shortage_quantity)values(v_delivery.team_id,v_delivery.id,'stock_shortage',coalesce(v_name,'硬件')||' 缺货',p_expected_on,v_stock.id,p_quantity-v_available)
  on conflict(delivery_id,stock_id)where exception_type='stock_shortage'and status='open'and stock_id is not null do update set details=excluded.details,expected_resolution_on=excluded.expected_resolution_on,shortage_quantity=excluded.shortage_quantity;
  update public.fulfillment_states set hardware_status='shortage',updated_at=now()where delivery_id=v_delivery.id;
  insert into public.fulfillment_inventory_operations(team_id,delivery_id,stock_id,operation_type,quantity,expected_on,idempotency_key,result_status,created_by)values(v_delivery.team_id,v_delivery.id,v_stock.id,'reserve',p_quantity,p_expected_on,p_idempotency_key,'shortage',v_profile.id);
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(v_delivery.team_id,v_profile.id,'fulfillment.stock_shortage','fulfillment_delivery',v_delivery.id,jsonb_build_object('available',v_available),jsonb_build_object('requested',p_quantity,'expected_on',p_expected_on));return null;
 end if;
 update public.fulfillment_inventory_stock set reserved_quantity=reserved_quantity+p_quantity,updated_at=now()where id=v_stock.id;
 insert into public.fulfillment_inventory_reservations(team_id,delivery_id,stock_id,quantity,created_by)values(v_delivery.team_id,v_delivery.id,v_stock.id,p_quantity,v_profile.id)returning*into v_reservation;
 insert into public.fulfillment_inventory_movements(team_id,stock_id,reservation_id,movement_type,quantity,actor_id)values(v_delivery.team_id,v_stock.id,v_reservation.id,'reserve',p_quantity,v_profile.id);
 insert into public.fulfillment_inventory_operations(team_id,delivery_id,stock_id,operation_type,quantity,expected_on,idempotency_key,result_status,reservation_id,created_by)values(v_delivery.team_id,v_delivery.id,v_stock.id,'reserve',p_quantity,p_expected_on,p_idempotency_key,'reserved',v_reservation.id,v_profile.id);
 update public.fulfillment_exceptions set status='resolved',resolved_at=now()where delivery_id=v_delivery.id and stock_id=v_stock.id and exception_type='stock_shortage'and status='open';
 update public.fulfillment_states set hardware_status=case when exists(select 1 from public.fulfillment_exceptions e where e.delivery_id=v_delivery.id and e.exception_type='stock_shortage'and e.status='open')then'shortage'else'reserved'end,updated_at=now()where delivery_id=v_delivery.id;
 return v_reservation;
end$$;

create or replace function public.create_order_delivery(p_order_id uuid,p_store_id uuid,p_service_expires_on date)
returns public.fulfillment_deliveries language plpgsql security definer set search_path=''as$$
declare v_order public.deal_orders;v_delivery public.fulfillment_deliveries;v_profile public.profiles;v_created boolean:=false;
begin
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';select o.*into v_order from public.deal_orders o where o.id=p_order_id for update;
 if v_order.id is null or v_profile.id is null or v_order.team_id<>v_profile.team_id then raise exception'ORDER_NOT_FOUND'using errcode='P0002';end if;
 if not(public.fulfillment_authorized(v_order.team_id,'implementation.manage')or public.has_permission(v_order.team_id,'customers.supervise'))then raise exception'DELIVERY_FORBIDDEN'using errcode='42501';end if;
 if v_order.fulfillment_allowed_at is null or v_order.internal_paid<v_order.internal_due then raise exception'INTERNAL_PAYMENT_REQUIRED'using errcode='23514';end if;
 if not exists(select 1 from public.crm_opportunities op where op.id=v_order.opportunity_id and op.team_id=v_order.team_id and op.store_id=p_store_id)then raise exception'ORDER_STORE_MISMATCH'using errcode='23514';end if;
 insert into public.fulfillment_deliveries(team_id,order_id,store_id,service_expires_on,created_by)values(v_order.team_id,v_order.id,p_store_id,p_service_expires_on,v_profile.id)on conflict(team_id,order_id,store_id)do nothing returning*into v_delivery;
 if v_delivery.id is null then select d.*into v_delivery from public.fulfillment_deliveries d where d.team_id=v_order.team_id and d.order_id=v_order.id and d.store_id=p_store_id;else v_created:=true;end if;
 insert into public.fulfillment_states(team_id,delivery_id)values(v_delivery.team_id,v_delivery.id)on conflict(delivery_id)do nothing;insert into public.fulfillment_implementation(team_id,delivery_id)values(v_delivery.team_id,v_delivery.id)on conflict(delivery_id)do nothing;
 if v_created then insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(v_order.team_id,v_profile.id,'fulfillment.delivery_created','fulfillment_delivery',v_delivery.id,'{}',jsonb_build_object('order_id',v_order.id));end if;return v_delivery;
end$$;

create or replace function public.set_delivery_software_active(p_delivery_id uuid)returns public.fulfillment_states
language plpgsql security definer set search_path=''as$$
declare v_state public.fulfillment_states;v_profile public.profiles;v_delivery public.fulfillment_deliveries;v_order public.deal_orders;v_before text;
begin
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';select s.*into v_state from public.fulfillment_states s where s.delivery_id=p_delivery_id for update;select d.*into v_delivery from public.fulfillment_deliveries d where d.id=v_state.delivery_id;select o.*into v_order from public.deal_orders o where o.id=v_delivery.order_id and o.team_id=v_delivery.team_id for update;
 if v_state.delivery_id is null or v_profile.id is null or v_state.team_id<>v_profile.team_id or not public.fulfillment_authorized(v_state.team_id,'implementation.manage')then raise exception'IMPLEMENTATION_FORBIDDEN'using errcode='42501';end if;
 if v_order.id is null or v_order.fulfillment_allowed_at is null or v_order.internal_paid<v_order.internal_due then raise exception'INTERNAL_PAYMENT_REQUIRED'using errcode='23514';end if;
 v_before:=v_state.software_status;if v_before='active'then return v_state;end if;
 update public.fulfillment_states set software_status='active',updated_at=now()where delivery_id=v_state.delivery_id returning*into v_state;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(v_state.team_id,v_profile.id,'fulfillment.software_activated','fulfillment_delivery',v_delivery.id,jsonb_build_object('software_status',v_before),jsonb_build_object('software_status','active'));return v_state;
end$$;

create or replace function public.audit_fulfillment_hardware_state()returns trigger
language plpgsql security definer set search_path=''as$$
begin
 if old.hardware_status is distinct from new.hardware_status then
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
  values(new.team_id,auth.uid(),'fulfillment.hardware_status_changed','fulfillment_delivery',new.delivery_id,
   jsonb_build_object('hardware_status',old.hardware_status),jsonb_build_object('hardware_status',new.hardware_status));
 end if;
 return new;
end$$;
drop trigger if exists fulfillment_hardware_state_audit on public.fulfillment_states;
create trigger fulfillment_hardware_state_audit after update of hardware_status on public.fulfillment_states
for each row execute function public.audit_fulfillment_hardware_state();

revoke all on function public.get_delivery_hardware_workspace(uuid),public.reserve_delivery_stock(uuid,uuid,numeric,date,uuid),public.create_order_delivery(uuid,uuid,date),public.set_delivery_software_active(uuid)from public,anon;
grant execute on function public.get_delivery_hardware_workspace(uuid),public.reserve_delivery_stock(uuid,uuid,numeric,date,uuid),public.create_order_delivery(uuid,uuid,date),public.set_delivery_software_active(uuid)to authenticated;
revoke execute on function public.reserve_delivery_stock(uuid,uuid,numeric,date)from authenticated;
revoke all on function public.audit_fulfillment_hardware_state()from public,anon,authenticated;
notify pgrst,'reload schema';
