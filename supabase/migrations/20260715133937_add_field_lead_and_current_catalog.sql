-- Field/site leads can wait for contact details without entering phone SLA.
-- Catalog versions remain immutable history, but admin saves auto-publish.

alter table public.crm_leads
  add column if not exists contactability_status text not null default 'ready'
    check(contactability_status in('pending_contact','ready')),
  add column if not exists intake_source text not null default 'sales'
    check(intake_source in('sales','operations','field_visit','site_hoarding')),
  add column if not exists contact_ready_at timestamptz;
update public.crm_leads set contact_ready_at=coalesce(contact_ready_at,created_at)
where contactability_status='ready' and contact_ready_at is null;

alter table public.crm_lead_submissions alter column phone_normalized drop not null;
alter table public.crm_lead_submissions drop constraint if exists crm_lead_submissions_phone_normalized_check;
alter table public.crm_lead_submissions add constraint crm_lead_submissions_phone_normalized_check
  check(phone_normalized is null or phone_normalized~'^[0-9]{6,20}$');
alter table public.crm_lead_submissions
  add column if not exists intake_source text not null default 'operations'
    check(intake_source in('operations','field_visit','site_hoarding'));

create or replace function public.resolve_active_sales_region(
  p_team_id text,p_region_text text,p_address text
) returns uuid language plpgsql security definer stable set search_path=''
as $resolve_active_sales_region$
declare result_id uuid;matches integer;longest integer;
begin
  if nullif(trim(p_region_text),'')is not null then
    select count(*),min(sr.id) into matches,result_id from public.sales_regions sr
    where sr.team_id=p_team_id and sr.is_active and sr.code<>'UNMATCHED_LEAD_POOL'
      and(lower(trim(sr.name))=lower(trim(p_region_text))or lower(trim(sr.code))=lower(trim(p_region_text)));
    if matches=1 then return result_id;end if;
  end if;
  if nullif(trim(p_address),'')is null then return null;end if;
  select max(char_length(sr.name))into longest from public.sales_regions sr
  where sr.team_id=p_team_id and sr.is_active and sr.code<>'UNMATCHED_LEAD_POOL'
    and position(lower(trim(sr.name))in lower(trim(p_address)))>0;
  if longest is null then return null;end if;
  select count(*),min(sr.id)into matches,result_id from public.sales_regions sr
  where sr.team_id=p_team_id and sr.is_active and sr.code<>'UNMATCHED_LEAD_POOL'
    and char_length(sr.name)=longest and position(lower(trim(sr.name))in lower(trim(p_address)))>0;
  return case when matches=1 then result_id else null end;
end
$resolve_active_sales_region$;

create or replace function public.match_lead_sales_region(p_region_text text,p_address text)
returns jsonb language plpgsql security definer stable set search_path=''
as $match_lead_sales_region$
declare actor public.profiles;region_row public.sales_regions;
begin
  select p.*into actor from public.profiles p where p.id=auth.uid()and p.status='active';
  if actor.id is null or not public.is_feature_enabled(actor.team_id,'sales_os_v3')
    or not(public.has_permission(actor.team_id,'leads.submit')
      or public.has_permission(actor.team_id,'customers.manage'))then raise exception'LEAD_SUBMIT_FORBIDDEN'using errcode='42501';end if;
  select sr.*into region_row from public.sales_regions sr
  where sr.id=public.resolve_active_sales_region(actor.team_id,p_region_text,p_address)
    and sr.team_id=actor.team_id and sr.is_active;
  return jsonb_build_object('matched',region_row.id is not null,'regionId',region_row.id,
    'regionName',region_row.name,'assignmentType',case when region_row.id is null then'unmatched_pool'else'region'end);
end
$match_lead_sales_region$;

alter function public.submit_operations_lead(text,text,text,text,text,text,text)
  rename to submit_operations_lead_legacy_inner;
revoke all on function public.submit_operations_lead_legacy_inner(text,text,text,text,text,text,text)
  from public,anon,authenticated;

create or replace function public.submit_operations_lead(
  p_customer_name text,p_contact_name text,p_phone text,p_region_text text,p_address text,
  p_notes text,p_raw_text text,p_intake_source text
)returns jsonb language plpgsql security definer set search_path=''
as $submit_operations_lead$
declare actor public.profiles;normalized_phone text;region_row public.sales_regions;fallback public.sales_regions;
  owner_row public.profiles;lead_row public.crm_leads;result jsonb;assignment text;
