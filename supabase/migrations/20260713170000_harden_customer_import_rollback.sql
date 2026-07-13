-- Additive rollback hardening for databases where 150000 was already applied.
alter table public.import_batches drop constraint if exists import_batches_status_check;
alter table public.import_batches add constraint import_batches_status_check check(status in('staged','precheck_failed','dry_run_ready','committed','committed_with_errors','rolled_back','rollback_conflict'));
alter table public.import_created_entities add column if not exists after_data jsonb;

create table if not exists public.import_update_snapshots(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),batch_id uuid not null,row_id uuid not null,entity_type text not null check(entity_type in('contact_private','subscription')),entity_id uuid not null,
 before_data jsonb not null,after_data jsonb not null,rollback_status text not null default'pending'check(rollback_status in('pending','restored','conflict')),created_at timestamptz not null default now(),unique(team_id,id),unique(batch_id,entity_type,entity_id),foreign key(team_id,batch_id)references public.import_batches(team_id,id),foreign key(team_id,row_id)references public.import_rows(team_id,id)
);

create table if not exists public.import_rollback_conflicts(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),batch_id uuid not null,entity_type text not null,entity_id uuid not null,reason text not null,created_at timestamptz not null default now(),
 unique(team_id,id),unique(batch_id,entity_type,entity_id),foreign key(team_id,batch_id)references public.import_batches(team_id,id)
);

create or replace function public.capture_import_created_entity_image()
returns trigger language plpgsql security definer set search_path=''as$$declare image jsonb;begin
 if new.entity_type='subscription'then select to_jsonb(x)into image from public.customer_product_subscriptions x where x.id=new.entity_id and x.team_id=new.team_id;
 elsif new.entity_type='contact'then select to_jsonb(x)into image from public.crm_contacts x where x.id=new.entity_id and x.team_id=new.team_id;
 elsif new.entity_type='store'then select to_jsonb(x)into image from public.crm_stores x where x.id=new.entity_id and x.team_id=new.team_id;
 elsif new.entity_type='brand'then select to_jsonb(x)into image from public.crm_brands x where x.id=new.entity_id and x.team_id=new.team_id;end if;
 if image is null then raise exception'IMPORT_CREATED_ENTITY_NOT_FOUND'using errcode='P0002';end if;new.after_data:=image;return new;end$$;
drop trigger if exists import_created_entity_image on public.import_created_entities;
create trigger import_created_entity_image before insert on public.import_created_entities for each row execute function public.capture_import_created_entity_image();

