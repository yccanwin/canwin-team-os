-- Inventory is enabled by a formal order. Its immutable deposit-frozen quote lines are the hardware snapshot.
create or replace function public.reserve_delivery_stock(p_delivery_id uuid,p_stock_id uuid,p_quantity numeric,p_expected_on date)
returns public.fulfillment_inventory_reservations language plpgsql security definer set search_path=''as$$
declare d public.fulfillment_deliveries;s public.fulfillment_inventory_stock;r public.profiles;o public.deal_orders;
 res public.fulfillment_inventory_reservations;available numeric;item_name text;required_quantity numeric;allocated_quantity numeric;
begin
 if p_quantity is null or p_quantity<=0 then raise exception'POSITIVE_QUANTITY_REQUIRED'using errcode='22023';end if;
 if p_expected_on is null or p_expected_on<current_date then raise exception'VALID_EXPECTED_ARRIVAL_REQUIRED'using errcode='22023';end if;
 select*into r from public.profiles where id=auth.uid()and status='active';
 select*into d from public.fulfillment_deliveries where id=p_delivery_id;
 select*into s from public.fulfillment_inventory_stock where id=p_stock_id for update;
 if d.id is null or s.id is null or r.id is null or d.team_id<>s.team_id or d.team_id<>r.team_id then raise exception'STOCK_NOT_FOUND'using errcode='P0002';end if;
 if not public.fulfillment_authorized(d.team_id,'inventory.manage')then raise exception'INVENTORY_FORBIDDEN'using errcode='42501';end if;
 select*into o from public.deal_orders where id=d.order_id and team_id=d.team_id for update;
 if o.id is null then raise exception'FORMAL_ORDER_REQUIRED'using errcode='23514';end if;
 if o.fulfillment_allowed_at is null or o.internal_paid<o.internal_due then raise exception'INTERNAL_PAYMENT_REQUIRED'using errcode='23514';end if;
 select coalesce(sum(ql.quantity),0)into required_quantity from public.deal_quote_lines ql
 where ql.team_id=o.team_id and ql.quote_id=o.quote_id and ql.item_type_snapshot='hardware'and ql.source_item_id=s.catalog_item_id;
 if required_quantity<=0 then raise exception'HARDWARE_NOT_IN_ORDER'using errcode='23514';end if;
 select coalesce(sum(x.quantity),0)into allocated_quantity from public.fulfillment_inventory_reservations x
 join public.fulfillment_inventory_stock st on st.id=x.stock_id and st.team_id=x.team_id
 where x.delivery_id=d.id and x.team_id=d.team_id and st.catalog_item_id=s.catalog_item_id and x.status in('reserved','shipped');
 if allocated_quantity+p_quantity>required_quantity then raise exception'ORDER_HARDWARE_QUANTITY_EXCEEDED'using errcode='23514';end if;
 available:=s.quantity-s.reserved_quantity;
 if available<p_quantity then
  select i.name into item_name from public.deal_catalog_items i where i.id=s.catalog_item_id and i.team_id=s.team_id;
  insert into public.fulfillment_exceptions(team_id,delivery_id,exception_type,details,expected_resolution_on,stock_id,shortage_quantity)
  values(d.team_id,d.id,'stock_shortage',coalesce(item_name,'硬件')||' 缺货',p_expected_on,s.id,p_quantity-available)
  on conflict(delivery_id,stock_id)where exception_type='stock_shortage'and status='open'and stock_id is not null
  do update set details=excluded.details,expected_resolution_on=excluded.expected_resolution_on,shortage_quantity=excluded.shortage_quantity;
  update public.fulfillment_states set hardware_status='shortage',updated_at=now()where delivery_id=d.id;return null;
 end if;
 update public.fulfillment_inventory_stock set reserved_quantity=reserved_quantity+p_quantity,updated_at=now()where id=s.id;
 insert into public.fulfillment_inventory_reservations(team_id,delivery_id,stock_id,quantity,created_by)
 values(d.team_id,d.id,s.id,p_quantity,r.id)returning*into res;
 insert into public.fulfillment_inventory_movements(team_id,stock_id,reservation_id,movement_type,quantity,actor_id)
 values(d.team_id,s.id,res.id,'reserve',p_quantity,r.id);
 update public.fulfillment_exceptions set status='resolved',resolved_at=now()where delivery_id=d.id and stock_id=s.id and exception_type='stock_shortage'and status='open';
 update public.fulfillment_states set hardware_status=case when exists(select 1 from public.fulfillment_exceptions e where e.delivery_id=d.id and e.exception_type='stock_shortage'and e.status='open')then'shortage'else'reserved'end,updated_at=now()where delivery_id=d.id;
 return res;
end$$;