begin
  select p.*into actor from public.profiles p where p.id=auth.uid()and p.status='active';
  if nullif(trim(p_customer_name),'')is null or p_intake_source not in('operations','field_visit','site_hoarding')then
    raise exception'LEAD_SUBMISSION_REQUIRED_FIELDS'using errcode='22023';end if;
  if actor.id is null or not public.is_feature_enabled(actor.team_id,'sales_os_v3')
    or not(public.has_permission(actor.team_id,'leads.submit')
      or(p_intake_source in('field_visit','site_hoarding')and public.has_permission(actor.team_id,'customers.manage')))then
    raise exception'LEAD_SUBMIT_FORBIDDEN'using errcode='42501';end if;
  normalized_phone:=nullif(pg_catalog.regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),'');
  if normalized_phone is not null and char_length(normalized_phone)not between 6 and 20 then
    raise exception'LEAD_PHONE_INVALID'using errcode='22023';end if;
  if normalized_phone is null and p_intake_source='operations'then
    raise exception'FIELD_SOURCE_REQUIRED_WITHOUT_PHONE'using errcode='22023';end if;
  select sr.*into region_row from public.sales_regions sr
  where sr.id=public.resolve_active_sales_region(actor.team_id,p_region_text,p_address)
    and sr.team_id=actor.team_id and sr.is_active;
  if normalized_phone is not null then
    result:=public.submit_operations_lead_legacy_inner(p_customer_name,p_contact_name,p_phone,
      coalesce(region_row.name,p_region_text),p_address,p_notes,p_raw_text);
    update public.crm_leads set intake_source=p_intake_source,contactability_status='ready',
      contact_ready_at=coalesce(contact_ready_at,created_at),source=case p_intake_source
        when'field_visit'then'现场线索'when'site_hoarding'then'围挡线索'else'运维转交'end
    where id=(result->>'leadId')::uuid and team_id=actor.team_id;
    update public.crm_lead_submissions set intake_source=p_intake_source
    where lead_id=(result->>'leadId')::uuid and team_id=actor.team_id and submitted_by=actor.id
      and id=(select s.id from public.crm_lead_submissions s where s.team_id=actor.team_id
        and s.lead_id=(result->>'leadId')::uuid and s.submitted_by=actor.id order by s.created_at desc,s.id limit 1);
    return result;
  end if;
  if region_row.id is null then
    insert into public.sales_regions(team_id,code,name,region_level,is_active)
    values(actor.team_id,'UNMATCHED_LEAD_POOL','待分区公海','custom',true)
    on conflict(team_id,code)do update set name=excluded.name,is_active=true returning*into fallback;
    region_row:=fallback;assignment:='unmatched_pool';
  else
    select p.*into owner_row from public.profile_sales_regions psr join public.profiles p
      on p.id=psr.profile_id and p.team_id=psr.team_id and p.status='active'
    where psr.team_id=actor.team_id and psr.region_id=region_row.id and exists(
      select 1 from public.profile_access_roles par join public.access_roles ar on ar.id=par.role_id and ar.team_id=par.team_id
      where par.team_id=psr.team_id and par.profile_id=psr.profile_id and ar.code='sales')
    order by(select count(*)from public.crm_leads l where l.team_id=actor.team_id and l.region_id=region_row.id and l.owner_id=p.id),p.id limit 1;
    assignment:=case when owner_row.id is null then'regional_pool'else'assigned'end;
  end if;
  insert into public.crm_leads(team_id,region_id,title,contact_name,source,status,owner_id,claimed_at,created_by,
    contactability_status,intake_source,contact_ready_at)
  values(actor.team_id,region_row.id,trim(p_customer_name),nullif(trim(p_contact_name),''),
    case p_intake_source when'field_visit'then'现场线索'else'围挡线索'end,
    case when owner_row.id is null then'public'else'claimed'end,owner_row.id,null,actor.id,
    'pending_contact',p_intake_source,null)returning*into lead_row;
  insert into public.crm_lead_submissions(team_id,lead_id,submitted_by,customer_name,contact_name,phone_normalized,
    region_text,address,notes,raw_text,assignment_type,assigned_owner_id,matched_region_id,intake_source)
  values(actor.team_id,lead_row.id,actor.id,trim(p_customer_name),nullif(trim(p_contact_name),''),null,
    nullif(trim(p_region_text),''),nullif(trim(p_address),''),nullif(trim(p_notes),''),nullif(trim(p_raw_text),''),
    assignment,owner_row.id,region_row.id,p_intake_source);
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)
  values(actor.team_id,actor.id,'lead.field_submitted','crm_lead',lead_row.id,jsonb_build_object(
    'contactabilityStatus','pending_contact','intakeSource',p_intake_source,'assignmentType',assignment,'regionId',region_row.id));
  return jsonb_build_object('leadId',lead_row.id,'assignmentType',assignment,'owner',owner_row.id,
    'ownerName',owner_row.name,'region',region_row.id,'regionName',region_row.name,'duplicate',false,'contactPending',true);
