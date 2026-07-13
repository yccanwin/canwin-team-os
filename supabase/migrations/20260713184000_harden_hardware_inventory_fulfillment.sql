-- Hardware inventory P0: finance/warehouse authorization, shortage context and payment-safe shipping.

alter table public.fulfillment_exceptions
  add column if not exists stock_id uuid references public.fulfillment_inventory_stock(id) on delete restrict,
  add column if not exists shortage_quantity numeric(12,2) check(shortage_quantity is null or shortage_quantity>0);

create unique index if not exists fulfillment_one_open_stock_shortage_idx
  on public.fulfillment_exceptions(delivery_id,stock_id)
  where exception_type='stock_shortage' and status='open' and stock_id is not null;

create or replace function public.fulfillment_authorized(p_team text,p_permission text)
returns boolean language sql security definer stable set search_path='' as $$
  select public.is_feature_enabled(p_team,'sales_os_v3') and
    (public.has_permission(p_team,p_permission)
      or (p_permission='inventory.manage' and public.has_permission(p_team,'finance.manage')))
$$;

create or replace function public.can_manage_delivery_hardware()
returns boolean language sql security definer stable set search_path='' as $$
  select exists(select 1 from public.profiles p
    where p.id=auth.uid() and p.status='active'
      and public.fulfillment_authorized(p.team_id,'inventory.manage'))
$$;

create policy "finance reads hardware deliveries" on public.fulfillment_deliveries
for select to authenticated using(public.has_permission(team_id,'finance.read') or public.has_permission(team_id,'finance.manage'));
create policy "finance reads hardware states" on public.fulfillment_states
for select to authenticated using(public.has_permission(team_id,'finance.read') or public.has_permission(team_id,'finance.manage'));
create policy "finance reads hardware exceptions" on public.fulfillment_exceptions
for select to authenticated using(public.has_permission(team_id,'finance.read') or public.has_permission(team_id,'finance.manage'));
create policy "finance manages stock reads" on public.fulfillment_inventory_stock
for select to authenticated using(public.has_permission(team_id,'finance.manage'));
create policy "finance manages reservation reads" on public.fulfillment_inventory_reservations
for select to authenticated using(public.has_permission(team_id,'finance.manage'));
create policy "finance manages movement reads" on public.fulfillment_inventory_movements
for select to authenticated using(public.has_permission(team_id,'finance.manage'));

create or replace function public.reserve_delivery_stock(
  p_delivery_id uuid,p_stock_id uuid,p_quantity numeric,p_expected_on date default null
) returns public.fulfillment_inventory_reservations language plpgsql security definer set search_path='' as $$
declare d public.fulfillment_deliveries;s public.fulfillment_inventory_stock;r public.profiles;
  res public.fulfillment_inventory_reservations;available numeric;item_name text;
begin
  if p_quantity is null or p_quantity<=0 then raise exception 'POSITIVE_QUANTITY_REQUIRED' using errcode='22023';end if;
  select * into r from public.profiles where id=auth.uid() and status='active';
  select * into d from public.fulfillment_deliveries where id=p_delivery_id;
  select * into s from public.fulfillment_inventory_stock where id=p_stock_id for update;
  if d.id is null or s.id is null or r.id is null or d.team_id<>s.team_id or d.team_id<>r.team_id then raise exception 'STOCK_NOT_FOUND' using errcode='P0002';end if;
  if not public.fulfillment_authorized(d.team_id,'inventory.manage') then raise exception 'INVENTORY_FORBIDDEN' using errcode='42501';end if;
  if not exists(select 1 from public.deal_orders o where o.id=d.order_id and o.team_id=d.team_id and o.fulfillment_allowed_at is not null and o.internal_paid>=o.internal_due) then raise exception 'INTERNAL_PAYMENT_REQUIRED' using errcode='23514';end if;
  available:=s.quantity-s.reserved_quantity;
  if available<p_quantity then
    select i.name into item_name from public.deal_catalog_items i where i.id=s.catalog_item_id and i.team_id=s.team_id;
    insert into public.fulfillment_exceptions(team_id,delivery_id,exception_type,details,expected_resolution_on,stock_id,shortage_quantity)
    values(d.team_id,d.id,'stock_shortage',coalesce(item_name,'硬件')||' 缺货',p_expected_on,s.id,p_quantity-available)
    on conflict(delivery_id,stock_id)where exception_type='stock_shortage' and status='open' and stock_id is not null
    do update set details=excluded.details,expected_resolution_on=excluded.expected_resolution_on,shortage_quantity=excluded.shortage_quantity;
    update public.fulfillment_states set hardware_status='shortage',updated_at=now() where delivery_id=d.id;
    return null;
  end if;
  update public.fulfillment_inventory_stock set reserved_quantity=reserved_quantity+p_quantity,updated_at=now() where id=s.id;
  insert into public.fulfillment_inventory_reservations(team_id,delivery_id,stock_id,quantity,created_by)
  values(d.team_id,d.id,s.id,p_quantity,r.id) returning * into res;
  insert into public.fulfillment_inventory_movements(team_id,stock_id,reservation_id,movement_type,quantity,actor_id)
  values(d.team_id,s.id,res.id,'reserve',p_quantity,r.id);
  update public.fulfillment_exceptions set status='resolved',resolved_at=now()
    where delivery_id=d.id and stock_id=s.id and exception_type='stock_shortage' and status='open';
  update public.fulfillment_states set hardware_status=case when exists(
    select 1 from public.fulfillment_exceptions e where e.delivery_id=d.id and e.exception_type='stock_shortage' and e.status='open'
  )then'shortage' else'reserved' end,updated_at=now() where delivery_id=d.id;
  return res;
