-- C6: after-sales handoff, implementation closure, renewal queue and append-only cancellation.

create table public.fulfillment_after_sales_tasks(
 id uuid primary key default gen_random_uuid(),
 team_id text not null references public.teams(id),
 order_id uuid not null,
 due_at timestamptz not null,
 status text not null default 'pending' check(status in('pending','submitted','accepted')),
 group_created_at timestamptz,
 checklist jsonb not null default '{}'::jsonb check(jsonb_typeof(checklist)='object'),
 submitted_by uuid references public.profiles(id),submitted_at timestamptz,submit_idempotency_key uuid,
 accepted_by uuid references public.profiles(id),accepted_at timestamptz,accept_idempotency_key uuid,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(team_id,id),unique(team_id,order_id),
 foreign key(team_id,order_id)references public.deal_orders(team_id,id)
);
create unique index fulfillment_after_sales_submit_key on public.fulfillment_after_sales_tasks(team_id,submit_idempotency_key)where submit_idempotency_key is not null;
create unique index fulfillment_after_sales_accept_key on public.fulfillment_after_sales_tasks(team_id,accept_idempotency_key)where accept_idempotency_key is not null;

create table public.deal_order_cancellations(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),order_id uuid not null,
 reason text not null,idempotency_key uuid not null,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(team_id,id),unique(team_id,idempotency_key),foreign key(team_id,order_id)references public.deal_orders(team_id,id)
);

alter table public.fulfillment_implementation add column completed_at timestamptz;
alter table public.fulfillment_implementation add column installation_idempotency_key uuid;
alter table public.fulfillment_implementation add column training_idempotency_key uuid;
create unique index fulfillment_implementation_install_key on public.fulfillment_implementation(team_id,installation_idempotency_key)where installation_idempotency_key is not null;
create unique index fulfillment_implementation_training_key on public.fulfillment_implementation(team_id,training_idempotency_key)where training_idempotency_key is not null;
create table public.fulfillment_service_expiry_changes(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),delivery_id uuid not null,
 previous_date date,new_date date not null,reason text not null,idempotency_key uuid not null,changed_by uuid not null references public.profiles(id),changed_at timestamptz not null default now(),
 unique(team_id,id),unique(team_id,idempotency_key),foreign key(team_id,delivery_id)references public.fulfillment_deliveries(team_id,id)
);

create or replace function public.create_after_sales_task_from_deposit()returns trigger
language plpgsql security definer set search_path='' as $function$
begin
 if new.payment_type in('deposit','full')then
  insert into public.fulfillment_after_sales_tasks(team_id,order_id,due_at)
  values(new.team_id,new.order_id,new.confirmed_at+interval'24 hours')
  on conflict(team_id,order_id)do nothing;
 end if;
 return new;
end
$function$;
drop trigger if exists create_after_sales_task_from_deposit on public.deal_payments;
create trigger create_after_sales_task_from_deposit after insert on public.deal_payments for each row execute function public.create_after_sales_task_from_deposit();

insert into public.fulfillment_after_sales_tasks(team_id,order_id,due_at)
select p.team_id,p.order_id,min(p.confirmed_at)+interval'24 hours'from public.deal_payments p
where p.payment_type in('deposit','full')group by p.team_id,p.order_id on conflict(team_id,order_id)do nothing;

