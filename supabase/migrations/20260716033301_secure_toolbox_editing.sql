-- Toolbox writes are server-owned: callers cannot forge owners or bypass audit.
create table if not exists public.toolbox_categories (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,47}$'),
  name text not null check (char_length(trim(name)) between 1 and 40),
  sort_order integer not null default 0,
  is_system boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, code),
  unique (team_id, name)
);

create index if not exists toolbox_categories_order_idx
on public.toolbox_categories(team_id, sort_order, created_at);

alter table public.toolbox_categories enable row level security;

drop policy if exists "team members read toolbox categories" on public.toolbox_categories;
create policy "team members read toolbox categories"
on public.toolbox_categories for select to authenticated
using (public.is_team_member(team_id));

insert into public.toolbox_categories(team_id,code,name,sort_order,is_system)
select t.id,v.code,v.name,v.sort_order,v.is_system
from public.teams t
cross join (values
  ('all','全部',0,true),
  ('efficiency','效率工具',10,false),
  ('design','设计资源',20,false),
  ('dev','开发利器',30,false),
  ('marketing','营销运营',40,false),
  ('other','其他',50,false)
)as v(code,name,sort_order,is_system)
on conflict(team_id,code)do update set
  name=excluded.name,
  sort_order=excluded.sort_order,
  is_system=excluded.is_system,
  updated_at=now();

-- Preserve unknown historic category codes as editable categories.
insert into public.toolbox_categories(team_id,code,name,sort_order,is_system)
select distinct t.team_id,t.category,t.category,
  100+row_number()over(partition by t.team_id order by t.category),false
from public.tools t
where t.category is not null and trim(t.category)<>'' and t.category<>'all'
  and t.category~'^[a-z][a-z0-9_]{1,47}$'
on conflict(team_id,code)do nothing;

create or replace function public.toolbox_is_admin(p_team_id text)
returns boolean
language sql
security definer
set search_path=''
stable
as $function$
  select exists(
    select 1 from public.profiles p
    where p.id=auth.uid() and p.team_id=p_team_id and p.status='active'
      and (
        p.role='admin'
        or public.has_access_role(p_team_id,array['owner','admin'])
        or public.has_permission(p_team_id,'access.manage')
      )
  )
$function$;

create or replace function public.toolbox_create_tool(
  p_title text,p_url text,p_description text,p_category_code text
)
returns public.tools
language plpgsql
security definer
set search_path=''
as $function$
declare v_profile public.profiles;v_tool public.tools;
begin
  select * into v_profile from public.profiles
  where id=auth.uid() and status='active';
  if v_profile.id is null then raise exception 'TOOLBOX_MEMBER_REQUIRED' using errcode='42501';end if;
  if nullif(trim(p_title),'')is null or nullif(trim(p_url),'')is null then
    raise exception 'TOOLBOX_REQUIRED_FIELDS' using errcode='22023';
  end if;
  if not exists(select 1 from public.toolbox_categories c where c.team_id=v_profile.team_id and c.code=p_category_code and c.code<>'all')then
    raise exception 'TOOLBOX_CATEGORY_INVALID' using errcode='22023';
  end if;
  insert into public.tools(team_id,title,url,description,category,created_by)
  values(v_profile.team_id,trim(p_title),trim(p_url),p_description,p_category_code,v_profile.id)
  returning * into v_tool;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)
  values(v_profile.team_id,v_profile.id,'toolbox.tool_created','tool',v_tool.id,to_jsonb(v_tool));
  return v_tool;
end
$function$;

