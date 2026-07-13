-- CanWin Team OS 3.0 fulfilment core. Additive, feature-gated, RPC-driven.
create unique index if not exists crm_stores_team_id_key on public.crm_stores(team_id,id);

create table public.fulfillment_deliveries(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),order_id uuid not null,store_id uuid not null,
 status text not null default 'preparing' check(status in('preparing','implementing','handoff','completed','cancelled')),
 service_expires_on date,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),completed_at timestamptz,
 unique(team_id,id),unique(team_id,order_id,store_id),foreign key(team_id,order_id) references public.deal_orders(team_id,id),foreign key(team_id,store_id) references public.crm_stores(team_id,id)
);
create table public.fulfillment_states(
 delivery_id uuid primary key,team_id text not null references public.teams(id),software_status text not null default 'pending' check(software_status in('pending','opening','active','failed')),
 hardware_status text not null default 'pending' check(hardware_status in('pending','reserved','shortage','shipped','completed')),
 updated_at timestamptz not null default now(),unique(team_id,delivery_id),foreign key(team_id,delivery_id) references public.fulfillment_deliveries(team_id,id)
);
create table public.fulfillment_inventory_stock(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),catalog_item_id uuid not null,
 quantity numeric(12,2) not null default 0 check(quantity>=0),reserved_quantity numeric(12,2) not null default 0 check(reserved_quantity>=0 and reserved_quantity<=quantity),
 updated_at timestamptz not null default now(),unique(team_id,id),unique(team_id,catalog_item_id),foreign key(team_id,catalog_item_id) references public.deal_catalog_items(team_id,id)
);
create table public.fulfillment_inventory_reservations(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),delivery_id uuid not null,stock_id uuid not null,
 quantity numeric(12,2) not null check(quantity>0),status text not null default 'reserved' check(status in('reserved','released','shipped')),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(team_id,id),
 foreign key(team_id,delivery_id) references public.fulfillment_deliveries(team_id,id),foreign key(team_id,stock_id) references public.fulfillment_inventory_stock(team_id,id)
);
create table public.fulfillment_inventory_movements(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),stock_id uuid not null,reservation_id uuid,
 movement_type text not null check(movement_type in('reserve','release','ship','adjust_in')),quantity numeric(12,2) not null check(quantity>0),
 actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(team_id,id),foreign key(team_id,stock_id) references public.fulfillment_inventory_stock(team_id,id),foreign key(team_id,reservation_id) references public.fulfillment_inventory_reservations(team_id,id)
);
create table public.fulfillment_exceptions(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),delivery_id uuid not null,exception_type text not null check(exception_type in('stock_shortage','software_failure','other')),
 status text not null default 'open' check(status in('open','resolved','cancelled')),details text not null,expected_resolution_on date,resolved_at timestamptz,
 created_at timestamptz not null default now(),unique(team_id,id),foreign key(team_id,delivery_id) references public.fulfillment_deliveries(team_id,id)
);
create table public.fulfillment_implementation(
 delivery_id uuid primary key,team_id text not null references public.teams(id),installed_at timestamptz,installed_by uuid references public.profiles(id),
 trained_at timestamptz,trained_by uuid references public.profiles(id),updated_at timestamptz not null default now(),unique(team_id,delivery_id),foreign key(team_id,delivery_id) references public.fulfillment_deliveries(team_id,id)
);
create table public.fulfillment_handoffs(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),delivery_id uuid not null,status text not null default 'pending' check(status in('pending','confirmed')),
 checklist jsonb not null default '{}'::jsonb check(jsonb_typeof(checklist)='object'),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 confirmed_by uuid references public.profiles(id),confirmed_at timestamptz,unique(team_id,id),unique(team_id,delivery_id),foreign key(team_id,delivery_id) references public.fulfillment_deliveries(team_id,id)
);
create table public.fulfillment_renewal_milestones(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),delivery_id uuid not null,days_before integer not null check(days_before in(60,30,15)),
 due_on date not null,status text not null default 'pending' check(status in('pending','completed','overdue','cancelled')),completed_at timestamptz,created_at timestamptz not null default now(),
 unique(team_id,id),unique(delivery_id,days_before),foreign key(team_id,delivery_id) references public.fulfillment_deliveries(team_id,id)
);