create or replace function public.submit_after_sales_handoff(p_order_id uuid,p_checklist jsonb,p_idempotency_key uuid)
returns public.fulfillment_after_sales_tasks language plpgsql security definer set search_path='' as $function$
declare v_task public.fulfillment_after_sales_tasks;v_profile public.profiles;v_quote public.deal_quotes;
begin
 if p_idempotency_key is null or jsonb_typeof(coalesce(p_checklist,'{}'::jsonb))<>'object'then raise exception'VALID_HANDOFF_REQUIRED'using errcode='22023';end if;
 if not(coalesce((p_checklist->>'customer_context')::boolean,false)and coalesce((p_checklist->>'quoted_scope')::boolean,false)and coalesce((p_checklist->>'payment_context')::boolean,false)and coalesce((p_checklist->>'implementation_contact')::boolean,false))then raise exception'STANDARD_HANDOFF_CHECKLIST_REQUIRED'using errcode='23514';end if;
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';
 select t.*into v_task from public.fulfillment_after_sales_tasks t where t.order_id=p_order_id for update;
 select q.*into v_quote from public.deal_orders o join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id where o.id=v_task.order_id and o.team_id=v_task.team_id;
 if v_task.id is null or v_profile.id is null or v_task.team_id<>v_profile.team_id or not public.is_feature_enabled(v_task.team_id,'sales_os_v3')or not(v_quote.owner_id=v_profile.id or public.can_act_for(v_task.team_id,v_quote.owner_id)or public.has_permission(v_task.team_id,'customers.supervise'))then raise exception'HANDOFF_FORBIDDEN'using errcode='42501';end if;
 if v_task.submit_idempotency_key is not null then if v_task.submit_idempotency_key<>p_idempotency_key or v_task.checklist is distinct from p_checklist then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return v_task;end if;
 update public.fulfillment_after_sales_tasks set checklist=p_checklist,group_created_at=now(),submitted_by=v_profile.id,submitted_at=now(),submit_idempotency_key=p_idempotency_key,status='submitted',updated_at=now()where id=v_task.id returning*into v_task;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(v_task.team_id,v_profile.id,'fulfillment.after_sales_submitted','deal_order',v_task.order_id,'{}',to_jsonb(v_task));return v_task;
end
$function$;

create or replace function public.confirm_after_sales_handoff(p_order_id uuid,p_idempotency_key uuid)
returns public.fulfillment_after_sales_tasks language plpgsql security definer set search_path='' as $function$
declare v_task public.fulfillment_after_sales_tasks;v_profile public.profiles;
begin
 if p_idempotency_key is null then raise exception'IDEMPOTENCY_KEY_REQUIRED'using errcode='22023';end if;
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';select t.*into v_task from public.fulfillment_after_sales_tasks t where t.order_id=p_order_id for update;
 if v_task.id is null or v_profile.id is null or v_task.team_id<>v_profile.team_id or not public.fulfillment_authorized(v_task.team_id,'operations.manage')then raise exception'OPERATIONS_FORBIDDEN'using errcode='42501';end if;
 if v_task.accept_idempotency_key is not null then if v_task.accept_idempotency_key<>p_idempotency_key then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return v_task;end if;
 if v_task.submitted_at is null then raise exception'HANDOFF_NOT_SUBMITTED'using errcode='55000';end if;
 update public.fulfillment_after_sales_tasks set accepted_by=v_profile.id,accepted_at=now(),accept_idempotency_key=p_idempotency_key,status='accepted',updated_at=now()where id=v_task.id returning*into v_task;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(v_task.team_id,v_profile.id,'fulfillment.after_sales_accepted','deal_order',v_task.order_id,jsonb_build_object('status','submitted'),jsonb_build_object('status','accepted'));return v_task;
end
$function$;

drop function if exists public.mark_delivery_implementation(uuid,text);
create function public.mark_delivery_implementation(p_delivery_id uuid,p_step text,p_idempotency_key uuid)
returns public.fulfillment_implementation language plpgsql security definer set search_path='' as $function$
declare v_item public.fulfillment_implementation;v_profile public.profiles;v_existing uuid;v_before jsonb;
begin
 if p_step not in('installation','training')or p_idempotency_key is null then raise exception'VALID_IMPLEMENTATION_STEP_REQUIRED'using errcode='22023';end if;
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';select i.*into v_item from public.fulfillment_implementation i where i.delivery_id=p_delivery_id for update;
 if v_item.delivery_id is null or v_profile.id is null or v_item.team_id<>v_profile.team_id or not public.fulfillment_authorized(v_item.team_id,'implementation.manage')then raise exception'IMPLEMENTATION_FORBIDDEN'using errcode='42501';end if;
 v_existing:=case when p_step='installation'then v_item.installation_idempotency_key else v_item.training_idempotency_key end;
 if v_existing is not null then if v_existing<>p_idempotency_key then raise exception'IMPLEMENTATION_STEP_ALREADY_COMPLETED'using errcode='23505';end if;return v_item;end if;
 v_before:=to_jsonb(v_item);
 update public.fulfillment_implementation set
  installed_at=case when p_step='installation'then now()else installed_at end,installed_by=case when p_step='installation'then v_profile.id else installed_by end,installation_idempotency_key=case when p_step='installation'then p_idempotency_key else installation_idempotency_key end,
  trained_at=case when p_step='training'then now()else trained_at end,trained_by=case when p_step='training'then v_profile.id else trained_by end,training_idempotency_key=case when p_step='training'then p_idempotency_key else training_idempotency_key end,updated_at=now()
 where delivery_id=v_item.delivery_id returning*into v_item;
 if v_item.installed_at is not null and v_item.trained_at is not null and v_item.completed_at is null then update public.fulfillment_implementation set completed_at=now()where delivery_id=v_item.delivery_id returning*into v_item;update public.fulfillment_deliveries set status='handoff'where id=v_item.delivery_id and status not in('completed','cancelled');end if;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(v_item.team_id,v_profile.id,'fulfillment.implementation_'||p_step,'fulfillment_delivery',v_item.delivery_id,v_before,to_jsonb(v_item));return v_item;