end
$submit_operations_lead$;

create or replace function public.submit_operations_lead(
  p_customer_name text,p_contact_name text,p_phone text,p_region_text text,p_address text,
  p_notes text default null,p_raw_text text default null
)returns jsonb language sql security invoker set search_path=''
as $submit_operations_lead_compat$
  select public.submit_operations_lead(p_customer_name,p_contact_name,p_phone,p_region_text,p_address,p_notes,p_raw_text,'operations')
$submit_operations_lead_compat$;

create or replace function public.complete_lead_contact(p_lead_id uuid,p_contact_name text,p_phone text)
returns uuid language plpgsql security definer set search_path=''
as $complete_lead_contact$
declare actor public.profiles;lead_row public.crm_leads;digits text;before_state jsonb;
begin
  select p.*into actor from public.profiles p where p.id=auth.uid()and p.status='active';
  select l.*into lead_row from public.crm_leads l where l.id=p_lead_id for update;
  digits:=pg_catalog.regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  if actor.id is null or lead_row.id is null or actor.team_id<>lead_row.team_id
    or not(lead_row.owner_id=actor.id or public.can_act_for(actor.team_id,lead_row.owner_id)
      or public.has_permission(actor.team_id,'customers.supervise'))then raise exception'LEAD_EDIT_FORBIDDEN'using errcode='42501';end if;
  if char_length(digits)not between 6 and 20 then raise exception'LEAD_PHONE_INVALID'using errcode='22023';end if;
  before_state:=jsonb_build_object('contactabilityStatus',lead_row.contactability_status,'claimedAt',lead_row.claimed_at);
  insert into public.crm_lead_private(lead_id,team_id,phone,updated_by)values(lead_row.id,lead_row.team_id,trim(p_phone),actor.id)
  on conflict(lead_id)do update set phone=excluded.phone,updated_by=actor.id,updated_at=now();
  update public.crm_leads set contact_name=coalesce(nullif(trim(p_contact_name),''),contact_name),
    contactability_status='ready',contact_ready_at=now(),claimed_at=case when owner_id is null then null else now()end,
    attention_status='normal',updated_at=now()where id=lead_row.id;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
  values(lead_row.team_id,actor.id,'lead.contact_completed','crm_lead',lead_row.id,before_state,
    jsonb_build_object('contactabilityStatus','ready','phoneProvided',true,'contactReadyAt',now()));
  return lead_row.id;
end
$complete_lead_contact$;

create or replace function public.hold_uncontactable_lead_clock()
returns trigger language plpgsql set search_path=''
as $hold_uncontactable_lead_clock$
begin
  if new.contactability_status='pending_contact'then
    new.claimed_at:=null;new.attention_status:='normal';new.last_contact_attempt_at:=null;
  end if;return new;
end
$hold_uncontactable_lead_clock$;
drop trigger if exists crm_lead_contact_clock_guard on public.crm_leads;
create trigger crm_lead_contact_clock_guard before insert or update on public.crm_leads
for each row execute function public.hold_uncontactable_lead_clock();

create or replace function public.enforce_contactable_lead_qualification()
returns trigger language plpgsql set search_path=''
as $enforce_contactable_lead_qualification$
begin
  if new.lead_id is not null and exists(select 1 from public.crm_leads l where l.id=new.lead_id
    and l.team_id=new.team_id and l.contactability_status<>'ready')then
    new.qualification_valid:=false;new.qualification_reason:='Lead contact details are required';
  end if;return new;
end
$enforce_contactable_lead_qualification$;
drop trigger if exists zz_crm_opportunity_contact_guard on public.crm_opportunities;
create trigger zz_crm_opportunity_contact_guard before insert or update on public.crm_opportunities
for each row execute function public.enforce_contactable_lead_qualification();

-- Preserve current configuration behind immutable version snapshots, while
-- making each admin save clone/edit/publish in one transaction.
alter function public.manage_catalog_draft_item(uuid,text,text,text,numeric,numeric,numeric,text[],boolean)
  rename to manage_catalog_draft_item_versioned_inner;
alter function public.manage_draft_package(uuid,text,text,text,boolean,jsonb,uuid)
  rename to manage_draft_package_versioned_inner;
