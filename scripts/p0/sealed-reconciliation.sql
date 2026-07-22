create temporary table canwin_p0_row_counts (
  table_name text primary key,
  row_count bigint not null,
  content_md5 text not null
) on commit drop;

do $canwin_reconcile$
declare
  item record;
  exact_count bigint;
  exact_content_md5 text;
begin
  for item in
    select c.relname as table_name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
    order by c.relname
  loop
    execute format(
      'select count(*), md5(coalesce(string_agg(row_md5, '''' order by row_md5), '''')) from (select md5(to_jsonb(t)::text) row_md5 from public.%I t) rows',
      item.table_name
    ) into exact_count, exact_content_md5;
    insert into canwin_p0_row_counts(table_name, row_count, content_md5)
    values (item.table_name, exact_count, exact_content_md5);
  end loop;
end
$canwin_reconcile$;

select jsonb_build_object(
  'schemaVersion', 1,
  'publicTables', (
    select coalesce(jsonb_object_agg(table_name, row_count order by table_name), '{}'::jsonb)
    from canwin_p0_row_counts
  ),
  'publicTableContentMd5', (
    select coalesce(jsonb_object_agg(table_name, content_md5 order by table_name), '{}'::jsonb)
    from canwin_p0_row_counts
  ),
  'auth', jsonb_build_object(
    'users', (select count(*) from auth.users),
    'identities', (select count(*) from auth.identities),
    'profiles', (select count(*) from public.profiles),
    'roleAssignments', (select count(*) from public.profile_access_roles),
    'orphanProfiles', (
      select count(*) from public.profiles p left join auth.users u on u.id = p.id where u.id is null
    ),
    'orphanRoleAssignments', (
      select count(*)
      from public.profile_access_roles par
      left join public.profiles p on p.id = par.profile_id and p.team_id = par.team_id
      left join public.access_roles ar on ar.id = par.role_id and ar.team_id = par.team_id
      where p.id is null or ar.id is null
    ),
    'usersContentMd5', (
      select md5(coalesce(string_agg(row_md5, '' order by row_md5), ''))
      from (select md5((to_jsonb(u) - 'banned_until')::text) row_md5 from auth.users u) rows
    ),
    'identitiesContentMd5', (
      select md5(coalesce(string_agg(row_md5, '' order by row_md5), ''))
      from (select md5(to_jsonb(i)::text) row_md5 from auth.identities i) rows
    )
  ),
  'storageMetadata', jsonb_build_object(
    'buckets', (select count(*) from storage.buckets),
    'objects', (select count(*) from storage.objects)
  ),
  'migrationHistory', jsonb_build_object(
    'schemaMigrations', (select count(*) from supabase_migrations.schema_migrations)
  ),
  'schemaSecurity', jsonb_build_object(
    'publicColumnsMd5', (
      select md5(coalesce(string_agg(
        format('%s.%s|%s|%s|%s|%s',table_name,column_name,data_type,udt_name,is_nullable,coalesce(column_default,'')),
        E'\n' order by table_name,ordinal_position
      ),'')) from information_schema.columns where table_schema='public'
    ),
    'publicConstraintsMd5', (
      select md5(coalesce(string_agg(c.conname||'|'||pg_get_constraintdef(c.oid,true),E'\n' order by n.nspname,r.relname,c.conname),''))
      from pg_catalog.pg_constraint c join pg_catalog.pg_class r on r.oid=c.conrelid
      join pg_catalog.pg_namespace n on n.oid=r.relnamespace where n.nspname='public'
    ),
    'publicIndexesMd5', (
      select md5(coalesce(string_agg(pg_get_indexdef(i.indexrelid),E'\n' order by n.nspname,c.relname,ic.relname),''))
      from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indrelid
      join pg_catalog.pg_class ic on ic.oid=i.indexrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public'
    ),
    'publicTableAclMd5', (
      select md5(coalesce(string_agg(
        c.relname||'|'||case when a.grantee=0 then 'PUBLIC' else g.rolname end||'|'||a.privilege_type||'|'||a.is_grantable::text,
        E'\n' order by c.relname,case when a.grantee=0 then 'PUBLIC' else g.rolname end,a.privilege_type,a.is_grantable
      ),''))
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a
      left join pg_catalog.pg_roles g on g.oid=a.grantee
      where n.nspname='public' and c.relkind in('r','p','v','m','S')
    ),
    'publicRoutines', (
      select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    ),
    'publicRoutinesMd5', (
      select md5(coalesce(string_agg(pg_get_functiondef(p.oid)||'|ACL='||(
        select coalesce(string_agg(
          case when a.grantee=0 then 'PUBLIC' else g.rolname end||'|'||a.privilege_type||'|'||a.is_grantable::text,
          ',' order by case when a.grantee=0 then 'PUBLIC' else g.rolname end,a.privilege_type,a.is_grantable
        ),'') from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_catalog.pg_roles g on g.oid=a.grantee
      ),E'\n' order by p.oid::regprocedure::text),''))
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    ),
    'salesOsPrivateSchemaAclMd5', (
      select md5(coalesce(string_agg(
        n.nspname||'|'||case when a.grantee=0 then 'PUBLIC' else g.rolname end||'|'||a.privilege_type||'|'||a.is_grantable::text,
        E'\n' order by n.nspname,case when a.grantee=0 then 'PUBLIC' else g.rolname end,a.privilege_type,a.is_grantable
      ),''))
      from pg_catalog.pg_namespace n
      cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
      left join pg_catalog.pg_roles g on g.oid=a.grantee
      where n.nspname='sales_os_private'
    ),
    'salesOsPrivateDataRelations', (
      select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='sales_os_private' and c.relkind in('r','p','S','m')
    ),
    'salesOsPrivateRoutines', (
      select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='sales_os_private'
    ),
    'salesOsPrivateRoutinesMd5', (
      select md5(coalesce(string_agg(pg_get_functiondef(p.oid)||'|ACL='||(
        select coalesce(string_agg(
          case when a.grantee=0 then 'PUBLIC' else g.rolname end||'|'||a.privilege_type||'|'||a.is_grantable::text,
          ',' order by case when a.grantee=0 then 'PUBLIC' else g.rolname end,a.privilege_type,a.is_grantable
        ),'') from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a left join pg_catalog.pg_roles g on g.oid=a.grantee
      ),E'\n' order by p.oid::regprocedure::text),''))
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='sales_os_private'
    ),
    'publicPoliciesMd5', (
      select md5(coalesce(string_agg(p.polname||'|'||p.polcmd::text||'|'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),E'\n' order by c.relname,p.polname),''))
      from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    ),
    'publicTriggersMd5', (
      select md5(coalesce(string_agg(pg_get_triggerdef(t.oid,false),E'\n' order by c.relname,t.tgname),''))
      from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
    ),
    'managedCustomizationsMd5', (
      select md5(coalesce(string_agg(item,E'\n' order by item),'')) from (
        select 'trigger|'||pg_get_triggerdef(t.oid,false)||'|function='||md5(pg_get_functiondef(p.oid)) item
        from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_proc p on p.oid=t.tgfoid
        where n.nspname in('auth','storage') and not t.tgisinternal
        union all
        select 'policy|'||n.nspname||'.'||c.relname||'.'||p.polname||'|'||p.polcmd::text||'|'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||'|'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') item
        from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname in('auth','storage')
      ) managed_items
    ),
    'defaultPrivilegesMd5', (
      select md5(coalesce(string_agg(r.rolname||'|'||coalesce(n.nspname,'')||'|'||d.defaclobjtype::text||'|'||d.defaclacl::text,E'\n' order by r.rolname,n.nspname,d.defaclobjtype),''))
      from pg_catalog.pg_default_acl d join pg_catalog.pg_roles r on r.oid=d.defaclrole
      left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace
    )
  ),
  'keyAmounts', jsonb_build_object(
    'currency', 'CNY',
    'customerPayments', round(
      coalesce((select sum(amount) from public.deal_payments), 0)
      - coalesce((select sum(amount) from public.deal_payment_reversals), 0), 2
    ),
    'internalPayables', round(coalesce((select sum(internal_due) from public.deal_orders), 0), 2),
    'salesProfit', round(
      coalesce((select sum(amount) from public.deal_payments), 0)
      - coalesce((select sum(amount) from public.deal_payment_reversals), 0)
      - coalesce((select sum(amount) from public.deal_procurement_cost_payments), 0)
      - coalesce((select sum(amount) from public.deal_sales_expenses), 0)
      + coalesce((select sum(amount) from public.profit_adjustments where adjustment_type = 'quarterly_rebate'), 0)
      - coalesce((select sum(amount) from public.profit_adjustments where adjustment_type = 'expense'), 0), 2
    ),
    'points', round(coalesce((select sum(official_points) from public.performance_quarterly_targets), 0), 2),
    'laborEarnings', round(coalesce((
      select sum(amount)
      from public.finance_records
      where record_type = 'expense'
        and category in (
          convert_from(decode('e5b7a5e8b584','hex'),'UTF8'),
          convert_from(decode('e58886e7baa2','hex'),'UTF8')
        )
    ), 0), 2)
  ),
  'rawLedgers', jsonb_build_object(
    'customerPaymentGross', round(coalesce((select sum(amount) from public.deal_payments), 0), 2),
    'customerPaymentReversals', round(coalesce((select sum(amount) from public.deal_payment_reversals), 0), 2),
    'internalDue', round(coalesce((select sum(internal_due) from public.deal_orders), 0), 2),
    'internalPaid', round(coalesce((select sum(internal_paid) from public.deal_orders), 0), 2),
    'internalSettlements', round(coalesce((select sum(amount) from public.deal_internal_settlements), 0), 2),
    'procurementPayments', round(coalesce((select sum(amount) from public.deal_procurement_cost_payments), 0), 2),
    'salesExpenses', round(coalesce((select sum(amount) from public.deal_sales_expenses), 0), 2),
    'quarterlyRebates', round(coalesce((select sum(amount) from public.profit_adjustments where adjustment_type = 'quarterly_rebate'), 0), 2),
    'companyExpenses', round(coalesce((select sum(amount) from public.profit_adjustments where adjustment_type = 'expense'), 0), 2)
  ),
  'inventory', jsonb_build_object(
    'onHand', round(coalesce((select sum(quantity) from public.fulfillment_inventory_stock), 0), 2),
    'reserved', round(coalesce((select sum(reserved_quantity) from public.fulfillment_inventory_stock), 0), 2),
    'shipped', round(coalesce((select sum(quantity) from public.fulfillment_inventory_reservations where status = 'shipped'), 0), 2)
  )
)::text;
