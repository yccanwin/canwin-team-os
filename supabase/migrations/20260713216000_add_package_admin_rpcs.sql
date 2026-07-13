-- B5 fixed package configuration for draft catalog versions.

alter table public.deal_packages
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.deal_package_admin_requests (
  team_id text not null references public.teams(id) on delete cascade,
  idempotency_key uuid not null,
  request_hash text not null,
  package_id uuid not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(team_id, idempotency_key),
  foreign key(team_id, package_id) references public.deal_packages(team_id, id)
);
alter table public.deal_package_admin_requests enable row level security;

create or replace function public.get_package_admin_snapshot()
returns jsonb language plpgsql security definer set search_path = '' stable
as $get_package_admin_snapshot$
declare actor public.profiles; draft public.deal_catalog_versions;
begin
  select * into actor from public.profiles where id = auth.uid() and status = 'active';
  if actor.id is null or not public.has_access_role(actor.team_id, array['owner','admin']) then raise exception 'ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into draft from public.deal_catalog_versions where team_id = actor.team_id and status = 'draft' order by version_no desc limit 1;
  return jsonb_build_object(
    'draftVersionId', draft.id, 'draftVersionNo', draft.version_no,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'sku',i.sku,'name',i.name,'itemType',i.item_type,'listPrice',i.customer_list_price) order by i.item_type,i.name)
      from public.deal_catalog_items i where i.team_id = actor.team_id and i.catalog_version_id = draft.id and i.is_active), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(jsonb_build_object(
      'id',pkg.id,'code',pkg.code,'name',pkg.name,'businessType',pkg.business_type,'isActive',pkg.is_active,
      'lines',coalesce((select jsonb_agg(jsonb_build_object('catalogItemId',pi.catalog_item_id,'quantity',pi.quantity) order by i.name)
        from public.deal_package_items pi join public.deal_catalog_items i on i.id=pi.catalog_item_id and i.team_id=pi.team_id
        where pi.team_id=actor.team_id and pi.package_id=pkg.id),'[]'::jsonb)
    ) order by pkg.is_active desc,pkg.name) from public.deal_packages pkg
      where pkg.team_id=actor.team_id and pkg.catalog_version_id=draft.id), '[]'::jsonb)
  );
end
$get_package_admin_snapshot$;

create or replace function public.manage_draft_package(
  p_package_id uuid,p_code text,p_name text,p_business_type text,p_is_active boolean,p_lines jsonb,p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path = ''
as $manage_draft_package$
declare actor public.profiles;draft public.deal_catalog_versions;target public.deal_packages;prior public.deal_package_admin_requests;
  line jsonb;item public.deal_catalog_items;qty numeric;before_state jsonb;after_state jsonb;request_hash text;
begin
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode='22023'; end if;
  select * into actor from public.profiles where id=auth.uid() and status='active';
  if actor.id is null or not public.has_access_role(actor.team_id,array['owner','admin']) then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if trim(coalesce(p_code,'')) !~ '^[A-Za-z0-9_-]{2,40}$' then raise exception 'INVALID_PACKAGE_CODE' using errcode='23514'; end if;
  if char_length(trim(coalesce(p_name,'')))<2 or char_length(trim(p_name))>80 then raise exception 'INVALID_PACKAGE_NAME' using errcode='23514'; end if;
  if p_business_type not in ('fast_food','chinese','hotpot','barbecue','beverage','bakery','banquet','international') then raise exception 'INVALID_BUSINESS_TYPE' using errcode='23514'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'PACKAGE_LINES_REQUIRED' using errcode='23514'; end if;
  if (select count(*) from jsonb_array_elements(p_lines))<>(select count(distinct value->>'catalog_item_id') from jsonb_array_elements(p_lines)) then raise exception 'DUPLICATE_PACKAGE_ITEM' using errcode='23514'; end if;
  request_hash:=md5(jsonb_build_object('packageId',p_package_id,'code',upper(trim(p_code)),'name',trim(p_name),'businessType',p_business_type,'isActive',p_is_active,'lines',p_lines)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.team_id,2));
  select * into prior from public.deal_package_admin_requests where team_id=actor.team_id and idempotency_key=p_idempotency_key;
  if prior.package_id is not null then if prior.request_hash<>request_hash then raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode='23505'; end if; return prior.package_id; end if;
  select * into draft from public.deal_catalog_versions where team_id=actor.team_id and status='draft' order by version_no desc limit 1 for update;
  if draft.id is null then raise exception 'DRAFT_CATALOG_REQUIRED' using errcode='23514'; end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    qty:=nullif(line->>'quantity','')::numeric;
    select * into item from public.deal_catalog_items where id=nullif(line->>'catalog_item_id','')::uuid and team_id=actor.team_id and catalog_version_id=draft.id and is_active;
    if item.id is null or qty is null or qty<=0 then raise exception 'INVALID_PACKAGE_ITEM' using errcode='23514'; end if;
  end loop;
  if p_package_id is null then
    insert into public.deal_packages(team_id,catalog_version_id,code,name,business_type,is_active)
    values(actor.team_id,draft.id,upper(trim(p_code)),trim(p_name),p_business_type,coalesce(p_is_active,true)) returning * into target;
  else
    select * into target from public.deal_packages where id=p_package_id and team_id=actor.team_id and catalog_version_id=draft.id for update;
    if target.id is null then raise exception 'DRAFT_PACKAGE_NOT_FOUND' using errcode='P0002'; end if;
    select jsonb_build_object('package',to_jsonb(target),'lines',coalesce(jsonb_agg(to_jsonb(pi)),'[]'::jsonb)) into before_state
      from public.deal_package_items pi where pi.team_id=actor.team_id and pi.package_id=target.id;
    update public.deal_packages set code=upper(trim(p_code)),name=trim(p_name),business_type=p_business_type,is_active=coalesce(p_is_active,target.is_active),updated_at=now()
      where id=target.id returning * into target;
  end if;
  delete from public.deal_package_items where team_id=actor.team_id and package_id=target.id;
  insert into public.deal_package_items(team_id,package_id,catalog_item_id,quantity)
    select actor.team_id,target.id,(value->>'catalog_item_id')::uuid,(value->>'quantity')::numeric from jsonb_array_elements(p_lines);
  select jsonb_build_object('package',to_jsonb(target),'lines',coalesce(jsonb_agg(to_jsonb(pi)),'[]'::jsonb)) into after_state
    from public.deal_package_items pi where pi.team_id=actor.team_id and pi.package_id=target.id;
  insert into public.deal_package_admin_requests(team_id,idempotency_key,request_hash,package_id,actor_id) values(actor.team_id,p_idempotency_key,request_hash,target.id,actor.id);
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
    values(actor.team_id,actor.id,case when p_package_id is null then 'catalog.package_created' else 'catalog.package_updated' end,'deal_package',target.id,before_state,after_state);
  return target.id;