end $$;

create or replace function public.ship_delivery_stock(p_reservation_id uuid)
returns public.fulfillment_inventory_reservations language plpgsql security definer set search_path='' as $$
declare res public.fulfillment_inventory_reservations;s public.fulfillment_inventory_stock;r public.profiles;
begin
  select * into r from public.profiles where id=auth.uid() and status='active';
  select * into res from public.fulfillment_inventory_reservations where id=p_reservation_id for update;
  if res.id is null or r.id is null or res.team_id<>r.team_id or not public.fulfillment_authorized(res.team_id,'inventory.manage') then raise exception 'RESERVATION_FORBIDDEN' using errcode='42501';end if;
  if not exists(select 1 from public.fulfillment_deliveries d join public.deal_orders o on o.id=d.order_id and o.team_id=d.team_id where d.id=res.delivery_id and o.fulfillment_allowed_at is not null and o.internal_paid>=o.internal_due) then raise exception 'INTERNAL_PAYMENT_REQUIRED' using errcode='23514';end if;
  if res.status='shipped' then return res;elsif res.status<>'reserved' then raise exception 'RESERVATION_NOT_ACTIVE' using errcode='55000';end if;
  select * into s from public.fulfillment_inventory_stock where id=res.stock_id for update;
  if s.quantity<res.quantity or s.reserved_quantity<res.quantity then raise exception 'INVENTORY_INVARIANT_FAILED' using errcode='23514';end if;
  update public.fulfillment_inventory_stock set quantity=quantity-res.quantity,reserved_quantity=reserved_quantity-res.quantity,updated_at=now() where id=s.id;
  update public.fulfillment_inventory_reservations set status='shipped',updated_at=now() where id=res.id returning * into res;
  insert into public.fulfillment_inventory_movements(team_id,stock_id,reservation_id,movement_type,quantity,actor_id) values(res.team_id,s.id,res.id,'ship',res.quantity,r.id);
  update public.fulfillment_states set hardware_status=case
    when exists(select 1 from public.fulfillment_exceptions e where e.delivery_id=res.delivery_id and e.exception_type='stock_shortage' and e.status='open')then'shortage'
    when exists(select 1 from public.fulfillment_inventory_reservations x where x.delivery_id=res.delivery_id and x.status='reserved')then'reserved'
    else'shipped'end,updated_at=now() where delivery_id=res.delivery_id;
  return res;
end $$;

create or replace function public.complete_delivery_hardware(p_delivery_id uuid)
returns public.fulfillment_states language plpgsql security definer set search_path='' as $$
declare s public.fulfillment_states;r public.profiles;
begin
  select * into r from public.profiles where id=auth.uid() and status='active';select * into s from public.fulfillment_states where delivery_id=p_delivery_id for update;
  if s.delivery_id is null or r.id is null or s.team_id<>r.team_id or not public.fulfillment_authorized(s.team_id,'inventory.manage') then raise exception 'INVENTORY_FORBIDDEN' using errcode='42501';end if;
  if not exists(select 1 from public.fulfillment_deliveries d join public.deal_orders o on o.id=d.order_id and o.team_id=d.team_id where d.id=s.delivery_id and o.fulfillment_allowed_at is not null and o.internal_paid>=o.internal_due) then raise exception 'INTERNAL_PAYMENT_REQUIRED' using errcode='23514';end if;
  if exists(select 1 from public.fulfillment_exceptions e where e.delivery_id=s.delivery_id and e.exception_type='stock_shortage' and e.status='open') then raise exception 'OPEN_STOCK_SHORTAGE' using errcode='23514';end if;
  if exists(select 1 from public.fulfillment_inventory_reservations x where x.delivery_id=s.delivery_id and x.status<>'shipped') then raise exception 'HARDWARE_NOT_SHIPPED' using errcode='23514';end if;
  if exists(select 1 from public.fulfillment_deliveries d join public.deal_orders o on o.id=d.order_id and o.team_id=d.team_id join public.deal_quote_lines ql on ql.quote_id=o.quote_id and ql.team_id=o.team_id where d.id=s.delivery_id and ql.item_type_snapshot='hardware') and not exists(select 1 from public.fulfillment_inventory_reservations x where x.delivery_id=s.delivery_id and x.status='shipped') then raise exception 'HARDWARE_NOT_SHIPPED' using errcode='23514';end if;
  update public.fulfillment_states set hardware_status='completed',updated_at=now() where delivery_id=s.delivery_id returning * into s;return s;
end $$;

revoke all on function public.can_manage_delivery_hardware() from public;
grant execute on function public.can_manage_delivery_hardware() to authenticated;
notify pgrst,'reload schema';
