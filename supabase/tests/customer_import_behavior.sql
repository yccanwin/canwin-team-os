-- Executable rollback fixture. Run after all migrations; every fixture row is rolled back.
begin;
set local request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000','authenticated','authenticated','import-fixture@example.invalid','',now(),'{}','{}',now(),now())on conflict(id)do nothing;
insert into public.profiles(id,team_id,name,role,status)values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CANWIN_TEAM','Import Fixture','admin','active')on conflict(id)do update set status='active';
insert into public.profile_access_roles(team_id,profile_id,role_id)select'CANWIN_TEAM','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',id from public.access_roles where team_id='CANWIN_TEAM'and code='admin'on conflict do nothing;
insert into public.feature_flags(team_id,key,enabled)values('CANWIN_TEAM','sales_os_v3',true)on conflict(team_id,key)do update set enabled=true;
insert into public.sales_regions(id,team_id,code,name)values('10000000-0000-4000-8000-000000000001','CANWIN_TEAM','fixture','Fixture Region')on conflict(id)do nothing;
insert into public.deal_catalog_versions(id,team_id,version_no,status,created_by)values('20000000-0000-4000-8000-000000000001','CANWIN_TEAM',999999,'published','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')on conflict(team_id,version_no)do nothing;
insert into public.deal_catalog_items(id,team_id,catalog_version_id,sku,name,item_type,customer_list_price,procurement_cost)values('20000000-0000-4000-8000-000000000002','CANWIN_TEAM','20000000-0000-4000-8000-000000000001','fixture-import','Fixture Product','software',1,1)on conflict(id)do nothing;

-- One committed batch and one row are sufficient to drive all rollback branches.
insert into public.import_batches(id,team_id,source_name,status,row_count,created_by,committed_at)values('30000000-0000-4000-8000-000000000001','CANWIN_TEAM','behavior-fixture','committed',1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now());
insert into public.import_rows(id,team_id,batch_id,row_number,raw_data,result_status)values('30000000-0000-4000-8000-000000000002','CANWIN_TEAM','30000000-0000-4000-8000-000000000001',1,'{}','created');

-- Legacy NULL image must fail closed and preserve the entity.
insert into public.crm_brands(id,team_id,name,business_mode,owner_id,created_by)values('40000000-0000-4000-8000-000000000001','CANWIN_TEAM','Legacy Brand','independent','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.import_created_entities(team_id,batch_id,row_id,entity_type,entity_id)values('CANWIN_TEAM','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','brand','40000000-0000-4000-8000-000000000001');
update public.import_created_entities set after_data=null where entity_id='40000000-0000-4000-8000-000000000001';

-- Four created entity kinds changed after capture must all survive as conflicts.
insert into public.crm_brands(id,team_id,name,business_mode,owner_id,created_by)values('41000000-0000-4000-8000-000000000001','CANWIN_TEAM','Changed Brand','independent','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.crm_stores(id,team_id,brand_id,region_id,name,business_type,owner_id,created_by)values('41000000-0000-4000-8000-000000000002','CANWIN_TEAM','41000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Changed Store','chinese','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.crm_contacts(id,team_id,brand_id,store_id,name,owner_id,created_by)values('41000000-0000-4000-8000-000000000003','CANWIN_TEAM','41000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002','Changed Contact','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.customer_product_subscriptions(id,team_id,store_id,catalog_item_id,owner_id,expires_on)values('41000000-0000-4000-8000-000000000004','CANWIN_TEAM','41000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',current_date+30);
insert into public.import_created_entities(team_id,batch_id,row_id,entity_type,entity_id)values
('CANWIN_TEAM','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','brand','41000000-0000-4000-8000-000000000001'),
('CANWIN_TEAM','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','store','41000000-0000-4000-8000-000000000002'),
('CANWIN_TEAM','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','contact','41000000-0000-4000-8000-000000000003'),
('CANWIN_TEAM','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','subscription','41000000-0000-4000-8000-000000000004');
update public.crm_brands set name='Changed Brand Later'where id='41000000-0000-4000-8000-000000000001';
update public.crm_stores set name='Changed Store Later'where id='41000000-0000-4000-8000-000000000002';
update public.crm_contacts set name='Changed Contact Later'where id='41000000-0000-4000-8000-000000000003';
update public.customer_product_subscriptions set expires_on=expires_on+1 where id='41000000-0000-4000-8000-000000000004';

-- Unchanged entity is safe to delete.
insert into public.crm_brands(id,team_id,name,business_mode,owner_id,created_by)values('42000000-0000-4000-8000-000000000001','CANWIN_TEAM','Unchanged Brand','independent','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.import_created_entities(team_id,batch_id,row_id,entity_type,entity_id)values('CANWIN_TEAM','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','brand','42000000-0000-4000-8000-000000000001');

-- Unchanged store with a later lead reference must survive.
insert into public.crm_brands(id,team_id,name,business_mode,owner_id,created_by)values('43000000-0000-4000-8000-000000000001','CANWIN_TEAM','Reference Parent','independent','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.crm_stores(id,team_id,brand_id,region_id,name,business_type,owner_id,created_by)values('43000000-0000-4000-8000-000000000002','CANWIN_TEAM','43000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Referenced Store','chinese','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.import_created_entities(team_id,batch_id,row_id,entity_type,entity_id)values('CANWIN_TEAM','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','store','43000000-0000-4000-8000-000000000002');
insert into public.crm_leads(team_id,region_id,brand_id,store_id,title,status,owner_id,claimed_at,created_by)values('CANWIN_TEAM','10000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000002','Later reference','claimed','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

select public.rollback_customer_import('30000000-0000-4000-8000-000000000001');
do$$begin
 if not exists(select 1 from public.crm_brands where id='40000000-0000-4000-8000-000000000001')then raise exception'legacy NULL image was deleted';end if;
 if(select count(*)from public.import_rollback_conflicts where batch_id='30000000-0000-4000-8000-000000000001'and entity_id in('41000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000004'))<>4 then raise exception'four changed entities not preserved as conflicts';end if;
 if exists(select 1 from public.crm_brands where id='42000000-0000-4000-8000-000000000001')then raise exception'unchanged entity not deleted';end if;
 if not exists(select 1 from public.crm_stores where id='43000000-0000-4000-8000-000000000002')then raise exception'later-referenced store was deleted';end if;
 if(select status from public.import_batches where id='30000000-0000-4000-8000-000000000001')<>'rollback_conflict'then raise exception'batch status incorrect';end if;
 if not exists(select 1 from public.audit_logs where target_id='30000000-0000-4000-8000-000000000001'and action='import.batch_rollback_conflict')then raise exception'rollback audit missing';end if;
 if to_regclass('public.import_update_snapshots')is null or to_regprocedure('public.capture_import_created_entity_image()')is null then raise exception'150000 to 170000 upgrade objects missing';end if;
end$$;
select'customer_import_behavior_ok'result;
rollback;
