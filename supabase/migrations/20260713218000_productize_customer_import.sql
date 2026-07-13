-- B7 productises the existing staged customer import. No external collection.
-- Only administrators with customers.import may stage, precheck or commit files.

insert into public.access_permissions(code,name,description)values
 ('customers.import','Import customer archive','Stage, validate and commit customer Excel/CSV files')
on conflict(code)do update set name=excluded.name,description=excluded.description;
insert into public.access_role_permissions(role_id,permission_code)
select ar.id,'customers.import'from public.access_roles ar where ar.code='admin'
on conflict do nothing;

alter table public.import_batches
 add column if not exists idempotency_key uuid,
 add column if not exists source_hash text,
 add column if not exists template_version text not null default'customer-v1';
create unique index if not exists import_batches_idempotency_idx
 on public.import_batches(team_id,idempotency_key)where idempotency_key is not null;

create or replace function public.stage_customer_import_batch(
 p_source_name text,p_rows jsonb,p_idempotency_key uuid,p_template_version text default'customer-v1'
)returns uuid language plpgsql security definer set search_path='' as $stage$
declare actor public.profiles;batch public.import_batches;item jsonb;n integer;i integer:=0;payload_hash text;
begin
 select*into actor from public.profiles where id=auth.uid()and status='active';
 if actor.id is null or not public.has_permission(actor.team_id,'customers.import')or not public.is_feature_enabled(actor.team_id,'sales_os_v3')then raise exception'IMPORT_ADMIN_REQUIRED'using errcode='42501';end if;
 if p_idempotency_key is null or jsonb_typeof(p_rows)<>'array'then raise exception'VALID_IMPORT_REQUEST_REQUIRED'using errcode='22023';end if;
 n:=jsonb_array_length(p_rows);if n<1 or n>500 then raise exception'ROW_COUNT_1_TO_500_REQUIRED'using errcode='22023';end if;
 payload_hash:=pg_catalog.md5(p_rows::text||coalesce(p_source_name,'')||coalesce(p_template_version,''));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.team_id,719));
 select*into batch from public.import_batches where team_id=actor.team_id and idempotency_key=p_idempotency_key;
 if batch.id is not null then
  if batch.source_hash is distinct from payload_hash then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;
  return batch.id;
 end if;
 insert into public.import_batches(team_id,source_name,row_count,created_by,idempotency_key,source_hash,template_version)
 values(actor.team_id,coalesce(nullif(trim(p_source_name),''),'customer-import'),n,actor.id,p_idempotency_key,payload_hash,coalesce(nullif(trim(p_template_version),''),'customer-v1'))returning*into batch;
 for item in select*from jsonb_array_elements(p_rows)loop
  i:=i+1;
  if jsonb_typeof(item)<>'object'then raise exception'ROW_OBJECT_REQUIRED_AT_%',i using errcode='22023';end if;
  insert into public.import_rows(team_id,batch_id,row_number,raw_data)values(actor.team_id,batch.id,i,item);
 end loop;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)
 values(actor.team_id,actor.id,'import.batch_staged','import_batch',batch.id,jsonb_build_object('rows',n,'sourceName',batch.source_name,'templateVersion',batch.template_version));
 return batch.id;
end$stage$;

