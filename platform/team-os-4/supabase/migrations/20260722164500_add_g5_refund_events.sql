-- G5 append-only refunds. Confirmed labor earnings are not modified or linked.

create table public.refund_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  order_id uuid not null,
  original_payment_event_id bigint not null,
  actor_user_id uuid not null,
  refund_case_key text not null,
  event_type text not null,
  refund_amount numeric(14,2) not null,
  reversal_of_id bigint,
  idempotency_key text not null,
  reason text not null,
  occurred_at timestamptz not null default now(),
  constraint refund_events_company_identity unique (id, company_id),
  constraint refund_events_company_order_identity unique (id, company_id, order_id),
  constraint refund_events_payment_fk foreign key (original_payment_event_id, company_id, order_id)
    references public.payment_events(id, company_id, order_id) on delete restrict,
  constraint refund_events_reversal_fk foreign key (reversal_of_id, company_id, order_id)
    references public.refund_events(id, company_id, order_id) on delete restrict,
  constraint refund_events_order_company_fk foreign key (order_id, company_id)
    references public.orders(id, company_id) on delete restrict,
  constraint refund_events_actor_company_fk foreign key (actor_user_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint refund_events_idempotency unique (company_id, idempotency_key),
  constraint refund_events_case_stage unique (company_id, refund_case_key, event_type),
  constraint refund_events_type check (event_type in ('requested', 'approved', 'confirmed', 'reversed')),
  constraint refund_events_amount_positive check (refund_amount > 0),
  constraint refund_events_case_not_blank check (btrim(refund_case_key) <> ''),
  constraint refund_events_reason_not_blank check (btrim(reason) <> ''),
  constraint refund_events_reversal_consistent check (
    (event_type <> 'reversed' and reversal_of_id is null)
    or (event_type = 'reversed' and reversal_of_id is not null)
  )
);

create table public.refund_responsibility_splits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  refund_event_id bigint not null,
  responsibility_type text not null,
  responsible_user_id uuid,
  split_amount numeric(14,2) not null,
  constraint refund_splits_event_company_fk foreign key (refund_event_id, company_id)
    references public.refund_events(id, company_id) on delete restrict,
  constraint refund_splits_user_company_fk foreign key (responsible_user_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint refund_splits_identity unique nulls not distinct (
    refund_event_id, responsibility_type, responsible_user_id
  ),
  constraint refund_splits_type check (responsibility_type in ('company', 'sales')),
  constraint refund_splits_amount_positive check (split_amount > 0),
  constraint refund_splits_user_consistent check (
    (responsibility_type = 'company' and responsible_user_id is null)
    or (responsibility_type = 'sales' and responsible_user_id is not null)
  )
);

create or replace function private.enforce_refund_responsibility_total()
returns trigger language plpgsql set search_path = '' as $function$
declare v_refund_id bigint; v_required numeric(14,2); v_split numeric(14,2); v_event_type text;
begin
  if tg_table_name = 'refund_responsibility_splits' then
    v_refund_id := case when tg_op = 'DELETE' then old.refund_event_id else new.refund_event_id end;
  else
    v_refund_id := case when tg_op = 'DELETE' then old.id else new.id end;
  end if;
  select refund_amount, event_type into v_required, v_event_type from public.refund_events where id = v_refund_id;
  if v_required is null then return null; end if;
  if v_event_type <> 'confirmed' then
    if tg_table_name = 'refund_responsibility_splits' then
      raise exception 'responsibility splits are allowed only for confirmed refunds' using errcode = '23514';
    end if;
    return null;
  end if;
  select coalesce(sum(split_amount), 0) into v_split
  from public.refund_responsibility_splits where refund_event_id = v_refund_id;
  if v_split <> v_required then
    raise exception 'refund responsibility total % must equal refund amount %', v_split, v_required
      using errcode = '23514';
  end if;
  return null;
end;
$function$;
revoke all on function private.enforce_refund_responsibility_total() from public;

create constraint trigger refund_event_responsibility_total
after insert or update of refund_amount on public.refund_events
deferrable initially deferred for each row
execute function private.enforce_refund_responsibility_total();
create constraint trigger refund_split_responsibility_total
after insert or update or delete on public.refund_responsibility_splits
deferrable initially deferred for each row
execute function private.enforce_refund_responsibility_total();

create trigger refund_events_immutable before update or delete on public.refund_events
for each row execute function private.prevent_financial_ledger_mutation();
create trigger refund_splits_immutable before update or delete on public.refund_responsibility_splits
for each row execute function private.prevent_financial_ledger_mutation();

alter table public.refund_events enable row level security;
alter table public.refund_responsibility_splits enable row level security;
revoke all on table public.refund_events, public.refund_responsibility_splits from anon, authenticated;
grant select on table public.refund_events, public.refund_responsibility_splits to authenticated;
grant select, insert on table public.refund_events, public.refund_responsibility_splits to service_role;
grant usage, select on sequence public.refund_events_id_seq to service_role;

create policy refund_events_select_finance_or_admin on public.refund_events for select to authenticated
using (private.is_company_admin(company_id) or exists (select 1 from public.profiles p join public.primary_roles r on r.id=p.primary_role_id and r.company_id=p.company_id where p.id=(select auth.uid()) and p.company_id=refund_events.company_id and p.is_active and r.is_active and r.role_key='finance'));
create policy refund_splits_select_finance_or_admin on public.refund_responsibility_splits for select to authenticated
using (private.is_company_admin(company_id) or exists (select 1 from public.profiles p join public.primary_roles r on r.id=p.primary_role_id and r.company_id=p.company_id where p.id=(select auth.uid()) and p.company_id=refund_responsibility_splits.company_id and p.is_active and r.is_active and r.role_key='finance'));

comment on table public.refund_events is
  'Append-only refund lifecycle linked to the original payment and order. It never mutates labor_earnings.';
