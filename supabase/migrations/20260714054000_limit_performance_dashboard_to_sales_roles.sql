-- Keep management visibility rules, but only include active members explicitly
-- assigned the sales role in sales performance and reconciliation selectors.
create or replace function public.get_performance_management_dashboard(p_quarter_start date)
returns table(
  profile_id uuid,
  profile_name text,
  quarter_start date,
  points_target numeric,
  estimated_points numeric,
  official_points numeric,
  new_gmv_target numeric,
  new_gmv_actual numeric,
  renewal_gmv_target numeric,
  renewal_gmv_actual numeric,
  monthly_observations jsonb,
  can_set_target boolean
)
language plpgsql security definer stable set search_path='' as $function$
declare
  v_profile public.profiles;
begin
  if p_quarter_start<>date_trunc('quarter',p_quarter_start)::date then
    raise exception 'INVALID_QUARTER' using errcode='22023';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.id=auth.uid() and p.status='active';
  if v_profile.id is null
    or not public.is_feature_enabled(v_profile.team_id,'sales_os_v3') then
    raise exception 'PERFORMANCE_FORBIDDEN' using errcode='42501';
  end if;

  return query
  with people as (
    select p.id,p.name
    from public.profiles p
    where p.team_id=v_profile.team_id
      and p.status='active'
      and exists (
        select 1
        from public.profile_access_roles par
        join public.access_roles ar
          on ar.id=par.role_id and ar.team_id=par.team_id
        where par.team_id=p.team_id
          and par.profile_id=p.id
          and ar.code='sales'
      )
      and (
        p.id=v_profile.id
        or public.can_supervise_performance(
          v_profile.team_id,p.id,(now() at time zone 'Asia/Shanghai')::date
        )
        or public.has_access_role(v_profile.team_id,array['owner','admin'])
        or public.has_permission(v_profile.team_id,'finance.read')
      )
  ), months as (
    select generate_series(
      p_quarter_start,
      p_quarter_start+interval '2 months',
      interval '1 month'
    )::date month_start
  )
  select
    p.id,
    p.name,
    p_quarter_start,
    coalesce(t.points_target,0),
    coalesce((
      select sum(o.estimated_points)
      from public.performance_monthly_observations o
      where o.team_id=v_profile.team_id
        and o.profile_id=p.id
        and o.month_start between p_quarter_start and p_quarter_start+interval '2 months'
    ),t.estimated_points,0),
    coalesce(t.official_points,0),
    coalesce(t.new_gmv_target,0),
    coalesce(t.new_gmv_actual,0),
    coalesce(t.renewal_gmv_target,0),
    coalesce(t.renewal_gmv_actual,0),
    (
      select jsonb_agg(
        jsonb_build_object(
          'month_start',m.month_start,
          'estimated_points',coalesce(o.estimated_points,0),
          'new_gmv',coalesce(o.new_gmv,0),
          'renewal_gmv',coalesce(o.renewal_gmv,0),
          'official_points',coalesce(x.official_points,0)
        ) order by m.month_start
      )
      from months m
      left join public.performance_monthly_observations o
        on o.team_id=v_profile.team_id
        and o.profile_id=p.id
        and o.month_start=m.month_start
      left join lateral (
        select sum(l.official_points) official_points
        from public.official_reconciliation_lines l
        join public.official_reconciliation_batches b
          on b.id=l.batch_id and b.team_id=l.team_id and b.status='confirmed'
        where l.team_id=v_profile.team_id
          and l.profile_id=p.id
          and l.observed_month=m.month_start
      ) x on true
    ),
    (
      public.can_supervise_performance(
        v_profile.team_id,p.id,(now() at time zone 'Asia/Shanghai')::date
      )
      or public.has_access_role(v_profile.team_id,array['owner','admin'])
    )
  from people p
  left join public.performance_quarterly_targets t
    on t.team_id=v_profile.team_id
    and t.profile_id=p.id
    and t.quarter_start=p_quarter_start
  order by p.name;
end
$function$;

revoke all on function public.get_performance_management_dashboard(date)
  from public,anon;
grant execute on function public.get_performance_management_dashboard(date)
  to authenticated;
notify pgrst,'reload schema';
