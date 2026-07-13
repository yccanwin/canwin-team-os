-- Personal-only sales performance workspace for the mobile "My" entry.
create or replace function public.get_my_sales_performance_workspace()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_target public.performance_quarterly_targets;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_quarter_start date;
  v_quarter_end date;
  v_months jsonb;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid()
    and status = 'active';

  if v_profile.id is null
    or not public.is_feature_enabled(v_profile.team_id, 'sales_os_v3') then
    raise exception 'PERSONAL_WORKSPACE_FORBIDDEN' using errcode = '42501';
  end if;

  v_quarter_start := date_trunc('quarter', v_today)::date;
  v_quarter_end := (v_quarter_start + interval '3 months - 1 day')::date;

  select * into v_target
  from public.performance_quarterly_targets
  where team_id = v_profile.team_id
    and profile_id = v_profile.id
    and quarter_start = v_quarter_start;

  select coalesce(jsonb_agg(jsonb_build_object(
    'month_start', month_start,
    'month_label', to_char(month_start, 'YYYY-MM'),
    'new_gmv', new_gmv,
    'renewal_gmv', renewal_gmv,
    'official_points', official_points
  ) order by month_start), '[]'::jsonb)
  into v_months
  from (
    select
      m.month_start,
      coalesce(sum(l.gmv_amount) filter (where l.gmv_type = 'new'), 0) as new_gmv,
      coalesce(sum(l.gmv_amount) filter (where l.gmv_type = 'renewal'), 0) as renewal_gmv,
      coalesce(sum(l.official_points), 0) as official_points
    from generate_series(v_quarter_start, v_quarter_start + interval '2 months', interval '1 month') m(month_start)
    left join public.official_reconciliation_batches b
      on b.team_id = v_profile.team_id
     and b.quarter_start = v_quarter_start
     and b.status = 'confirmed'
    left join public.official_reconciliation_lines l
      on l.team_id = b.team_id
     and l.batch_id = b.id
     and l.profile_id = v_profile.id
     and l.observed_month = m.month_start::date
    group by m.month_start
  ) monthly;

  return jsonb_build_object(
    'profile_id', v_profile.id,
    'display_name', v_profile.name,
    'quarter_start', v_quarter_start,
    'quarter_end', v_quarter_end,
    'quarter_label', concat(extract(year from v_quarter_start)::int, ' Q', extract(quarter from v_quarter_start)::int),
    'has_target', v_target.id is not null,
    'target', case when v_target.id is null then null else jsonb_build_object(
      'id', v_target.id,
      'points_target', v_target.points_target,
      'estimated_points', v_target.estimated_points,
      'official_points', v_target.official_points,
      'new_gmv_target', v_target.new_gmv_target,
      'new_gmv_actual', v_target.new_gmv_actual,
      'renewal_gmv_target', v_target.renewal_gmv_target,
      'renewal_gmv_actual', v_target.renewal_gmv_actual,
      'updated_at', v_target.updated_at
    ) end,
    'monthly_observations', v_months
  );
end
$$;

revoke all on function public.get_my_sales_performance_workspace() from public, anon;
grant execute on function public.get_my_sales_performance_workspace() to authenticated;
notify pgrst, 'reload schema';