create or replace function public.fulfillment_authorized(p_team text,p_permission text)
returns boolean language sql security definer stable set search_path='' as $$select public.is_feature_enabled(p_team,'sales_os_v3') and public.has_permission(p_team,p_permission)$$;

create or replace function public.can_read_order_delivery(p_team_id text,p_delivery_id uuid)
returns boolean language sql security definer stable set search_path='' as $$
 select public.is_feature_enabled(p_team_id,'sales_os_v3') and exists(
  select 1 from public.fulfillment_deliveries d
  join public.deal_orders o on o.id=d.order_id and o.team_id=d.team_id
  join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id
  join public.profiles p on p.id=auth.uid() and p.team_id=d.team_id and p.status='active'
  where d.id=p_delivery_id and d.team_id=p_team_id
    and(q.owner_id=auth.uid() or public.can_act_for(d.team_id,q.owner_id))
 )
$$;
revoke all on function public.can_read_order_delivery(text,uuid) from public;
grant execute on function public.can_read_order_delivery(text,uuid) to authenticated;

create or replace function public.create_order_delivery(p_order_id uuid,p_store_id uuid,p_service_expires_on date)
returns public.fulfillment_deliveries language plpgsql security definer set search_path='' as $$
declare o public.deal_orders;d public.fulfillment_deliveries;r public.profiles;
begin select * into r from public.profiles where id=auth.uid() and status='active';select * into o from public.deal_orders where id=p_order_id for update;
 if o.id is null or r.id is null or o.team_id<>r.team_id then raise exception 'ORDER_NOT_FOUND' using errcode='P0002';end if;
 if not(public.fulfillment_authorized(o.team_id,'implementation.manage') or public.has_permission(o.team_id,'customers.supervise')) then raise exception 'DELIVERY_FORBIDDEN' using errcode='42501';end if;
 if o.fulfillment_allowed_at is null or o.internal_paid<o.internal_due then raise exception 'INTERNAL_PAYMENT_REQUIRED' using errcode='23514';end if;
 insert into public.fulfillment_deliveries(team_id,order_id,store_id,service_expires_on,created_by) values(o.team_id,o.id,p_store_id,p_service_expires_on,r.id)
 on conflict(team_id,order_id,store_id) do update set service_expires_on=excluded.service_expires_on returning * into d;
 insert into public.fulfillment_states(team_id,delivery_id) values(d.team_id,d.id) on conflict(delivery_id) do nothing;
 insert into public.fulfillment_implementation(team_id,delivery_id) values(d.team_id,d.id) on conflict(delivery_id) do nothing;
 if p_service_expires_on is not null then insert into public.fulfillment_renewal_milestones(team_id,delivery_id,days_before,due_on)
  select d.team_id,d.id,m.days,p_service_expires_on-m.days from unnest(array[60,30,15]) as m(days) on conflict(delivery_id,days_before) do nothing;end if;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data) values(d.team_id,r.id,'delivery.created','fulfillment_delivery',d.id,to_jsonb(d));return d;end$$;

