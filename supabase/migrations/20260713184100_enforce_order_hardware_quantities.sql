-- Bind inventory reservations and completion to frozen quote hardware SKUs.
create or replace function public.reserve_delivery_stock(p_delivery_id uuid,p_stock_id uuid,p_quantity numeric,p_expected_on date default null)
returns public.fulfillment_inventory_reservations language plpgsql security definer set search_path='' as $$
declare d public.fulfillment_deliveries;s public.fulfillment_inventory_stock;r public.profiles;res public.fulfillment_inventory_reservations;available numeric;item_name text;required_quantity numeric;allocated_quantity numeric;
begin
 if p_quantity is null or p_quantity<=0 then raise exception'POSITIVE_QUANTITY_REQUIRED'using errcode='22023';end if;
 if p_expected_on is null or p_expected_on<current_date then raise exception'VALID_EXPECTED_ARRIVAL_REQUIRED'using errcode='22023';end if;
 select*into r from public.profiles where id=auth.uid()and status='active';select*into d from public.fulfillment_deliveries where id=p_delivery_id;select*into s from public.fulfillment_inventory_stock where id=p_stock_id for update;
 if d.id is null or s.id is null or r.id is null or d.team_id<>s.team_id or d.team_id<>r.team_id then raise exception'STOCK_NOT_FOUND'using errcode='P0002';end if;
 if not public.fulfillment_authorized(d.team_id,'inventory.manage')then raise exception'INVENTORY_FORBIDDEN'using errcode='42501';end if;
 if not exists(select 1 from public.deal_orders o where o.id=d.order_id and o.team_id=d.team_id and o.fulfillment_allowed_at is not null and o.internal_paid>=o.internal_due)then raise exception'INTERNAL_PAYMENT_REQUIRED'using errcode='23514';end if;
 select coalesce(sum(ql.quantity),0)into required_quantity from public.deal_orders o join public.deal_quote_lines ql on ql.quote_id=o.quote_id and ql.team_id=o.team_id where o.id=d.order_id and o.team_id=d.team_id and ql.item_type_snapshot='hardware'and ql.source_item_id=s.catalog_item_id;
 if required_quantity<=0 then raise exception'HARDWARE_NOT_IN_FROZEN_QUOTE'using errcode='23514';end if;
 select coalesce(sum(x.quantity),0)into allocated_quantity from public.fulfillment_inventory_reservations x where x.delivery_id=d.id and x.stock_id=s.id and x.status in('reserved','shipped');
 if allocated_quantity+p_quantity>required_quantity then raise exception'ORDER_HARDWARE_QUANTITY_EXCEEDED'using errcode='23514';end if;
 available:=s.quantity-s.reserved_quantity;
 if available<p_quantity then
  select i.name into item_name from public.deal_catalog_items i where i.id=s.catalog_item_id and i.team_id=s.team_id;
  insert into public.fulfillment_exceptions(team_id,delivery_id,exception_type,details,expected_resolution_on,stock_id,shortage_quantity)values(d.team_id,d.id,'stock_shortage',coalesce(item_name,'硬件')||' 缺货',p_expected_on,s.id,p_quantity-available)
  on conflict(delivery_id,stock_id)where exception_type='stock_shortage'and status='open'and stock_id is not null do update set details=excluded.details,expected_resolution_on=excluded.expected_resolution_on,shortage_quantity=excluded.shortage_quantity;
  update public.fulfillment_states set hardware_status='shortage',updated_at=now()where delivery_id=d.id;return null;
 end if;
 update public.fulfillment_inventory_stock set reserved_quantity=reserved_quantity+p_quantity,updated_at=now()where id=s.id;
 insert into public.fulfillment_inventory_reservations(team_id,delivery_id,stock_id,quantity,created_by)values(d.team_id,d.id,s.id,p_quantity,r.id)returning*into res;
 insert into public.fulfillment_inventory_movements(team_id,stock_id,reservation_id,movement_type,quantity,actor_id)values(d.team_id,s.id,res.id,'reserve',p_quantity,r.id);
 update public.fulfillment_exceptions set status='resolved',resolved_at=now()where delivery_id=d.id and stock_id=s.id and exception_type='stock_shortage'and status='open';
 update public.fulfillment_states set hardware_status=case when exists(select 1 from public.fulfillment_exceptions e where e.delivery_id=d.id and e.exception_type='stock_shortage'and e.status='open')then'shortage'else'reserved'end,updated_at=now()where delivery_id=d.id;return res;
 end $$;

create or replace function public.complete_delivery_hardware(p_delivery_id uuid)returns public.fulfillment_states language plpgsql security definer set search_path='' as $$
declare s public.fulfillment_states;r public.profiles;d public.fulfillment_deliveries;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';select*into s from public.fulfillment_states where delivery_id=p_delivery_id for update;select*into d from public.fulfillment_deliveries where id=p_delivery_id;
 if s.delivery_id is null or d.id is null or r.id is null or s.team_id<>r.team_id or not public.fulfillment_authorized(s.team_id,'inventory.manage')then raise exception'INVENTORY_FORBIDDEN'using errcode='42501';end if;
 if not exists(select 1 from public.deal_orders o where o.id=d.order_id and o.team_id=d.team_id and o.fulfillment_allowed_at is not null and o.internal_paid>=o.internal_due)then raise exception'INTERNAL_PAYMENT_REQUIRED'using errcode='23514';end if;
 if exists(select 1 from public.fulfillment_exceptions e where e.delivery_id=d.id and e.exception_type='stock_shortage'and e.status='open')then raise exception'OPEN_STOCK_SHORTAGE'using errcode='23514';end if;
 if exists(select 1 from public.fulfillment_inventory_reservations x where x.delivery_id=d.id and x.status='reserved')then raise exception'HARDWARE_NOT_SHIPPED'using errcode='23514';end if;
 if exists(select ql.source_item_id from public.deal_orders o join public.deal_quote_lines ql on ql.quote_id=o.quote_id and ql.team_id=o.team_id where o.id=d.order_id and o.team_id=d.team_id and ql.item_type_snapshot='hardware'group by ql.source_item_id having ql.source_item_id is null or coalesce((select sum(x.quantity)from public.fulfillment_inventory_reservations x join public.fulfillment_inventory_stock st on st.id=x.stock_id and st.team_id=x.team_id where x.delivery_id=d.id and x.status='shipped'and st.catalog_item_id=ql.source_item_id),0)<sum(ql.quantity))then raise exception'HARDWARE_QUOTE_QUANTITY_NOT_SHIPPED'using errcode='23514';end if;
 update public.fulfillment_states set hardware_status='completed',updated_at=now()where delivery_id=d.id returning*into s;return s;
 end $$;
revoke all on function public.reserve_delivery_stock(uuid,uuid,numeric,date),public.complete_delivery_hardware(uuid)from public;
grant execute on function public.reserve_delivery_stock(uuid,uuid,numeric,date),public.complete_delivery_hardware(uuid)to authenticated;
notify pgrst,'reload schema';