-- Replace the legacy commit function so upgraded databases also capture updated-record snapshots.
create or replace function public.commit_customer_import(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=''as$$<<import_commit>>
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

-- Existing legacy rows have no trustworthy import-time image: fail closed.
update public.import_created_entities set after_data=null where after_data is null;

create or replace function public.record_import_rollback_conflict(p_team text,p_batch uuid,p_type text,p_entity uuid,p_reason text)
returns void language sql security definer set search_path=''as$$insert into public.import_rollback_conflicts(team_id,batch_id,entity_type,entity_id,reason)values(p_team,p_batch,p_type,p_entity,p_reason)on conflict(batch_id,entity_type,entity_id)do nothing$$;

create or replace function public.rollback_customer_import(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=''as$$declare r public.profiles;b public.import_batches;ce public.import_created_entities;snap record;cur jsonb;conflicts integer;final_status text;begin
 select*into r from public.profiles where id=auth.uid()and status='active';select*into b from public.import_batches where id=p_batch_id for update;
 if b.id is null or r.id is null or b.team_id<>r.team_id or not public.has_access_role(r.team_id,array['owner','admin'])or not public.is_feature_enabled(r.team_id,'sales_os_v3')then raise exception'ROLLBACK_FORBIDDEN'using errcode='42501';end if;
 if b.status in('rolled_back','rollback_conflict')then return jsonb_build_object('batch_id',b.id,'status',b.status);end if;if b.status not in('committed','committed_with_errors')then raise exception'COMMITTED_BATCH_REQUIRED'using errcode='55000';end if;
 -- Updated entities are compare-and-restored; a later edit is preserved as a conflict.
 if to_regclass('public.import_update_snapshots')is not null then
  for snap in select*from public.import_update_snapshots where batch_id=b.id and rollback_status='pending'order by created_at loop cur:=null;
   if snap.entity_type='contact_private'then select jsonb_build_object('phone',x.phone,'wechat_id',x.wechat_id,'email',x.email,'notes',x.notes)into cur from public.crm_contact_private x where x.contact_id=snap.entity_id;
    if cur is not distinct from snap.after_data then update public.crm_contact_private set phone=snap.before_data->>'phone',wechat_id=snap.before_data->>'wechat_id',email=snap.before_data->>'email',notes=snap.before_data->>'notes',updated_by=r.id,updated_at=now()where contact_id=snap.entity_id;update public.import_update_snapshots set rollback_status='restored'where id=snap.id;
    else update public.import_update_snapshots set rollback_status='conflict'where id=snap.id;insert into public.import_rollback_conflicts(team_id,batch_id,entity_type,entity_id,reason)values(b.team_id,b.id,snap.entity_type,snap.entity_id,'current_value_differs_from_batch_after_image')on conflict(batch_id,entity_type,entity_id)do nothing;end if;
   elsif snap.entity_type='subscription'then select jsonb_build_object('owner_id',x.owner_id,'expires_on',x.expires_on,'status',x.status)into cur from public.customer_product_subscriptions x where x.id=snap.entity_id;
    if cur is not distinct from snap.after_data then update public.customer_product_subscriptions set owner_id=(snap.before_data->>'owner_id')::uuid,expires_on=(snap.before_data->>'expires_on')::date,status=snap.before_data->>'status',updated_at=now()where id=snap.entity_id;update public.import_update_snapshots set rollback_status='restored'where id=snap.id;
    else update public.import_update_snapshots set rollback_status='conflict'where id=snap.id;insert into public.import_rollback_conflicts(team_id,batch_id,entity_type,entity_id,reason)values(b.team_id,b.id,snap.entity_type,snap.entity_id,'current_value_differs_from_batch_after_image')on conflict(batch_id,entity_type,entity_id)do nothing;end if;end if;
  end loop;
 end if;
 for ce in select*from public.import_created_entities where batch_id=b.id order by case entity_type when'subscription'then 1 when'contact'then 2 when'store'then 3 else 4 end loop cur:=null;
  if ce.entity_type='subscription'then select to_jsonb(x)into cur from public.customer_product_subscriptions x where x.id=ce.entity_id and x.team_id=ce.team_id;
   if ce.after_data is not null and cur is not distinct from ce.after_data then delete from public.customer_product_subscriptions where id=ce.entity_id;else perform public.record_import_rollback_conflict(ce.team_id,ce.batch_id,ce.entity_type,ce.entity_id,'created_entity_changed_or_legacy_snapshot_missing');end if;
  elsif ce.entity_type='contact'then select to_jsonb(x)into cur from public.crm_contacts x where x.id=ce.entity_id and x.team_id=ce.team_id;
   if ce.after_data is not null and cur is not distinct from ce.after_data and not exists(select 1 from public.crm_contact_private p where p.contact_id=ce.entity_id and p.updated_at>b.committed_at)then delete from public.crm_contacts where id=ce.entity_id;else perform public.record_import_rollback_conflict(ce.team_id,ce.batch_id,ce.entity_type,ce.entity_id,'created_entity_changed_or_referenced');end if;
  elsif ce.entity_type='store'then select to_jsonb(x)into cur from public.crm_stores x where x.id=ce.entity_id and x.team_id=ce.team_id;
   if ce.after_data is not null and cur is not distinct from ce.after_data and not exists(select 1 from public.crm_leads x where x.store_id=ce.entity_id)and not exists(select 1 from public.crm_opportunities x where x.store_id=ce.entity_id)and not exists(select 1 from public.fulfillment_deliveries x where x.store_id=ce.entity_id)and not exists(select 1 from public.crm_contacts x where x.store_id=ce.entity_id)and not exists(select 1 from public.customer_product_subscriptions x where x.store_id=ce.entity_id)then delete from public.crm_stores where id=ce.entity_id;else perform public.record_import_rollback_conflict(ce.team_id,ce.batch_id,ce.entity_type,ce.entity_id,'created_entity_changed_or_referenced');end if;
  elsif ce.entity_type='brand'then select to_jsonb(x)into cur from public.crm_brands x where x.id=ce.entity_id and x.team_id=ce.team_id;
   if ce.after_data is not null and cur is not distinct from ce.after_data and not exists(select 1 from public.crm_stores x where x.brand_id=ce.entity_id)and not exists(select 1 from public.crm_contacts x where x.brand_id=ce.entity_id)and not exists(select 1 from public.crm_leads x where x.brand_id=ce.entity_id)and not exists(select 1 from public.crm_opportunities x where x.brand_id=ce.entity_id)then delete from public.crm_brands where id=ce.entity_id;else perform public.record_import_rollback_conflict(ce.team_id,ce.batch_id,ce.entity_type,ce.entity_id,'created_entity_changed_or_referenced');end if;end if;
 end loop;
 select count(*)into conflicts from public.import_rollback_conflicts where batch_id=b.id;final_status:=case when conflicts=0 then'rolled_back'else'rollback_conflict'end;update public.import_batches set status=final_status,rolled_back_at=now()where id=b.id;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(b.team_id,r.id,case when conflicts=0 then'import.batch_rolled_back'else'import.batch_rollback_conflict'end,'import_batch',b.id,jsonb_build_object('status',final_status,'conflicts',conflicts));return jsonb_build_object('batch_id',b.id,'status',final_status,'conflicts',conflicts);end$$;

alter table public.import_rollback_conflicts enable row level security;
alter table public.import_update_snapshots enable row level security;
drop policy if exists "sales os v3 server gate"on public.import_update_snapshots;create policy"sales os v3 server gate"on public.import_update_snapshots as restrictive for all to authenticated using(public.is_feature_enabled(team_id,'sales_os_v3'))with check(public.is_feature_enabled(team_id,'sales_os_v3'));
drop policy if exists "admins read import snapshots"on public.import_update_snapshots;create policy"admins read import snapshots"on public.import_update_snapshots for select to authenticated using(public.has_access_role(team_id,array['owner','admin']));
drop policy if exists "sales os v3 server gate"on public.import_rollback_conflicts;create policy"sales os v3 server gate"on public.import_rollback_conflicts as restrictive for all to authenticated using(public.is_feature_enabled(team_id,'sales_os_v3'))with check(public.is_feature_enabled(team_id,'sales_os_v3'));
drop policy if exists "admins read rollback conflicts"on public.import_rollback_conflicts;create policy"admins read rollback conflicts"on public.import_rollback_conflicts for select to authenticated using(public.has_access_role(team_id,array['owner','admin']));
revoke all on function public.capture_import_created_entity_image(),public.record_import_rollback_conflict(text,uuid,text,uuid,text)from public;
notify pgrst,'reload schema';
