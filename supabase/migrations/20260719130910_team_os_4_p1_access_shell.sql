-- CanWin Team OS 4.0 P1 access shell.
-- Additive compatibility migration: one primary role, optional warehouse or
-- supervisor functions, a company-wide supervisor switch, server-authoritative
-- app context/navigation, and idempotent administrator mutations.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.profile_access_roles
  add column if not exists assignment_kind text;

update public.profile_access_roles par
set assignment_kind = case
  when ar.code in ('warehouse', 'supervisor') then 'additional_function'
  when ar.code in ('owner', 'admin', 'sales', 'implementation', 'operations', 'finance') then 'primary'
  else null
end
from public.access_roles ar
where ar.id = par.role_id
  and par.assignment_kind is null;

-- The existing last-admin constraint trigger is initially deferred. Flush only
-- that trigger before changing this table's shape, then restore its original
-- transaction mode for the remainder of the migration.
set constraints public.profile_access_roles_last_admin immediate;
set constraints public.profile_access_roles_last_admin deferred;

do $$
begin
  if exists (
    select 1
    from public.profile_access_roles
    where assignment_kind is null
  ) then
    raise exception 'UNCLASSIFIED_ACCESS_ROLE' using errcode = '23514';
  end if;
end $$;

alter table public.profile_access_roles
  alter column assignment_kind set not null;
alter table public.profile_access_roles
  drop constraint if exists profile_access_roles_assignment_kind_check;
alter table public.profile_access_roles
  add constraint profile_access_roles_assignment_kind_check
  check (assignment_kind in ('primary', 'additional_function'));

create unique index if not exists profile_access_roles_one_primary_idx
on public.profile_access_roles(profile_id)
where assignment_kind = 'primary';

create or replace function private.set_role_assignment_kind_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_code text;
  expected_kind text;
begin
  select ar.code into role_code
  from public.access_roles ar
  where ar.id = new.role_id
    and ar.team_id = new.team_id;

  expected_kind := case
    when role_code in ('warehouse', 'supervisor') then 'additional_function'
    when role_code in ('owner', 'admin', 'sales', 'implementation', 'operations', 'finance') then 'primary'
    else null
  end;

  if expected_kind is null then
    raise exception 'UNSUPPORTED_ACCESS_ROLE' using errcode = '23514';
  end if;
  if new.assignment_kind is null then
    new.assignment_kind := expected_kind;
  elsif new.assignment_kind <> expected_kind then
    raise exception 'ROLE_ASSIGNMENT_KIND_MISMATCH' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists profile_access_roles_set_assignment_kind on public.profile_access_roles;
create trigger profile_access_roles_set_assignment_kind
before insert or update of team_id, role_id, assignment_kind
on public.profile_access_roles
for each row execute function private.set_role_assignment_kind_v1();

create or replace function private.enforce_one_primary_role_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_profile uuid;
  affected_profiles uuid[];
  active_member boolean;
  primary_count integer;
begin
  affected_profiles := case tg_op
    when 'INSERT' then array[new.profile_id]
    when 'DELETE' then array[old.profile_id]
    else array[new.profile_id, old.profile_id]
  end;

  foreach affected_profile in array affected_profiles loop
    select p.status = 'active' into active_member
    from public.profiles p
    where p.id = affected_profile;

    if coalesce(active_member, false) then
      select count(*) into primary_count
      from public.profile_access_roles par
      where par.profile_id = affected_profile
        and par.assignment_kind = 'primary';
      if primary_count <> 1 then
        raise exception 'EXACTLY_ONE_PRIMARY_ROLE_REQUIRED' using errcode = '23514';
      end if;
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists profile_access_roles_one_primary on public.profile_access_roles;
create constraint trigger profile_access_roles_one_primary
after insert or update or delete on public.profile_access_roles
deferrable initially deferred
for each row execute function private.enforce_one_primary_role_v1();

insert into public.feature_flags(team_id, key, description, enabled, config)
select t.id,
       'team_os_4_supervisor',
       'CanWin Team OS 4.0 company-wide supervisor system',
       false,
       jsonb_build_object(
         'warehouseScopesByProfile', '{}'::jsonb,
         'supervisorScopesByProfile', '{}'::jsonb
       )
from public.teams t
on conflict(team_id, key) do nothing;

create or replace function private.member_primary_role_v1(
  p_team_id text,
  p_profile_id uuid
)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select case ar.code when 'owner' then 'admin' else ar.code end
  from public.profile_access_roles par
  join public.access_roles ar
    on ar.id = par.role_id
   and ar.team_id = par.team_id
  join public.profiles p
    on p.id = par.profile_id
   and p.team_id = par.team_id
  where par.team_id = p_team_id
    and par.profile_id = p_profile_id
    and par.assignment_kind = 'primary'
    and p.status = 'active'
    and ar.code in ('owner', 'admin', 'sales', 'implementation', 'operations', 'finance')
  order by case ar.code when 'admin' then 0 when 'owner' then 1 else 2 end
  limit 1
