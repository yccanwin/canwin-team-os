-- Disposable behavior fixture; all data is rolled back.
begin;
set local request.jwt.claim.sub='b4000000-0000-4000-8000-000000000001';
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('b4000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hardware-chain@example.invalid','',now(),'{}','{}',now(),now())on conflict(id)do nothing;
insert into public.profiles(id,team_id,name,role,status)values('b4000000-0000-4000-8000-000000000001','CANWIN_TEAM','Hardware Fixture','admin','active')on conflict(id)do update set status='active';
insert into public.profile_access_roles(team_id,profile_id,role_id)select'CANWIN_TEAM','b4000000-0000-4000-8000-000000000001',id from public.access_roles where team_id='CANWIN_TEAM'and code='admin'on conflict do nothing;
insert into public.feature_flags(team_id,key,enabled)values('CANWIN_TEAM','sales_os_v3',true)on conflict(team_id,key)do update set enabled=true;
insert into public.sales_regions(id,team_id,code,name)values('b4000000-0000-4000-8000-000000000002','CANWIN_TEAM','hw-fixture','Hardware Fixture')on conflict(id)do nothing;
insert into public.crm_brands(id,team_id,name,owner_id,created_by)values('b4000000-0000-4000-8000-000000000003','CANWIN_TEAM','Hardware Brand','b4000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001');
insert into public.crm_stores(id,team_id,brand_id,region_id,name,business_type,owner_id,created_by)values('b4000000-0000-4000-8000-000000000004','CANWIN_TEAM','b4000000-0000-4000-8000-000000000003','b4000000-0000-4000-8000-000000000002','Hardware Store','chinese','b4000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001');
insert into public.crm_opportunities(id,team_id,brand_id,store_id,region_id,owner_id,value_grade,annual_fee_viable,key_person_contacted,qualification_valid,created_by)
values('b4000000-0000-4000-8000-000000000005','CANWIN_TEAM','b4000000-0000-4000-8000-000000000003','b4000000-0000-4000-8000-000000000004','b4000000-0000-4000-8000-000000000002','b4000000-0000-4000-8000-000000000001','C',true,true,true,'b4000000-0000-4000-8000-000000000001');
insert into public.deal_catalog_versions(id,team_id,version_no,status,created_by)values('b4000000-0000-4000-8000-000000000006','CANWIN_TEAM',940001,'published','b4000000-0000-4000-8000-000000000001');
insert into public.deal_catalog_items(id,team_id,catalog_version_id,sku,name,item_type,customer_list_price,procurement_cost)values
('b4000000-0000-4000-8000-000000000007','CANWIN_TEAM','b4000000-0000-4000-8000-000000000006','HW-REQ','Required Hardware','hardware',100,50),
('b4000000-0000-4000-8000-000000000008','CANWIN_TEAM','b4000000-0000-4000-8000-000000000006','HW-BAD','Unrelated Hardware','hardware',100,50);
insert into public.deal_quotes(id,team_id,opportunity_id,owner_id,version_no,status,customer_total,internal_total,created_by)
values('b4000000-0000-4000-8000-000000000009','CANWIN_TEAM','b4000000-0000-4000-8000-000000000005','b4000000-0000-4000-8000-000000000001',1,'frozen',200,110,'b4000000-0000-4000-8000-000000000001');
insert into public.deal_quote_lines(team_id,quote_id,source_item_id,item_name_snapshot,item_type_snapshot,quantity,customer_unit_price,internal_unit_price)
values('CANWIN_TEAM','b4000000-0000-4000-8000-000000000009','b4000000-0000-4000-8000-000000000007','Required Hardware','hardware',2,100,55);
insert into public.deal_orders(id,team_id,quote_id,opportunity_id,customer_total,internal_due,internal_paid,status,fulfillment_allowed_at)
values('b4000000-0000-4000-8000-00000000000a','CANWIN_TEAM','b4000000-0000-4000-8000-000000000009','b4000000-0000-4000-8000-000000000005',200,110,110,'internal_paid',now());
-- A later display-state change must not detach the formal order from its frozen quote-line snapshot.
update public.deal_quotes set status='cancelled'where id='b4000000-0000-4000-8000-000000000009';
insert into public.fulfillment_deliveries(id,team_id,order_id,store_id,status,created_by)values('b4000000-0000-4000-8000-00000000000b','CANWIN_TEAM','b4000000-0000-4000-8000-00000000000a','b4000000-0000-4000-8000-000000000004','preparing','b4000000-0000-4000-8000-000000000001');
insert into public.fulfillment_states(team_id,delivery_id)values('CANWIN_TEAM','b4000000-0000-4000-8000-00000000000b');
insert into public.fulfillment_inventory_stock(id,team_id,catalog_item_id,quantity,reserved_quantity)values
('b4000000-0000-4000-8000-00000000000c','CANWIN_TEAM','b4000000-0000-4000-8000-000000000007',10,5),
('b4000000-0000-4000-8000-00000000000d','CANWIN_TEAM','b4000000-0000-4000-8000-000000000008',10,1);
insert into public.fulfillment_inventory_reservations(id,team_id,delivery_id,stock_id,quantity,status,created_by)values
('b4000000-0000-4000-8000-00000000000e','CANWIN_TEAM','b4000000-0000-4000-8000-00000000000b','b4000000-0000-4000-8000-00000000000d',1,'reserved','b4000000-0000-4000-8000-000000000001'),
('b4000000-0000-4000-8000-00000000000f','CANWIN_TEAM','b4000000-0000-4000-8000-00000000000b','b4000000-0000-4000-8000-00000000000c',3,'reserved','b4000000-0000-4000-8000-000000000001'),
('b4000000-0000-4000-8000-000000000010','CANWIN_TEAM','b4000000-0000-4000-8000-00000000000b','b4000000-0000-4000-8000-00000000000c',2,'reserved','b4000000-0000-4000-8000-000000000001');
select public.ship_delivery_stock('b4000000-0000-4000-8000-00000000000e');
select public.ship_delivery_stock('b4000000-0000-4000-8000-00000000000f');
do$$begin
 if exists(select 1 from public.fulfillment_inventory_reservations where id in('b4000000-0000-4000-8000-00000000000e','b4000000-0000-4000-8000-00000000000f')and status='shipped')then raise exception'Bad legacy reservation shipped';end if;
 if(select quantity from public.fulfillment_inventory_stock where id='b4000000-0000-4000-8000-00000000000d')<>10 then raise exception'Unrelated stock deducted';end if;
 if(select count(*)from public.fulfillment_exceptions where delivery_id='b4000000-0000-4000-8000-00000000000b'and exception_type='other'and status='open')<>2 then raise exception'Bad reservation anomaly missing';end if;
end$$;
update public.fulfillment_inventory_reservations set status='released'where id in('b4000000-0000-4000-8000-00000000000e','b4000000-0000-4000-8000-00000000000f');
update public.fulfillment_inventory_stock set reserved_quantity=2 where id='b4000000-0000-4000-8000-00000000000c';
select public.ship_delivery_stock('b4000000-0000-4000-8000-000000000010');
update public.fulfillment_inventory_reservations set status='shipped'where id='b4000000-0000-4000-8000-00000000000e';
do$$begin
 begin perform public.complete_delivery_hardware('b4000000-0000-4000-8000-00000000000b');raise exception'Extra SKU incorrectly completed';
 exception when sqlstate'23514'then if sqlerrm<>'HARDWARE_ORDER_QUANTITY_MISMATCH'then raise;end if;end;
end$$;
update public.fulfillment_inventory_reservations set status='released'where id='b4000000-0000-4000-8000-00000000000e';
select public.complete_delivery_hardware('b4000000-0000-4000-8000-00000000000b');
do$$begin if(select hardware_status from public.fulfillment_states where delivery_id='b4000000-0000-4000-8000-00000000000b')<>'completed'then raise exception'Exact shipped quantity did not complete';end if;end$$;
rollback;