end
$function$;

create or replace function public.sync_delivery_renewal_milestones()returns trigger
language plpgsql security definer set search_path='' as $function$
begin
 if new.service_expires_on is null then return new;end if;
 insert into public.fulfillment_renewal_milestones(team_id,delivery_id,days_before,due_on)
 select new.team_id,new.id,d.days,new.service_expires_on-d.days from unnest(array[60,30,15])d(days)
 on conflict(delivery_id,days_before)do update set due_on=excluded.due_on,status=case when public.fulfillment_renewal_milestones.status='completed'then'completed'else'pending'end;
 return new;
end
$function$;
drop trigger if exists sync_delivery_renewal_milestones on public.fulfillment_deliveries;
create trigger sync_delivery_renewal_milestones after insert or update of service_expires_on on public.fulfillment_deliveries for each row execute function public.sync_delivery_renewal_milestones();
update public.fulfillment_deliveries set service_expires_on=service_expires_on where service_expires_on is not null;

create or replace function public.set_delivery_service_expiry(p_delivery_id uuid,p_service_expires_on date,p_reason text,p_idempotency_key uuid)
returns public.fulfillment_deliveries language plpgsql security definer set search_path='' as $function$
declare v_delivery public.fulfillment_deliveries;v_profile public.profiles;v_before date;v_change public.fulfillment_service_expiry_changes;
begin
 if p_service_expires_on is null or nullif(trim(p_reason),'')is null or p_idempotency_key is null then raise exception'SERVICE_EXPIRY_REQUIRED'using errcode='22023';end if;
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';select d.*into v_delivery from public.fulfillment_deliveries d where d.id=p_delivery_id for update;
 if v_delivery.id is null or v_profile.id is null or v_delivery.team_id<>v_profile.team_id or not(public.fulfillment_authorized(v_delivery.team_id,'implementation.manage')or public.has_permission(v_delivery.team_id,'customers.supervise'))then raise exception'DELIVERY_FORBIDDEN'using errcode='42501';end if;
 select c.*into v_change from public.fulfillment_service_expiry_changes c where c.team_id=v_delivery.team_id and c.idempotency_key=p_idempotency_key;
 if v_change.id is not null then if v_change.delivery_id<>v_delivery.id or v_change.new_date<>p_service_expires_on or v_change.reason<>trim(p_reason)then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return v_delivery;end if;
 v_before:=v_delivery.service_expires_on;insert into public.fulfillment_service_expiry_changes(team_id,delivery_id,previous_date,new_date,reason,idempotency_key,changed_by)values(v_delivery.team_id,v_delivery.id,v_before,p_service_expires_on,trim(p_reason),p_idempotency_key,v_profile.id);
 update public.fulfillment_deliveries set service_expires_on=p_service_expires_on where id=v_delivery.id returning*into v_delivery;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(v_delivery.team_id,v_profile.id,'fulfillment.service_expiry_set','fulfillment_delivery',v_delivery.id,jsonb_build_object('service_expires_on',v_before),jsonb_build_object('service_expires_on',p_service_expires_on));return v_delivery;