create or replace function public.reserve_delivery_stock(p_delivery_id uuid,p_stock_id uuid,p_quantity numeric,p_expected_on date default null)
returns public.fulfillment_inventory_reservations language plpgsql security definer set search_path='' as $$
declare d public.fulfillment_deliveries;s public.fulfillment_inventory_stock;r public.profiles;res public.fulfillment_inventory_reservations;
begin if p_quantity<=0 then raise exception 'POSITIVE_QUANTITY_REQUIRED' using errcode='22023';end if;
 select * into r from public.profiles where id=auth.uid() and status='active';select * into d from public.fulfillment_deliveries where id=p_delivery_id;select * into s from public.fulfillment_inventory_stock where id=p_stock_id for update;
 if d.id is null or s.id is null or r.id is null or d.team_id<>s.team_id or d.team_id<>r.team_id then raise exception 'STOCK_NOT_FOUND' using errcode='P0002';end if;
 if not public.fulfillment_authorized(d.team_id,'inventory.manage') then raise exception 'INVENTORY_FORBIDDEN' using errcode='42501';end if;
 if not exists(select 1 from public.deal_orders o where o.id=d.order_id and o.team_id=d.team_id and o.fulfillment_allowed_at is not null and o.internal_paid>=o.internal_due) then raise exception 'INTERNAL_PAYMENT_REQUIRED' using errcode='23514';end if;
 if s.quantity-s.reserved_quantity<p_quantity then insert into public.fulfillment_exceptions(team_id,delivery_id,exception_type,details,expected_resolution_on) values(d.team_id,d.id,'stock_shortage','Insufficient stock',p_expected_on);
  update public.fulfillment_states set hardware_status='shortage',updated_at=now() where delivery_id=d.id;return null;end if;
 update public.fulfillment_inventory_stock set reserved_quantity=reserved_quantity+p_quantity,updated_at=now() where id=s.id;
 insert into public.fulfillment_inventory_reservations(team_id,delivery_id,stock_id,quantity,created_by) values(d.team_id,d.id,s.id,p_quantity,r.id) returning * into res;
 insert into public.fulfillment_inventory_movements(team_id,stock_id,reservation_id,movement_type,quantity,actor_id) values(d.team_id,s.id,res.id,'reserve',p_quantity,r.id);
 update public.fulfillment_states set hardware_status='reserved',updated_at=now() where delivery_id=d.id;return res;end$$;

create or replace function public.release_delivery_stock(p_reservation_id uuid)
returns public.fulfillment_inventory_reservations language plpgsql security definer set search_path='' as $$
declare res public.fulfillment_inventory_reservations;s public.fulfillment_inventory_stock;r public.profiles;
begin select * into r from public.profiles where id=auth.uid() and status='active';select * into res from public.fulfillment_inventory_reservations where id=p_reservation_id for update;
 if res.id is null or r.id is null or res.team_id<>r.team_id or not public.fulfillment_authorized(res.team_id,'inventory.manage') then raise exception 'RESERVATION_FORBIDDEN' using errcode='42501';end if;
 if res.status<>'reserved' then return res;end if;select * into s from public.fulfillment_inventory_stock where id=res.stock_id for update;
 update public.fulfillment_inventory_stock set reserved_quantity=reserved_quantity-res.quantity,updated_at=now() where id=s.id;
 update public.fulfillment_inventory_reservations set status='released',updated_at=now() where id=res.id returning * into res;
 insert into public.fulfillment_inventory_movements(team_id,stock_id,reservation_id,movement_type,quantity,actor_id) values(res.team_id,s.id,res.id,'release',res.quantity,r.id);return res;end$$;

