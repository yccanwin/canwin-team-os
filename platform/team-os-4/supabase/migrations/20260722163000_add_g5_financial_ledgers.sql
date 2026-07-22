-- G5 append-only financial foundations. Refund flows are intentionally deferred.

create table public.payment_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  order_id uuid not null,
  actor_user_id uuid not null,
  event_type text not null,
  payment_amount numeric(14,2) not null,
  reversal_of_id bigint,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  constraint payment_events_order_company_fk foreign key (order_id, company_id)
    references public.orders(id, company_id) on delete restrict,
  constraint payment_events_actor_company_fk foreign key (actor_user_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint payment_events_idempotency unique (company_id, idempotency_key),
  constraint payment_events_company_order_identity unique (id, company_id, order_id),
  constraint payment_events_reversal_fk foreign key (reversal_of_id, company_id, order_id)
    references public.payment_events(id, company_id, order_id) on delete restrict,
  constraint payment_events_type check (event_type in ('confirmed', 'reversed')),
  constraint payment_events_amount_positive check (payment_amount > 0),
  constraint payment_events_reversal_consistent check (
    (event_type = 'confirmed' and reversal_of_id is null)
    or (event_type = 'reversed' and reversal_of_id is not null)
  )
);

create table public.internal_payment_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  order_id uuid not null,
  actor_user_id uuid not null,
  event_type text not null,
  internal_payment_amount numeric(14,2) not null,
  reversal_of_id bigint,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  constraint internal_payment_events_order_company_fk foreign key (order_id, company_id)
    references public.orders(id, company_id) on delete restrict,
  constraint internal_payment_events_actor_company_fk foreign key (actor_user_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint internal_payment_events_idempotency unique (company_id, idempotency_key),
  constraint internal_payment_events_company_order_identity unique (id, company_id, order_id),
  constraint internal_payment_events_reversal_fk foreign key (reversal_of_id, company_id, order_id)
    references public.internal_payment_events(id, company_id, order_id) on delete restrict,
  constraint internal_payment_events_type check (event_type in ('confirmed', 'reversed')),
  constraint internal_payment_events_amount_positive check (internal_payment_amount > 0),
  constraint internal_payment_events_reversal_consistent check (
    (event_type = 'confirmed' and reversal_of_id is null)
    or (event_type = 'reversed' and reversal_of_id is not null)
  )
);