end
$function$;

create or replace function public.get_renewal_action_queue()
returns table(order_id uuid,delivery_id uuid,days_before integer,due_on date,status text,urgency text)
language sql security definer stable set search_path='' as $function$
 select d.order_id,m.delivery_id,m.days_before,m.due_on,m.status,
  case when m.status='completed'then'completed'when m.due_on<(now()at time zone'Asia/Shanghai')::date then'overdue'when m.due_on=(now()at time zone'Asia/Shanghai')::date then'due_today'else'upcoming'end
 from public.fulfillment_renewal_milestones m join public.fulfillment_deliveries d on d.id=m.delivery_id and d.team_id=m.team_id
 where public.is_feature_enabled(m.team_id,'sales_os_v3')and(public.can_read_order_delivery(m.team_id,m.delivery_id)or public.has_permission(m.team_id,'customers.supervise')or public.has_permission(m.team_id,'operations.manage'))
 order by m.due_on,m.days_before desc
$function$;

create or replace function public.record_order_cancellation(p_order_id uuid,p_reason text,p_idempotency_key uuid)
returns public.deal_order_cancellations language plpgsql security definer set search_path='' as $function$
declare v_order public.deal_orders;v_profile public.profiles;v_cancel public.deal_order_cancellations;
begin
 if nullif(trim(p_reason),'')is null or p_idempotency_key is null then raise exception'CANCELLATION_REASON_REQUIRED'using errcode='22023';end if;
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';select o.*into v_order from public.deal_orders o where o.id=p_order_id;
 if v_order.id is null or v_profile.id is null or v_order.team_id<>v_profile.team_id or not public.is_feature_enabled(v_order.team_id,'sales_os_v3')or not public.has_permission(v_order.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;
 select c.*into v_cancel from public.deal_order_cancellations c where c.team_id=v_order.team_id and c.idempotency_key=p_idempotency_key;
 if v_cancel.id is not null then if v_cancel.order_id<>v_order.id or v_cancel.reason<>trim(p_reason)then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return v_cancel;end if;
 insert into public.deal_order_cancellations(team_id,order_id,reason,idempotency_key,created_by)values(v_order.team_id,v_order.id,trim(p_reason),p_idempotency_key,v_profile.id)returning*into v_cancel;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(v_order.team_id,v_profile.id,'deal.order_cancellation_recorded','deal_order',v_order.id,to_jsonb(v_order),jsonb_build_object('cancellation_id',v_cancel.id,'reason',v_cancel.reason));return v_cancel;
end
$function$;

create or replace function public.reverse_deal_payment(p_payment_id uuid,p_amount numeric,p_reason text,p_idempotency_key uuid)
returns public.deal_payment_reversals language plpgsql security definer set search_path='' as $function$
declare v_payment public.deal_payments;v_profile public.profiles;v_reversal public.deal_payment_reversals;v_total numeric;
begin
 if p_amount<=0 or nullif(trim(p_reason),'')is null or p_idempotency_key is null then raise exception'REVERSAL_INPUT_REQUIRED'using errcode='22023';end if;
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';select p.*into v_payment from public.deal_payments p where p.id=p_payment_id for update;
 if v_payment.id is null or v_profile.id is null or v_payment.team_id<>v_profile.team_id or not public.is_feature_enabled(v_payment.team_id,'sales_os_v3')or not public.has_permission(v_payment.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;
 select r.*into v_reversal from public.deal_payment_reversals r where r.team_id=v_payment.team_id and r.idempotency_key=p_idempotency_key;
 if v_reversal.id is not null then if v_reversal.payment_id<>v_payment.id or v_reversal.amount<>p_amount or v_reversal.reason<>trim(p_reason)then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return v_reversal;end if;
 select coalesce(sum(r.amount),0)into v_total from public.deal_payment_reversals r where r.team_id=v_payment.team_id and r.payment_id=v_payment.id;
 if v_total+p_amount>v_payment.amount then raise exception'REVERSAL_EXCEEDS_PAYMENT'using errcode='23514';end if;
 insert into public.deal_payment_reversals(team_id,payment_id,amount,reason,idempotency_key,confirmed_by)values(v_payment.team_id,v_payment.id,p_amount,trim(p_reason),p_idempotency_key,v_profile.id)returning*into v_reversal;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(v_payment.team_id,v_profile.id,'deal.payment_reversed','deal_payment',v_payment.id,jsonb_build_object('reversed',v_total),jsonb_build_object('reversed',v_total+p_amount,'reversal_id',v_reversal.id));return v_reversal;
end
$function$;

create or replace function public.get_order_reversal_workbench(p_order_id uuid)
returns table(payment_id uuid,payment_type text,original_amount numeric,reversed_amount numeric,reversible_amount numeric,confirmed_at timestamptz,external_ref text)
language plpgsql security definer stable set search_path='' as $function$
declare v_order public.deal_orders;v_profile public.profiles;
begin
 select p.*into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';
 select o.*into v_order from public.deal_orders o where o.id=p_order_id;
 if v_order.id is null or v_profile.id is null or v_order.team_id<>v_profile.team_id or not public.is_feature_enabled(v_order.team_id,'sales_os_v3')or not public.has_permission(v_order.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;
 return query select p.id,p.payment_type,p.amount,coalesce(sum(r.amount),0),p.amount-coalesce(sum(r.amount),0),p.confirmed_at,p.external_ref
 from public.deal_payments p left join public.deal_payment_reversals r on r.payment_id=p.id and r.team_id=p.team_id
 where p.order_id=v_order.id and p.team_id=v_order.team_id group by p.id,p.payment_type,p.amount,p.confirmed_at,p.external_ref having p.amount-coalesce(sum(r.amount),0)>0 order by p.confirmed_at desc;
end
$function$;

alter table public.fulfillment_after_sales_tasks enable row level security;
alter table public.deal_order_cancellations enable row level security;
alter table public.fulfillment_service_expiry_changes enable row level security;
create policy "after sales feature gate"on public.fulfillment_after_sales_tasks as restrictive for all to authenticated using(public.is_feature_enabled(team_id,'sales_os_v3'))with check(public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "after sales order roles read"on public.fulfillment_after_sales_tasks for select to authenticated using(exists(select 1 from public.deal_orders o join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id where o.id=fulfillment_after_sales_tasks.order_id and o.team_id=fulfillment_after_sales_tasks.team_id and(q.owner_id=auth.uid()or public.can_act_for(fulfillment_after_sales_tasks.team_id,q.owner_id)or public.has_permission(fulfillment_after_sales_tasks.team_id,'customers.supervise')or public.has_permission(fulfillment_after_sales_tasks.team_id,'operations.manage'))));
create policy "cancellations feature gate"on public.deal_order_cancellations as restrictive for all to authenticated using(public.is_feature_enabled(team_id,'sales_os_v3'))with check(public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "cancellations finance read"on public.deal_order_cancellations for select to authenticated using(public.has_permission(team_id,'finance.read')or public.has_permission(team_id,'finance.manage'));
create policy "service expiry feature gate"on public.fulfillment_service_expiry_changes as restrictive for all to authenticated using(public.is_feature_enabled(team_id,'sales_os_v3'))with check(public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "service expiry changes read"on public.fulfillment_service_expiry_changes for select to authenticated using(public.can_read_order_delivery(team_id,delivery_id)or public.has_permission(team_id,'customers.supervise')or public.has_permission(team_id,'operations.manage'));

revoke all on function public.submit_after_sales_handoff(uuid,jsonb,uuid),public.confirm_after_sales_handoff(uuid,uuid),public.mark_delivery_implementation(uuid,text,uuid),public.set_delivery_service_expiry(uuid,date,text,uuid),public.get_renewal_action_queue(),public.record_order_cancellation(uuid,text,uuid),public.get_order_reversal_workbench(uuid)from public;
grant execute on function public.submit_after_sales_handoff(uuid,jsonb,uuid),public.confirm_after_sales_handoff(uuid,uuid),public.mark_delivery_implementation(uuid,text,uuid),public.set_delivery_service_expiry(uuid,date,text,uuid),public.get_renewal_action_queue(),public.record_order_cancellation(uuid,text,uuid),public.get_order_reversal_workbench(uuid)to authenticated;
notify pgrst,'reload schema';