revoke all on function public.manage_catalog_draft_item_versioned_inner(uuid,text,text,text,numeric,numeric,numeric,text[],boolean),
  public.manage_draft_package_versioned_inner(uuid,text,text,text,boolean,jsonb,uuid)from public,anon,authenticated;

create or replace function public.manage_catalog_draft_item(p_item_id uuid,p_sku text,p_name text,p_item_type text,
  p_procurement_cost numeric,p_customer_list_price numeric,p_points numeric,p_applicable_business_types text[],p_is_active boolean)
returns uuid language plpgsql security definer set search_path=''
as $manage_catalog_draft_item$
declare actor public.profiles;source_sku text;draft_id uuid;target_id uuid;result_id uuid;
begin
  select p.*into actor from public.profiles p where p.id=auth.uid()and p.status='active';
  if actor.id is null or not public.has_access_role(actor.team_id,array['owner','admin'])then raise exception'ADMIN_REQUIRED'using errcode='42501';end if;
  if p_item_id is not null then select i.sku into source_sku from public.deal_catalog_items i where i.id=p_item_id and i.team_id=actor.team_id;end if;
  draft_id:=public.create_catalog_draft_from_latest(gen_random_uuid());
  if p_item_id is not null then select i.id into target_id from public.deal_catalog_items i
    where i.team_id=actor.team_id and i.catalog_version_id=draft_id and i.sku=source_sku;end if;
  result_id:=public.manage_catalog_draft_item_versioned_inner(target_id,p_sku,p_name,p_item_type,p_procurement_cost,
    p_customer_list_price,p_points,p_applicable_business_types,p_is_active);
  perform public.publish_catalog_draft(draft_id,gen_random_uuid());return result_id;
end
$manage_catalog_draft_item$;

create or replace function public.manage_draft_package(p_package_id uuid,p_code text,p_name text,p_business_type text,
  p_is_active boolean,p_lines jsonb,p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path=''
as $manage_draft_package$
declare actor public.profiles;source_code text;draft_id uuid;target_id uuid;result_id uuid;translated jsonb;
  prior public.deal_package_admin_requests;request_hash text;
begin
  select p.*into actor from public.profiles p where p.id=auth.uid()and p.status='active';
  if actor.id is null or not public.has_access_role(actor.team_id,array['owner','admin'])then raise exception'ADMIN_REQUIRED'using errcode='42501';end if;
  if p_idempotency_key is null then raise exception'IDEMPOTENCY_KEY_REQUIRED'using errcode='22023';end if;
  request_hash:=md5(jsonb_build_object('packageId',p_package_id,'code',upper(trim(p_code)),'name',trim(p_name),
    'businessType',p_business_type,'isActive',p_is_active,'lines',p_lines)::text);
  select r.*into prior from public.deal_package_admin_requests r
  where r.team_id=actor.team_id and r.idempotency_key=p_idempotency_key;
  if prior.package_id is not null then
    if prior.request_hash<>request_hash then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;
    return prior.package_id;
  end if;
  if p_package_id is not null then select pkg.code into source_code from public.deal_packages pkg where pkg.id=p_package_id and pkg.team_id=actor.team_id;end if;
  draft_id:=public.create_catalog_draft_from_latest(gen_random_uuid());
  if p_package_id is not null then select pkg.id into target_id from public.deal_packages pkg
    where pkg.team_id=actor.team_id and pkg.catalog_version_id=draft_id and pkg.code=source_code;end if;
  select jsonb_agg(jsonb_build_object('catalog_item_id',ni.id,'quantity',x.quantity)order by x.ordinality)into translated
  from jsonb_array_elements(p_lines)with ordinality e(value,ordinality)
  join lateral(select (e.value->>'catalog_item_id')::uuid old_id,(e.value->>'quantity')::numeric quantity,e.ordinality)x on true
  join public.deal_catalog_items oi on oi.id=x.old_id and oi.team_id=actor.team_id
  join public.deal_catalog_items ni on ni.team_id=actor.team_id and ni.catalog_version_id=draft_id and ni.sku=oi.sku;
  result_id:=public.manage_draft_package_versioned_inner(target_id,p_code,p_name,p_business_type,p_is_active,translated,p_idempotency_key);
  perform public.publish_catalog_draft(draft_id,gen_random_uuid());return result_id;
end
$manage_draft_package$;

create or replace function public.get_catalog_item_admin_snapshot()
returns jsonb language plpgsql security definer stable set search_path=''
as $get_catalog_item_admin_snapshot$
declare actor public.profiles;current_version public.deal_catalog_versions;
begin
  select p.*into actor from public.profiles p where p.id=auth.uid()and p.status='active';
  if actor.id is null or not public.has_access_role(actor.team_id,array['owner','admin'])then raise exception'ADMIN_REQUIRED'using errcode='42501';end if;
  select v.*into current_version from public.deal_catalog_versions v where v.team_id=actor.team_id
    and v.status in('draft','published')order by case when v.status='draft'then 0 else 1 end,v.version_no desc limit 1;
  return jsonb_build_object('draftVersionId',current_version.id,'draftVersionNo',current_version.version_no,
    'currentVersionStatus',current_version.status,'publishedVersionNo',(select max(v.version_no)from public.deal_catalog_versions v where v.team_id=actor.team_id and v.status='published'),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'sku',i.sku,'name',i.name,'itemType',i.item_type,
      'procurementCost',i.procurement_cost,'customerListPrice',i.customer_list_price,'points',i.points,
      'applicableBusinessTypes',to_jsonb(i.applicable_business_types),'isActive',i.is_active)order by i.is_active desc,i.item_type,i.name)
      from public.deal_catalog_items i where i.team_id=actor.team_id and i.catalog_version_id=current_version.id),'[]'::jsonb));
