-- Executable hardware inventory acceptance fixture. Run after all migrations.
-- All rows and RPC effects are isolated by the final rollback.
begin;
set local request.jwt.claim.sub='f8400000-0000-4000-8000-000000000001';

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('f8400000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hardware-fixture@example.invalid','',now(),'{}','{}',now(),now())on conflict(id)do nothing;
insert into public.profiles(id,team_id,name,role,status)
values('f8400000-0000-4000-8000-000000000001','CANWIN_TEAM','Hardware Fixture','warehouse','active')
on conflict(id)do update set status='active';
insert into public.profile_access_roles(team_id,profile_id,role_id)
select'CANWIN_TEAM','f8400000-0000-4000-8000-000000000001',id from public.access_roles
where team_id='CANWIN_TEAM'and code='warehouse'on conflict do nothing;
insert into public.feature_flags(team_id,key,enabled)values('CANWIN_TEAM','sales_os_v3',true)
on conflict(team_id,key)do update set enabled=true;

insert into public.sales_regions(id,team_id,code,name)values('f8400000-0000-4000-8000-000000000010','CANWIN_TEAM','hardware-fixture','Hardware Fixture Region')on conflict(id)do nothing;
insert into public.crm_brands(id,team_id,name,business_mode,owner_id,created_by)
values('f8400000-0000-4000-8000-000000000011','CANWIN_TEAM','Hardware Fixture Brand','independent','f8400000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000001');
insert into public.crm_stores(id,team_id,brand_id,region_id,name,business_type,owner_id,created_by)
values('f8400000-0000-4000-8000-000000000012','CANWIN_TEAM','f8400000-0000-4000-8000-000000000011','f8400000-0000-4000-8000-000000000010','Hardware Fixture Store','chinese','f8400000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000001');
insert into public.crm_opportunities(id,team_id,brand_id,store_id,region_id,owner_id,value_grade,annual_fee_viable,key_person_contacted,created_by)
values('f8400000-0000-4000-8000-000000000013','CANWIN_TEAM','f8400000-0000-4000-8000-000000000011','f8400000-0000-4000-8000-000000000012','f8400000-0000-4000-8000-000000000010','f8400000-0000-4000-8000-000000000001','C',true,true,'f8400000-0000-4000-8000-000000000001');

insert into public.deal_catalog_versions(id,team_id,version_no,status,created_by)
values('f8400000-0000-4000-8000-000000000020','CANWIN_TEAM',984000,'published','f8400000-0000-4000-8000-000000000001');
insert into public.deal_catalog_items(id,team_id,catalog_version_id,sku,name,item_type,customer_list_price,procurement_cost)values
('f8400000-0000-4000-8000-000000000021','CANWIN_TEAM','f8400000-0000-4000-8000-000000000020','HW-A','Hardware A','hardware',100,50),
('f8400000-0000-4000-8000-000000000022','CANWIN_TEAM','f8400000-0000-4000-8000-000000000020','HW-B','Hardware B','hardware',100,50),
('f8400000-0000-4000-8000-000000000023','CANWIN_TEAM','f8400000-0000-4000-8000-000000000020','HW-C','Hardware C Short','hardware',100,50),
('f8400000-0000-4000-8000-000000000024','CANWIN_TEAM','f8400000-0000-4000-8000-000000000020','HW-X','Hardware Extra','hardware',100,50);
insert into public.fulfillment_inventory_stock(id,team_id,catalog_item_id,quantity)values
('f8400000-0000-4000-8000-000000000031','CANWIN_TEAM','f8400000-0000-4000-8000-000000000021',10),
('f8400000-0000-4000-8000-000000000032','CANWIN_TEAM','f8400000-0000-4000-8000-000000000022',10),
('f8400000-0000-4000-8000-000000000033','CANWIN_TEAM','f8400000-0000-4000-8000-000000000023',1),
('f8400000-0000-4000-8000-000000000034','CANWIN_TEAM','f8400000-0000-4000-8000-000000000024',10);