create or replace function public.ship_delivery_stock(p_reservation_id uuid)
returns public.fulfillment_inventory_reservations language plpgsql security definer set search_path='' as $$
declare res public.fulfillment_inventory_reservations;s public.fulfillment_inventory_stock;r public.profiles;
begin select * into r from public.profiles where id=auth.uid() and status='active';select * into res from public.fulfillment_inventory_reservations where id=p_reservation_id for update;
 if res.id is null or r.id is null or res.team_id<>r.team_id or not public.fulfillment_authorized(res.team_id,'inventory.manage') then raise exception 'RESERVATION_FORBIDDEN' using errcode='42501';end if;
 if res.status='shipped' then return res;elsif res.status<>'reserved' then raise exception 'RESERVATION_NOT_ACTIVE' using errcode='55000';end if;select * into s from public.fulfillment_inventory_stock where id=res.stock_id for update;
 if s.quantity<res.quantity or s.reserved_quantity<res.quantity then raise exception 'INVENTORY_INVARIANT_FAILED' using errcode='23514';end if;
 update public.fulfillment_inventory_stock set quantity=quantity-res.quantity,reserved_quantity=reserved_quantity-res.quantity,updated_at=now() where id=s.id;
 update public.fulfillment_inventory_reservations set status='shipped',updated_at=now() where id=res.id returning * into res;
 insert into public.fulfillment_inventory_movements(team_id,stock_id,reservation_id,movement_type,quantity,actor_id) values(res.team_id,s.id,res.id,'ship',res.quantity,r.id);
 if not exists(select 1 from public.fulfillment_inventory_reservations x where x.delivery_id=res.delivery_id and x.status='reserved') then update public.fulfillment_states set hardware_status='shipped',updated_at=now() where delivery_id=res.delivery_id;end if;return res;end$$;

create or replace function public.set_delivery_software_active(p_delivery_id uuid)
returns public.fulfillment_states language plpgsql security definer set search_path='' as $$declare s public.fulfillment_states;r public.profiles;begin
 select * into r from public.profiles where id=auth.uid() and status='active';select * into s from public.fulfillment_states where delivery_id=p_delivery_id for update;
 if s.delivery_id is null or r.id is null or s.team_id<>r.team_id or not public.fulfillment_authorized(s.team_id,'implementation.manage') then raise exception 'IMPLEMENTATION_FORBIDDEN' using errcode='42501';end if;
 if not exists(select 1 from public.fulfillment_deliveries d join public.deal_orders o on o.id=d.order_id and o.team_id=d.team_id where d.id=s.delivery_id and o.fulfillment_allowed_at is not null and o.internal_paid>=o.internal_due) then raise exception 'INTERNAL_PAYMENT_REQUIRED' using errcode='23514';end if;
 update public.fulfillment_states set software_status='active',updated_at=now() where delivery_id=s.delivery_id returning * into s;return s;end$$;

create or replace function public.complete_delivery_hardware(p_delivery_id uuid)
returns public.fulfillment_states language plpgsql security definer set search_path='' as $$declare s public.fulfillment_states;r public.profiles;begin
 select * into r from public.profiles where id=auth.uid() and status='active';select * into s from public.fulfillment_states where delivery_id=p_delivery_id for update;
 if s.delivery_id is null or r.id is null or s.team_id<>r.team_id or not public.fulfillment_authorized(s.team_id,'inventory.manage') then raise exception 'INVENTORY_FORBIDDEN' using errcode='42501';end if;
 if exists(select 1 from public.fulfillment_exceptions e where e.delivery_id=s.delivery_id and e.exception_type='stock_shortage' and e.status='open') then raise exception 'OPEN_STOCK_SHORTAGE' using errcode='23514';end if;
 if exists(select 1 from public.fulfillment_inventory_reservations x where x.delivery_id=s.delivery_id and x.status<>'shipped') then raise exception 'HARDWARE_NOT_SHIPPED' using errcode='23514';end if;
 if exists(select 1 from public.fulfillment_deliveries d join public.deal_orders o on o.id=d.order_id and o.team_id=d.team_id join public.deal_quote_lines ql on ql.quote_id=o.quote_id and ql.team_id=o.team_id where d.id=s.delivery_id and ql.item_type_snapshot='hardware')
  and not exists(select 1 from public.fulfillment_inventory_reservations x where x.delivery_id=s.delivery_id and x.status='shipped') then raise exception 'HARDWARE_NOT_SHIPPED' using errcode='23514';end if;
 update public.fulfillment_states set hardware_status='completed',updated_at=now() where delivery_id=s.delivery_id returning * into s;return s;end$$;