create or replace function public.toolbox_update_tool(
  p_tool_id uuid,p_title text,p_url text,p_description text,p_category_code text
)
returns public.tools
language plpgsql
security definer
set search_path=''
as $function$
declare v_profile public.profiles;v_before public.tools;v_after public.tools;
begin
  select * into v_profile from public.profiles where id=auth.uid() and status='active';
  select * into v_before from public.tools where id=p_tool_id for update;
  if v_profile.id is null or v_before.id is null or v_before.team_id<>v_profile.team_id
    or not(v_before.created_by=v_profile.id or public.toolbox_is_admin(v_profile.team_id))then
    raise exception 'TOOLBOX_TOOL_UPDATE_FORBIDDEN' using errcode='42501';
  end if;
  if nullif(trim(p_title),'')is null or nullif(trim(p_url),'')is null then
    raise exception 'TOOLBOX_REQUIRED_FIELDS' using errcode='22023';
  end if;
  if not exists(select 1 from public.toolbox_categories c where c.team_id=v_profile.team_id and c.code=p_category_code and c.code<>'all')then
    raise exception 'TOOLBOX_CATEGORY_INVALID' using errcode='22023';
  end if;
  update public.tools set title=trim(p_title),url=trim(p_url),description=p_description,
    category=p_category_code,updated_at=now()
  where id=p_tool_id returning * into v_after;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
  values(v_profile.team_id,v_profile.id,'toolbox.tool_updated','tool',v_after.id,to_jsonb(v_before),to_jsonb(v_after));
  return v_after;
end
$function$;

create or replace function public.toolbox_delete_tool(p_tool_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare v_profile public.profiles;v_before public.tools;
begin
  select * into v_profile from public.profiles where id=auth.uid() and status='active';
  select * into v_before from public.tools where id=p_tool_id for update;
  if v_profile.id is null or v_before.id is null or v_before.team_id<>v_profile.team_id
    or not(v_before.created_by=v_profile.id or public.toolbox_is_admin(v_profile.team_id))then
    raise exception 'TOOLBOX_TOOL_DELETE_FORBIDDEN' using errcode='42501';
  end if;
  delete from public.tools where id=p_tool_id;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data)
  values(v_profile.team_id,v_profile.id,'toolbox.tool_deleted','tool',v_before.id,to_jsonb(v_before));
  return v_before.id;
end
$function$;

create or replace function public.toolbox_toggle_tool_like(p_tool_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $function$
declare v_profile public.profiles;v_tool public.tools;v_meta jsonb;v_likes jsonb;v_liked boolean;
begin
  select * into v_profile from public.profiles where id=auth.uid() and status='active';
  select * into v_tool from public.tools where id=p_tool_id for update;
  if v_profile.id is null or v_tool.id is null or v_tool.team_id<>v_profile.team_id then
    raise exception 'TOOLBOX_TOOL_NOT_VISIBLE' using errcode='42501';
  end if;
  begin v_meta:=coalesce(v_tool.description,'{}')::jsonb;
  exception when others then v_meta:=jsonb_build_object('description',coalesce(v_tool.description,''));end;
  if jsonb_typeof(v_meta)<>'object'then v_meta:=jsonb_build_object('description',coalesce(v_tool.description,''));end if;
  v_likes:=case when jsonb_typeof(v_meta->'likedBy')='array'then v_meta->'likedBy' else '[]'::jsonb end;
  v_liked:=v_likes ? v_profile.id::text;
  if v_liked then
    select coalesce(jsonb_agg(x.value),'[]'::jsonb)into v_likes
    from jsonb_array_elements_text(v_likes)as x(value)
    where x.value<>v_profile.id::text;
  else
    v_likes:=v_likes||to_jsonb(v_profile.id::text);
  end if;
  v_meta:=jsonb_set(v_meta,'{likedBy}',v_likes,true);
  update public.tools set description=v_meta::text,updated_at=now()where id=v_tool.id;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
  values(v_profile.team_id,v_profile.id,case when v_liked then'toolbox.tool_unliked'else'toolbox.tool_liked'end,
    'tool',v_tool.id,jsonb_build_object('liked',v_liked),jsonb_build_object('liked',not v_liked));
  return not v_liked;
end
$function$;

create or replace function public.toolbox_list_categories()
returns table(id uuid,code text,name text,sort_order integer,is_system boolean,tool_count bigint)
language sql
security definer
set search_path=''
stable
as $function$
  select c.id,c.code,c.name,c.sort_order,c.is_system,
    case when c.code='all'then(select count(*)from public.tools t where t.team_id=c.team_id)
      else(select count(*)from public.tools t where t.team_id=c.team_id and t.category=c.code)end
  from public.toolbox_categories c
  join public.profiles p on p.team_id=c.team_id
  where p.id=auth.uid()and p.status='active'
  order by c.sort_order,c.created_at
$function$;

create or replace function public.toolbox_create_category(p_name text)
returns public.toolbox_categories
language plpgsql
security definer
set search_path=''
as $function$
declare v_profile public.profiles;v_category public.toolbox_categories;v_code text;
begin
  select * into v_profile from public.profiles where id=auth.uid()and status='active';
  if v_profile.id is null then raise exception 'TOOLBOX_MEMBER_REQUIRED'using errcode='42501';end if;
  if nullif(trim(p_name),'')is null or char_length(trim(p_name))>40 then raise exception'TOOLBOX_CATEGORY_NAME_INVALID'using errcode='22023';end if;
  v_code:='custom_'||substr(replace(gen_random_uuid()::text,'-',''),1,16);
  insert into public.toolbox_categories(team_id,code,name,sort_order,created_by,updated_by)
  select v_profile.team_id,v_code,trim(p_name),coalesce(max(sort_order),0)+10,v_profile.id,v_profile.id
  from public.toolbox_categories where team_id=v_profile.team_id returning*into v_category;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)
  values(v_profile.team_id,v_profile.id,'toolbox.category_created','toolbox_category',v_category.id,to_jsonb(v_category));
  return v_category;
