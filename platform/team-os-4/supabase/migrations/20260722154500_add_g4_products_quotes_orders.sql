-- G4 commercial foundation. Quotes never reserve inventory.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  name text not null,
  product_type text not null,
  external_key text not null,
  is_active boolean not null default true,
  constraint products_company_identity unique (id, company_id),
  constraint products_external_identity unique (company_id, external_key),
  constraint products_name_not_blank check (btrim(name) <> ''),
  constraint products_type check (product_type in ('software', 'hardware', 'service'))
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_id uuid not null,
  sales_owner_id uuid not null,
  status text not null default 'draft',
  currency text not null default 'CNY',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotes_company_identity unique (id, company_id),
  constraint quotes_customer_company_fk foreign key (customer_id, company_id)
    references public.customers(id, company_id) on delete restrict,
  constraint quotes_owner_company_fk foreign key (sales_owner_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint quotes_status check (status in ('draft', 'issued', 'accepted', 'expired', 'cancelled')),
  constraint quotes_currency check (currency = 'CNY')
);

create table public.product_price_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  product_id uuid not null,
  version integer not null,
  customer_sale_price numeric(14,2) not null,
  sales_internal_price numeric(14,2) not null,
  company_actual_cost numeric(14,2) not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  constraint product_price_versions_company_identity unique (id, company_id),
  constraint product_price_versions_product_company_fk foreign key (product_id, company_id)
    references public.products(id, company_id) on delete restrict,
  constraint product_price_versions_identity unique (company_id, product_id, version),
  constraint product_price_versions_nonnegative check (customer_sale_price >= 0 and sales_internal_price >= 0 and company_actual_cost >= 0),
  constraint product_price_versions_time_order check (effective_to is null or effective_to > effective_from)
);

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  quote_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,3) not null,
  customer_sale_price numeric(14,2) not null,
  sales_internal_price numeric(14,2) not null,
  company_actual_cost numeric(14,2) not null,
  product_snapshot jsonb not null,
  constraint quote_lines_company_identity unique (id, company_id),
  constraint quote_lines_quote_company_fk foreign key (quote_id, company_id)
    references public.quotes(id, company_id) on delete restrict,
  constraint quote_lines_product_company_fk foreign key (product_id, company_id)
    references public.products(id, company_id) on delete restrict,
  constraint quote_lines_quantity_positive check (quantity > 0),
  constraint quote_lines_prices_nonnegative check (customer_sale_price >= 0 and sales_internal_price >= 0 and company_actual_cost >= 0),
  constraint quote_lines_snapshot_object check (jsonb_typeof(product_snapshot) = 'object')
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  quote_id uuid not null,
  customer_id uuid not null,
  sales_owner_id uuid not null,
  status text not null default 'pending_payment',
  frozen_quote_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_company_identity unique (id, company_id),
  constraint orders_quote_identity unique (company_id, quote_id),
  constraint orders_quote_company_fk foreign key (quote_id, company_id)
    references public.quotes(id, company_id) on delete restrict,
  constraint orders_customer_company_fk foreign key (customer_id, company_id)
    references public.customers(id, company_id) on delete restrict,
  constraint orders_owner_company_fk foreign key (sales_owner_id, company_id)
    references public.profiles(id, company_id) on delete restrict,
  constraint orders_status check (status in ('pending_payment', 'confirmed', 'fulfilling', 'completed', 'cancelled')),
  constraint orders_quote_snapshot_object check (jsonb_typeof(frozen_quote_snapshot) = 'object')
);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  order_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,3) not null,
  customer_sale_price numeric(14,2) not null,
  sales_internal_price numeric(14,2) not null,
  company_actual_cost numeric(14,2) not null,
  product_snapshot jsonb not null,
  constraint order_lines_company_identity unique (id, company_id),
  constraint order_lines_order_company_fk foreign key (order_id, company_id)
    references public.orders(id, company_id) on delete restrict,
  constraint order_lines_product_company_fk foreign key (product_id, company_id)
    references public.products(id, company_id) on delete restrict,
  constraint order_lines_quantity_positive check (quantity > 0),
  constraint order_lines_prices_nonnegative check (customer_sale_price >= 0 and sales_internal_price >= 0 and company_actual_cost >= 0),
  constraint order_lines_snapshot_object check (jsonb_typeof(product_snapshot) = 'object')
);

