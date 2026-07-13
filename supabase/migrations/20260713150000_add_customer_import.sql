-- Admin-only staged import. Input is already-parsed JSON; no external collection.
create table public.customer_product_subscriptions(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),store_id uuid not null,catalog_item_id uuid not null,owner_id uuid not null,
 expires_on date,status text not null default'active'check(status in('active','expired','cancelled')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(team_id,id),unique(team_id,store_id,catalog_item_id),foreign key(team_id,store_id)references public.crm_stores(team_id,id),foreign key(team_id,catalog_item_id)references public.deal_catalog_items(team_id,id),foreign key(team_id,owner_id)references public.profiles(team_id,id)
);
create table public.import_batches(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),source_name text not null,status text not null default'staged'check(status in('staged','precheck_failed','dry_run_ready','committed','committed_with_errors','rolled_back','rollback_conflict')),
 row_count integer not null check(row_count between 1 and 500),blocking_error_count integer not null default 0 check(blocking_error_count>=0),dry_run_report jsonb,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),prechecked_at timestamptz,committed_at timestamptz,rolled_back_at timestamptz,
 unique(team_id,id)
);
create table public.import_rows(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),batch_id uuid not null,row_number integer not null check(row_number>0),raw_data jsonb not null check(jsonb_typeof(raw_data)='object'),
 normalized_data jsonb,validation_errors jsonb not null default'[]'check(jsonb_typeof(validation_errors)='array'),planned_action text check(planned_action in('created','updated','skipped')),
 result_status text not null default'pending'check(result_status in('pending','created','updated','skipped','error')),result_data jsonb,error_message text,processed_at timestamptz,
 created_at timestamptz not null default now(),unique(team_id,id),unique(batch_id,row_number),foreign key(team_id,batch_id)references public.import_batches(team_id,id)
);
create table public.import_created_entities(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),batch_id uuid not null,row_id uuid not null,entity_type text not null check(entity_type in('brand','store','contact','subscription')),
 entity_id uuid not null,created_at timestamptz not null default now(),unique(team_id,id),unique(batch_id,entity_type,entity_id),foreign key(team_id,batch_id)references public.import_batches(team_id,id),foreign key(team_id,row_id)references public.import_rows(team_id,id)
);
create table public.import_update_snapshots(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),batch_id uuid not null,row_id uuid not null,entity_type text not null check(entity_type in('contact_private','subscription')),entity_id uuid not null,
 before_data jsonb not null,after_data jsonb not null,rollback_status text not null default'pending'check(rollback_status in('pending','restored','conflict')),created_at timestamptz not null default now(),unique(team_id,id),unique(batch_id,entity_type,entity_id),foreign key(team_id,batch_id)references public.import_batches(team_id,id),foreign key(team_id,row_id)references public.import_rows(team_id,id)
);
create table public.import_rollback_conflicts(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),batch_id uuid not null,entity_type text not null,entity_id uuid not null,reason text not null,created_at timestamptz not null default now(),unique(team_id,id),unique(batch_id,entity_type,entity_id),foreign key(team_id,batch_id)references public.import_batches(team_id,id)
);

create or replace function public.create_customer_import_batch(p_source_name text,p_rows jsonb)
returns public.import_batches language plpgsql security definer set search_path='' as $$declare r public.profiles;b public.import_batches;item jsonb;n integer;i integer:=0;begin
 select*into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.has_access_role(r.team_id,array['owner','admin'])or not public.is_feature_enabled(r.team_id,'sales_os_v3')then raise exception'IMPORT_ADMIN_REQUIRED'using errcode='42501';end if;
 if jsonb_typeof(p_rows)<>'array'then raise exception'ROWS_ARRAY_REQUIRED'using errcode='22023';end if;n:=jsonb_array_length(p_rows);if n<1 or n>500 then raise exception'ROW_COUNT_1_TO_500_REQUIRED'using errcode='22023';end if;
 insert into public.import_batches(team_id,source_name,row_count,created_by)values(r.team_id,coalesce(nullif(trim(p_source_name),''),'customer-import'),n,r.id)returning*into b;
 for item in select*from jsonb_array_elements(p_rows)loop i:=i+1;insert into public.import_rows(team_id,batch_id,row_number,raw_data)values(r.team_id,b.id,i,item);end loop;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(r.team_id,r.id,'import.batch_staged','import_batch',b.id,jsonb_build_object('rows',n));return b;end$$;