end
$function$;

create or replace function public.toolbox_update_category(p_category_id uuid,p_name text,p_sort_order integer)
returns public.toolbox_categories
language plpgsql
security definer
set search_path=''
as $function$
declare v_profile public.profiles;v_before public.toolbox_categories;v_after public.toolbox_categories;
begin
  select * into v_profile from public.profiles where id=auth.uid()and status='active';
  select * into v_before from public.toolbox_categories where id=p_category_id for update;
  if v_profile.id is null or v_before.id is null or v_before.team_id<>v_profile.team_id then raise exception'TOOLBOX_CATEGORY_FORBIDDEN'using errcode='42501';end if;
  if v_before.is_system then raise exception'TOOLBOX_SYSTEM_CATEGORY_IMMUTABLE'using errcode='42501';end if;
  if nullif(trim(p_name),'')is null or char_length(trim(p_name))>40 then raise exception'TOOLBOX_CATEGORY_NAME_INVALID'using errcode='22023';end if;
  update public.toolbox_categories set name=trim(p_name),sort_order=coalesce(p_sort_order,sort_order),updated_by=v_profile.id,updated_at=now()
  where id=p_category_id returning*into v_after;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
  values(v_profile.team_id,v_profile.id,'toolbox.category_updated','toolbox_category',v_after.id,to_jsonb(v_before),to_jsonb(v_after));
  return v_after;
end
$function$;

create or replace function public.toolbox_reorder_categories(p_category_ids uuid[])
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare v_profile public.profiles;v_id uuid;v_index integer:=0;
begin
  select * into v_profile from public.profiles where id=auth.uid()and status='active';
  if v_profile.id is null then raise exception'TOOLBOX_MEMBER_REQUIRED'using errcode='42501';end if;
  if cardinality(p_category_ids)<>coalesce((select count(distinct x)from unnest(p_category_ids)x),0)then raise exception'TOOLBOX_CATEGORY_ORDER_DUPLICATE'using errcode='22023';end if;
  foreach v_id in array p_category_ids loop
    if not exists(select 1 from public.toolbox_categories where id=v_id and team_id=v_profile.team_id and not is_system)then raise exception'TOOLBOX_CATEGORY_FORBIDDEN'using errcode='42501';end if;
    v_index:=v_index+1;
    update public.toolbox_categories set sort_order=v_index*10,updated_by=v_profile.id,updated_at=now()where id=v_id;
  end loop;
  insert into public.audit_logs(team_id,actor_id,action,target_type,after_data)
  values(v_profile.team_id,v_profile.id,'toolbox.categories_reordered','toolbox_category',jsonb_build_object('category_ids',p_category_ids));