-- Five isolated orders: normal multi-SKU, shortage, unpaid, later quote-state change, legacy bad reservation.
insert into public.deal_quotes(id,team_id,opportunity_id,owner_id,version_no,status,customer_total,internal_total,created_by)values
('f8400000-0000-4000-8000-000000000041','CANWIN_TEAM','f8400000-0000-4000-8000-000000000013','f8400000-0000-4000-8000-000000000001',1,'frozen',500,300,'f8400000-0000-4000-8000-000000000001'),
('f8400000-0000-4000-8000-000000000042','CANWIN_TEAM','f8400000-0000-4000-8000-000000000013','f8400000-0000-4000-8000-000000000001',2,'frozen',300,200,'f8400000-0000-4000-8000-000000000001'),
('f8400000-0000-4000-8000-000000000043','CANWIN_TEAM','f8400000-0000-4000-8000-000000000013','f8400000-0000-4000-8000-000000000001',3,'frozen',100,100,'f8400000-0000-4000-8000-000000000001'),
('f8400000-0000-4000-8000-000000000044','CANWIN_TEAM','f8400000-0000-4000-8000-000000000013','f8400000-0000-4000-8000-000000000001',4,'frozen',100,100,'f8400000-0000-4000-8000-000000000001'),
('f8400000-0000-4000-8000-000000000045','CANWIN_TEAM','f8400000-0000-4000-8000-000000000013','f8400000-0000-4000-8000-000000000001',5,'frozen',200,100,'f8400000-0000-4000-8000-000000000001');
insert into public.deal_quote_lines(team_id,quote_id,source_item_id,item_name_snapshot,sku_snapshot,item_type_snapshot,quantity,customer_unit_price,internal_unit_price)values
('CANWIN_TEAM','f8400000-0000-4000-8000-000000000041','f8400000-0000-4000-8000-000000000021','Hardware A','HW-A','hardware',2,100,55),
('CANWIN_TEAM','f8400000-0000-4000-8000-000000000041','f8400000-0000-4000-8000-000000000022','Hardware B','HW-B','hardware',3,100,55),
('CANWIN_TEAM','f8400000-0000-4000-8000-000000000042','f8400000-0000-4000-8000-000000000023','Hardware C Short','HW-C','hardware',3,100,55),
('CANWIN_TEAM','f8400000-0000-4000-8000-000000000043','f8400000-0000-4000-8000-000000000021','Hardware A','HW-A','hardware',1,100,55),
('CANWIN_TEAM','f8400000-0000-4000-8000-000000000044','f8400000-0000-4000-8000-000000000021','Hardware A','HW-A','hardware',1,100,55),
('CANWIN_TEAM','f8400000-0000-4000-8000-000000000045','f8400000-0000-4000-8000-000000000021','Hardware A','HW-A','hardware',2,100,55);
insert into public.deal_orders(id,team_id,quote_id,opportunity_id,customer_total,internal_due,internal_paid,status,fulfillment_allowed_at)values
('f8400000-0000-4000-8000-000000000051','CANWIN_TEAM','f8400000-0000-4000-8000-000000000041','f8400000-0000-4000-8000-000000000013',500,300,300,'internal_paid',now()),
('f8400000-0000-4000-8000-000000000052','CANWIN_TEAM','f8400000-0000-4000-8000-000000000042','f8400000-0000-4000-8000-000000000013',300,200,200,'internal_paid',now()),
('f8400000-0000-4000-8000-000000000053','CANWIN_TEAM','f8400000-0000-4000-8000-000000000043','f8400000-0000-4000-8000-000000000013',100,100,0,'deposit_confirmed',null),
('f8400000-0000-4000-8000-000000000054','CANWIN_TEAM','f8400000-0000-4000-8000-000000000044','f8400000-0000-4000-8000-000000000013',100,100,100,'internal_paid',now()),
('f8400000-0000-4000-8000-000000000055','CANWIN_TEAM','f8400000-0000-4000-8000-000000000045','f8400000-0000-4000-8000-000000000013',200,100,100,'internal_paid',now());
insert into public.fulfillment_deliveries(id,team_id,order_id,store_id,created_by)values
('f8400000-0000-4000-8000-000000000061','CANWIN_TEAM','f8400000-0000-4000-8000-000000000051','f8400000-0000-4000-8000-000000000012','f8400000-0000-4000-8000-000000000001'),
('f8400000-0000-4000-8000-000000000062','CANWIN_TEAM','f8400000-0000-4000-8000-000000000052','f8400000-0000-4000-8000-000000000012','f8400000-0000-4000-8000-000000000001'),
('f8400000-0000-4000-8000-000000000063','CANWIN_TEAM','f8400000-0000-4000-8000-000000000053','f8400000-0000-4000-8000-000000000012','f8400000-0000-4000-8000-000000000001'),
('f8400000-0000-4000-8000-000000000064','CANWIN_TEAM','f8400000-0000-4000-8000-000000000054','f8400000-0000-4000-8000-000000000012','f8400000-0000-4000-8000-000000000001'),
('f8400000-0000-4000-8000-000000000065','CANWIN_TEAM','f8400000-0000-4000-8000-000000000055','f8400000-0000-4000-8000-000000000012','f8400000-0000-4000-8000-000000000001');
insert into public.fulfillment_states(team_id,delivery_id)select'CANWIN_TEAM',id from public.fulfillment_deliveries where id between'f8400000-0000-4000-8000-000000000061'and'f8400000-0000-4000-8000-000000000065';
-- The order keeps quote_id as its hardware snapshot. Later quote display state
-- is not an inventory runtime gate.
update public.deal_quotes set status='submitted'where id='f8400000-0000-4000-8000-000000000044';