create or replace function public.precheck_customer_import(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.profiles;b public.import_batches;ir public.import_rows;e jsonb;norm jsonb;region_id uuid;owner_id uuid;item_id uuid;existing_store uuid;report jsonb;blockers integer;begin
 select*into r from public.profiles where id=auth.uid()and status='active';select*into b from public.import_batches where id=p_batch_id for update;
 if b.id is null or r.id is null or b.team_id<>r.team_id then raise exception'BATCH_NOT_FOUND'using errcode='P0002';end if;if not public.has_access_role(r.team_id,array['owner','admin'])or not public.is_feature_enabled(r.team_id,'sales_os_v3')then raise exception'IMPORT_ADMIN_REQUIRED'using errcode='42501';end if;
 if b.status in('committed','rolled_back')then return b.dry_run_report;end if;
 for ir in select*from public.import_rows where batch_id=b.id order by row_number loop e:='[]';region_id:=null;owner_id:=null;item_id:=null;existing_store:=null;
  if nullif(trim(ir.raw_data->>'brand_name'),'')is null then e:=e||'"brand_name_required"'::jsonb;end if;
  if nullif(trim(ir.raw_data->>'store_name'),'')is null then e:=e||'"store_name_required"'::jsonb;end if;
  select sr.id into region_id from public.sales_regions sr where sr.team_id=b.team_id and sr.code=trim(ir.raw_data->>'region_code')and sr.is_active;
  if region_id is null then e:=e||'"valid_region_required"'::jsonb;end if;
  if coalesce(ir.raw_data->>'owner_profile_id','')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'then select p.id into owner_id from public.profiles p where p.id=(ir.raw_data->>'owner_profile_id')::uuid and p.team_id=b.team_id and p.status='active';end if;
  if owner_id is null or not exists(select 1 from public.profile_access_roles par join public.access_roles ar on ar.id=par.role_id and ar.team_id=par.team_id where par.team_id=b.team_id and par.profile_id=owner_id and ar.code in('sales','supervisor','admin','owner'))then e:=e||'"active_sales_owner_required"'::jsonb;end if;
  select ci.id into item_id from public.deal_catalog_items ci join public.deal_catalog_versions cv on cv.id=ci.catalog_version_id and cv.team_id=ci.team_id where ci.team_id=b.team_id and ci.sku=trim(ir.raw_data->>'current_product_sku')and cv.status='published'order by cv.version_no desc limit 1;
  if item_id is null then e:=e||'"published_current_product_required"'::jsonb;end if;
  if coalesce(ir.raw_data->>'expires_on','')!~'^\d{4}-\d{2}-\d{2}$'then e:=e||'"valid_expires_on_required"'::jsonb;else begin perform(ir.raw_data->>'expires_on')::date;exception when others then e:=e||'"valid_expires_on_required"'::jsonb;end;end if;
  if nullif(ir.raw_data->>'business_type','')is not null and(ir.raw_data->>'business_type')not in('fast_food','chinese','hotpot','barbecue','beverage','bakery','banquet','international')then e:=e||'"valid_business_type_required"'::jsonb;end if;
  if region_id is not null then select s.id into existing_store from public.crm_stores s where s.team_id=b.team_id and s.region_id=region_id and s.normalized_name=lower(trim(ir.raw_data->>'store_name'));end if;
  norm:=jsonb_build_object('brand_name',trim(ir.raw_data->>'brand_name'),'brand_key',lower(trim(ir.raw_data->>'brand_name')),'store_name',trim(ir.raw_data->>'store_name'),'store_key',lower(trim(ir.raw_data->>'store_name')),'contact_name',nullif(trim(ir.raw_data->>'contact_name'),''),'region_id',region_id,'owner_id',owner_id,'catalog_item_id',item_id,'expires_on',ir.raw_data->>'expires_on');
  if exists(select 1 from public.import_rows prior where prior.batch_id=b.id and prior.row_number<ir.row_number and lower(trim(prior.raw_data->>'store_name'))=lower(trim(ir.raw_data->>'store_name'))and trim(prior.raw_data->>'region_code')=trim(ir.raw_data->>'region_code'))then update public.import_rows set normalized_data=norm,validation_errors=e,planned_action='skipped',result_status='pending'where id=ir.id;
  else update public.import_rows set normalized_data=norm,validation_errors=e,planned_action=case when existing_store is null then'created'else'updated'end,result_status='pending'where id=ir.id;end if;
 end loop;
 select count(*)into blockers from public.import_rows where batch_id=b.id and jsonb_array_length(validation_errors)>0;
 select jsonb_build_object('batch_id',b.id,'total',b.row_count,'blocking_errors',blockers,'created',(select count(*)from public.import_rows where batch_id=b.id and planned_action='created'),'updated',(select count(*)from public.import_rows where batch_id=b.id and planned_action='updated'),'skipped',(select count(*)from public.import_rows where batch_id=b.id and planned_action='skipped'))into report;
 update public.import_batches set status=case when blockers=0 then'dry_run_ready'else'precheck_failed'end,blocking_error_count=blockers,dry_run_report=report,prechecked_at=now()where id=b.id;return report;end$$;

create or replace function public.commit_customer_import(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$<<import_commit>>
declare r public.profiles;b public.import_batches;ir public.import_rows;brand_id uuid;store_id uuid;contact_id uuid;subscription_id uuid;created_any boolean;result jsonb;before_image jsonb;after_image jsonb;begin
 select*into r from public.profiles where id=auth.uid()and status='active';select*into b from public.import_batches where id=p_batch_id for update;
 if b.id is null or r.id is null or b.team_id<>r.team_id then raise exception'BATCH_NOT_FOUND'using errcode='P0002';end if;if not public.has_access_role(r.team_id,array['owner','admin'])or not public.is_feature_enabled(r.team_id,'sales_os_v3')then raise exception'IMPORT_ADMIN_REQUIRED'using errcode='42501';end if;
 if b.status in('committed','committed_with_errors')then return jsonb_build_object('batch_id',b.id,'status',b.status);end if;if b.status<>'dry_run_ready'or b.blocking_error_count<>0 then raise exception'ZERO_ERROR_DRY_RUN_REQUIRED'using errcode='23514';end if;
 for ir in select*from public.import_rows where batch_id=b.id order by row_number for update loop
  if ir.planned_action='skipped'then update public.import_rows set result_status='skipped',processed_at=now()where id=ir.id;continue;end if;created_any:=false;brand_id:=null;store_id:=null;contact_id:=null;subscription_id:=null;begin
  insert into public.crm_brands(team_id,name,owner_id,created_by)values(b.team_id,ir.normalized_data->>'brand_name',(ir.normalized_data->>'owner_id')::uuid,r.id)on conflict(team_id,normalized_name)do nothing returning id into brand_id;
  if brand_id is null then select id into brand_id from public.crm_brands where team_id=b.team_id and normalized_name=ir.normalized_data->>'brand_key';else created_any:=true;insert into public.import_created_entities(team_id,batch_id,row_id,entity_type,entity_id)values(b.team_id,b.id,ir.id,'brand',brand_id);end if;
  insert into public.crm_stores(team_id,brand_id,region_id,name,address,business_type,owner_id,created_by)values(b.team_id,brand_id,(ir.normalized_data->>'region_id')::uuid,ir.normalized_data->>'store_name',nullif(ir.raw_data->>'address',''),nullif(ir.raw_data->>'business_type',''),(ir.normalized_data->>'owner_id')::uuid,r.id)
  on conflict(team_id,region_id,normalized_name)do nothing returning id into store_id;
  if store_id is null then select id into store_id from public.crm_stores where team_id=b.team_id and region_id=(ir.normalized_data->>'region_id')::uuid and normalized_name=ir.normalized_data->>'store_key';else created_any:=true;insert into public.import_created_entities(team_id,batch_id,row_id,entity_type,entity_id)values(b.team_id,b.id,ir.id,'store',store_id);end if;
  if ir.normalized_data->>'contact_name'is not null then select id into contact_id from public.crm_contacts where team_id=b.team_id and store_id=store_id and lower(trim(name))=lower(trim(ir.normalized_data->>'contact_name'))limit 1;
   if contact_id is null then insert into public.crm_contacts(team_id,brand_id,store_id,name,owner_id,created_by)values(b.team_id,brand_id,store_id,ir.normalized_data->>'contact_name',(ir.normalized_data->>'owner_id')::uuid,r.id)returning id into contact_id;created_any:=true;insert into public.import_created_entities(team_id,batch_id,row_id,entity_type,entity_id)values(b.team_id,b.id,ir.id,'contact',contact_id);end if;
   if nullif(trim(ir.raw_data->>'contact_phone'),'')is not null then select jsonb_build_object('phone',cp.phone,'wechat_id',cp.wechat_id,'email',cp.email,'notes',cp.notes)into before_image from public.crm_contact_private cp where cp.contact_id=import_commit.contact_id;
    after_image:=jsonb_build_object('phone',trim(ir.raw_data->>'contact_phone'),'wechat_id',before_image->'wechat_id','email',before_image->'email','notes',before_image->'notes');
    if before_image is not null then insert into public.import_update_snapshots(team_id,batch_id,row_id,entity_type,entity_id,before_data,after_data)values(b.team_id,b.id,ir.id,'contact_private',contact_id,before_image,after_image)on conflict(batch_id,entity_type,entity_id)do nothing;end if;
    insert into public.crm_contact_private(contact_id,team_id,phone,updated_by)values(contact_id,b.team_id,trim(ir.raw_data->>'contact_phone'),r.id)on conflict(contact_id)do update set phone=excluded.phone,updated_by=r.id,updated_at=now();end if;end if;
  select cps.id,jsonb_build_object('owner_id',cps.owner_id,'expires_on',cps.expires_on,'status',cps.status)into subscription_id,before_image from public.customer_product_subscriptions cps where cps.team_id=b.team_id and cps.store_id=import_commit.store_id and cps.catalog_item_id=(ir.normalized_data->>'catalog_item_id')::uuid;
  after_image:=jsonb_build_object('owner_id',ir.normalized_data->>'owner_id','expires_on',ir.normalized_data->>'expires_on','status',coalesce(before_image->>'status','active'));
  if subscription_id is null then insert into public.customer_product_subscriptions(team_id,store_id,catalog_item_id,owner_id,expires_on)values(b.team_id,store_id,(ir.normalized_data->>'catalog_item_id')::uuid,(ir.normalized_data->>'owner_id')::uuid,(ir.normalized_data->>'expires_on')::date)returning id into subscription_id;
   insert into public.import_created_entities(team_id,batch_id,row_id,entity_type,entity_id)values(b.team_id,b.id,ir.id,'subscription',subscription_id);created_any:=true;
  else insert into public.import_update_snapshots(team_id,batch_id,row_id,entity_type,entity_id,before_data,after_data)values(b.team_id,b.id,ir.id,'subscription',subscription_id,before_image,after_image)on conflict(batch_id,entity_type,entity_id)do nothing;
   update public.customer_product_subscriptions set owner_id=(ir.normalized_data->>'owner_id')::uuid,expires_on=(ir.normalized_data->>'expires_on')::date,updated_at=now()where id=import_commit.subscription_id;end if;
  result:=jsonb_build_object('brand_id',brand_id,'store_id',store_id,'contact_id',contact_id,'subscription_id',subscription_id);
  update public.import_rows set result_status=case when ir.planned_action='created'then'created'else'updated'end,result_data=result,processed_at=now()where id=ir.id;
  exception when others then update public.import_rows set result_status='error',error_message=left(sqlerrm,1000),processed_at=now()where id=ir.id;end;
 end loop;update public.import_batches set status=case when exists(select 1 from public.import_rows where batch_id=b.id and result_status='error')then'committed_with_errors'else'committed'end,committed_at=now()where id=b.id returning*into b;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(b.team_id,r.id,'import.batch_committed','import_batch',b.id,b.dry_run_report);return jsonb_build_object('batch_id',b.id,'status','committed');end$$;

create or replace function public.rollback_customer_import(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$declare r public.profiles;b public.import_batches;snap public.import_update_snapshots;e public.import_created_entities;current_data jsonb;conflicts integer;final_status text;begin
 select*into r from public.profiles where id=auth.uid()and status='active';select*into b from public.import_batches where id=p_batch_id for update;
 if b.id is null or r.id is null or b.team_id<>r.team_id or not public.has_access_role(r.team_id,array['owner','admin'])or not public.is_feature_enabled(r.team_id,'sales_os_v3')then raise exception'ROLLBACK_FORBIDDEN'using errcode='42501';end if;
 if b.status in('rolled_back','rollback_conflict')then return jsonb_build_object('batch_id',b.id,'status',b.status);end if;if b.status not in('committed','committed_with_errors')then raise exception'COMMITTED_BATCH_REQUIRED'using errcode='55000';end if;
 for snap in select*from public.import_update_snapshots where batch_id=b.id and rollback_status='pending'order by created_at loop current_data:=null;
  if snap.entity_type='contact_private'then select jsonb_build_object('phone',p.phone,'wechat_id',p.wechat_id,'email',p.email,'notes',p.notes)into current_data from public.crm_contact_private p where p.contact_id=snap.entity_id;
   if current_data is not distinct from snap.after_data then update public.crm_contact_private set phone=snap.before_data->>'phone',wechat_id=snap.before_data->>'wechat_id',email=snap.before_data->>'email',notes=snap.before_data->>'notes',updated_by=r.id,updated_at=now()where contact_id=snap.entity_id;update public.import_update_snapshots set rollback_status='restored'where id=snap.id;
   else update public.import_update_snapshots set rollback_status='conflict'where id=snap.id;insert into public.import_rollback_conflicts(team_id,batch_id,entity_type,entity_id,reason)values(b.team_id,b.id,snap.entity_type,snap.entity_id,'current_value_differs_from_batch_after_image')on conflict(batch_id,entity_type,entity_id)do nothing;end if;
  elsif snap.entity_type='subscription'then select jsonb_build_object('owner_id',p.owner_id,'expires_on',p.expires_on,'status',p.status)into current_data from public.customer_product_subscriptions p where p.id=snap.entity_id;
   if current_data is not distinct from snap.after_data then update public.customer_product_subscriptions set owner_id=(snap.before_data->>'owner_id')::uuid,expires_on=(snap.before_data->>'expires_on')::date,status=snap.before_data->>'status',updated_at=now()where id=snap.entity_id;update public.import_update_snapshots set rollback_status='restored'where id=snap.id;
   else update public.import_update_snapshots set rollback_status='conflict'where id=snap.id;insert into public.import_rollback_conflicts(team_id,batch_id,entity_type,entity_id,reason)values(b.team_id,b.id,snap.entity_type,snap.entity_id,'current_value_differs_from_batch_after_image')on conflict(batch_id,entity_type,entity_id)do nothing;end if;end if;
 end loop;
 delete from public.customer_product_subscriptions x using public.import_created_entities ce where ce.batch_id=b.id and ce.entity_type='subscription'and x.id=ce.entity_id;
 delete from public.crm_contacts x using public.import_created_entities ce where ce.batch_id=b.id and ce.entity_type='contact'and x.id=ce.entity_id and not exists(select 1 from public.crm_contact_private p where p.contact_id=x.id and p.updated_at>b.committed_at);
 delete from public.crm_stores x using public.import_created_entities ce where ce.batch_id=b.id and ce.entity_type='store'and x.id=ce.entity_id and not exists(select 1 from public.crm_leads l where l.store_id=x.id)and not exists(select 1 from public.crm_opportunities o where o.store_id=x.id)and not exists(select 1 from public.fulfillment_deliveries d where d.store_id=x.id)and not exists(select 1 from public.crm_contacts c where c.store_id=x.id)and not exists(select 1 from public.customer_product_subscriptions p where p.store_id=x.id);
 delete from public.crm_brands x using public.import_created_entities ce where ce.batch_id=b.id and ce.entity_type='brand'and x.id=ce.entity_id and not exists(select 1 from public.crm_stores s where s.brand_id=x.id)and not exists(select 1 from public.crm_contacts c where c.brand_id=x.id)and not exists(select 1 from public.crm_leads l where l.brand_id=x.id)and not exists(select 1 from public.crm_opportunities o where o.brand_id=x.id);
 for e in select*from public.import_created_entities where batch_id=b.id loop
  if(e.entity_type='brand'and exists(select 1 from public.crm_brands x where x.id=e.entity_id))or(e.entity_type='store'and exists(select 1 from public.crm_stores x where x.id=e.entity_id))or(e.entity_type='contact'and exists(select 1 from public.crm_contacts x where x.id=e.entity_id))or(e.entity_type='subscription'and exists(select 1 from public.customer_product_subscriptions x where x.id=e.entity_id))then insert into public.import_rollback_conflicts(team_id,batch_id,entity_type,entity_id,reason)values(b.team_id,b.id,e.entity_type,e.entity_id,'created_entity_has_later_reference_or_change')on conflict(batch_id,entity_type,entity_id)do nothing;end if;
 end loop;
 select count(*)into conflicts from public.import_rollback_conflicts where batch_id=b.id;final_status:=case when conflicts=0 then'rolled_back'else'rollback_conflict'end;
 update public.import_batches set status=final_status,rolled_back_at=now()where id=b.id;insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(b.team_id,r.id,case when conflicts=0 then'import.batch_rolled_back'else'import.batch_rollback_conflict'end,'import_batch',b.id,jsonb_build_object('status',final_status,'conflicts',conflicts));return jsonb_build_object('batch_id',b.id,'status',final_status,'conflicts',conflicts);end$$;

do $$declare t text;begin foreach t in array array['customer_product_subscriptions','import_batches','import_rows','import_created_entities','import_update_snapshots','import_rollback_conflicts']loop execute format('alter table public.%I enable row level security',t);execute format('create policy"sales os v3 server gate"on public.%I as restrictive for all to authenticated using(public.is_feature_enabled(team_id,''sales_os_v3''))with check(public.is_feature_enabled(team_id,''sales_os_v3''))',t);end loop;end$$;
create policy"scoped subscriptions read"on public.customer_product_subscriptions for select to authenticated using(owner_id=auth.uid()or public.can_act_for(team_id,owner_id)or public.has_permission(team_id,'customers.supervise')or public.has_permission(team_id,'operations.manage'));
create policy"admins read import batches"on public.import_batches for select to authenticated using(public.has_access_role(team_id,array['owner','admin']));
create policy"admins read import rows"on public.import_rows for select to authenticated using(public.has_access_role(team_id,array['owner','admin']));
create policy"admins read import creations"on public.import_created_entities for select to authenticated using(public.has_access_role(team_id,array['owner','admin']));
create policy"admins read import snapshots"on public.import_update_snapshots for select to authenticated using(public.has_access_role(team_id,array['owner','admin']));
create policy"admins read rollback conflicts"on public.import_rollback_conflicts for select to authenticated using(public.has_access_role(team_id,array['owner','admin']));
revoke all on function public.create_customer_import_batch(text,jsonb),public.precheck_customer_import(uuid),public.commit_customer_import(uuid),public.rollback_customer_import(uuid)from public;
grant execute on function public.create_customer_import_batch(text,jsonb),public.precheck_customer_import(uuid),public.commit_customer_import(uuid),public.rollback_customer_import(uuid)to authenticated;
notify pgrst,'reload schema';
