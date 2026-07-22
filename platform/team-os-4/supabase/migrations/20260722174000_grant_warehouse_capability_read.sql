create or replace function private.has_active_capability(
  p_company_id uuid,
  p_capability_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.profile_capabilities pc
      on pc.profile_id = p.id
      and pc.company_id = p.company_id
      and pc.revoked_at is null
    join public.capabilities c
      on c.id = pc.capability_id
      and c.company_id = pc.company_id
      and c.is_active
    where p.id = (select auth.uid())
      and p.company_id = p_company_id
      and p.is_active
      and c.capability_key = p_capability_key
  );
$$;

revoke all on function private.has_active_capability(uuid, text) from public;
revoke all on function private.has_active_capability(uuid, text) from anon;
grant execute on function private.has_active_capability(uuid, text) to authenticated;
grant execute on function private.has_active_capability(uuid, text) to service_role;

drop policy warehouses_select_admin on public.warehouses;
create policy warehouses_select_admin_or_warehouse on public.warehouses
for select to authenticated
using (
  (select private.is_company_admin(company_id))
  or (select private.has_active_capability(company_id, 'warehouse'))
);

drop policy stock_items_select_admin on public.stock_items;
create policy stock_items_select_admin_or_warehouse on public.stock_items
for select to authenticated
using (
  (select private.is_company_admin(company_id))
  or (select private.has_active_capability(company_id, 'warehouse'))
);

drop policy inventory_events_select_admin on public.inventory_events;
create policy inventory_events_select_admin_or_warehouse on public.inventory_events
for select to authenticated
using (
  (select private.is_company_admin(company_id))
  or (select private.has_active_capability(company_id, 'warehouse'))
);

comment on function private.has_active_capability(uuid, text) is
  'Checks an active Team OS 4 capability assignment from trusted relational state; never from user_metadata.';