create or replace function public.ship_delivery_stock(p_reservation_id uuid)
returns public.fulfillment_inventory_reservations language plpgsql security definer set search_path=''as$$
declare res public.fulfillment_inventory_reservations;s public.fulfillment_inventory_stock;r public.profiles;
 d public.fulfillment_deliveries;o public.deal_orders;required_quantity numeric;allocated_quantity numeric;anomaly text;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';
 select*into res from public.fulfillment_inventory_reservations where id=p_reservation_id for update;
 if res.id is null or r.id is null or res.team_id<>r.team_id or not public.fulfillment_authorized(res.team_id,'inventory.manage')then raise exception'RESERVATION_FORBIDDEN'using errcode='42501';end if;
 select*into s from public.fulfillment_inventory_stock where id=res.stock_id and team_id=res.team_id for update;
 select*into d from public.fulfillment_deliveries where id=res.delivery_id and team_id=res.team_id;
 select*into o from public.deal_orders where id=d.order_id and team_id=d.team_id for update;
 if s.id is null or d.id is null or o.id is null then raise exception'FORMAL_ORDER_REQUIRED'using errcode='23514';end if;
 if o.fulfillment_allowed_at is null or o.internal_paid<o.internal_due then raise exception'INTERNAL_PAYMENT_REQUIRED'using errcode='23514';end if;
 select coalesce(sum(ql.quantity),0)into required_quantity from public.deal_quote_lines ql
 where ql.team_id=o.team_id and ql.quote_id=o.quote_id and ql.item_type_snapshot='hardware'and ql.source_item_id=s.catalog_item_id;
 select coalesce(sum(x.quantity),0)into allocated_quantity from public.fulfillment_inventory_reservations x
 join public.fulfillment_inventory_stock st on st.id=x.stock_id and st.team_id=x.team_id
 where x.delivery_id=d.id and x.team_id=d.team_id and st.catalog_item_id=s.catalog_item_id and x.status in('reserved','shipped');
 if required_quantity<=0 then anomaly:='reservation SKU is not in order hardware snapshot';
 elsif allocated_quantity>required_quantity then anomaly:='reservation quantity exceeds order hardware demand';end if;
 if anomaly is not null then
  if not exists(select 1 from public.fulfillment_exceptions e where e.delivery_id=d.id and e.exception_type='other'and e.status='open'and e.details='invalid reservation '||res.id::text||': '||anomaly)then
   insert into public.fulfillment_exceptions(team_id,delivery_id,exception_type,details,stock_id)values(d.team_id,d.id,'other','invalid reservation '||res.id::text||': '||anomaly,s.id);end if;
  update public.fulfillment_states set hardware_status='shortage',updated_at=now()where delivery_id=d.id;return res;
 end if;
 if res.status='shipped'then return res;elsif res.status<>'reserved'then raise exception'RESERVATION_NOT_ACTIVE'using errcode='55000';end if;
 if s.quantity<res.quantity or s.reserved_quantity<res.quantity then raise exception'INVENTORY_INVARIANT_FAILED'using errcode='23514';end if;
 update public.fulfillment_inventory_stock set quantity=quantity-res.quantity,reserved_quantity=reserved_quantity-res.quantity,updated_at=now()where id=s.id;
 update public.fulfillment_inventory_reservations set status='shipped',updated_at=now()where id=res.id returning*into res;
 insert into public.fulfillment_inventory_movements(team_id,stock_id,reservation_id,movement_type,quantity,actor_id)values(res.team_id,s.id,res.id,'ship',res.quantity,r.id);
 update public.fulfillment_states set hardware_status=case when exists(select 1 from public.fulfillment_exceptions e where e.delivery_id=d.id and e.exception_type='stock_shortage'and e.status='open')then'shortage'when exists(select 1 from public.fulfillment_inventory_reservations x where x.delivery_id=d.id and x.status='reserved')then'reserved'else'shipped'end,updated_at=now()where delivery_id=d.id;
 return res;
end$$;

create or replace function public.complete_delivery_hardware(p_delivery_id uuid)
returns public.fulfillment_states language plpgsql security definer set search_path=''as$$
declare st public.fulfillment_states;r public.profiles;d public.fulfillment_deliveries;o public.deal_orders;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';
 select*into d from public.fulfillment_deliveries where id=p_delivery_id;
 select*into o from public.deal_orders where id=d.order_id and team_id=d.team_id for update;
 select*into st from public.fulfillment_states where delivery_id=p_delivery_id for update;
 if st.delivery_id is null or d.id is null or o.id is null or r.id is null or st.team_id<>r.team_id or not public.fulfillment_authorized(st.team_id,'inventory.manage')then raise exception'INVENTORY_FORBIDDEN'using errcode='42501';end if;
 if o.fulfillment_allowed_at is null or o.internal_paid<o.internal_due then raise exception'INTERNAL_PAYMENT_REQUIRED'using errcode='23514';end if;
 if exists(select 1 from public.fulfillment_exceptions e where e.delivery_id=d.id and e.exception_type='stock_shortage'and e.status='open')then raise exception'OPEN_STOCK_SHORTAGE'using errcode='23514';end if;
 if exists(select 1 from public.fulfillment_inventory_reservations x where x.delivery_id=d.id and x.status='reserved')then raise exception'HARDWARE_NOT_SHIPPED'using errcode='23514';end if;
 if exists(with required as(select ql.source_item_id sku,sum(ql.quantity)quantity from public.deal_quote_lines ql where ql.team_id=o.team_id and ql.quote_id=o.quote_id and ql.item_type_snapshot='hardware'group by ql.source_item_id),shipped as(select inv.catalog_item_id sku,sum(x.quantity)quantity from public.fulfillment_inventory_reservations x join public.fulfillment_inventory_stock inv on inv.id=x.stock_id and inv.team_id=x.team_id where x.delivery_id=d.id and x.team_id=d.team_id and x.status='shipped'group by inv.catalog_item_id)select 1 from required full join shipped using(sku)where required.sku is null or shipped.sku is null or required.quantity is distinct from shipped.quantity)then raise exception'HARDWARE_ORDER_QUANTITY_MISMATCH'using errcode='23514';end if;
 update public.fulfillment_states set hardware_status='completed',updated_at=now()where delivery_id=d.id returning*into st;return st;
end$$;

revoke all on function public.reserve_delivery_stock(uuid,uuid,numeric,date),public.ship_delivery_stock(uuid),public.complete_delivery_hardware(uuid)from public,anon;
grant execute on function public.reserve_delivery_stock(uuid,uuid,numeric,date),public.ship_delivery_stock(uuid),public.complete_delivery_hardware(uuid)to authenticated;
notify pgrst,'reload schema';
