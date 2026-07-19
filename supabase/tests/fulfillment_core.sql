do $$declare n int;begin
 select count(*)into n from unnest(array['fulfillment_deliveries','fulfillment_states','fulfillment_inventory_stock','fulfillment_inventory_reservations','fulfillment_inventory_movements','fulfillment_exceptions','fulfillment_implementation','fulfillment_handoffs','fulfillment_renewal_milestones'])x(t)where to_regclass('public.'||t)is null;if n<>0 then raise exception 'Missing % fulfillment tables',n;end if;
 if(select count(*)from pg_policies where schemaname='public' and tablename like 'fulfillment_%' and policyname='sales os v3 server gate' and permissive='RESTRICTIVE')<>9 then raise exception 'Fulfillment gates missing';end if;
 if(select count(*)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'fulfillment_%' and c.relkind='r' and c.relrowsecurity)<9 then raise exception 'Fulfillment RLS missing';end if;
 if position('for update' in lower(pg_get_functiondef('public.reserve_delivery_stock(uuid,uuid,numeric,date)'::regprocedure)))=0 or position('stock_shortage' in pg_get_functiondef('public.reserve_delivery_stock(uuid,uuid,numeric,date)'::regprocedure))=0 then raise exception 'Concurrent nonnegative reservation/shortage guard missing';end if;
 if position('OPEN_STOCK_SHORTAGE' in pg_get_functiondef('public.complete_delivery_hardware(uuid)'::regprocedure))=0 then raise exception 'Hardware shortage completion guard missing';end if;
 if position('INTERNAL_PAYMENT_REQUIRED' in pg_get_functiondef('public.create_order_delivery(uuid,uuid,date)'::regprocedure))=0 or position('INTERNAL_PAYMENT_REQUIRED' in pg_get_functiondef('public.set_delivery_software_active(uuid)'::regprocedure))=0 then raise exception 'Internal payment gate missing';end if;
 if position('INSTALLATION_AND_TRAINING_REQUIRED' in pg_get_functiondef('public.create_delivery_handoff(uuid,jsonb)'::regprocedure))=0 or position('operations.manage' in pg_get_functiondef('public.confirm_delivery_handoff(uuid)'::regprocedure))=0 then raise exception 'Implementation/handoff gates missing';end if;
 if(select count(*)from public.fulfillment_renewal_milestones where days_before not in(60,30,15))<>0 then raise exception 'Invalid renewal milestone';end if;
 if exists(select 1 from pg_policies where schemaname='public' and tablename='fulfillment_inventory_movements' and cmd in('UPDATE','DELETE','ALL'))then raise exception 'Inventory audit history mutable';end if;
 if has_function_privilege('anon','public.ship_delivery_stock(uuid)','EXECUTE')then raise exception 'Anon can ship stock';end if;
 if to_regprocedure('public.can_read_order_delivery(text,uuid)') is null
  or position('q.owner_id = auth.uid()' in pg_get_functiondef('public.can_read_order_delivery(text,uuid)'::regprocedure))=0
  or position('can_act_for' in pg_get_functiondef('public.can_read_order_delivery(text,uuid)'::regprocedure))=0
  or position('customers.manage' in pg_get_functiondef('public.can_read_order_delivery(text,uuid)'::regprocedure))>0
  or position('customers.supervise' in pg_get_functiondef('public.can_read_order_delivery(text,uuid)'::regprocedure))>0 then raise exception 'Owner/delegate-only delivery read helper missing';end if;
 if(select count(*)from pg_policies where schemaname='public' and tablename in('fulfillment_deliveries','fulfillment_states','fulfillment_exceptions','fulfillment_implementation','fulfillment_handoffs','fulfillment_renewal_milestones')
  and cmd='SELECT' and qual like '%can_read_order_delivery%')<>6 then raise exception 'Sales owner delivery read policies missing';end if;
 if exists(select 1 from pg_policies where schemaname='public' and tablename in('fulfillment_inventory_stock','fulfillment_inventory_reservations','fulfillment_inventory_movements')
  and (coalesce(qual,'') like '%can_read_order_delivery%' or coalesce(qual,'') like '%customers.manage%')) then raise exception 'Sales can read warehouse inventory';end if;
 if(select count(*)from pg_policies where schemaname='public' and tablename in('fulfillment_inventory_stock','fulfillment_inventory_reservations','fulfillment_inventory_movements')
  and cmd='SELECT' and qual like '%inventory.manage%')<>3 then raise exception 'Warehouse-only inventory reads missing';end if;
end$$;select 'fulfillment_core_ok'result;