create or replace function public.precheck_customer_import(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $precheck$
declare actor public.profiles;batch public.import_batches;row_item public.import_rows;errors jsonb;normalized jsonb;
 region_id uuid;owner_id uuid;catalog_item_id uuid;brand_id uuid;existing_store_id uuid;existing_store_brand_id uuid;
 phone_contact_id uuid;phone_store_id uuid;phone_contact_name text;owner_matches integer;phone_normalized text;report jsonb;blockers integer;
begin
 select*into actor from public.profiles where id=auth.uid()and status='active';select*into batch from public.import_batches where id=p_batch_id for update;
 if batch.id is null or actor.id is null or batch.team_id<>actor.team_id then raise exception'BATCH_NOT_FOUND'using errcode='P0002';end if;
 if not public.has_permission(actor.team_id,'customers.import')or not public.is_feature_enabled(actor.team_id,'sales_os_v3')then raise exception'IMPORT_ADMIN_REQUIRED'using errcode='42501';end if;
 if batch.status in('committed','committed_with_errors','rolled_back','rollback_conflict')then return batch.dry_run_report;end if;
 for row_item in select*from public.import_rows where batch_id=batch.id order by row_number loop
  errors:='[]'::jsonb;region_id:=null;owner_id:=null;catalog_item_id:=null;brand_id:=null;existing_store_id:=null;existing_store_brand_id:=null;phone_contact_id:=null;phone_store_id:=null;owner_matches:=0;
  phone_normalized:=pg_catalog.regexp_replace(coalesce(row_item.raw_data->>'contact_phone',''),'[^0-9]','','g');
  if nullif(trim(row_item.raw_data->>'brand_name'),'')is null then errors:=errors||jsonb_build_array(jsonb_build_object('field','brand_name','code','brand_name_required','message','品牌名称必填'));end if;
  if nullif(trim(row_item.raw_data->>'store_name'),'')is null then errors:=errors||jsonb_build_array(jsonb_build_object('field','store_name','code','store_name_required','message','门店名称必填'));end if;
  if nullif(trim(row_item.raw_data->>'region_code'),'')is null then errors:=errors||jsonb_build_array(jsonb_build_object('field','region_code','code','region_code_required','message','区域编码必填'));else select sr.id into region_id from public.sales_regions sr where sr.team_id=batch.team_id and sr.code=trim(row_item.raw_data->>'region_code')and sr.is_active;if region_id is null then errors:=errors||jsonb_build_array(jsonb_build_object('field','region_code','code','region_not_found','message','区域编码不存在或已停用'));end if;end if;
  if coalesce(row_item.raw_data->>'owner_profile_id','')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'then
   select p.id into owner_id from public.profiles p where p.id=(row_item.raw_data->>'owner_profile_id')::uuid and p.team_id=batch.team_id and p.status='active';
  elsif nullif(trim(row_item.raw_data->>'owner_name'),'')is not null then
   select count(*),(array_agg(p.id order by p.id))[1]into owner_matches,owner_id from public.profiles p where p.team_id=batch.team_id and p.status='active'and lower(trim(p.name))=lower(trim(row_item.raw_data->>'owner_name'));
   if owner_matches>1 then owner_id:=null;errors:=errors||jsonb_build_array(jsonb_build_object('field','owner_name','code','owner_name_ambiguous','message','负责人姓名重复，请改用负责人ID'));end if;
  end if;
  if owner_id is null or not exists(select 1 from public.profile_access_roles par join public.access_roles ar on ar.id=par.role_id and ar.team_id=par.team_id where par.team_id=batch.team_id and par.profile_id=owner_id and ar.code in('sales','supervisor','admin','owner'))then errors:=errors||jsonb_build_array(jsonb_build_object('field','owner_name','code','active_sales_owner_required','message','负责人不存在、已停用或无销售角色'));end if;
  select ci.id into catalog_item_id from public.deal_catalog_items ci join public.deal_catalog_versions cv on cv.id=ci.catalog_version_id and cv.team_id=ci.team_id where ci.team_id=batch.team_id and ci.sku=trim(row_item.raw_data->>'current_product_sku')and ci.is_active and cv.status='published'order by cv.version_no desc limit 1;
  if catalog_item_id is null then errors:=errors||jsonb_build_array(jsonb_build_object('field','current_product_sku','code','published_sku_required','message','SKU不存在、已停用或未发布'));end if;
  if coalesce(row_item.raw_data->>'expires_on','')!~'^\d{4}-\d{2}-\d{2}$'then errors:=errors||jsonb_build_array(jsonb_build_object('field','expires_on','code','valid_expires_on_required','message','到期日必须为YYYY-MM-DD'));else begin perform(row_item.raw_data->>'expires_on')::date;exception when others then errors:=errors||jsonb_build_array(jsonb_build_object('field','expires_on','code','valid_expires_on_required','message','到期日不是有效日期'));end;end if;
  if nullif(row_item.raw_data->>'business_type','')is not null and(row_item.raw_data->>'business_type')not in('fast_food','chinese','hotpot','barbecue','beverage','bakery','banquet','international')then errors:=errors||jsonb_build_array(jsonb_build_object('field','business_type','code','business_type_invalid','message','业态编码不在标准字典中'));end if;
  if nullif(trim(row_item.raw_data->>'contact_phone'),'')is not null and(char_length(phone_normalized)<6 or char_length(phone_normalized)>20)then errors:=errors||jsonb_build_array(jsonb_build_object('field','contact_phone','code','phone_invalid','message','联系电话格式不正确'));end if;
  if nullif(trim(row_item.raw_data->>'contact_phone'),'')is not null and nullif(trim(row_item.raw_data->>'contact_name'),'')is null then errors:=errors||jsonb_build_array(jsonb_build_object('field','contact_name','code','contact_name_required_for_phone','message','填写电话时联系人姓名必填'));end if;
  if nullif(trim(row_item.raw_data->>'brand_name'),'')is not null then select b.id into brand_id from public.crm_brands b where b.team_id=batch.team_id and b.normalized_name=lower(trim(row_item.raw_data->>'brand_name'));end if;
  if region_id is not null and nullif(trim(row_item.raw_data->>'store_name'),'')is not null then select s.id,s.brand_id into existing_store_id,existing_store_brand_id from public.crm_stores s where s.team_id=batch.team_id and s.region_id=region_id and s.normalized_name=lower(trim(row_item.raw_data->>'store_name'));end if;
  if existing_store_id is not null and brand_id is not null and existing_store_brand_id is distinct from brand_id then errors:=errors||jsonb_build_array(jsonb_build_object('field','brand_name','code','store_brand_conflict','message','现有门店归属其他品牌'));end if;
  if phone_normalized<>''then
   select c.id,c.store_id,c.name into phone_contact_id,phone_store_id,phone_contact_name from public.crm_contact_private cp join public.crm_contacts c on c.id=cp.contact_id and c.team_id=cp.team_id where cp.team_id=batch.team_id and pg_catalog.regexp_replace(coalesce(cp.phone,''),'[^0-9]','','g')=phone_normalized limit 1;
   if phone_contact_id is not null and(existing_store_id is null or phone_store_id is distinct from existing_store_id or lower(trim(phone_contact_name))is distinct from lower(trim(row_item.raw_data->>'contact_name')))then errors:=errors||jsonb_build_array(jsonb_build_object('field','contact_phone','code','phone_already_used','message','电话已属于其他客户联系人'));end if;
   if exists(select 1 from public.import_rows prior where prior.batch_id=batch.id and prior.row_number<row_item.row_number and pg_catalog.regexp_replace(coalesce(prior.raw_data->>'contact_phone',''),'[^0-9]','','g')=phone_normalized)then errors:=errors||jsonb_build_array(jsonb_build_object('field','contact_phone','code','duplicate_phone_in_file','message','文件内联系电话重复'));end if;
  end if;
  if region_id is not null and exists(select 1 from public.import_rows prior where prior.batch_id=batch.id and prior.row_number<row_item.row_number and lower(trim(prior.raw_data->>'store_name'))=lower(trim(row_item.raw_data->>'store_name'))and trim(prior.raw_data->>'region_code')=trim(row_item.raw_data->>'region_code'))then errors:=errors||jsonb_build_array(jsonb_build_object('field','store_name','code','duplicate_store_in_file','message','文件内同一区域门店重复'));end if;
  normalized:=jsonb_build_object('brand_name',trim(row_item.raw_data->>'brand_name'),'brand_key',lower(trim(row_item.raw_data->>'brand_name')),'brand_id',brand_id,'store_name',trim(row_item.raw_data->>'store_name'),'store_key',lower(trim(row_item.raw_data->>'store_name')),'existing_store_id',existing_store_id,'contact_name',nullif(trim(row_item.raw_data->>'contact_name'),''),'phone_normalized',nullif(phone_normalized,''),'region_id',region_id,'owner_id',owner_id,'catalog_item_id',catalog_item_id,'expires_on',row_item.raw_data->>'expires_on');
  update public.import_rows set normalized_data=normalized,validation_errors=errors,planned_action=case when jsonb_array_length(errors)>0 then'skipped'when existing_store_id is null then'created'else'updated'end,result_status='pending',result_data=null,error_message=null,processed_at=null where id=row_item.id;
 end loop;
 select count(*)into blockers from public.import_rows where batch_id=batch.id and jsonb_array_length(validation_errors)>0;
 select jsonb_build_object('batchId',batch.id,'total',batch.row_count,'blockingErrors',blockers,'created',(select count(*)from public.import_rows where batch_id=batch.id and planned_action='created'),'updated',(select count(*)from public.import_rows where batch_id=batch.id and planned_action='updated'),'skipped',(select count(*)from public.import_rows where batch_id=batch.id and planned_action='skipped'))into report;
 update public.import_batches set status=case when blockers=0 then'dry_run_ready'else'precheck_failed'end,blocking_error_count=blockers,dry_run_report=report,prechecked_at=now()where id=batch.id;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(batch.team_id,actor.id,'import.batch_prechecked','import_batch',batch.id,report);
 return report;
end$precheck$;

create or replace function public.get_customer_import_admin_snapshot(p_batch_id uuid default null)
returns jsonb language plpgsql security definer stable set search_path='' as $snapshot$
declare actor public.profiles;selected_id uuid;
begin
 select*into actor from public.profiles where id=auth.uid()and status='active';
 if actor.id is null or not public.has_permission(actor.team_id,'customers.import')then raise exception'IMPORT_ADMIN_REQUIRED'using errcode='42501';end if;
 selected_id:=p_batch_id;if selected_id is null then select b.id into selected_id from public.import_batches b where b.team_id=actor.team_id order by b.created_at desc limit 1;end if;
 if selected_id is not null and not exists(select 1 from public.import_batches b where b.id=selected_id and b.team_id=actor.team_id)then raise exception'BATCH_NOT_FOUND'using errcode='P0002';end if;
 return jsonb_build_object(
  'batches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'sourceName',b.source_name,'status',b.status,'rowCount',b.row_count,'blockingErrorCount',b.blocking_error_count,'report',b.dry_run_report,'createdAt',b.created_at,'precheckedAt',b.prechecked_at,'committedAt',b.committed_at)order by b.created_at desc)from(select*from public.import_batches where team_id=actor.team_id order by created_at desc limit 20)b),'[]'::jsonb),
  'selectedBatchId',selected_id,
  'rows',coalesce((select jsonb_agg(jsonb_build_object('id',ir.id,'rowNumber',ir.row_number,'rawData',ir.raw_data,'normalizedData',ir.normalized_data,'validationErrors',ir.validation_errors,'plannedAction',ir.planned_action,'resultStatus',ir.result_status,'resultData',ir.result_data,'errorMessage',ir.error_message)order by ir.row_number)from public.import_rows ir where ir.team_id=actor.team_id and ir.batch_id=selected_id),'[]'::jsonb)
 );
end$snapshot$;

create or replace function public.commit_customer_import_admin(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $commit_wrapper$<<commit_import>>
declare actor public.profiles;batch public.import_batches;row_item public.import_rows;brand_id uuid;store_id uuid;contact_id uuid;subscription_id uuid;phone_normalized text;before_image jsonb;after_image jsonb;result jsonb;runtime_errors integer;final_status text;
begin
 select*into actor from public.profiles where id=auth.uid()and status='active';select*into batch from public.import_batches where id=p_batch_id for update;
 if actor.id is null or batch.id is null or batch.team_id<>actor.team_id or not public.has_permission(actor.team_id,'customers.import')then raise exception'IMPORT_ADMIN_REQUIRED'using errcode='42501';end if;
 if batch.status in('committed','committed_with_errors')then return jsonb_build_object('batchId',batch.id,'status',batch.status);end if;
 if batch.status<>'dry_run_ready'or batch.blocking_error_count<>0 then raise exception'ZERO_ERROR_DRY_RUN_REQUIRED'using errcode='23514';end if;
 for row_item in select*from public.import_rows where batch_id=batch.id order by row_number for update loop
  begin
   brand_id:=null;store_id:=null;contact_id:=null;subscription_id:=null;before_image:=null;after_image:=null;
   insert into public.crm_brands(team_id,name,owner_id,created_by)values(batch.team_id,row_item.normalized_data->>'brand_name',(row_item.normalized_data->>'owner_id')::uuid,actor.id)on conflict(team_id,normalized_name)do nothing returning id into brand_id;
   if brand_id is null then select id into brand_id from public.crm_brands where team_id=batch.team_id and normalized_name=row_item.normalized_data->>'brand_key';else insert into public.import_created_entities(team_id,batch_id,row_id,entity_type,entity_id)values(batch.team_id,batch.id,row_item.id,'brand',brand_id)on conflict do nothing;end if;
   insert into public.crm_stores(team_id,brand_id,region_id,name,address,business_type,owner_id,created_by)values(batch.team_id,brand_id,(row_item.normalized_data->>'region_id')::uuid,row_item.normalized_data->>'store_name',nullif(row_item.raw_data->>'address',''),nullif(row_item.raw_data->>'business_type',''),(row_item.normalized_data->>'owner_id')::uuid,actor.id)on conflict(team_id,region_id,normalized_name)do nothing returning id into store_id;
   if store_id is null then
    select id into store_id from public.crm_stores where team_id=batch.team_id and region_id=(row_item.normalized_data->>'region_id')::uuid and normalized_name=row_item.normalized_data->>'store_key';
    update public.crm_stores set brand_id=commit_import.brand_id,owner_id=(row_item.normalized_data->>'owner_id')::uuid,address=coalesce(nullif(row_item.raw_data->>'address',''),address),business_type=coalesce(nullif(row_item.raw_data->>'business_type',''),business_type),updated_at=now()where id=commit_import.store_id;
   else insert into public.import_created_entities(team_id,batch_id,row_id,entity_type,entity_id)values(batch.team_id,batch.id,row_item.id,'store',store_id)on conflict do nothing;end if;
   if row_item.normalized_data->>'contact_name'is not null then
    phone_normalized:=coalesce(row_item.normalized_data->>'phone_normalized','');
    if phone_normalized<>''then select c.id into contact_id from public.crm_contact_private cp join public.crm_contacts c on c.id=cp.contact_id and c.team_id=cp.team_id where cp.team_id=batch.team_id and pg_catalog.regexp_replace(coalesce(cp.phone,''),'[^0-9]','','g')=phone_normalized limit 1;end if;
    if contact_id is null then select id into contact_id from public.crm_contacts where team_id=batch.team_id and store_id=commit_import.store_id and lower(trim(name))=lower(trim(row_item.normalized_data->>'contact_name'))limit 1;end if;
    if contact_id is null then insert into public.crm_contacts(team_id,brand_id,store_id,name,owner_id,created_by)values(batch.team_id,brand_id,store_id,row_item.normalized_data->>'contact_name',(row_item.normalized_data->>'owner_id')::uuid,actor.id)returning id into contact_id;insert into public.import_created_entities(team_id,batch_id,row_id,entity_type,entity_id)values(batch.team_id,batch.id,row_item.id,'contact',contact_id)on conflict do nothing;
    else update public.crm_contacts set brand_id=commit_import.brand_id,store_id=commit_import.store_id,name=row_item.normalized_data->>'contact_name',owner_id=(row_item.normalized_data->>'owner_id')::uuid,updated_at=now()where id=commit_import.contact_id;end if;
    if phone_normalized<>''then
     select jsonb_build_object('phone',cp.phone,'wechat_id',cp.wechat_id,'email',cp.email,'notes',cp.notes)into before_image from public.crm_contact_private cp where cp.contact_id=commit_import.contact_id;
     after_image:=jsonb_build_object('phone',trim(row_item.raw_data->>'contact_phone'),'wechat_id',before_image->'wechat_id','email',before_image->'email','notes',before_image->'notes');
     if before_image is not null then insert into public.import_update_snapshots(team_id,batch_id,row_id,entity_type,entity_id,before_data,after_data)values(batch.team_id,batch.id,row_item.id,'contact_private',contact_id,before_image,after_image)on conflict(batch_id,entity_type,entity_id)do nothing;end if;
     insert into public.crm_contact_private(contact_id,team_id,phone,updated_by)values(contact_id,batch.team_id,trim(row_item.raw_data->>'contact_phone'),actor.id)on conflict(contact_id)do update set phone=excluded.phone,updated_by=actor.id,updated_at=now();
    end if;
   end if;
   select cps.id,jsonb_build_object('owner_id',cps.owner_id,'expires_on',cps.expires_on,'status',cps.status)into subscription_id,before_image from public.customer_product_subscriptions cps where cps.team_id=batch.team_id and cps.store_id=commit_import.store_id and cps.catalog_item_id=(row_item.normalized_data->>'catalog_item_id')::uuid;
   after_image:=jsonb_build_object('owner_id',row_item.normalized_data->>'owner_id','expires_on',row_item.normalized_data->>'expires_on','status',coalesce(before_image->>'status','active'));
   if subscription_id is null then insert into public.customer_product_subscriptions(team_id,store_id,catalog_item_id,owner_id,expires_on)values(batch.team_id,store_id,(row_item.normalized_data->>'catalog_item_id')::uuid,(row_item.normalized_data->>'owner_id')::uuid,(row_item.normalized_data->>'expires_on')::date)returning id into subscription_id;insert into public.import_created_entities(team_id,batch_id,row_id,entity_type,entity_id)values(batch.team_id,batch.id,row_item.id,'subscription',subscription_id)on conflict do nothing;
   else insert into public.import_update_snapshots(team_id,batch_id,row_id,entity_type,entity_id,before_data,after_data)values(batch.team_id,batch.id,row_item.id,'subscription',subscription_id,before_image,after_image)on conflict(batch_id,entity_type,entity_id)do nothing;update public.customer_product_subscriptions set owner_id=(row_item.normalized_data->>'owner_id')::uuid,expires_on=(row_item.normalized_data->>'expires_on')::date,status='active',updated_at=now()where id=subscription_id;end if;
   result:=jsonb_build_object('brandId',brand_id,'storeId',store_id,'contactId',contact_id,'subscriptionId',subscription_id);
   update public.import_rows set result_status=case when row_item.planned_action='created'then'created'else'updated'end,result_data=result,error_message=null,processed_at=now()where id=row_item.id;
  exception when others then update public.import_rows set result_status='error',result_data=null,error_message=left(sqlerrm,1000),processed_at=now()where id=row_item.id;end;
 end loop;
 select count(*)into runtime_errors from public.import_rows where batch_id=batch.id and result_status='error';final_status:=case when runtime_errors=0 then'committed'else'committed_with_errors'end;
 update public.import_batches set status=final_status,committed_at=now(),dry_run_report=coalesce(dry_run_report,'{}')||jsonb_build_object('runtimeErrors',runtime_errors,'createdResults',(select count(*)from public.import_rows where batch_id=batch.id and result_status='created'),'updatedResults',(select count(*)from public.import_rows where batch_id=batch.id and result_status='updated'))where id=batch.id returning*into batch;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(batch.team_id,actor.id,'import.batch_committed','import_batch',batch.id,batch.dry_run_report);
 return jsonb_build_object('batchId',batch.id,'status',batch.status,'runtimeErrors',runtime_errors);
end$commit_wrapper$;

revoke all on function public.create_customer_import_batch(text,jsonb),public.commit_customer_import(uuid),public.rollback_customer_import(uuid)from authenticated;
revoke all on function public.stage_customer_import_batch(text,jsonb,uuid,text),public.precheck_customer_import(uuid),public.get_customer_import_admin_snapshot(uuid),public.commit_customer_import_admin(uuid)from public,anon;
grant execute on function public.stage_customer_import_batch(text,jsonb,uuid,text),public.precheck_customer_import(uuid),public.get_customer_import_admin_snapshot(uuid),public.commit_customer_import_admin(uuid)to authenticated;
notify pgrst,'reload schema';