end
$get_catalog_item_admin_snapshot$;

create or replace function public.get_package_admin_snapshot()
returns jsonb language plpgsql security definer stable set search_path=''
as $get_package_admin_snapshot$
declare actor public.profiles;current_version public.deal_catalog_versions;
begin
  select p.*into actor from public.profiles p where p.id=auth.uid()and p.status='active';
  if actor.id is null or not public.has_access_role(actor.team_id,array['owner','admin'])then raise exception'ADMIN_REQUIRED'using errcode='42501';end if;
  select v.*into current_version from public.deal_catalog_versions v where v.team_id=actor.team_id
    and v.status in('draft','published')order by case when v.status='draft'then 0 else 1 end,v.version_no desc limit 1;
  return jsonb_build_object('draftVersionId',current_version.id,'draftVersionNo',current_version.version_no,
    'currentVersionStatus',current_version.status,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'sku',i.sku,'name',i.name,'itemType',i.item_type,'listPrice',i.customer_list_price)
      order by i.item_type,i.name)from public.deal_catalog_items i where i.team_id=actor.team_id and i.catalog_version_id=current_version.id and i.is_active),'[]'::jsonb),
    'packages',coalesce((select jsonb_agg(jsonb_build_object('id',pkg.id,'code',pkg.code,'name',pkg.name,
      'businessType',pkg.business_type,'isActive',pkg.is_active,'lines',coalesce((select jsonb_agg(jsonb_build_object(
        'catalogItemId',pi.catalog_item_id,'quantity',pi.quantity)order by i.name)from public.deal_package_items pi
        join public.deal_catalog_items i on i.id=pi.catalog_item_id and i.team_id=pi.team_id
        where pi.team_id=actor.team_id and pi.package_id=pkg.id),'[]'::jsonb))order by pkg.is_active desc,pkg.name)
      from public.deal_packages pkg where pkg.team_id=actor.team_id and pkg.catalog_version_id=current_version.id),'[]'::jsonb));
end
$get_package_admin_snapshot$;

revoke all on function public.resolve_active_sales_region(text,text,text),public.match_lead_sales_region(text,text),
  public.submit_operations_lead(text,text,text,text,text,text,text,text),public.submit_operations_lead(text,text,text,text,text,text,text),
  public.complete_lead_contact(uuid,text,text),public.hold_uncontactable_lead_clock(),public.enforce_contactable_lead_qualification(),
  public.manage_catalog_draft_item(uuid,text,text,text,numeric,numeric,numeric,text[],boolean),
  public.manage_draft_package(uuid,text,text,text,boolean,jsonb,uuid),public.get_catalog_item_admin_snapshot(),
  public.get_package_admin_snapshot()from public,anon;
grant execute on function public.match_lead_sales_region(text,text),
  public.submit_operations_lead(text,text,text,text,text,text,text,text),public.submit_operations_lead(text,text,text,text,text,text,text),
  public.complete_lead_contact(uuid,text,text),
  public.manage_catalog_draft_item(uuid,text,text,text,numeric,numeric,numeric,text[],boolean),
  public.manage_draft_package(uuid,text,text,text,boolean,jsonb,uuid),public.get_catalog_item_admin_snapshot(),
  public.get_package_admin_snapshot()to authenticated;
notify pgrst,'reload schema';