create table public.order_line_store_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  order_line_id uuid not null,
  store_id uuid not null,
  quantity numeric(14,3) not null,
  constraint order_line_store_allocations_line_store unique (order_line_id, store_id),
  constraint allocations_order_line_company_fk foreign key (order_line_id, company_id)
    references public.order_lines(id, company_id) on delete restrict,
  constraint allocations_store_company_fk foreign key (store_id, company_id)
    references public.stores(id, company_id) on delete restrict,
  constraint allocations_quantity_positive check (quantity > 0)
);

create or replace function private.enforce_order_line_store_allocation_total()
returns trigger language plpgsql set search_path = '' as $function$
declare v_line_id uuid; v_required numeric(14,3); v_allocated numeric(14,3);
begin
  if tg_table_name = 'order_line_store_allocations' then
    v_line_id := case when tg_op = 'DELETE' then old.order_line_id else new.order_line_id end;
  else
    v_line_id := case when tg_op = 'DELETE' then old.id else new.id end;
  end if;
  select quantity into v_required from public.order_lines where id = v_line_id;
  if v_required is null then return null; end if;
  select coalesce(sum(quantity), 0) into v_allocated
  from public.order_line_store_allocations where order_line_id = v_line_id;
  if v_allocated <> v_required then
    raise exception 'store allocation total % must equal order line quantity %', v_allocated, v_required
      using errcode = '23514';
  end if;
  return null;
end;
$function$;

create constraint trigger allocations_total_matches_order_line
after insert or update or delete on public.order_line_store_allocations
deferrable initially deferred for each row
execute function private.enforce_order_line_store_allocation_total();
create constraint trigger order_line_quantity_matches_allocations
after insert or update of quantity on public.order_lines
deferrable initially deferred for each row
execute function private.enforce_order_line_store_allocation_total();

revoke all on function private.enforce_order_line_store_allocation_total() from public;

alter table public.products enable row level security;
alter table public.product_price_versions enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_lines enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.order_line_store_allocations enable row level security;

revoke all on table public.products, public.product_price_versions, public.quotes, public.quote_lines, public.orders,
  public.order_lines, public.order_line_store_allocations from anon, authenticated;
grant select on table public.products, public.product_price_versions, public.quotes, public.quote_lines, public.orders,
  public.order_lines, public.order_line_store_allocations to authenticated;
grant all privileges on table public.products, public.product_price_versions, public.quotes, public.quote_lines, public.orders,
  public.order_lines, public.order_line_store_allocations to service_role;

create policy products_select_member on public.products for select to authenticated
using (private.is_active_company_member(company_id));
create policy product_price_versions_select_sales_or_admin on public.product_price_versions for select to authenticated
using (private.is_company_admin(company_id) or exists (
  select 1 from public.profiles p join public.primary_roles r on r.id = p.primary_role_id and r.company_id = p.company_id
  where p.id = (select auth.uid()) and p.company_id = product_price_versions.company_id and p.is_active and r.role_key = 'sales'
));
create policy quotes_select_owner_or_admin on public.quotes for select to authenticated
using ((sales_owner_id = (select auth.uid()) and private.is_active_company_member(company_id)) or private.is_company_admin(company_id));
create policy quote_lines_select_owner_or_admin on public.quote_lines for select to authenticated
using (exists (select 1 from public.quotes q where q.id = quote_lines.quote_id and q.company_id = quote_lines.company_id and (q.sales_owner_id = (select auth.uid()) or private.is_company_admin(q.company_id))));
create policy orders_select_owner_or_admin on public.orders for select to authenticated
using ((sales_owner_id = (select auth.uid()) and private.is_active_company_member(company_id)) or private.is_company_admin(company_id));
create policy order_lines_select_owner_or_admin on public.order_lines for select to authenticated
using (exists (select 1 from public.orders o where o.id = order_lines.order_id and o.company_id = order_lines.company_id and (o.sales_owner_id = (select auth.uid()) or private.is_company_admin(o.company_id))));
create policy allocations_select_owner_or_admin on public.order_line_store_allocations for select to authenticated
using (exists (select 1 from public.order_lines ol join public.orders o on o.id = ol.order_id and o.company_id = ol.company_id where ol.id = order_line_store_allocations.order_line_id and ol.company_id = order_line_store_allocations.company_id and (o.sales_owner_id = (select auth.uid()) or private.is_company_admin(o.company_id))));