end
$manage_draft_package$;

-- Preserve the hardened quote implementation behind a non-callable inner name,
-- then validate active published sources before delegating to it.
alter function public.replace_deal_quote_lines(uuid,jsonb) rename to replace_deal_quote_lines_b5_inner;
revoke all on function public.replace_deal_quote_lines_b5_inner(uuid,jsonb) from public,anon,authenticated;
create or replace function public.replace_deal_quote_lines(p_quote_id uuid,p_lines jsonb) returns uuid
language plpgsql security definer set search_path=''
as $replace_deal_quote_lines$
declare actor public.profiles;q public.deal_quotes;line jsonb;kind text;source uuid;
begin
  select * into actor from public.profiles where id=auth.uid() and status='active';
  select * into q from public.deal_quotes where id=p_quote_id;
  if actor.id is null or q.id is null or actor.team_id<>q.team_id then raise exception 'QUOTE_EDIT_FORBIDDEN' using errcode='42501'; end if;
  if jsonb_typeof(p_lines)<>'array' then raise exception 'QUOTE_LINES_REQUIRED' using errcode='22023'; end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    kind:=line->>'kind';source:=nullif(line->>'source_id','')::uuid;
    if kind='package' then
      if not exists(select 1 from public.deal_packages pkg join public.deal_catalog_versions v on v.id=pkg.catalog_version_id and v.team_id=pkg.team_id
        where pkg.id=source and pkg.team_id=q.team_id and pkg.is_active and v.status='published') then raise exception 'ACTIVE_PUBLISHED_PACKAGE_REQUIRED' using errcode='P0002'; end if;
    elsif kind in('hardware','addon') then
      if not exists(select 1 from public.deal_catalog_items i join public.deal_catalog_versions v on v.id=i.catalog_version_id and v.team_id=i.team_id
        where i.id=source and i.team_id=q.team_id and i.is_active and v.status='published') then raise exception 'ACTIVE_PUBLISHED_ITEM_REQUIRED' using errcode='P0002'; end if;
    end if;
  end loop;
  return public.replace_deal_quote_lines_b5_inner(p_quote_id,p_lines);
end
$replace_deal_quote_lines$;

revoke all on function public.get_package_admin_snapshot(),public.manage_draft_package(uuid,text,text,text,boolean,jsonb,uuid),public.replace_deal_quote_lines(uuid,jsonb) from public,anon;
grant execute on function public.get_package_admin_snapshot(),public.manage_draft_package(uuid,text,text,text,boolean,jsonb,uuid),public.replace_deal_quote_lines(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