create or replace function public.mark_delivery_implementation(p_delivery_id uuid,p_step text)
returns public.fulfillment_implementation language plpgsql security definer set search_path='' as $$declare i public.fulfillment_implementation;r public.profiles;begin
 if p_step not in('installation','training') then raise exception 'INVALID_IMPLEMENTATION_STEP' using errcode='22023';end if;
 select * into r from public.profiles where id=auth.uid() and status='active';select * into i from public.fulfillment_implementation where delivery_id=p_delivery_id for update;
 if i.delivery_id is null or r.id is null or i.team_id<>r.team_id or not public.fulfillment_authorized(i.team_id,'implementation.manage') then raise exception 'IMPLEMENTATION_FORBIDDEN' using errcode='42501';end if;
 update public.fulfillment_implementation set installed_at=case when p_step='installation' then coalesce(installed_at,now()) else installed_at end,installed_by=case when p_step='installation' then coalesce(installed_by,r.id) else installed_by end,
 trained_at=case when p_step='training' then coalesce(trained_at,now()) else trained_at end,trained_by=case when p_step='training' then coalesce(trained_by,r.id) else trained_by end,updated_at=now() where delivery_id=i.delivery_id returning * into i;return i;end$$;

create or replace function public.create_delivery_handoff(p_delivery_id uuid,p_checklist jsonb)
returns public.fulfillment_handoffs language plpgsql security definer set search_path='' as $$declare i public.fulfillment_implementation;h public.fulfillment_handoffs;r public.profiles;begin
 select * into r from public.profiles where id=auth.uid() and status='active';select * into i from public.fulfillment_implementation where delivery_id=p_delivery_id for update;
 if i.delivery_id is null or r.id is null or i.team_id<>r.team_id or not public.fulfillment_authorized(i.team_id,'implementation.manage') then raise exception 'IMPLEMENTATION_FORBIDDEN' using errcode='42501';end if;
 if i.installed_at is null or i.trained_at is null then raise exception 'INSTALLATION_AND_TRAINING_REQUIRED' using errcode='23514';end if;
 insert into public.fulfillment_handoffs(team_id,delivery_id,checklist,created_by) values(i.team_id,i.delivery_id,coalesce(p_checklist,'{}'),r.id) on conflict(team_id,delivery_id) do update set checklist=excluded.checklist returning * into h;
 update public.fulfillment_deliveries set status='handoff' where id=i.delivery_id;return h;end$$;

create or replace function public.confirm_delivery_handoff(p_handoff_id uuid)
returns public.fulfillment_deliveries language plpgsql security definer set search_path='' as $$declare h public.fulfillment_handoffs;d public.fulfillment_deliveries;s public.fulfillment_states;r public.profiles;begin
 select * into r from public.profiles where id=auth.uid() and status='active';select * into h from public.fulfillment_handoffs where id=p_handoff_id for update;
 if h.id is null or r.id is null or h.team_id<>r.team_id or not public.fulfillment_authorized(h.team_id,'operations.manage') then raise exception 'OPERATIONS_FORBIDDEN' using errcode='42501';end if;
 select * into s from public.fulfillment_states where delivery_id=h.delivery_id;
 if s.software_status<>'active' or s.hardware_status not in('completed','pending') then raise exception 'FULFILLMENT_NOT_COMPLETE' using errcode='23514';end if;
 if s.hardware_status='pending' and exists(select 1 from public.fulfillment_deliveries d join public.deal_orders o on o.id=d.order_id and o.team_id=d.team_id join public.deal_quote_lines ql on ql.quote_id=o.quote_id and ql.team_id=o.team_id where d.id=h.delivery_id and ql.item_type_snapshot='hardware') then raise exception 'FULFILLMENT_NOT_COMPLETE' using errcode='23514';end if;
 update public.fulfillment_handoffs set status='confirmed',confirmed_by=r.id,confirmed_at=now() where id=h.id;
 update public.fulfillment_deliveries set status='completed',completed_at=now() where id=h.delivery_id returning * into d;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data) values(d.team_id,r.id,'delivery.completed','fulfillment_delivery',d.id,to_jsonb(d));return d;end$$;