do $$declare blocked boolean;reservation_id uuid;begin
 -- expected_on is mandatory and cannot be historical.
 blocked:=false;begin perform public.reserve_delivery_stock('f8400000-0000-4000-8000-000000000061','f8400000-0000-4000-8000-000000000031',1,null);exception when others then blocked:=position('VALID_EXPECTED_ARRIVAL_REQUIRED'in sqlerrm)>0;end;if not blocked then raise exception'NULL expected_on accepted';end if;
 blocked:=false;begin perform public.reserve_delivery_stock('f8400000-0000-4000-8000-000000000061','f8400000-0000-4000-8000-000000000031',1,current_date-1);exception when others then blocked:=position('VALID_EXPECTED_ARRIVAL_REQUIRED'in sqlerrm)>0;end;if not blocked then raise exception'Past expected_on accepted';end if;
 -- Small partial allocations compose to the exact ordered quantity across multiple SKUs.
 perform public.reserve_delivery_stock('f8400000-0000-4000-8000-000000000061','f8400000-0000-4000-8000-000000000031',1,current_date+2);
 perform public.reserve_delivery_stock('f8400000-0000-4000-8000-000000000061','f8400000-0000-4000-8000-000000000031',1,current_date+2);
 perform public.reserve_delivery_stock('f8400000-0000-4000-8000-000000000061','f8400000-0000-4000-8000-000000000032',3,current_date+2);
 if(select sum(quantity)from public.fulfillment_inventory_reservations where delivery_id='f8400000-0000-4000-8000-000000000061'and status='reserved')<>5 then raise exception'Multi-SKU reservation total incorrect';end if;
 -- Ordered quantity cap and non-ordered SKU are fail-closed.
 blocked:=false;begin perform public.reserve_delivery_stock('f8400000-0000-4000-8000-000000000061','f8400000-0000-4000-8000-000000000031',1,current_date+2);exception when others then blocked:=position('ORDER_HARDWARE_QUANTITY_EXCEEDED'in sqlerrm)>0;end;if not blocked then raise exception'Over-allocation accepted';end if;
 blocked:=false;begin perform public.reserve_delivery_stock('f8400000-0000-4000-8000-000000000061','f8400000-0000-4000-8000-000000000034',1,current_date+2);exception when others then blocked:=position('HARDWARE_NOT_IN_ORDER'in sqlerrm)>0;end;if not blocked then raise exception'Extra SKU accepted';end if;
 -- Insufficient stock writes the requested expected date and shortage amount without reserving.
 if public.reserve_delivery_stock('f8400000-0000-4000-8000-000000000062','f8400000-0000-4000-8000-000000000033',3,current_date+7)is not null then raise exception'Shortage unexpectedly reserved';end if;
 if not exists(select 1 from public.fulfillment_exceptions where delivery_id='f8400000-0000-4000-8000-000000000062'and status='open'and expected_resolution_on=current_date+7 and shortage_quantity=2)then raise exception'Shortage expected_on/quantity missing';end if;
 -- Internal payment is a server gate.
 blocked:=false;begin perform public.reserve_delivery_stock('f8400000-0000-4000-8000-000000000063','f8400000-0000-4000-8000-000000000031',1,current_date+2);exception when others then blocked:=position('INTERNAL_PAYMENT_REQUIRED'in sqlerrm)>0;end;if not blocked then raise exception'Unpaid order reserved stock';end if;
 -- Later quote display state still uses the formal order's hardware snapshot.
 perform public.reserve_delivery_stock('f8400000-0000-4000-8000-000000000064','f8400000-0000-4000-8000-000000000031',1,current_date+2);
 if not exists(select 1 from public.fulfillment_inventory_reservations where delivery_id='f8400000-0000-4000-8000-000000000064'and stock_id='f8400000-0000-4000-8000-000000000031'and quantity=1 and status='reserved')then raise exception'Order snapshot changed with quote display state';end if;
 -- Missing delivery/formal-order identity cannot allocate inventory.
 blocked:=false;begin perform public.reserve_delivery_stock('f8400000-0000-4000-8000-000000000099','f8400000-0000-4000-8000-000000000031',1,current_date+2);exception when others then blocked:=position('STOCK_NOT_FOUND'in sqlerrm)>0 or position('FORMAL_ORDER_REQUIRED'in sqlerrm)>0;end;if not blocked then raise exception'Inventory allocated without formal order';end if;
 -- Ship the valid multi-SKU reservations and complete only after every ordered SKU is shipped.
 for reservation_id in select id from public.fulfillment_inventory_reservations where delivery_id='f8400000-0000-4000-8000-000000000061'and status='reserved'loop perform public.ship_delivery_stock(reservation_id);end loop;
 perform public.complete_delivery_hardware('f8400000-0000-4000-8000-000000000061');
 if(select hardware_status from public.fulfillment_states where delivery_id='f8400000-0000-4000-8000-000000000061')<>'completed'then raise exception'Valid multi-SKU delivery not completed';end if;