$$;

create or replace function private.member_additional_functions_v1(
  p_team_id text,
  p_profile_id uuid
)
returns text[]
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(array_agg(ar.code order by ar.code), '{}'::text[])
  from public.profile_access_roles par
  join public.access_roles ar
    on ar.id = par.role_id
   and ar.team_id = par.team_id
  where par.team_id = p_team_id
    and par.profile_id = p_profile_id
    and par.assignment_kind = 'additional_function'
    and ar.code in ('warehouse', 'supervisor')
$$;

create or replace function private.get_app_context_v1()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  member public.profiles;
  company public.teams;
  primary_role text;
  additional_functions text[];
  permission_codes text[];
  skill_names text[];
  region_ids text[];
  flag public.feature_flags;
  warehouse_scope jsonb;
  supervisor_scope jsonb;
  work_views jsonb;
begin
  select p.* into member
  from public.profiles p
  where p.id = auth.uid();

  if member.id is null or member.status <> 'active' then
    raise exception 'ACTIVE_MEMBER_REQUIRED' using errcode = '42501';
  end if;

  select t.* into company
  from public.teams t
  where t.id = member.team_id;

  primary_role := private.member_primary_role_v1(member.team_id, member.id);
  if primary_role is null then
    raise exception 'PRIMARY_ROLE_REQUIRED' using errcode = '42501';
  end if;

  additional_functions := private.member_additional_functions_v1(member.team_id, member.id);

  select coalesce(array_agg(distinct arp.permission_code order by arp.permission_code), '{}'::text[])
  into permission_codes
  from public.profile_access_roles par
  join public.access_role_permissions arp on arp.role_id = par.role_id
  where par.team_id = member.team_id
    and par.profile_id = member.id;

  select coalesce(array_agg(distinct s.name order by s.name), '{}'::text[])
  into skill_names
  from public.user_skills us
  join public.skills s on s.id = us.skill_id and s.team_id = us.team_id
  where us.team_id = member.team_id
    and us.user_id = member.id;

  select coalesce(array_agg(psr.region_id::text order by psr.is_primary desc, psr.region_id::text), '{}'::text[])
  into region_ids
  from public.profile_sales_regions psr
  where psr.team_id = member.team_id
    and psr.profile_id = member.id;

  select ff.* into flag
  from public.feature_flags ff
  where ff.team_id = member.team_id
    and ff.key = 'team_os_4_supervisor';

  warehouse_scope := coalesce(
    flag.config #> array['warehouseScopesByProfile', member.id::text],
    '[]'::jsonb
  );

  if 'supervisor' = any(additional_functions) then
    supervisor_scope := jsonb_build_object(
      'regionIds', coalesce(
        flag.config #> array['supervisorScopesByProfile', member.id::text, 'regionIds'],
        '[]'::jsonb
      ),
      'userIds', coalesce((
        select jsonb_agg(a.subordinate_id::text order by a.subordinate_id::text)
        from public.performance_supervisor_assignments a
        where a.team_id = member.team_id
          and a.supervisor_id = member.id
          and current_date >= a.starts_on
          and (a.ends_on is null or current_date <= a.ends_on)
      ), '[]'::jsonb),
      'businessScopes', coalesce(
        flag.config #> array['supervisorScopesByProfile', member.id::text, 'businessScopes'],
        '[]'::jsonb
      )
    );
  else
    supervisor_scope := null;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', role_id,
      'label', case role_id
        when 'sales' then '销售'
        when 'implementation' then '实施'
        when 'operations' then '运维'
        when 'finance' then '财务'
        when 'admin' then '管理员'
      end
    ) order by ordinality
  ), '[]'::jsonb)
  into work_views
  from unnest(
    case when primary_role = 'admin'
      then array['admin', 'sales', 'implementation', 'operations', 'finance']::text[]
      else array[primary_role]::text[]
    end
  ) with ordinality as view_roles(role_id, ordinality);

  return jsonb_build_object(
    'company', jsonb_build_object('id', company.id, 'name', company.name, 'logoAssetRef', null),
    'user', jsonb_build_object('id', member.id, 'name', member.name, 'status', member.status),
    'primaryRole', primary_role,
    'additionalFunctions', to_jsonb(additional_functions),
    'skills', to_jsonb(skill_names),
    'regionScopeIds', to_jsonb(region_ids),
    'warehouseScopeIds', warehouse_scope,
    'supervisorScope', supervisor_scope,
    'supervisorEnabled', coalesce(flag.enabled, false),
    'permissions', to_jsonb(permission_codes),
    'availableWorkViews', work_views,
    'currentWorkView', primary_role,
    'navigationRevision', 'p1-nav-1:' || company.id
  );
