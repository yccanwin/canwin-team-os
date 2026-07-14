-- UUID has no max()/min() aggregate in PostgreSQL. Keep the public RPC
-- signatures stable while selecting assigned regions deterministically.
create or replace function public.get_quick_lead_context() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  r public.profiles;
  region_count integer;
  default_region uuid;
  regions jsonb;
begin
  select * into r
  from public.profiles
  where id=auth.uid() and status='active';

  if r.id is null
    or not public.is_feature_enabled(r.team_id,'sales_os_v3')
    or not public.has_permission(r.team_id,'customers.manage') then
    raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';
  end if;

  select count(*),
    coalesce(
      jsonb_agg(
        jsonb_build_object('id',sr.id,'name',sr.name)
        order by psr.is_primary desc,sr.name,sr.id
      ),
      '[]'::jsonb
    )
  into region_count,regions
  from public.profile_sales_regions psr
  join public.sales_regions sr
    on sr.id=psr.region_id and sr.team_id=psr.team_id
  where psr.profile_id=r.id
    and psr.team_id=r.team_id
    and sr.is_active;

  select psr.region_id into default_region
  from public.profile_sales_regions psr
  join public.sales_regions sr
    on sr.id=psr.region_id and sr.team_id=psr.team_id
  where psr.profile_id=r.id
    and psr.team_id=r.team_id
    and sr.is_active
    and psr.is_primary
  order by sr.name,sr.id
  limit 1;

  if region_count=1 and default_region is null then
    select psr.region_id into default_region
    from public.profile_sales_regions psr
    join public.sales_regions sr
      on sr.id=psr.region_id and sr.team_id=psr.team_id
    where psr.profile_id=r.id
      and psr.team_id=r.team_id
      and sr.is_active
    order by sr.name,sr.id
    limit 1;
  end if;

  return jsonb_build_object(
    'regions',regions,
    'default_region_id',default_region,
    'requires_region_selection',region_count>1 and default_region is null
  );
end $$;

create or replace function public.create_crm_lead_quick(
  p_title text,
  p_phone text,
  p_source text,
  p_region_id uuid default null
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  r public.profiles;
  selected_region uuid;
  region_count integer;
  l public.crm_leads;
begin
  select * into r
  from public.profiles
  where id=auth.uid() and status='active';

  if r.id is null
    or not public.is_feature_enabled(r.team_id,'sales_os_v3')
    or not public.has_permission(r.team_id,'customers.manage') then
    raise exception 'CRM_MANAGE_FORBIDDEN' using errcode='42501';
  end if;
  if nullif(trim(p_title),'') is null
    or nullif(trim(p_phone),'') is null
    or nullif(trim(p_source),'') is null then
    raise exception 'QUICK_LEAD_REQUIRED_FIELDS' using errcode='22023';
  end if;

  select count(*) into region_count
  from public.profile_sales_regions psr
  join public.sales_regions sr
    on sr.id=psr.region_id and sr.team_id=psr.team_id
  where psr.profile_id=r.id
    and psr.team_id=r.team_id
    and sr.is_active;

  if p_region_id is not null then
    select psr.region_id into selected_region
    from public.profile_sales_regions psr
    join public.sales_regions sr
      on sr.id=psr.region_id and sr.team_id=psr.team_id
    where psr.profile_id=r.id
      and psr.team_id=r.team_id
      and sr.is_active
      and psr.region_id=p_region_id
    order by psr.is_primary desc,sr.name,sr.id
    limit 1;

    if selected_region is null then
      raise exception 'LEAD_REGION_NOT_ASSIGNED' using errcode='22023';
    end if;
  else
    select psr.region_id into selected_region
    from public.profile_sales_regions psr
    join public.sales_regions sr
      on sr.id=psr.region_id and sr.team_id=psr.team_id
    where psr.profile_id=r.id
      and psr.team_id=r.team_id
      and sr.is_active
      and (psr.is_primary or region_count=1)
    order by psr.is_primary desc,sr.name,sr.id
    limit 1;
  end if;

  if selected_region is null then
    raise exception 'LEAD_REGION_SELECTION_REQUIRED' using errcode='22023';
  end if;

  insert into public.crm_leads(
    team_id,region_id,title,contact_name,source,status,
    owner_id,claimed_at,created_by
  ) values (
    r.team_id,selected_region,trim(p_title),trim(p_title),trim(p_source),'claimed',
    r.id,now(),r.id
  ) returning * into l;

  insert into public.crm_lead_private(lead_id,team_id,phone,updated_by)
  values(l.id,r.team_id,trim(p_phone),r.id);
  return l.id;
end $$;

revoke all on function public.get_quick_lead_context(),
  public.create_crm_lead_quick(text,text,text,uuid) from public;
grant execute on function public.get_quick_lead_context(),
  public.create_crm_lead_quick(text,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