do$$declare t text;begin foreach t in array array['fulfillment_deliveries','fulfillment_states','fulfillment_inventory_stock','fulfillment_inventory_reservations','fulfillment_inventory_movements','fulfillment_exceptions','fulfillment_implementation','fulfillment_handoffs','fulfillment_renewal_milestones']loop
 execute format('alter table public.%I enable row level security',t);execute format('create policy "sales os v3 server gate" on public.%I as restrictive for all to authenticated using(public.is_feature_enabled(team_id,''sales_os_v3'')) with check(public.is_feature_enabled(team_id,''sales_os_v3''))',t);end loop;end$$;
create policy "delivery roles read" on public.fulfillment_deliveries for select to authenticated using(public.can_read_order_delivery(team_id,id) or public.has_permission(team_id,'customers.supervise') or public.has_permission(team_id,'implementation.manage') or public.has_permission(team_id,'operations.manage') or public.has_permission(team_id,'inventory.manage'));
create policy "delivery roles read states" on public.fulfillment_states for select to authenticated using(public.can_read_order_delivery(team_id,delivery_id) or public.has_permission(team_id,'customers.supervise') or public.has_permission(team_id,'implementation.manage') or public.has_permission(team_id,'operations.manage') or public.has_permission(team_id,'inventory.manage'));
create policy "inventory reads stock" on public.fulfillment_inventory_stock for select to authenticated using(public.has_permission(team_id,'inventory.manage'));
create policy "inventory reads reservations" on public.fulfillment_inventory_reservations for select to authenticated using(public.has_permission(team_id,'inventory.manage'));
create policy "inventory reads movements" on public.fulfillment_inventory_movements for select to authenticated using(public.has_permission(team_id,'inventory.manage'));
create policy "delivery roles read exceptions" on public.fulfillment_exceptions for select to authenticated using(public.can_read_order_delivery(team_id,delivery_id) or public.has_permission(team_id,'customers.supervise') or public.has_permission(team_id,'implementation.manage') or public.has_permission(team_id,'operations.manage') or public.has_permission(team_id,'inventory.manage'));
create policy "implementation reads checklist" on public.fulfillment_implementation for select to authenticated using(public.can_read_order_delivery(team_id,delivery_id) or public.has_permission(team_id,'implementation.manage') or public.has_permission(team_id,'operations.manage'));
create policy "handoff roles read" on public.fulfillment_handoffs for select to authenticated using(public.can_read_order_delivery(team_id,delivery_id) or public.has_permission(team_id,'implementation.manage') or public.has_permission(team_id,'operations.manage'));
create policy "renewal roles read" on public.fulfillment_renewal_milestones for select to authenticated using(public.can_read_order_delivery(team_id,delivery_id) or public.has_permission(team_id,'customers.supervise') or public.has_permission(team_id,'operations.manage'));

revoke all on function public.create_order_delivery(uuid,uuid,date),public.reserve_delivery_stock(uuid,uuid,numeric,date),public.release_delivery_stock(uuid),public.ship_delivery_stock(uuid),public.set_delivery_software_active(uuid),public.complete_delivery_hardware(uuid),public.mark_delivery_implementation(uuid,text),public.create_delivery_handoff(uuid,jsonb),public.confirm_delivery_handoff(uuid) from public;
grant execute on function public.create_order_delivery(uuid,uuid,date),public.reserve_delivery_stock(uuid,uuid,numeric,date),public.release_delivery_stock(uuid),public.ship_delivery_stock(uuid),public.set_delivery_software_active(uuid),public.complete_delivery_hardware(uuid),public.mark_delivery_implementation(uuid,text),public.create_delivery_handoff(uuid,jsonb),public.confirm_delivery_handoff(uuid) to authenticated;
notify pgrst,'reload schema';