end $$;

create or replace function private.navigation_item_v1(
  p_route_id text,
  p_label text,
  p_order integer,
  p_group text,
  p_path text,
  p_visible boolean default true,
  p_enabled boolean default true,
  p_read_only boolean default false
)
returns jsonb
language sql
security definer
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'routeId', p_route_id,
    'label', p_label,
    'order', p_order,
    'group', p_group,
    'canonicalPath', p_path,
    'visible', p_visible,
    'enabled', p_enabled,
    'readOnly', p_read_only
  )
$$;

create or replace function private.get_navigation_manifest_v1(p_work_view text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  context_value jsonb := private.get_app_context_v1();
  manifest jsonb := '[]'::jsonb;
  role_label text;
  role_path text;
begin
  if p_work_view is null or not exists (
    select 1
    from jsonb_array_elements(context_value->'availableWorkViews') item
    where item->>'id' = p_work_view
  ) then
    raise exception 'WORK_VIEW_FORBIDDEN' using errcode = '42501';
  end if;

  role_label := case p_work_view
    when 'sales' then '销售客户'
    when 'implementation' then '实施任务'
    when 'operations' then '运维服务'
    when 'finance' then '财务收款'
    when 'admin' then '管理员审批'
  end;
  role_path := case p_work_view
    when 'sales' then '/sales-v3?tab=leads'
    when 'implementation' then '/orders-v3?view=implementation'
    when 'operations' then '/orders-v3?view=operations'
    when 'finance' then '/finance?view=receipts'
    when 'admin' then '/management-v3?view=approvals'
  end;

  manifest := manifest || jsonb_build_array(
    private.navigation_item_v1('my-workbench', '我的工作台', 10, 'common', '/dashboard'),
    private.navigation_item_v1('progress', '推进中心', 20, 'common', '/work'),
    private.navigation_item_v1('calendar', '日历', 30, 'common', '/calendar'),
    private.navigation_item_v1('role-business', role_label, 40, 'current_role', role_path),
    private.navigation_item_v1('messages', '消息', 5, 'topbar', '/notifications-v3'),
    private.navigation_item_v1('mobile-profile', '我的', 50, 'mobile_only', '/profile')
  );

  if p_work_view = 'sales' then
    manifest := manifest || jsonb_build_array(
      private.navigation_item_v1('sales-leads', '线索与公海', 101, 'role_business', '/sales-v3?tab=leads'),
      private.navigation_item_v1('sales-customers', '客户与门店', 102, 'role_business', '/sales-v3?tab=customers'),
      private.navigation_item_v1('sales-opportunities', '商机与跟进', 103, 'role_business', '/sales-v3?tab=opportunities'),
      private.navigation_item_v1('sales-quotes', '报价与订单', 104, 'role_business', '/quotes-v3'),
      private.navigation_item_v1('sales-payments', '回款与内部款状态', 105, 'role_business', '/orders-v3?view=payments'),
      private.navigation_item_v1('sales-renewals', '续费客户', 106, 'role_business', '/orders-v3?view=renewals'),
      private.navigation_item_v1('sales-earnings', '我的业绩、积分和利润', 107, 'role_business', '/profile?view=earnings')
    );
  elsif p_work_view = 'implementation' then
    manifest := manifest || jsonb_build_array(
      private.navigation_item_v1('implementation-schedule', '待排期', 101, 'role_business', '/orders-v3?view=schedule'),
      private.navigation_item_v1('implementation-install', '待安装', 102, 'role_business', '/orders-v3?view=installation'),
      private.navigation_item_v1('implementation-training', '待培训', 103, 'role_business', '/orders-v3?view=training'),
      private.navigation_item_v1('implementation-acceptance', '待验收', 104, 'role_business', '/orders-v3?view=acceptance'),
      private.navigation_item_v1('implementation-handoff', '待交接', 105, 'role_business', '/orders-v3?view=handoff'),
      private.navigation_item_v1('implementation-exceptions', '实施异常', 106, 'role_business', '/orders-v3?view=exceptions'),
      private.navigation_item_v1('implementation-earnings', '我的服务收益', 107, 'role_business', '/profile?view=earnings')
    );
  elsif p_work_view = 'operations' then
    manifest := manifest || jsonb_build_array(
      private.navigation_item_v1('operations-queue', '服务队列', 101, 'role_business', '/orders-v3?view=operations'),
      private.navigation_item_v1('operations-customers', '客户维护', 102, 'role_business', '/sales-v3?tab=customers'),
      private.navigation_item_v1('operations-exceptions', '售后异常', 103, 'role_business', '/orders-v3?view=exceptions'),
      private.navigation_item_v1('operations-renewals', '续费协作', 104, 'role_business', '/orders-v3?view=renewals'),
      private.navigation_item_v1('operations-cases', '案例素材待补充', 105, 'role_business', '/management-v3?view=case-candidates'),
      private.navigation_item_v1('operations-earnings', '我的服务收益', 106, 'role_business', '/profile?view=earnings')
    );
  elsif p_work_view = 'finance' then
    manifest := manifest || jsonb_build_array(
      private.navigation_item_v1('finance-receipts', '待确认收款', 101, 'role_business', '/finance?view=receipts'),
      private.navigation_item_v1('finance-internal', '销售代收与内部应付', 102, 'role_business', '/finance?view=internal'),
      private.navigation_item_v1('finance-reversals', '退款与冲销', 103, 'role_business', '/finance?view=reversals'),
      private.navigation_item_v1('finance-sales-profit', '销售利润结算', 104, 'role_business', '/finance?view=sales-profit'),
      private.navigation_item_v1('finance-labor', '劳动收益结算', 105, 'role_business', '/finance?view=labor'),
      private.navigation_item_v1('finance-company', '公司成本与现金支撑', 106, 'role_business', '/finance?view=company')
    );
  elsif p_work_view = 'admin' then
    manifest := manifest || jsonb_build_array(
      private.navigation_item_v1('admin-cockpit', '经营驾驶舱', 101, 'role_business', '/management-v3'),
      private.navigation_item_v1('admin-approvals', '审批与分配', 102, 'role_business', '/management-v3?view=approvals'),
      private.navigation_item_v1('admin-people', '组织、岗位与权限', 103, 'role_business', '/settings-v3/access'),
      private.navigation_item_v1('admin-goods', '商品、价格、仓库与服务', 104, 'role_business', '/asset-center'),
      private.navigation_item_v1('admin-customers', '客户、品牌与门店', 105, 'role_business', '/sales-v3?tab=customers'),
      private.navigation_item_v1('admin-finance', '财务、成本与结算', 106, 'role_business', '/finance'),
      private.navigation_item_v1('admin-cases', '案例馆与网站发布', 107, 'role_business', '/management-v3?view=case-candidates'),
      private.navigation_item_v1('admin-settings', '系统设置', 108, 'role_business', '/settings-v3')
    );
  end if;

  if context_value->'additionalFunctions' ? 'warehouse' then
    manifest := manifest || jsonb_build_array(
      private.navigation_item_v1('warehouse-processing', '仓库处理', 200, 'warehouse', '/asset-center?view=inventory')
    );
  end if;
  if context_value->'additionalFunctions' ? 'supervisor'
     and coalesce((context_value->>'supervisorEnabled')::boolean, false) then
    manifest := manifest || jsonb_build_array(
      private.navigation_item_v1('team-approval', '团队审批', 210, 'supervisor', '/management-v3?view=approvals')
    );
  end if;

  return manifest;
end $$;

create or replace function private.resolve_responsible_profile_v1(
  p_business_type text,
  p_region_id uuid,
  p_candidate_profile_id uuid,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  caller public.profiles;
  candidate public.profiles;
  flag public.feature_flags;
  admin_id uuid;
  region_scope jsonb;
  business_scope jsonb;
  active_people_scope_count integer := 0;
  caller_in_people_scope boolean := false;
  effective_date date := (coalesce(p_at, pg_catalog.now()) at time zone 'Asia/Shanghai')::date;
  reason text := 'no_matching_supervisor';
begin
  select p.* into caller from public.profiles p where p.id = auth.uid() and p.status = 'active';
  if caller.id is null then
    raise exception 'ACTIVE_MEMBER_REQUIRED' using errcode = '42501';
  end if;

  select ff.* into flag
  from public.feature_flags ff
  where ff.team_id = caller.team_id and ff.key = 'team_os_4_supervisor';

  select p.* into candidate
  from public.profiles p
  where p.id = p_candidate_profile_id and p.team_id = caller.team_id;

  select p.id into admin_id
  from public.profiles p
  join public.profile_access_roles par
    on par.profile_id = p.id and par.team_id = p.team_id and par.assignment_kind = 'primary'
  join public.access_roles ar
    on ar.id = par.role_id and ar.team_id = par.team_id
  where p.team_id = caller.team_id
    and p.status = 'active'
    and ar.code in ('admin', 'owner')
  order by case ar.code when 'admin' then 0 else 1 end, p.created_at
  limit 1;

  if admin_id is null then
    raise exception 'ACTIVE_ADMIN_REQUIRED' using errcode = '23514';
  end if;

  if not coalesce(flag.enabled, false) then
    return jsonb_build_object('profileId', admin_id, 'reason', 'supervisor_system_disabled', 'fallbackApplied', true);
  end if;

  if candidate.id is not null and candidate.status <> 'active' then
    reason := 'supervisor_disabled';
  elsif candidate.id is not null and exists (
    select 1
    from public.profile_access_roles par
    join public.access_roles ar on ar.id = par.role_id and ar.team_id = par.team_id
    where par.team_id = caller.team_id
      and par.profile_id = candidate.id
      and par.assignment_kind = 'additional_function'
      and ar.code = 'supervisor'
  ) then
    region_scope := coalesce(
      flag.config #> array['supervisorScopesByProfile', candidate.id::text, 'regionIds'],
      '[]'::jsonb
    );
    business_scope := coalesce(
      flag.config #> array['supervisorScopesByProfile', candidate.id::text, 'businessScopes'],
      '[]'::jsonb
    );
    select count(*), coalesce(pg_catalog.bool_or(a.subordinate_id = caller.id), false)
    into active_people_scope_count, caller_in_people_scope
    from public.performance_supervisor_assignments a
    where a.team_id = caller.team_id
      and a.supervisor_id = candidate.id
      and effective_date >= a.starts_on
      and (a.ends_on is null or effective_date <= a.ends_on);
    if (p_region_id is null or jsonb_array_length(region_scope) = 0 or region_scope ? p_region_id::text)
       and (jsonb_array_length(business_scope) = 0 or business_scope ? p_business_type or business_scope ? '*')
       and (active_people_scope_count = 0 or caller_in_people_scope) then
      return jsonb_build_object('profileId', candidate.id, 'reason', 'matching_supervisor_scope', 'fallbackApplied', false);
    end if;
  end if;

  return jsonb_build_object('profileId', admin_id, 'reason', reason, 'fallbackApplied', true);
end $$;

create or replace function private.admin_apply_member_access_v1(
  p_profile_id uuid,
  p_primary_role text,
  p_additional_functions text[],
  p_skill_ids uuid[],
  p_region_scope_ids uuid[],
  p_warehouse_scope_ids text[],
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  target public.profiles;
  functions text[];
  skills uuid[];
  regions uuid[];
  warehouse_scopes text[];
  payload jsonb;
  before_state jsonb;
  result_value jsonb;
  prior public.access_admin_requests;
  flag public.feature_flags;
  audit_id uuid;
begin
  select p.* into actor from public.profiles p where p.id = auth.uid() and p.status = 'active';
  select p.* into target from public.profiles p where p.id = p_profile_id;
  if actor.id is null or target.id is null or actor.team_id <> target.team_id
     or private.member_primary_role_v1(actor.team_id, actor.id) <> 'admin' then
    raise exception 'ACCESS_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct item order by item), '{}'::text[])
  into functions from unnest(coalesce(p_additional_functions, '{}'::text[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[])
  into skills from unnest(coalesce(p_skill_ids, '{}'::uuid[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[])
  into regions from unnest(coalesce(p_region_scope_ids, '{}'::uuid[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::text[])
  into warehouse_scopes from unnest(coalesce(p_warehouse_scope_ids, '{}'::text[])) item;

  if p_primary_role not in ('sales', 'implementation', 'operations', 'finance', 'admin') then
    raise exception 'INVALID_PRIMARY_ROLE' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(functions) item where item not in ('warehouse', 'supervisor')) then
    raise exception 'INVALID_ADDITIONAL_FUNCTION' using errcode = '23514';
  end if;
  if 'warehouse' = any(functions) and p_primary_role not in ('implementation', 'admin') then
    raise exception 'WAREHOUSE_FUNCTION_NOT_ASSIGNABLE' using errcode = '23514';
  end if;
  if (not ('warehouse' = any(functions)) and cardinality(warehouse_scopes) > 0)
     or exists (select 1 from unnest(warehouse_scopes) item where item <> actor.team_id) then
    raise exception 'INVALID_WAREHOUSE_SCOPE' using errcode = '23514';
  end if;
  if (select count(*) from public.skills s where s.team_id = actor.team_id and s.id = any(skills)) <> cardinality(skills) then
    raise exception 'INVALID_SKILL_SCOPE' using errcode = '23514';
  end if;
  if (select count(*) from public.sales_regions r where r.team_id = actor.team_id and r.is_active and r.id = any(regions)) <> cardinality(regions) then
    raise exception 'INVALID_REGION_SCOPE' using errcode = '23514';
  end if;

  payload := jsonb_build_object(
    'profileId', target.id,
    'primaryRole', p_primary_role,
    'additionalFunctions', to_jsonb(functions),
    'skillIds', to_jsonb(skills),
    'regionScopeIds', to_jsonb(regions),
    'warehouseScopeIds', to_jsonb(warehouse_scopes)
  );
  select req.* into prior
  from public.access_admin_requests req
  where req.team_id = actor.team_id and req.idempotency_key = p_idempotency_key;
  if prior.idempotency_key is not null then
    if prior.action <> 'team_os_4.member_access.apply' or prior.payload <> payload then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = '23505';
    end if;
    return prior.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.team_id || target.id::text, 401));
  before_state := jsonb_build_object(
    'primaryRole', private.member_primary_role_v1(target.team_id, target.id),
    'additionalFunctions', to_jsonb(private.member_additional_functions_v1(target.team_id, target.id))
  );

  delete from public.profile_access_roles par
  where par.team_id = target.team_id and par.profile_id = target.id;
  insert into public.profile_access_roles(team_id, profile_id, role_id, assigned_by, assignment_kind)
  select target.team_id, target.id, ar.id, actor.id, 'primary'
  from public.access_roles ar
  where ar.team_id = target.team_id and ar.code = p_primary_role;
  insert into public.profile_access_roles(team_id, profile_id, role_id, assigned_by, assignment_kind)
  select target.team_id, target.id, ar.id, actor.id, 'additional_function'
  from public.access_roles ar
  where ar.team_id = target.team_id and ar.code = any(functions);

  delete from public.user_skills us where us.team_id = target.team_id and us.user_id = target.id;
  insert into public.user_skills(team_id, user_id, skill_id)
  select target.team_id, target.id, item from unnest(skills) item;

  delete from public.profile_sales_regions psr where psr.team_id = target.team_id and psr.profile_id = target.id;
  insert into public.profile_sales_regions(team_id, profile_id, region_id, assigned_by, is_primary)
  select target.team_id, target.id, item, actor.id, row_number() over(order by item) = 1
  from unnest(regions) item;

  select ff.* into flag
  from public.feature_flags ff
  where ff.team_id = target.team_id and ff.key = 'team_os_4_supervisor'
  for update;
  update public.feature_flags ff
  set config = coalesce(flag.config, '{}'::jsonb) || jsonb_build_object(
        'warehouseScopesByProfile',
        coalesce(flag.config->'warehouseScopesByProfile', '{}'::jsonb)
          || jsonb_build_object(target.id::text, to_jsonb(warehouse_scopes))
      ),
      updated_by = actor.id,
      updated_at = now()
  where ff.id = flag.id;

  insert into public.audit_logs(team_id, actor_id, action, target_type, target_id, before_data, after_data)
  values(target.team_id, actor.id, 'team_os_4.member_access_applied', 'profile', target.id, before_state, payload)
  returning id into audit_id;
  result_value := jsonb_build_object('subjectId', target.id, 'revision', audit_id, 'auditId', audit_id);
  insert into public.access_admin_requests(team_id, idempotency_key, action, payload, result, actor_id)
  values(actor.team_id, p_idempotency_key, 'team_os_4.member_access.apply', payload, result_value, actor.id);
  return result_value;
end $$;

create or replace function private.admin_set_supervisor_system_v1(
  p_enabled boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  flag public.feature_flags;
  payload jsonb;
  result_value jsonb;
  prior public.access_admin_requests;
  audit_id uuid;
begin
  select p.* into actor from public.profiles p where p.id = auth.uid() and p.status = 'active';
  if actor.id is null or private.member_primary_role_v1(actor.team_id, actor.id) <> 'admin' then
    raise exception 'ACCESS_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_enabled is null then
    raise exception 'INVALID_SUPERVISOR_SWITCH' using errcode = '22023';
  end if;
  payload := jsonb_build_object('enabled', p_enabled);
  select req.* into prior from public.access_admin_requests req
  where req.team_id = actor.team_id and req.idempotency_key = p_idempotency_key;
  if prior.idempotency_key is not null then
    if prior.action <> 'team_os_4.supervisor_system.set' or prior.payload <> payload then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = '23505';
    end if;
    return prior.result;
  end if;

  select ff.* into flag from public.feature_flags ff
  where ff.team_id = actor.team_id and ff.key = 'team_os_4_supervisor' for update;
  update public.feature_flags
  set enabled = p_enabled, updated_by = actor.id, updated_at = now()
  where id = flag.id;
  insert into public.audit_logs(team_id, actor_id, action, target_type, before_data, after_data)
  values(actor.team_id, actor.id, 'team_os_4.supervisor_system_set', 'team',
         jsonb_build_object('enabled', flag.enabled), payload)
  returning id into audit_id;
  result_value := jsonb_build_object('subjectId', actor.team_id, 'revision', audit_id, 'auditId', audit_id);
  insert into public.access_admin_requests(team_id, idempotency_key, action, payload, result, actor_id)
  values(actor.team_id, p_idempotency_key, 'team_os_4.supervisor_system.set', payload, result_value, actor.id);
  return result_value;
end $$;

create or replace function private.admin_replace_supervisor_scope_v1(
  p_supervisor_id uuid,
  p_region_ids uuid[],
  p_user_ids uuid[],
  p_business_scopes text[],
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  supervisor public.profiles;
  regions uuid[];
  users uuid[];
  business_scopes text[];
  payload jsonb;
  before_state jsonb;
  result_value jsonb;
  prior public.access_admin_requests;
  flag public.feature_flags;
  audit_id uuid;
begin
  select p.* into actor from public.profiles p where p.id = auth.uid() and p.status = 'active';
  select p.* into supervisor from public.profiles p where p.id = p_supervisor_id;
  if actor.id is null or supervisor.id is null or actor.team_id <> supervisor.team_id
     or private.member_primary_role_v1(actor.team_id, actor.id) <> 'admin' then
    raise exception 'ACCESS_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if supervisor.status <> 'active' then
    raise exception 'ACTIVE_SUPERVISOR_REQUIRED' using errcode = '23514';
  end if;
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[]) into regions
  from unnest(coalesce(p_region_ids, '{}'::uuid[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::uuid[]) into users
  from unnest(coalesce(p_user_ids, '{}'::uuid[])) item;
  select coalesce(array_agg(distinct item order by item), '{}'::text[]) into business_scopes
  from unnest(coalesce(p_business_scopes, '{}'::text[])) item;

  if not exists (
    select 1 from public.profile_access_roles par
    join public.access_roles ar on ar.id = par.role_id and ar.team_id = par.team_id
    where par.team_id = actor.team_id and par.profile_id = supervisor.id
      and par.assignment_kind = 'additional_function' and ar.code = 'supervisor'
  ) then
    raise exception 'SUPERVISOR_FUNCTION_REQUIRED' using errcode = '23514';
  end if;
  if supervisor.id = any(users)
     or (select count(*) from public.profiles p where p.team_id = actor.team_id and p.status = 'active' and p.id = any(users)) <> cardinality(users)
     or (select count(*) from public.sales_regions r where r.team_id = actor.team_id and r.is_active and r.id = any(regions)) <> cardinality(regions)
     or exists (select 1 from unnest(business_scopes) item where item !~ '^[a-z][a-z0-9_.-]{0,63}$') then
    raise exception 'INVALID_SUPERVISOR_SCOPE' using errcode = '23514';
  end if;

  payload := jsonb_build_object(
    'supervisorId', supervisor.id,
    'regionIds', to_jsonb(regions),
    'userIds', to_jsonb(users),
    'businessScopes', to_jsonb(business_scopes)
  );
  select req.* into prior from public.access_admin_requests req
  where req.team_id = actor.team_id and req.idempotency_key = p_idempotency_key;
  if prior.idempotency_key is not null then
    if prior.action <> 'team_os_4.supervisor_scope.replace' or prior.payload <> payload then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = '23505';
    end if;
    return prior.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.team_id || supervisor.id::text, 402));
  select jsonb_build_object(
    'userIds', coalesce(jsonb_agg(a.subordinate_id order by a.subordinate_id), '[]'::jsonb)
  ) into before_state
  from public.performance_supervisor_assignments a
  where a.team_id = actor.team_id and a.supervisor_id = supervisor.id
    and current_date >= a.starts_on and (a.ends_on is null or current_date <= a.ends_on);

  delete from public.performance_supervisor_assignments a
  where a.team_id = actor.team_id and a.supervisor_id = supervisor.id and a.starts_on >= current_date;
  update public.performance_supervisor_assignments a
  set ends_on = current_date - 1
  where a.team_id = actor.team_id and a.supervisor_id = supervisor.id
    and a.starts_on < current_date and (a.ends_on is null or a.ends_on >= current_date);
  insert into public.performance_supervisor_assignments(team_id, supervisor_id, subordinate_id, starts_on, created_by)
  select actor.team_id, supervisor.id, item, current_date, actor.id from unnest(users) item;

  select ff.* into flag from public.feature_flags ff
  where ff.team_id = actor.team_id and ff.key = 'team_os_4_supervisor' for update;
  update public.feature_flags ff
  set config = coalesce(flag.config, '{}'::jsonb) || jsonb_build_object(
        'supervisorScopesByProfile',
        coalesce(flag.config->'supervisorScopesByProfile', '{}'::jsonb)
          || jsonb_build_object(supervisor.id::text, jsonb_build_object(
            'regionIds', to_jsonb(regions),
            'businessScopes', to_jsonb(business_scopes)
          ))
      ),
      updated_by = actor.id,
      updated_at = now()
  where ff.id = flag.id;

  insert into public.audit_logs(team_id, actor_id, action, target_type, target_id, before_data, after_data)
  values(actor.team_id, actor.id, 'team_os_4.supervisor_scope_replaced', 'profile', supervisor.id, before_state, payload)
  returning id into audit_id;
  result_value := jsonb_build_object('subjectId', supervisor.id, 'revision', audit_id, 'auditId', audit_id);
  insert into public.access_admin_requests(team_id, idempotency_key, action, payload, result, actor_id)
  values(actor.team_id, p_idempotency_key, 'team_os_4.supervisor_scope.replace', payload, result_value, actor.id);
  return result_value;
end $$;

create or replace function public.get_app_context_v1()
returns jsonb
language sql
security invoker
stable
set search_path = ''
as $$ select private.get_app_context_v1() $$;

create or replace function public.get_navigation_manifest_v1(p_work_view text)
returns jsonb
language sql
security invoker
stable
set search_path = ''
as $$ select private.get_navigation_manifest_v1(p_work_view) $$;

create or replace function public.resolve_responsible_profile_v1(
  p_business_type text,
  p_region_id uuid,
  p_candidate_profile_id uuid,
  p_at timestamptz
)
returns jsonb
language sql
security invoker
stable
set search_path = ''
as $$ select private.resolve_responsible_profile_v1(p_business_type, p_region_id, p_candidate_profile_id, p_at) $$;

create or replace function public.admin_apply_member_access_v1(
  p_profile_id uuid,
  p_primary_role text,
  p_additional_functions text[],
  p_skill_ids uuid[],
  p_region_scope_ids uuid[],
  p_warehouse_scope_ids text[],
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_apply_member_access_v1(
    p_profile_id, p_primary_role, p_additional_functions, p_skill_ids,
    p_region_scope_ids, p_warehouse_scope_ids, p_idempotency_key
  )
$$;

create or replace function public.admin_set_supervisor_system_v1(
  p_enabled boolean,
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.admin_set_supervisor_system_v1(p_enabled, p_idempotency_key) $$;

create or replace function public.admin_replace_supervisor_scope_v1(
  p_supervisor_id uuid,
  p_region_ids uuid[],
  p_user_ids uuid[],
  p_business_scopes text[],
  p_idempotency_key uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.admin_replace_supervisor_scope_v1(
    p_supervisor_id, p_region_ids, p_user_ids, p_business_scopes, p_idempotency_key
  )
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
grant execute on function private.get_app_context_v1() to authenticated;
grant execute on function private.get_navigation_manifest_v1(text) to authenticated;
grant execute on function private.admin_apply_member_access_v1(uuid,text,text[],uuid[],uuid[],text[],uuid) to authenticated;
grant execute on function private.admin_set_supervisor_system_v1(boolean,uuid) to authenticated;
grant execute on function private.admin_replace_supervisor_scope_v1(uuid,uuid[],uuid[],text[],uuid) to authenticated;
grant execute on function private.resolve_responsible_profile_v1(text,uuid,uuid,timestamptz) to service_role;

revoke all on function public.get_app_context_v1() from public, anon;
revoke all on function public.get_navigation_manifest_v1(text) from public, anon;
revoke all on function public.resolve_responsible_profile_v1(text,uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.admin_apply_member_access_v1(uuid,text,text[],uuid[],uuid[],text[],uuid) from public, anon;
revoke all on function public.admin_set_supervisor_system_v1(boolean,uuid) from public, anon;
revoke all on function public.admin_replace_supervisor_scope_v1(uuid,uuid[],uuid[],text[],uuid) from public, anon;

grant execute on function public.get_app_context_v1() to authenticated;
grant execute on function public.get_navigation_manifest_v1(text) to authenticated;
grant execute on function public.resolve_responsible_profile_v1(text,uuid,uuid,timestamptz) to service_role;
grant execute on function public.admin_apply_member_access_v1(uuid,text,text[],uuid[],uuid[],text[],uuid) to authenticated;
grant execute on function public.admin_set_supervisor_system_v1(boolean,uuid) to authenticated;
grant execute on function public.admin_replace_supervisor_scope_v1(uuid,uuid[],uuid[],text[],uuid) to authenticated;

-- Retire the 3.0 role/supervisor writers. They do not carry the frozen 4.0
-- primary/additional classification, scope payload, or idempotent audit result.
revoke execute on function public.manage_profile_access(uuid,text[],uuid[]) from authenticated;
revoke execute on function public.admin_replace_profile_roles(uuid,text[],uuid) from authenticated;
revoke execute on function public.admin_replace_supervisor_subordinates(uuid,uuid[],uuid) from authenticated;

revoke insert, update, delete on table
  public.access_roles,
  public.access_role_permissions,
  public.profile_access_roles,
  public.profile_sales_regions,
  public.user_skills,
  public.feature_flags,
  public.performance_supervisor_assignments
from anon, authenticated;
grant select on table
  public.access_roles,
  public.access_permissions,
  public.access_role_permissions,
  public.profile_access_roles,
  public.sales_regions,
  public.profile_sales_regions,
  public.skills,
  public.user_skills,
  public.feature_flags,
  public.performance_supervisor_assignments
to authenticated;

notify pgrst, 'reload schema';