end$$;

-- A legacy shipped reservation for an extra SKU must not satisfy the ordered SKU.
insert into public.fulfillment_inventory_reservations(id,team_id,delivery_id,stock_id,quantity,status,created_by)
values('f8400000-0000-4000-8000-000000000071','CANWIN_TEAM','f8400000-0000-4000-8000-000000000065','f8400000-0000-4000-8000-000000000034',2,'shipped','f8400000-0000-4000-8000-000000000001');
do $$declare blocked boolean:=false;definition text;begin
 begin perform public.complete_delivery_hardware('f8400000-0000-4000-8000-000000000065');exception when others then blocked:=position('HARDWARE_ORDER_QUANTITY_MISMATCH'in sqlerrm)>0;end;
 if not blocked then raise exception'Legacy bad reservation satisfied quote';end if;
 -- Concurrency contract: reservation allocation is serialized by a stock row lock.
 definition:=lower(pg_get_functiondef('public.reserve_delivery_stock(uuid,uuid,numeric,date)'::regprocedure));
 if position('for update'in definition)=0 or position('allocated_quantity'in definition)=0 then raise exception'Reservation lock/allocation contract missing';end if;
 if not exists(select 1 from pg_constraint where conrelid='public.fulfillment_inventory_stock'::regclass and contype='u')then raise exception'One stock row per catalog SKU constraint missing';end if;
end$$;

select'hardware_inventory_behavior_ok'result;
rollback;