create table public.profit_ledger_entries (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  order_id uuid not null,
  actor_user_id uuid not null,
  beneficiary_user_id uuid,
  entry_type text not null,
  profit_amount numeric(14,2) not null,
  reversal_of_id bigint,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  constraint profit_entries_order_company_fk foreign key (order_id, company_id)
    references public.orders(id, company_id) on delete restrict,
  constraint profit_entries_actor_company_fk foreign key (actor_user_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint profit_entries_beneficiary_company_fk foreign key (beneficiary_user_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint profit_entries_idempotency unique (company_id, idempotency_key),
  constraint profit_entries_company_order_identity unique (id, company_id, order_id),
  constraint profit_entries_reversal_fk foreign key (reversal_of_id, company_id, order_id)
    references public.profit_ledger_entries(id, company_id, order_id) on delete restrict,
  constraint profit_entries_type check (entry_type in ('recognized', 'reversed')),
  constraint profit_entries_amount_positive check (profit_amount > 0),
  constraint profit_entries_reversal_consistent check (
    (entry_type = 'recognized' and reversal_of_id is null)
    or (entry_type = 'reversed' and reversal_of_id is not null)
  )
);

create table public.labor_earnings (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  order_id uuid not null,
  actor_user_id uuid not null,
  beneficiary_user_id uuid not null,
  entry_type text not null,
  labor_earning_amount numeric(14,2) not null,
  reversal_of_id bigint,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  constraint labor_earnings_order_company_fk foreign key (order_id, company_id)
    references public.orders(id, company_id) on delete restrict,
  constraint labor_earnings_actor_company_fk foreign key (actor_user_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint labor_earnings_beneficiary_company_fk foreign key (beneficiary_user_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint labor_earnings_idempotency unique (company_id, idempotency_key),
  constraint labor_earnings_company_order_identity unique (id, company_id, order_id),
  constraint labor_earnings_reversal_fk foreign key (reversal_of_id, company_id, order_id)
    references public.labor_earnings(id, company_id, order_id) on delete restrict,
  constraint labor_earnings_type check (entry_type in ('recognized', 'reversed')),
  constraint labor_earnings_amount_positive check (labor_earning_amount > 0),
  constraint labor_earnings_reversal_consistent check (
    (entry_type = 'recognized' and reversal_of_id is null)
    or (entry_type = 'reversed' and reversal_of_id is not null)
  )
);

create or replace function private.prevent_financial_ledger_mutation()
returns trigger language plpgsql set search_path = '' as $function$
begin raise exception 'financial ledger rows are immutable; append a reversal instead' using errcode = '55000'; end;
$function$;
revoke all on function private.prevent_financial_ledger_mutation() from public;

create trigger payment_events_immutable before update or delete on public.payment_events
for each row execute function private.prevent_financial_ledger_mutation();
create trigger internal_payment_events_immutable before update or delete on public.internal_payment_events
for each row execute function private.prevent_financial_ledger_mutation();
create trigger profit_ledger_entries_immutable before update or delete on public.profit_ledger_entries
for each row execute function private.prevent_financial_ledger_mutation();
create trigger labor_earnings_immutable before update or delete on public.labor_earnings
for each row execute function private.prevent_financial_ledger_mutation();

alter table public.payment_events enable row level security;
alter table public.internal_payment_events enable row level security;
alter table public.profit_ledger_entries enable row level security;
alter table public.labor_earnings enable row level security;
revoke all on table public.payment_events, public.internal_payment_events,
  public.profit_ledger_entries, public.labor_earnings from anon, authenticated;
grant select on table public.payment_events, public.internal_payment_events,
  public.profit_ledger_entries, public.labor_earnings to authenticated;
grant select, insert on table public.payment_events, public.internal_payment_events,
  public.profit_ledger_entries, public.labor_earnings to service_role;
grant usage, select on sequence public.payment_events_id_seq,
  public.internal_payment_events_id_seq, public.profit_ledger_entries_id_seq,
  public.labor_earnings_id_seq to service_role;

create policy payment_events_select_finance_or_admin on public.payment_events for select to authenticated
using (private.is_company_admin(company_id) or exists (select 1 from public.profiles p join public.primary_roles r on r.id=p.primary_role_id and r.company_id=p.company_id where p.id=(select auth.uid()) and p.company_id=payment_events.company_id and p.is_active and r.is_active and r.role_key='finance'));
create policy internal_payment_events_select_finance_or_admin on public.internal_payment_events for select to authenticated
using (private.is_company_admin(company_id) or exists (select 1 from public.profiles p join public.primary_roles r on r.id=p.primary_role_id and r.company_id=p.company_id where p.id=(select auth.uid()) and p.company_id=internal_payment_events.company_id and p.is_active and r.is_active and r.role_key='finance'));
create policy profit_entries_select_finance_admin_or_self on public.profit_ledger_entries for select to authenticated
using (beneficiary_user_id=(select auth.uid()) or private.is_company_admin(company_id) or exists (select 1 from public.profiles p join public.primary_roles r on r.id=p.primary_role_id and r.company_id=p.company_id where p.id=(select auth.uid()) and p.company_id=profit_ledger_entries.company_id and p.is_active and r.is_active and r.role_key='finance'));
create policy labor_earnings_select_finance_admin_or_self on public.labor_earnings for select to authenticated
using (beneficiary_user_id=(select auth.uid()) or private.is_company_admin(company_id) or exists (select 1 from public.profiles p join public.primary_roles r on r.id=p.primary_role_id and r.company_id=p.company_id where p.id=(select auth.uid()) and p.company_id=labor_earnings.company_id and p.is_active and r.is_active and r.role_key='finance'));