end
$function$;

create or replace function public.toolbox_delete_category(p_category_id uuid,p_move_to_category_id uuid default null)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare v_profile public.profiles;v_source public.toolbox_categories;v_target public.toolbox_categories;v_count bigint;
begin
  select * into v_profile from public.profiles where id=auth.uid()and status='active';
  select * into v_source from public.toolbox_categories where id=p_category_id for update;
  if v_profile.id is null or v_source.id is null or v_source.team_id<>v_profile.team_id then raise exception'TOOLBOX_CATEGORY_FORBIDDEN'using errcode='42501';end if;
  if v_source.is_system then raise exception'TOOLBOX_SYSTEM_CATEGORY_IMMUTABLE'using errcode='42501';end if;
  select count(*)into v_count from public.tools where team_id=v_source.team_id and category=v_source.code;
  if v_count>0 then
    if p_move_to_category_id is null then raise exception'TOOLBOX_CATEGORY_NOT_EMPTY'using errcode='23503';end if;
    select * into v_target from public.toolbox_categories where id=p_move_to_category_id and team_id=v_source.team_id and code<>'all';
    if v_target.id is null or v_target.id=v_source.id then raise exception'TOOLBOX_MOVE_TARGET_INVALID'using errcode='22023';end if;
    update public.tools set category=v_target.code,updated_at=now()where team_id=v_source.team_id and category=v_source.code;
  end if;
  delete from public.toolbox_categories where id=v_source.id;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
  values(v_profile.team_id,v_profile.id,'toolbox.category_deleted','toolbox_category',v_source.id,to_jsonb(v_source),jsonb_build_object('moved_count',v_count,'target_id',v_target.id));
end
$function$;

-- Direct client mutation is closed; all writes above derive actor/team server-side.
drop policy if exists "team members add tools" on public.tools;
drop policy if exists "owners or captains manage tools" on public.tools;
drop policy if exists "owners or captains delete tools" on public.tools;
revoke insert,update,delete on public.tools from authenticated;
revoke insert,update,delete on public.toolbox_categories from authenticated;

revoke all on function public.toolbox_is_admin(text)from public,anon,authenticated;
revoke all on function public.toolbox_create_tool(text,text,text,text)from public,anon;
revoke all on function public.toolbox_update_tool(uuid,text,text,text,text)from public,anon;
revoke all on function public.toolbox_delete_tool(uuid)from public,anon;
revoke all on function public.toolbox_toggle_tool_like(uuid)from public,anon;
revoke all on function public.toolbox_list_categories()from public,anon;
revoke all on function public.toolbox_create_category(text)from public,anon;
revoke all on function public.toolbox_update_category(uuid,text,integer)from public,anon;
revoke all on function public.toolbox_reorder_categories(uuid[])from public,anon;
revoke all on function public.toolbox_delete_category(uuid,uuid)from public,anon;

grant execute on function public.toolbox_create_tool(text,text,text,text)to authenticated;
grant execute on function public.toolbox_update_tool(uuid,text,text,text,text)to authenticated;
grant execute on function public.toolbox_delete_tool(uuid)to authenticated;
grant execute on function public.toolbox_toggle_tool_like(uuid)to authenticated;
grant execute on function public.toolbox_list_categories()to authenticated;
grant execute on function public.toolbox_create_category(text)to authenticated;
grant execute on function public.toolbox_update_category(uuid,text,integer)to authenticated;
grant execute on function public.toolbox_reorder_categories(uuid[])to authenticated;
grant execute on function public.toolbox_delete_category(uuid,uuid)to authenticated;
grant select on public.toolbox_categories to authenticated;

notify pgrst,'reload schema';
